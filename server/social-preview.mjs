#!/usr/bin/env node
// Server-side social-preview renderer for link unfurling (Discord, Twitter/X,
// Slack, iMessage, etc).
//
// The main site (src/renderer) is a client-rendered SPA - src/renderer/src/lib/seo.ts
// rewrites <head> tags after React mounts, but crawlers that don't execute JS
// (Discordbot chief among them) only ever see the generic site-wide OG tags
// baked into src/renderer/index.html, no matter which /track/:id, /shared/:id
// or /news/:id URL was actually shared.
//
// nginx routes ONLY known bot user-agents on those three path prefixes to
// this process (see nginx-social-preview.conf.example); every other request
// keeps hitting the static SPA build directly, unchanged. This process
// fetches the real item from the API and returns a small standalone HTML
// page with per-item og:/twitter: tags - it is never rendered by a human, so
// no client JS, styling, or interactivity is needed here.
//
// Run: node server/social-preview.mjs
// Env: SOCIAL_PREVIEW_PORT (default 8788), SOCIAL_PREVIEW_HOST (default
// 127.0.0.1 - only nginx should reach this), JWAPI_BASE, SITE_ORIGIN,
// SITE_HOSTS (comma-separated hosts links may point back to),
// SOCIAL_PREVIEW_CACHE (track video cache dir), SOCIAL_PREVIEW_VIDEO=0 to
// turn playable track embeds off, SOCIAL_PREVIEW_UNFURL=0 to turn the chat
// link-preview endpoint (GET /unfurl?url=) off

import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import zlib from 'node:zlib'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { URL } from 'node:url'

const PORT = Number(process.env.SOCIAL_PREVIEW_PORT || 8788)
const HOST = process.env.SOCIAL_PREVIEW_HOST || '127.0.0.1'
const JWAPI_BASE = process.env.JWAPI_BASE || 'https://juicewrldapi.com/juicewrld'
const DEFAULT_ORIGIN = process.env.SITE_ORIGIN || 'https://player.juicewrldapi.com'
const SITE = 'unreleased'
const FETCH_TIMEOUT_MS = 5000

// The SPA builds share links from its own origin (platform.ts's shareOrigin),
// so a link copied on beta must unfurl with beta links. The Host nginx
// forwards picks the origin, limited to known hosts so a spoofed Host header
// can't point the embed anywhere else.
const SITE_HOSTS = new Set(
  (process.env.SITE_HOSTS || `${new URL(DEFAULT_ORIGIN).host},beta.juicewrldapi.com`)
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
)
const requestOrigin = new AsyncLocalStorage()
function originForHost(host) {
  const h = String(host || '').trim().toLowerCase()
  return SITE_HOSTS.has(h) ? `https://${h}` : DEFAULT_ORIGIN
}
const origin = () => requestOrigin.getStore() ?? DEFAULT_ORIGIN
const defaultImage = () => `${origin()}/icon-512.png`

// Same category labels as juicewrldApi.ts's CATEGORY_LABELS - kept in sync
// manually since this process never imports the client bundle.
const CATEGORY_LABELS = {
  released: 'Released',
  unreleased: 'Unreleased',
  unsurfaced: 'Unsurfaced',
  recording_session: 'Session',
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Same crude markdown -> plain text stripper as NewsView.tsx's stripMarkdown -
// keep the two in sync if that one changes.
function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Only list-bullet dashes - a bare "-" mid-sentence is punctuation.
    .replace(/^\s*[-*+]\s+/gm, ' ')
    .replace(/[#>*_~`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(text, max) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:-]+$/, '')}…`
}

// Discord Component Embeds (<script id="discord:component-embed">) render
// text as Discord markdown, so API-sourced strings must be escaped.
function escapeDiscordMarkdown(value) {
  return String(value).replace(/([\\*_~`|>#\[\]<])/g, '\\$1')
}

// Components V2 builders - only the subset component embeds allow.
const ACCENT_COLOR = 0x1db954 // index.css --accent
const text = (content) => ({ type: 10, content })
const mediaItem = (url, description) => ({ media: { url }, ...(description ? { description: String(description).slice(0, 256) } : {}) })
const thumbnail = (url, description) => ({ type: 11, ...mediaItem(url, description) })
const gallery = (items) => ({ type: 12, items: items.map(({ url, description }) => mediaItem(url, description)) })
const separator = () => ({ type: 14, divider: true, spacing: 1 })
const linkButtons = (...buttons) => ({
  type: 1,
  components: buttons.map(({ label, url, emoji }) => ({ type: 2, style: 5, label, url, ...(emoji ? { emoji: { name: emoji } } : {}) })),
})
const section = (texts, accessory) => ({ type: 9, components: texts, accessory })
const container = (components) => ({ component: { type: 17, accent_color: ACCENT_COLOR, components } })

// Discord rejects payloads over 3000 bytes. Serialized with <, > and & as
// \u escapes so no API string can close the <script> element early.
const COMPONENT_EMBED_MAX_BYTES = 3000
function serializeComponentEmbed(payload) {
  if (!payload) return null
  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
  return Buffer.byteLength(json, 'utf8') <= COMPONENT_EMBED_MAX_BYTES ? json : null
}

// Returns the richest variant that fits: `build` is called with each option
// set in turn (most detailed first) until one serializes under the cap.
function fitComponentEmbed(build, optionSets) {
  for (const options of optionSets) {
    const json = serializeComponentEmbed(build(options))
    if (json) return json
  }
  return null
}

// "3:12" / "1:02:03" -> seconds; null when unparseable.
function parseLength(value) {
  if (typeof value !== 'string' || !/^\d+(:\d{1,2}){1,2}$/.test(value.trim())) return null
  return value.trim().split(':').reduce((acc, part) => acc * 60 + Number(part), 0)
}

function formatTotalLength(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h} hr ${m} min` : `${m} min`
}

// News bodies are editor-written markdown, which Discord mostly renders as
// is. Images move out to the media gallery, #### and deeper (unsupported)
// become bold lines, and the cut lands on a line boundary so no link or
// emphasis is split - an unclosed code fence gets closed.
function newsBodyToDiscordMarkdown(body, max) {
  const images = []
  const md = String(body || '')
    .replace(/\r\n/g, '\n')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, src) => {
      images.push({ url: ensureHttpsMediaUrl(src), description: alt })
      return ''
    })
    .replace(/^#{4,}\s+(.+)$/gm, '**$1**')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (md.length <= max) return { markdown: md, images }
  let out = ''
  for (const line of md.split('\n')) {
    if (out.length + line.length + 1 > max) break
    out += (out ? '\n' : '') + line
  }
  out = out.trimEnd() || escapeDiscordMarkdown(truncate(stripMarkdown(md), max))
  if ((out.match(/^\s*```/gm) || []).length % 2) out += '\n```'
  return { markdown: `${out}\n…`, images }
}

// Mirrors newsApi.ts's ensureHttpsMediaUrl - some hosted URLs were saved back
// when the API's own origin was still plain http.
function ensureHttpsMediaUrl(url) {
  if (!url) return null
  if (url.startsWith('http://juicewrldapi.com')) return `https://${url.slice('http://'.length)}`
  return url
}

// Mirrors juicewrldApi.ts's buildImageUrl - a song's image_url is often a
// site-relative path ("/assets/youtube.webp"), sometimes the literal string
// "null" (see project_jwa_api_docs_drift), rarely already-absolute.
function buildImageUrl(imageUrl) {
  if (!imageUrl || imageUrl === 'null') return null
  if (/^https?:\/\//.test(imageUrl) || imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) return imageUrl
  const rel = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`
  return `https://${new URL(JWAPI_BASE).hostname}${rel}`
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// The shared-playlist API's response shape isn't pinned down anywhere - the
// client (SharedPlaylistView.tsx's parseTracks) walks the same set of
// candidate keys defensively. Kept intentionally simpler here: only a track
// count and the first track's path/name are needed for the preview.
function firstTrackArray(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return null
  for (const key of ['songs', 'items', 'tracks', 'results', 'playlist_songs', 'song_list', 'files', 'entries']) {
    const list = data[key]
    if (Array.isArray(list) && list.length) return list
  }
  if (data.data && typeof data.data === 'object') {
    const nested = firstTrackArray(data.data)
    if (nested) return nested
  }
  if (data.playlist && typeof data.playlist === 'object') {
    const nested = firstTrackArray(data.playlist)
    if (nested) return nested
  }
  return null
}

function trackPath(entry) {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') {
    if (entry.song && typeof entry.song === 'object') return trackPath(entry.song)
    return entry.path ?? entry.file_path ?? entry.url ?? null
  }
  return null
}

function playlistName(data) {
  if (data && typeof data === 'object') {
    if (typeof data.name === 'string' && data.name.trim()) return data.name.trim()
    if (data.playlist && typeof data.playlist === 'object' && typeof data.playlist.name === 'string' && data.playlist.name.trim()) {
      return data.playlist.name.trim()
    }
  }
  return null
}

function renderPage({ title, description, image, imageAlt, url, componentEmbed, video }) {
  const fullTitle = title.includes(SITE) ? title : `${title} · ${SITE}`
  const safeImage = image || null
  const videoTags = video
    ? `<meta property="og:video" content="${escapeHtml(video)}" />
<meta property="og:video:secure_url" content="${escapeHtml(video)}" />
<meta property="og:video:type" content="video/mp4" />
<meta property="og:video:width" content="${VIDEO_SIZE}" />
<meta property="og:video:height" content="${VIDEO_SIZE}" />`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(fullTitle)}</title>
<link rel="canonical" href="${escapeHtml(url)}" />
<meta name="robots" content="noindex, nofollow" />

<meta property="og:site_name" content="${SITE}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${escapeHtml(url)}" />
<meta property="og:title" content="${escapeHtml(fullTitle)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
${safeImage ? `<meta property="og:image" content="${escapeHtml(safeImage)}" />
<meta property="og:image:alt" content="${escapeHtml(imageAlt || fullTitle)}" />` : ''}
${videoTags}

<meta name="twitter:card" content="${safeImage ? 'summary_large_image' : 'summary'}" />
<meta name="twitter:title" content="${escapeHtml(fullTitle)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
${safeImage ? `<meta name="twitter:image" content="${escapeHtml(safeImage)}" />` : ''}
${componentEmbed ? `<script id="discord:component-embed" type="application/json">${componentEmbed}</script>` : ''}
</head>
<body>
<p><a href="${escapeHtml(url)}">${escapeHtml(fullTitle)}</a></p>
</body>
</html>`
}

// Song metadata fields are free-form spreadsheet text: "N/A"/"Unknown"
// placeholders, "[?]" gaps, and label lines ("Recorded\nJune 13, 2017.",
// "Juice's Vocals\n...") mixed in with the value.
const PLACEHOLDERS = new Set(['', 'n/a', 'unknown', 'null', 'none', '?', '[?]'])
function songField(value) {
  if (typeof value !== 'string') return null
  const v = value.replace(/\r\n?/g, '\n').trim()
  return PLACEHOLDERS.has(v.toLowerCase()) ? null : v
}

function oneLine(value) {
  return value.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

// First line carrying a date, minus its "Surfaced"/"Recorded"-style label.
function songDate(value) {
  const v = songField(value)
  const line = v?.split('\n').map((l) => l.trim()).find((l) => /\d/.test(l))
  if (!line) return null
  return line
    .replace(/^(first\s+)?(surfaced|released|recorded|leaked|previewed|teased)\s*:?\s*/i, '')
    .replace(/\s*\[\?\],?/g, '')
    .replace(/\.$/, '')
    .trim() || null
}

// Location lines are the ones with commas; label lines ("Juice's Vocals")
// have none. Unknown parts ("[?], [?], Chicago, IL.") are dropped, and
// "Studio, Neighborhood, City, ST" is cut to "Studio, City, ST".
function songLocation(value) {
  const v = songField(value)
  if (!v) return null
  const places = [...new Set(v.split('\n')
    .filter((l) => l.includes(','))
    .map((l) => {
      const parts = l.replace(/\[\?\],?\s*/g, '').replace(/\.$/, '').split(',').map((p) => p.trim()).filter(Boolean)
      return (parts.length > 3 ? [parts[0], ...parts.slice(-2)] : parts).join(', ')
    })
    .filter(Boolean))]
  return places.slice(0, 2).join(' / ') || null
}

// The most repeated pair of consecutive lines is usually the hook - a better
// teaser than the intro ad-libs at the top. Lines that are all ad-lib
// ("Uh-uh, uh, uh") or bracketed section markers never count.
function lyricHook(lyrics) {
  const v = songField(lyrics)
  if (!v) return null
  const lines = v.split('\n').map((l) => l.trim())
  const norm = (l) => l.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()
  const usable = (l) => {
    if (!l || /^[([]/.test(l)) return false
    const words = norm(l).split(' ')
    return words.length >= 3 && new Set(words.filter((w) => w.length > 2)).size >= 2
  }
  const counts = new Map()
  let best = null
  for (let i = 0; i < lines.length; i++) {
    if (!usable(lines[i])) continue
    const pair = usable(lines[i + 1])
    const key = pair ? `${norm(lines[i])}\n${norm(lines[i + 1])}` : norm(lines[i])
    const n = (counts.get(key) || 0) + 1
    counts.set(key, n)
    // Pairs outrank a lone line at the same count; ties keep the earliest.
    const score = n * 2 + (pair ? 1 : 0)
    if (!best || score > best.score) best = { score, lines: pair ? [lines[i], lines[i + 1]] : [lines[i]] }
  }
  return best ? best.lines.map((l) => truncate(l, 90)) : null
}

// Playable track embeds. Discord never plays audio from a link embed
// (og:audio is ignored), but it does play an MP4 inline - so each song is
// rendered once as its cover art held for the whole song over its audio,
// cached on disk, and served from /track/:id/video.mp4. Needs ffmpeg on the
// box; without it embeds just stay unplayable.
const VIDEO_ENABLED = process.env.SOCIAL_PREVIEW_VIDEO !== '0'
// Fixed binaries, never taken from the environment: the distro's ffmpeg on
// the server (apt install ffmpeg), the PATH one when developing on Windows.
const FFMPEG = process.platform === 'win32' ? 'ffmpeg.exe' : '/usr/bin/ffmpeg'
const FFPROBE = process.platform === 'win32' ? 'ffprobe.exe' : '/usr/bin/ffprobe'
const VIDEO_CACHE_DIR = process.env.SOCIAL_PREVIEW_CACHE || path.join(os.tmpdir(), 'social-preview-video')
const VIDEO_CACHE_MAX_FILES = 300
const VIDEO_MAX_JOBS = 2
const VIDEO_JOB_TIMEOUT_MS = 180_000
// Long session dumps and compilations aren't worth transcoding for a preview.
const VIDEO_MAX_SECONDS = 20 * 60
const VIDEO_MAX_AUDIO_BYTES = 60 * 1024 * 1024
const VIDEO_SIZE = 640

// The video URL is public, so rendering is fenced in: only songs whose embed
// page was just served can be rendered, renders beyond the queue cap are
// refused rather than queued, and new renders are budgeted per hour - both
// overall and per client IP (nginx's X-Real-IP; the service only listens on
// loopback). Cache hits and joining an in-flight render cost nothing.
const VIDEO_MAX_QUEUED = 6
const VIDEO_RENDERS_PER_HOUR = Number(process.env.SOCIAL_PREVIEW_VIDEO_RENDERS_PER_HOUR || 120)
const VIDEO_RENDERS_PER_IP_PER_HOUR = 20
const VIDEO_WANTED_TTL_MS = 15 * 60 * 1000
const requestIp = new AsyncLocalStorage()

let ffmpegReady = false
if (VIDEO_ENABLED) {
  const probe = spawn(FFMPEG, ['-version'], { stdio: 'ignore' })
  probe.on('error', () => console.warn(`social-preview: ${FFMPEG} not found - track embeds won't be playable`))
  probe.on('exit', (code) => {
    ffmpegReady = code === 0
    if (ffmpegReady) fs.mkdirSync(VIDEO_CACHE_DIR, { recursive: true })
  })
}

// A song's image_url is editor-set and buildImageUrl passes absolute (and
// data:) URLs through untouched. That's fine for og:image, which Discord
// fetches, but this process downloads the video's cover itself - so only
// HTTPS URLs on the API's own host or the site's hosts are ever fetched,
// never an internal address or anything else an editor typed in.
const FETCHABLE_IMAGE_HOSTS = new Set([new URL(JWAPI_BASE).host, new URL(DEFAULT_ORIGIN).host, ...SITE_HOSTS])
function fetchableImageUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && FETCHABLE_IMAGE_HOSTS.has(u.host) ? u.toString() : null
  } catch {
    return null
  }
}

// What a song's video is built from, and a key that changes when either
// input does - it versions the URL too, so Discord's cache never serves a
// video made from an old cover or file.
function trackVideoSource(song) {
  const file = songField(song.path)
  const seconds = parseLength(song.length)
  if (!VIDEO_ENABLED || !ffmpegReady || !file || (seconds && seconds > VIDEO_MAX_SECONDS)) return null
  const audio = `${JWAPI_BASE}/files/download/?path=${encodeURIComponent(file)}`
  const image = fetchableImageUrl(buildImageUrl(song.image_url)) || `${DEFAULT_ORIGIN}/icon-512.png`
  const key = createHash('sha1').update(`${audio}\n${image}`).digest('hex').slice(0, 12)
  return { audio, image, key, seconds, file: path.join(VIDEO_CACHE_DIR, `${Number(song.public_id ?? song.id)}-${key}.mp4`) }
}

const videoJobs = new Map()
let runningJobs = 0
const jobQueue = []

// Video keys whose embed page was served recently -> expiry.
const wantedVideos = new Map()
function markVideoWanted(key) {
  const now = Date.now()
  if (wantedVideos.size > 5000) for (const [k, exp] of wantedVideos) if (exp < now) wantedVideos.delete(k)
  wantedVideos.set(key, now + VIDEO_WANTED_TTL_MS)
}
const videoWanted = (key) => (wantedVideos.get(key) ?? 0) > Date.now()

const renderLog = []
const renderLogByIp = new Map()
// Returns why a new render is refused, or null after recording it.
function admitRender(ip) {
  const now = Date.now()
  const cutoff = now - 60 * 60 * 1000
  while (renderLog.length && renderLog[0] < cutoff) renderLog.shift()
  const mine = (renderLogByIp.get(ip) ?? []).filter((t) => t >= cutoff)
  if (jobQueue.length >= VIDEO_MAX_QUEUED) return 'render queue full'
  if (renderLog.length >= VIDEO_RENDERS_PER_HOUR) return 'hourly render budget spent'
  if (mine.length >= VIDEO_RENDERS_PER_IP_PER_HOUR) return 'client render budget spent'
  renderLog.push(now)
  mine.push(now)
  renderLogByIp.set(ip, mine)
  if (renderLogByIp.size > 10000) for (const [k, list] of renderLogByIp) if (!list.some((t) => t >= cutoff)) renderLogByIp.delete(k)
  return null
}

class RenderRefused extends Error {}

function ensureTrackVideo(source) {
  if (fs.existsSync(source.file)) return Promise.resolve(source.file)
  if (!videoJobs.has(source.file)) {
    const refused = admitRender(requestIp.getStore() ?? 'unknown')
    if (refused) return Promise.reject(new RenderRefused(refused))
    const job = new Promise((resolve, reject) => jobQueue.push({ source, resolve, reject }))
      .finally(() => videoJobs.delete(source.file))
    videoJobs.set(source.file, job)
    drainJobs()
  }
  return videoJobs.get(source.file)
}

function drainJobs() {
  while (runningJobs < VIDEO_MAX_JOBS && jobQueue.length) {
    const { source, resolve, reject } = jobQueue.shift()
    runningJobs++
    transcode(source)
      .then(() => resolve(source.file), reject)
      .finally(() => {
        runningJobs--
        drainJobs()
      })
  }
}

// Runs a tool to completion, resolving with its stdout.
function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d })
    proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000) })
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs)
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${stderr.trim()}`))
    })
  })
}

async function download(url, dest, timeoutMs, maxBytes) {
  // No redirects: an allowed host must not be able to bounce the request on
  // to one that isn't.
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`)
  if (Number(res.headers.get('content-length')) > maxBytes) throw new Error(`${url} is over ${maxBytes} bytes`)
  const chunks = []
  let size = 0
  for await (const chunk of res.body) {
    size += chunk.length
    if (size > maxBytes) throw new Error(`${url} is over ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  await fs.promises.writeFile(dest, Buffer.concat(chunks))
}

// Inputs are downloaded first: ffmpeg reading the audio straight off HTTPS
// took minutes for a 10MB file, versus ~2s to fetch it and ~4s to encode.
// The video is cut to the audio's exact length with -t - at 1 fps x264's
// frame buffering makes -shortest overshoot by half a minute.
async function transcode({ audio, image, file, seconds }) {
  const work = `${file}.${process.pid}`
  const audioFile = `${work}.audio`
  const imageFile = `${work}.image`
  const part = `${work}.part.mp4`
  try {
    await Promise.all([download(audio, audioFile, 90_000, VIDEO_MAX_AUDIO_BYTES), download(image, imageFile, 30_000, 20 * 1024 * 1024)])
    const probed = Number(await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audioFile], 30_000).catch(() => ''))
    const duration = probed > 0 ? probed : seconds
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-framerate', '1', '-i', imageFile,
      '-i', audioFile,
      '-map', '0:v', '-map', '1:a',
      '-vf', `scale=${VIDEO_SIZE}:${VIDEO_SIZE}:force_original_aspect_ratio=decrease,pad=${VIDEO_SIZE}:${VIDEO_SIZE}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-r', '1',
      '-c:a', 'aac', '-b:a', '160k',
      ...(duration ? ['-t', String(duration)] : ['-shortest']),
      '-movflags', '+faststart', '-f', 'mp4', part,
    ], VIDEO_JOB_TIMEOUT_MS)
    await fs.promises.rename(part, file)
    pruneVideoCache()
  } finally {
    for (const f of [audioFile, imageFile, part]) fs.rm(f, { force: true }, () => {})
  }
}

function pruneVideoCache() {
  try {
    const files = fs.readdirSync(VIDEO_CACHE_DIR)
      .filter((f) => f.endsWith('.mp4') && !f.endsWith('.part.mp4'))
      .map((f) => ({ f: path.join(VIDEO_CACHE_DIR, f), t: fs.statSync(path.join(VIDEO_CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const { f } of files.slice(VIDEO_CACHE_MAX_FILES)) fs.rmSync(f, { force: true })
  } catch (err) {
    console.error('social-preview: video cache prune failed:', err)
  }
}

// Only the exact URL an embed page handed out (?v=<key>) resolves, and an
// uncached video only renders while that page view is recent.
async function serveTrackVideo(req, res, songId, version) {
  const song = await fetchJson(`${JWAPI_BASE}/songs/${encodeURIComponent(songId)}/`)
  const source = song && trackVideoSource(song)
  if (!source || version !== source.key || (!fs.existsSync(source.file) && !videoWanted(source.key))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }
  let file
  try {
    file = await ensureTrackVideo(source)
  } catch (err) {
    if (err instanceof RenderRefused) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '120' })
      res.end('Busy')
      return
    }
    console.error(`social-preview: video for track ${songId} failed:`, err.message)
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Video unavailable')
    return
  }
  serveFile(req, res, file, 'video/mp4')
}

// Plain file response with single-range support - video players (and
// Discord's media proxy) seek with Range requests.
function serveFile(req, res, file, type) {
  const { size } = fs.statSync(file)
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  let start = 0
  let end = size - 1
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size })
  }
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(file, { start, end }).pipe(res)
}

async function renderTrack(songId) {
  const url = `${origin()}/track/${songId}`
  const song = await fetchJson(`${JWAPI_BASE}/songs/${encodeURIComponent(songId)}/`)

  if (!song) {
    return renderPage({
      title: 'Track',
      description: 'A Juice WRLD song on unreleased.',
      image: defaultImage(),
      url,
    })
  }

  const title = song.name || 'Track'
  const released = song.category === 'released'
  const categoryLabel = CATEGORY_LABELS[song.category] || song.category || ''
  const project = songField(song.album) || songField(song.era?.description) || songField(song.era?.name)
  const artists = songField(song.credited_artists) || 'Juice WRLD'
  const producers = songField(song.producers)
  const length = parseLength(song.length) ? song.length.trim() : null
  const description = [categoryLabel, project, length, artists, producers && `prod. ${oneLine(producers)}`]
    .filter(Boolean)
    .join(' · ') || 'Stream this Juice WRLD song free on unreleased.'
  const image = buildImageUrl(song.image_url) || defaultImage()

  const md = escapeDiscordMarkdown
  const akas = [...new Set((song.track_titles || []).filter((t) => t && t !== title))].slice(0, 3)
  const meta = [categoryLabel, project, length].filter(Boolean).map(md).join(' · ')

  const recorded = [songDate(song.record_dates), songLocation(song.recording_locations)].filter(Boolean)
  // Released songs show their release date; everything else shows when it
  // surfaced (or was first teased) plus the leak type ("Throwaway Track").
  const leakType = !released && songField(song.leak_type)
  const statusDate = released
    ? songDate(song.release_date)
    : songDate(song.date_leaked) || songDate(song.dates)
  const teased = !statusDate && songDate(song.preview_date)
  const status = [statusDate || teased, leakType && oneLine(leakType)].filter(Boolean)
  const statusLabel = released ? 'Released' : statusDate ? 'Surfaced' : teased ? 'First teased' : 'Status'

  const credits = [
    producers && `**Produced by** ${md(truncate(oneLine(producers), 120))}`,
    recorded.length && `**Recorded** ${md(truncate(recorded.join(' · '), 140))}`,
    status.length && `**${statusLabel}** ${md(truncate(status.join(' · '), 120))}`,
    akas.length && `**Also known as** ${md(akas.join(', '))}`,
  ].filter(Boolean)
  const hook = lyricHook(song.lyrics)
  const info = songField(song.additional_information)

  // Start rendering the video now - Discord's media proxy asks for it right
  // after reading this page, and a warm cache answers that immediately.
  const videoSource = trackVideoSource(song)
  const video = videoSource && `${url}/video.mp4?v=${videoSource.key}`
  if (videoSource) {
    markVideoWanted(videoSource.key)
    ensureTrackVideo(videoSource).catch((err) => {
      if (!(err instanceof RenderRefused)) console.error(`social-preview: video for track ${songId} failed:`, err.message)
    })
  }

  const componentEmbed = fitComponentEmbed(
    ({ withCredits, withHook, withInfo }) =>
      container([
        // The playable video already shows the cover, so it replaces the
        // thumbnail rather than sitting next to it.
        ...(video
          ? [text(`### [${md(title)}](${url})`), text(md(artists)), text(`-# ${meta || md(SITE)}`), gallery([{ url: video, description: title }])]
          : [section([text(`### [${md(title)}](${url})`), text(md(artists)), text(`-# ${meta || md(SITE)}`)], thumbnail(image, title))]),
        ...(withCredits && credits.length ? [separator(), text(credits.join('\n'))] : []),
        ...(withHook && hook ? [text(hook.map((l) => `> *${md(l)}*`).join('\n'))] : []),
        ...(withInfo && info ? [text(`-# ${md(truncate(oneLine(info), 240))}`)] : []),
        separator(),
        linkButtons({ label: 'Play on unreleased', url, emoji: '▶️' }),
      ]),
    [
      { withCredits: true, withHook: true, withInfo: true },
      { withCredits: true, withHook: true, withInfo: false },
      { withCredits: true, withHook: false, withInfo: false },
      { withCredits: false, withHook: false, withInfo: false },
    ],
  )

  return renderPage({ title, description, image, imageAlt: title, url, componentEmbed, video })
}

// Anonymous share links (/shared/:id) and a signed-in user's public library
// playlist (/playlists?id=:id&view=shared) return the same kind of payload.
function renderSharedPlaylist(shareId) {
  return renderPlaylistPreview(
    `${origin()}/shared/${encodeURIComponent(shareId)}`,
    `${JWAPI_BASE}/playlists/shared/${encodeURIComponent(shareId)}/`,
  )
}

function renderPublicPlaylist(id) {
  return renderPlaylistPreview(
    `${origin()}/playlists?id=${encodeURIComponent(id)}&view=shared`,
    `${JWAPI_BASE}/library/playlists/public/${encodeURIComponent(id)}/`,
  )
}

async function renderPlaylistPreview(url, apiUrl) {
  const data = await fetchJson(apiUrl)

  if (!data) {
    return renderPage({
      title: 'Shared playlist',
      description: 'A playlist shared from unreleased.',
      image: defaultImage(),
      url,
    })
  }

  const tracks = firstTrackArray(data) ?? []
  const name = playlistName(data) || 'Shared Playlist'
  const firstPath = tracks.length ? trackPath(tracks[0]) : null
  // Library playlists carry their own cover (cover_image is inline base64,
  // which crawlers can't fetch - only the hosted cover_image_url is usable).
  const playlistCover = buildImageUrl(data.cover_image_url ?? data.playlist?.cover_image_url)
  const image = (playlistCover && /^https?:\/\//.test(playlistCover) ? playlistCover : null)
    || (firstPath ? `${JWAPI_BASE}/files/cover-art/?path=${encodeURIComponent(firstPath)}&size=1024` : defaultImage())
  const description = tracks.length
    ? `${tracks.length} track${tracks.length === 1 ? '' : 's'} - listen free on unreleased.`
    : 'A playlist shared from unreleased.'

  const md = escapeDiscordMarkdown
  const entries = tracks.map((t) => {
    const song = t && typeof t === 'object' ? (t.song && typeof t.song === 'object' ? t.song : t) : null
    const path = trackPath(t)
    return {
      name: song?.name || path?.split('/').pop()?.replace(/\.[^.]+$/, '') || null,
      length: typeof song?.length === 'string' ? song.length : null,
      cover: buildImageUrl(song?.image_url) || (path ? `${JWAPI_BASE}/files/cover-art/?path=${encodeURIComponent(path)}&size=512` : null),
    }
  })
  const totalSeconds = entries.reduce((sum, e) => sum + (parseLength(e.length) ?? 0), 0)
  const owner = [data.owner_display_name, data.playlist?.owner_display_name].find((o) => typeof o === 'string' && o.trim())?.trim()
  const meta = [
    owner ? `Playlist by ${escapeDiscordMarkdown(owner)}` : 'Shared playlist',
    tracks.length ? `${tracks.length} track${tracks.length === 1 ? '' : 's'}` : null,
    totalSeconds >= 60 ? formatTotalLength(totalSeconds) : null,
  ].filter(Boolean).join(' · ')
  const about = [data.description, data.playlist?.description].find((d) => typeof d === 'string' && d.trim())?.trim()
  // Distinct covers only - many songs share the same placeholder art.
  const covers = [...new Set(entries.map((e) => e.cover).filter(Boolean))]

  const componentEmbed = fitComponentEmbed(
    ({ listed, mosaic, withAbout }) => {
      const list = entries
        .slice(0, listed)
        .filter((e) => e.name)
        .map((e, i) => `${i + 1}. ${md(truncate(e.name, 60))}${e.length ? ` · \`${e.length}\`` : ''}`)
      if (list.length && tracks.length > list.length) list.push(`-# +${tracks.length - list.length} more`)
      const heading = [text(`### [${md(name)}](${url})`), text(`-# ${meta}`), ...(withAbout && about ? [text(md(truncate(about, 200)))] : [])]
      // A 2x2 cover mosaic reads as "playlist" at a glance; with fewer than
      // four distinct covers it falls back to a single thumbnail.
      return container([
        ...(mosaic && covers.length >= 4
          ? [...heading, gallery(covers.slice(0, 4).map((u) => ({ url: u })))]
          : [section(heading, thumbnail(image, name))]),
        ...(list.length ? [separator(), text(list.join('\n'))] : []),
        separator(),
        linkButtons({ label: 'Open playlist', url, emoji: '🎧' }),
      ])
    },
    [
      { listed: 10, mosaic: true, withAbout: true },
      { listed: 6, mosaic: true, withAbout: true },
      { listed: 6, mosaic: false, withAbout: true },
      { listed: 3, mosaic: false, withAbout: false },
      { listed: 0, mosaic: false, withAbout: false },
    ],
  )

  return renderPage({ title: name, description, image, imageAlt: name, url, componentEmbed })
}

async function renderNewsPost(postId) {
  const url = `${origin()}/news/${postId}`
  const item = await fetchJson(`${JWAPI_BASE}/news/${encodeURIComponent(postId)}/`)

  if (!item) {
    return renderPage({
      title: 'News',
      description: 'Juice WRLD news and announcements.',
      image: defaultImage(),
      url,
    })
  }

  const summary = typeof item.summary === 'string' ? item.summary.trim() : ''
  const plainBody = stripMarkdown(item.body || '')
  const description = summary || truncate(plainBody, 300) || 'Juice WRLD news and announcements.'
  const postImage = ensureHttpsMediaUrl(item.image_url)
  const image = postImage || defaultImage()
  const title = item.title || 'News'

  // The generic icon only shows as a small thumbnail - a full-width gallery
  // is reserved for posts with real images (lead, attachments, inline).
  const md = escapeDiscordMarkdown
  const dateRaw = item.published_at ?? item.created_at
  const date = dateRaw ? new Date(dateRaw) : null
  const channel = typeof item.channel === 'string' && item.channel
    ? item.channel.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
    : 'News'
  const meta = [
    md([channel, item.category].filter(Boolean).join(' / ')),
    item.author ? `by ${md(item.author)}` : null,
    date && !Number.isNaN(date.getTime()) ? `<t:${Math.floor(date.getTime() / 1000)}:D>` : null,
  ].filter(Boolean).join(' · ')
  const attachments = Array.isArray(item.attachments) ? item.attachments.filter((a) => a?.url) : []
  const imageAttachments = attachments
    .filter((a) => String(a.mime || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(a.name || a.url))
    .map((a) => ({ url: ensureHttpsMediaUrl(a.url), description: a.name }))
  const otherAttachments = attachments.length - imageAttachments.length

  const componentEmbed = fitComponentEmbed(
    ({ bodyMax, maxImages }) => {
      const { markdown, images } = newsBodyToDiscordMarkdown(item.body, bodyMax)
      // Lead image first, then attachments, then images pulled from the body.
      const media = [...(postImage ? [{ url: postImage, description: title }] : []), ...imageAttachments, ...images]
        .filter((m, i, all) => /^https?:\/\//.test(m.url || '') && all.findIndex((o) => o.url === m.url) === i)
        .slice(0, maxImages)
      const heading = [text(`### [${md(title)}](${url})`), text(`-# ${meta}`)]
      return container([
        ...(media.length ? heading : [section(heading, thumbnail(defaultImage(), SITE))]),
        ...(summary && markdown ? [text(`**${md(summary)}**`)] : []),
        text(markdown || md(description)),
        ...(media.length ? [gallery(media)] : []),
        ...(otherAttachments > 0 ? [text(`-# 📎 ${otherAttachments} attachment${otherAttachments === 1 ? '' : 's'}`)] : []),
        separator(),
        linkButtons({ label: 'Read on unreleased', url, emoji: '📰' }, { label: 'All news', url: `${origin()}/news` }),
      ])
    },
    [1600, 1200, 900, 600, 350]
      .flatMap((bodyMax) => [4, 1].map((maxImages) => ({ bodyMax, maxImages })))
      .concat([{ bodyMax: 200, maxImages: 0 }]),
  )

  return renderPage({ title, description, image, imageAlt: title, url, componentEmbed })
}

// Site-wide card for the bare origin (and /playlists without a shared id).
// Same copy as index.html's static tags, plus live catalog numbers and the
// latest news post - all optional, so an API outage still yields the card.
const HOME_DESCRIPTION = "Stream Juice WRLD's full catalog - every released and unreleased song - free in your browser. Search by era, producer or engineer, build playlists, listen to 999 FM radio, and read synced lyrics."

async function renderHome() {
  const url = `${origin()}/`
  const title = `${SITE} - Juice WRLD music player`
  const [stats, eras, news] = await Promise.all([
    fetchJson(`${JWAPI_BASE}/stats/`),
    fetchJson(`${JWAPI_BASE}/eras/?page_size=1`),
    fetchJson(`${JWAPI_BASE}/news/?page_size=1`),
  ])

  const n = (value) => (Number.isFinite(value) ? value.toLocaleString('en-US') : null)
  const cats = stats?.category_stats && typeof stats.category_stats === 'object' ? stats.category_stats : {}
  const headline = [
    n(stats?.total_songs) && `**${n(stats.total_songs)}** songs`,
    n(eras?.count) && `**${n(eras.count)}** eras`,
  ].filter(Boolean).join(' · ')
  const breakdown = Object.entries(CATEGORY_LABELS)
    .map(([key, label]) => n(cats[key]) && `${n(cats[key])} ${key === 'recording_session' ? 'sessions' : label.toLowerCase()}`)
    .filter(Boolean)
    .join(' · ')

  const md = escapeDiscordMarkdown
  const latest = Array.isArray(news?.results) ? news.results[0] : null
  const latestDate = latest?.published_at ? new Date(latest.published_at) : null
  const latestLine = latest?.id != null && latest.title
    ? `📰 **Latest** [${md(truncate(latest.title, 80))}](${origin()}/news/${latest.id})${latestDate && !Number.isNaN(latestDate.getTime()) ? ` · <t:${Math.floor(latestDate.getTime() / 1000)}:R>` : ''}`
    : null

  const componentEmbed = fitComponentEmbed(
    ({ withLatest }) =>
      container([
        section(
          [text(`## [${SITE}](${url})`), text('-# Juice WRLD music player · free, in your browser'), text(md(HOME_DESCRIPTION))],
          thumbnail(defaultImage(), SITE),
        ),
        ...(headline ? [separator(), text([headline, breakdown && `-# ${breakdown}`].filter(Boolean).join('\n'))] : []),
        ...(withLatest && latestLine ? [separator(), text(latestLine)] : []),
        separator(),
        linkButtons(
          { label: 'Start listening', url, emoji: '🎧' },
          { label: '999 FM', url: `${origin()}/wrld`, emoji: '📻' },
          { label: 'News', url: `${origin()}/news`, emoji: '📰' },
        ),
      ]),
    [{ withLatest: true }, { withLatest: false }],
  )

  return renderPage({ title, description: HOME_DESCRIPTION, image: defaultImage(), imageAlt: title, url, componentEmbed })
}

// Same two sources as useStatisticsData.ts: /stats/ counts catalog rows,
// /plays/stats/ counts plays across every listener.
async function renderStatistics() {
  const url = `${origin()}/statistics`
  const title = 'Statistics'
  const [stats, plays] = await Promise.all([fetchJson(`${JWAPI_BASE}/stats/`), fetchJson(`${JWAPI_BASE}/plays/stats/`)])

  const md = escapeDiscordMarkdown
  const n = (value) => (Number.isFinite(value) ? value.toLocaleString('en-US') : null)
  const compact = (value) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  const totalPlays = Number.isFinite(plays?.total_plays) ? plays.total_plays : null

  const headline = [
    totalPlays != null && `**${n(totalPlays)}** plays`,
    n(plays?.total_songs_with_plays) && `**${n(plays.total_songs_with_plays)}** songs played`,
    n(stats?.total_songs) && `**${n(stats.total_songs)}** in the catalog`,
  ].filter(Boolean).join(' · ')
  const byCategory = totalPlays
    ? (Array.isArray(plays?.category_breakdown) ? plays.category_breakdown : [])
      .filter((r) => Number.isFinite(r?.count) && r.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((r) => `${compact(r.count)} ${(r.category === 'recording_session' ? 'sessions' : (CATEGORY_LABELS[r.category] || r.category)).toLowerCase()} (${r.count / totalPlays < 0.01 ? '<1' : Math.round((r.count / totalPlays) * 100)}%)`)
      .join(' · ')
    : ''

  const topSongs = (Array.isArray(plays?.top_songs) ? plays.top_songs : []).filter((s) => s?.id != null && s.name)
  const topEras = (Array.isArray(plays?.top_eras) ? plays.top_eras : []).filter((e) => e?.name && Number.isFinite(e.play_count))
  const latest = Array.isArray(plays?.recent_plays) ? plays.recent_plays.find((p) => p?.song_id != null && p.title) : null
  const latestAt = latest?.played_at ? Date.parse(latest.played_at) : NaN

  // Text bars scaled to the top era - Discord has no chart component.
  const bar = (value, max, width = 10) => {
    const filled = Math.max(1, Math.round((value / max) * width))
    return `\`${'█'.repeat(filled)}${'░'.repeat(width - filled)}\``
  }

  const description = [headline.replace(/\*\*/g, ''), topSongs[0] && `Most played: ${topSongs[0].name}`].filter(Boolean).join(' · ')
    || 'Catalog-wide listening statistics on unreleased.'

  const componentEmbed = fitComponentEmbed(
    ({ songCount, eraCount, withLatest }) => {
      const songLines = topSongs.slice(0, songCount).map((s, i) =>
        `${i + 1}. [${md(truncate(s.name, 50))}](${origin()}/track/${s.id})${s.era_name ? ` · ${md(s.era_name)}` : ''} · ${compact(s.play_count)} plays`)
      const eraLines = topEras.slice(0, eraCount).map((e) => `${bar(e.play_count, topEras[0].play_count)} ${md(e.name)} · ${compact(e.play_count)}`)
      return container([
        section(
          [text(`### [${title}](${url})`), text('-# Listening across everyone on unreleased'), ...(headline ? [text([headline, byCategory && `-# ${byCategory}`].filter(Boolean).join('\n'))] : [])],
          thumbnail(defaultImage(), SITE),
        ),
        ...(songLines.length ? [separator(), text(['**Top songs**', ...songLines].join('\n'))] : []),
        ...(eraLines.length ? [separator(), text(['**Top eras**', ...eraLines].join('\n'))] : []),
        ...(withLatest && latest ? [separator(), text(`🕒 **Just played** [${md(truncate(latest.title, 60))}](${origin()}/track/${latest.song_id})${Number.isFinite(latestAt) ? ` · <t:${Math.floor(latestAt / 1000)}:R>` : ''}`)] : []),
        separator(),
        linkButtons({ label: 'View statistics', url, emoji: '📊' }),
      ])
    },
    [
      { songCount: 5, eraCount: 5, withLatest: true },
      { songCount: 5, eraCount: 3, withLatest: true },
      { songCount: 3, eraCount: 3, withLatest: false },
      { songCount: 0, eraCount: 0, withLatest: false },
    ],
  )

  return renderPage({ title, description, image: defaultImage(), imageAlt: title, url, componentEmbed })
}

// 999 FM (/wrld). Same /radio/live/ snapshot the RADIO view polls - an embed
// is frozen once Discord unfurls it, so the card says when it was taken.
const RADIO_DESCRIPTION = 'A 24/7 Juice WRLD radio station. See what everyone is listening to in real time, vote to skip, suggest the next song, and preview the upcoming queue.'

async function renderRadio() {
  const url = `${origin()}/wrld`
  const title = '999 FM - live Juice WRLD radio'
  const live = await fetchJson(`${JWAPI_BASE}/radio/live/`)

  const md = escapeDiscordMarkdown
  const now = live?.is_live ? live.now_playing : null
  const next = live?.is_live ? live.up_next : null
  const trackLine = (t, withAlbum = true) => {
    const name = md(truncate(t.title || t.display || 'Unknown', 70))
    const linked = t.song_id != null ? `[${name}](${origin()}/track/${Number(t.song_id)})` : `**${name}**`
    const artist = t.artist && t.artist !== 'Juice WRLD' ? ` · ${md(t.artist)}` : ''
    return `${linked}${artist}${withAlbum && t.album ? `\n-# ${md(truncate(t.album, 80))}` : ''}`
  }

  const listeners = Number.isFinite(live?.total_listeners) ? live.total_listeners : null
  const status = !live
    ? 'Juice WRLD radio · 24/7'
    : [
      live.is_live ? (live.state === 'dj_talking' ? '🔴 Live · DJ on air' : '🔴 Live') : 'Off air',
      listeners != null && `${listeners.toLocaleString('en-US')} listening`,
      `<t:${Math.floor(Date.now() / 1000)}:R>`,
    ].filter(Boolean).join(' · ')

  // queue_preview is "Artist — Title" display strings; up_next is its head.
  const queue = (Array.isArray(live?.queue_preview) ? live.queue_preview : [])
    .filter((q) => typeof q === 'string' && q.trim())
    .map((q) => q.replace(/^Juice WRLD\s+—\s+/, '').trim())
  const later = next ? queue.slice(1) : queue
  const image = buildImageUrl(now?.image_url) || defaultImage()

  const description = [
    now && `Now playing: ${now.title || now.display}`,
    listeners != null && `${listeners.toLocaleString('en-US')} listening`,
  ].filter(Boolean).join(' · ') || RADIO_DESCRIPTION

  const componentEmbed = fitComponentEmbed(
    ({ queued, withAbout }) => {
      const queueLines = later.slice(0, queued).map((q, i) => `${i + 2}. ${md(truncate(q, 60))}`)
      return container([
        section(
          [
            text(`### [999 FM](${url})`),
            text(`-# ${status}`),
            ...(now ? [text(`🎧 **Now playing**\n${trackLine(now)}`)] : withAbout ? [text(md(RADIO_DESCRIPTION))] : []),
          ],
          thumbnail(image, now?.title || '999 FM'),
        ),
        ...(next || queueLines.length
          ? [separator(), text([
            '**Up next**',
            ...(next ? [`1. ${trackLine(next, false)}`] : []),
            ...queueLines,
          ].join('\n'))]
          : []),
        ...(withAbout && now ? [text(`-# ${md(RADIO_DESCRIPTION)}`)] : []),
        separator(),
        linkButtons({ label: 'Tune in', url, emoji: '📻' }),
      ])
    },
    [
      { queued: 4, withAbout: true },
      { queued: 4, withAbout: false },
      { queued: 2, withAbout: false },
      { queued: 0, withAbout: false },
    ],
  )

  return renderPage({ title, description, image, imageAlt: title, url, componentEmbed })
}

// Profile avatars are stored inline as base64 data: URLs, which crawlers
// can't fetch - this service re-serves the decoded bytes at
// /u/:id/avatar.<ext> (see the nginx snippet) so embeds get a real image URL.
const AVATAR_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

function decodeAvatar(avatar) {
  const m = typeof avatar === 'string' && avatar.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/)
  if (!m || !AVATAR_TYPES[m[1]]) return null
  return { mime: m[1], ext: AVATAR_TYPES[m[1]], bytes: Buffer.from(m[2], 'base64') }
}

function avatarUrl(profile) {
  if (typeof profile?.avatar === 'string' && /^https?:\/\//.test(profile.avatar)) return profile.avatar
  const decoded = decodeAvatar(profile?.avatar)
  if (!decoded) return null
  // Content hash as a cache-buster, so a changed avatar isn't stuck behind
  // Discord's media-proxy cache.
  const v = createHash('sha1').update(decoded.bytes).digest('hex').slice(0, 10)
  return `${origin()}/u/${profile.id}/avatar.${decoded.ext}?v=${v}`
}

async function serveAvatar(res, userId) {
  const decoded = decodeAvatar((await fetchJson(`${JWAPI_BASE}/accounts/profile/${userId}/`))?.avatar)
  if (!decoded) {
    res.writeHead(302, { Location: defaultImage(), 'Cache-Control': 'public, max-age=300' })
    res.end()
    return
  }
  res.writeHead(200, { 'Content-Type': decoded.mime, 'Content-Length': decoded.bytes.length, 'Cache-Control': 'public, max-age=3600' })
  res.end(decoded.bytes)
}

async function renderProfile(userId) {
  const url = `${origin()}/u/${userId}`
  const [profile, np] = await Promise.all([
    fetchJson(`${JWAPI_BASE}/accounts/profile/${userId}/`),
    fetchJson(`${JWAPI_BASE}/accounts/profile/${userId}/np/`),
  ])

  if (!profile) {
    return renderPage({ title: 'Profile', description: 'A listener on unreleased.', image: defaultImage(), url })
  }

  const md = escapeDiscordMarkdown
  const name = (profile.display_name || profile.username || 'Listener').trim()
  const image = avatarUrl(profile) || defaultImage()
  const bio = typeof profile.bio === 'string' ? profile.bio.trim() : ''

  const donorSince = profile.donor_since ? new Date(profile.donor_since) : null
  const badges = [
    profile.is_editor && 'Editor',
    profile.is_contributor && 'Contributor',
    profile.is_donor && (donorSince && !Number.isNaN(donorSince.getTime()) ? `Donor since <t:${Math.floor(donorSince.getTime() / 1000)}:D>` : 'Donor'),
  ].filter(Boolean)
  // Discord-linked accounts get a "discord_<snowflake>" username - not worth showing.
  const handle = profile.username && profile.username !== name && !/^discord_\d+$/.test(profile.username) ? `@${md(profile.username)}` : null
  const subline = [handle, ...badges].filter(Boolean).join(' · ') || 'Listener on unreleased'

  // Listening stats straight from the public play history (all-time).
  const plays = profile.public_play_history && Array.isArray(profile.play_history) ? profile.play_history : []
  const counts = new Map()
  for (const p of plays) if (p?.song != null) counts.set(p.song, (counts.get(p.song) ?? 0) + 1)
  const topIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const lastPlayed = plays.reduce((max, p) => Math.max(max, Date.parse(p?.played_at) || 0), 0)

  const nowPlaying = profile.public_now_playing ? np?.now_playing : null
  const songIds = [...new Set([...(nowPlaying?.song != null ? [nowPlaying.song] : []), ...topIds.map(([id]) => id)])]
  const songs = new Map(
    (await Promise.all(songIds.map((id) => fetchJson(`${JWAPI_BASE}/songs/${encodeURIComponent(id)}/`))))
      .filter((s) => s?.id != null)
      .map((s) => [s.id, s]),
  )
  const songLink = (id) => {
    const song = songs.get(id)
    return song?.name ? `[${md(truncate(song.name, 60))}](${origin()}/track/${id})` : null
  }

  const nowLine = nowPlaying && songLink(nowPlaying.song) ? `🎧 **Listening now** ${songLink(nowPlaying.song)}` : null
  const statsLine = plays.length
    ? [`**${plays.length.toLocaleString('en-US')}** plays`, `**${counts.size.toLocaleString('en-US')}** songs`, lastPlayed ? `last played <t:${Math.floor(lastPlayed / 1000)}:R>` : null].filter(Boolean).join(' · ')
    : null
  const topLines = topIds
    .map(([id, count], i) => songLink(id) && `${i + 1}. ${songLink(id)} · ${count.toLocaleString('en-US')} play${count === 1 ? '' : 's'}`)
    .filter(Boolean)

  const publicPlaylists = profile.public_playlists && Array.isArray(profile.playlists)
    ? profile.playlists.filter((p) => p?.is_public && p.id != null && p.name)
    : []

  const description = [bio && truncate(bio, 200), statsLine && `${plays.length.toLocaleString('en-US')} plays`, publicPlaylists.length && `${publicPlaylists.length} public playlist${publicPlaylists.length === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' · ') || `${name} on unreleased.`

  const componentEmbed = fitComponentEmbed(
    ({ listedPlaylists, withTop }) => {
      const playlistLines = publicPlaylists
        .slice(0, listedPlaylists)
        .map((p) => `[${md(truncate(p.name, 50))}](${origin()}/playlists?id=${p.id}&view=shared)${Number.isFinite(p.track_count) ? ` · ${p.track_count} tracks` : ''}`)
      if (playlistLines.length && publicPlaylists.length > playlistLines.length) playlistLines.push(`-# +${publicPlaylists.length - playlistLines.length} more`)
      const heading = [text(`### [${md(name)}](${url})`), text(`-# ${subline}`), ...(bio ? [text(md(truncate(bio, 200)))] : [])]
      const listening = [nowLine, statsLine, ...(withTop && topLines.length ? ['**Most played**', ...topLines] : [])].filter(Boolean)
      return container([
        section(heading, thumbnail(image, name)),
        ...(listening.length ? [separator(), text(listening.join('\n'))] : []),
        ...(playlistLines.length ? [separator(), text(['**Playlists**', ...playlistLines].join('\n'))] : []),
        separator(),
        linkButtons({ label: 'View profile', url, emoji: '👤' }),
      ])
    },
    [
      { listedPlaylists: 5, withTop: true },
      { listedPlaylists: 3, withTop: true },
      { listedPlaylists: 3, withTop: false },
      { listedPlaylists: 0, withTop: false },
    ],
  )

  return renderPage({ title: name, description, image, imageAlt: name, url, componentEmbed })
}

// Chat link previews: GET /unfurl?url=<https url> -> { url, title, description?,
// image?, siteName }. The browser can't read another site's og: tags (CORS),
// and fetching from the viewer's machine would hand their IP to every linked
// site, so the chat client asks this service instead. Unlike everything above,
// the URL here is chosen by an arbitrary chat member, which makes this an
// SSRF surface - so the fetch is fenced in: http(s) on the default ports only,
// every resolved address (checked again at connect time, so DNS rebinding
// can't swap one in) must be public, redirects are followed by hand and each
// hop re-checked, only the first stretch of an HTML response is read, and
// callers are budgeted. Only the parsed metadata is ever returned, never the
// fetched body.
const UNFURL_ENABLED = process.env.SOCIAL_PREVIEW_UNFURL !== '0'
const UNFURL_TIMEOUT_MS = 6000
// YouTube buries its og: tags ~710 KB in, behind a huge inline script.
const UNFURL_MAX_BYTES = 1536 * 1024
const UNFURL_MAX_REDIRECTS = 4
const UNFURL_MAX_CONCURRENT = 8
const UNFURL_FETCHES_PER_MIN_PER_IP = 30
const UNFURL_HIT_TTL_MS = 60 * 60 * 1000
const UNFURL_MISS_TTL_MS = 10 * 60 * 1000
const UNFURL_CACHE_MAX = 1000

const privateRanges = new net.BlockList()
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]) privateRanges.addSubnet(addr, prefix, 'ipv4')
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  // Ranges that embed an IPv4 address (NAT64, 6to4) or are documentation-only.
  ['64:ff9b::', 96], ['2002::', 16], ['2001:db8::', 32],
]) privateRanges.addSubnet(addr, prefix, 'ipv6')

// BlockList.check treats an IPv4-mapped IPv6 address (::ffff:127.0.0.1) as the
// IPv4 address it wraps, so those can't be used to get around the v4 ranges.
const isPublicAddress = (address) => {
  const family = net.isIP(address)
  return family !== 0 && !privateRanges.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

// Used as the request's `lookup`, so the address that is validated is the one
// that is connected to. One private answer among several rejects the lot.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err)
    if (!addresses.length || !addresses.every((a) => isPublicAddress(a.address))) {
      return callback(new Error(`${hostname} does not resolve to a public address`))
    }
    return options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family)
  })
}

// null when the URL isn't one a preview may be fetched for.
function unfurlTarget(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return null
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  if (u.port && u.port !== (u.protocol === 'https:' ? '443' : '80')) return null
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || (net.isIP(host) && !isPublicAddress(host))) return null
  // The site's own pages only ever carry the generic tags, and the SPA doesn't
  // need to unfurl itself.
  if (SITE_HOSTS.has(u.host.toLowerCase())) return null
  u.hash = ''
  return u
}

function getOnce(u) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(u, {
      method: 'GET',
      lookup: safeLookup,
      agent: false,
      timeout: UNFURL_TIMEOUT_MS,
      signal: AbortSignal.timeout(UNFURL_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; unreleased-linkpreview/1.0; +https://player.juicewrldapi.com)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'en',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    }, resolve)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

// Resolves to { url, headers, html } for an HTML page, null for anything else.
async function fetchHtml(start) {
  let u = start
  for (let hop = 0; hop <= UNFURL_MAX_REDIRECTS; hop++) {
    const res = await getOnce(u)
    // Destroying the stream early (or a dropped connection) emits 'error'; with
    // no listener that would take the whole process down.
    res.on('error', () => {})
    const status = res.statusCode ?? 0
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume()
      const next = unfurlTarget(new URL(res.headers.location, u).toString())
      if (!next) return null
      u = next
      continue
    }
    const type = String(res.headers['content-type'] || '')
    if (status < 200 || status >= 300 || !/^(text\/html|application\/xhtml\+xml)/i.test(type)) {
      res.resume()
      return null
    }
    const encoding = String(res.headers['content-encoding'] || '').toLowerCase()
    const decoder = encoding === 'gzip' || encoding === 'x-gzip' ? zlib.createGunzip()
      : encoding === 'deflate' ? zlib.createInflate()
      : encoding === 'br' ? zlib.createBrotliDecompress()
      : null
    if (decoder) res.pipe(decoder)
    const body = decoder ?? res
    const chunks = []
    let size = 0
    let tail = ''
    try {
      for await (const chunk of body) {
        chunks.push(chunk)
        size += chunk.length
        const text = chunk.toString('latin1')
        if (size >= UNFURL_MAX_BYTES || (tail + text).toLowerCase().includes('</head>')) break
        tail = text.slice(-7)
      }
    } finally {
      res.destroy()
      decoder?.destroy()
    }
    const bytes = Buffer.concat(chunks)
    const label = /charset\s*=\s*["']?([\w-]+)/i.exec(type)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(bytes.toString('latin1', 0, 4096))?.[1] ?? 'utf-8'
    let html
    try {
      html = new TextDecoder(label).decode(bytes)
    } catch {
      html = bytes.toString('utf8')
    }
    return { url: u, html }
  }
  return null
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }
function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      try {
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
      } catch {
        return whole
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

const cleanText = (value, max) => {
  const text = decodeEntities(String(value ?? '')).replace(/\s+/g, ' ').trim()
  return text ? truncate(text, max) : null
}

// og:/twitter:/standard tags out of a page's <head>. Regex rather than a parser
// is enough here: only <meta> and <title> are read, and a malformed page just
// yields fewer fields.
function parseMetadata(html, pageUrl) {
  const head = html.split(/<\/head>/i)[0]
  const meta = new Map()
  for (const tag of head.match(/<meta\s[^>]*>/gi) ?? []) {
    const attrs = {}
    for (const m of tag.matchAll(/([a-z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
    }
    const key = (attrs.property || attrs.name || '').toLowerCase()
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content)
  }
  const pick = (...keys) => keys.map((k) => meta.get(k)).find((v) => v && v.trim())
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]

  const title = cleanText(pick('og:title', 'twitter:title') ?? titleTag, 150)
  if (!title) return null

  // The client only loads https images (its CSP blocks the rest).
  let image = null
  const rawImage = pick('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src')
  if (rawImage) {
    try {
      const resolved = new URL(decodeEntities(rawImage.trim()), pageUrl)
      if (resolved.protocol === 'https:' && !resolved.username && !resolved.password && resolved.href.length <= 500) image = resolved.href
    } catch {}
  }
  return {
    url: pageUrl.href,
    title,
    description: cleanText(pick('og:description', 'twitter:description', 'description'), 300) ?? undefined,
    image: image ?? undefined,
    siteName: cleanText(pick('og:site_name'), 60) ?? pageUrl.hostname.replace(/^www\./, ''),
  }
}

const unfurlCache = new Map() // href -> { expires, value }
const unfurlInflight = new Map()
const unfurlLog = new Map() // ip -> timestamps of uncached fetches
let unfurlRunning = 0

// Returns why a new fetch is refused, or null after recording it.
function admitUnfurl(ip) {
  const now = Date.now()
  const cutoff = now - 60_000
  const mine = (unfurlLog.get(ip) ?? []).filter((t) => t >= cutoff)
  if (unfurlRunning >= UNFURL_MAX_CONCURRENT) return 'busy'
  if (mine.length >= UNFURL_FETCHES_PER_MIN_PER_IP) return 'rate limited'
  mine.push(now)
  unfurlLog.set(ip, mine)
  if (unfurlLog.size > 10000) for (const [k, list] of unfurlLog) if (!list.some((t) => t >= cutoff)) unfurlLog.delete(k)
  return null
}

function rememberUnfurl(href, value) {
  if (unfurlCache.size >= UNFURL_CACHE_MAX) unfurlCache.delete(unfurlCache.keys().next().value)
  unfurlCache.set(href, { expires: Date.now() + (value ? UNFURL_HIT_TTL_MS : UNFURL_MISS_TTL_MS), value })
}

// Resolves to the preview, null (nothing to show), or 'refused' when the
// caller is over budget - which is deliberately not cached.
async function unfurl(target) {
  const cached = unfurlCache.get(target.href)
  if (cached && cached.expires > Date.now()) return cached.value
  if (unfurlInflight.has(target.href)) return unfurlInflight.get(target.href)
  if (admitUnfurl(requestIp.getStore() ?? 'unknown')) return 'refused'

  unfurlRunning++
  const job = fetchHtml(target)
    .then((page) => (page ? parseMetadata(page.html, page.url) : null))
    .catch(() => null)
    .then((value) => {
      rememberUnfurl(target.href, value)
      return value
    })
    .finally(() => {
      unfurlRunning--
      unfurlInflight.delete(target.href)
    })
  unfurlInflight.set(target.href, job)
  return job
}

async function serveUnfurl(res, rawUrl) {
  const json = (status, body, cache = 'no-store') => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache })
    res.end(JSON.stringify(body))
  }
  const target = UNFURL_ENABLED ? unfurlTarget(rawUrl) : null
  if (!target) return json(404, {}, 'public, max-age=600')
  const result = await unfurl(target)
  if (result === 'refused') return json(429, {})
  return result ? json(200, result, 'public, max-age=3600') : json(404, {}, 'public, max-age=600')
}

const server = http.createServer((req, res) => {
  // X-Real-IP is only believed from nginx on this box. If the service is
  // ever bound beyond loopback, direct callers are budgeted by their real
  // address instead of whatever header they send.
  const peer = req.socket.remoteAddress || 'unknown'
  const fromLocalProxy = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1'
  const ip = String((fromLocalProxy && req.headers['x-real-ip']) || peer)
  requestOrigin.run(originForHost(req.headers.host), () => requestIp.run(ip, () => handle(req, res)))
})

async function handle(req, res) {
  try {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost')
    let html = null
    let match

    if (pathname === '/unfurl') {
      await serveUnfurl(res, searchParams.get('url'))
      return
    } else if ((match = pathname.match(/^\/track\/(\d+)\/?$/))) {
      html = await renderTrack(match[1])
    } else if ((match = pathname.match(/^\/track\/(\d+)\/video\.mp4$/))) {
      await serveTrackVideo(req, res, match[1], searchParams.get('v'))
      return
    } else if ((match = pathname.match(/^\/shared\/([^/]+)\/?$/))) {
      html = await renderSharedPlaylist(match[1])
    } else if ((match = pathname.match(/^\/news\/(\d+)\/?$/))) {
      html = await renderNewsPost(match[1])
    } else if (/^\/playlists\/?$/.test(pathname) && searchParams.get('view') === 'shared' && /^\d+$/.test(searchParams.get('id') || '')) {
      html = await renderPublicPlaylist(searchParams.get('id'))
    } else if ((match = pathname.match(/^\/u\/(\d+)\/avatar\.(jpg|png|webp|gif)$/))) {
      await serveAvatar(res, match[1])
      return
    } else if ((match = pathname.match(/^\/u\/(\d+)\/?$/))) {
      html = await renderProfile(match[1])
    } else if (/^\/wrld\/?$/.test(pathname)) {
      html = await renderRadio()
    } else if (/^\/statistics\/?$/.test(pathname)) {
      html = await renderStatistics()
    } else if (pathname === '/' || /^\/(home|playlists)\/?$/.test(pathname)) {
      html = await renderHome()
    }

    if (!html) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }

    // nginx serves a different body (the SPA shell) for the same URL to
    // non-bot user-agents - shared caches must key on the UA too.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', Vary: 'User-Agent' })
    res.end(html)
  } catch (err) {
    console.error('social-preview error:', err)
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Internal error')
  }
}

server.listen(PORT, HOST, () => {
  console.log(`social-preview listening on ${HOST}:${PORT} (JWAPI_BASE=${JWAPI_BASE}, ORIGIN=${origin()})`)
})
