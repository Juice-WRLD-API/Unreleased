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
// SITE_HOSTS (comma-separated hosts links may point back to)

import http from 'node:http'
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

function renderPage({ title, description, image, imageAlt, url, componentEmbed }) {
  const fullTitle = title.includes(SITE) ? title : `${title} · ${SITE}`
  const safeImage = image || null
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

  const componentEmbed = fitComponentEmbed(
    ({ withCredits, withHook, withInfo }) =>
      container([
        section([text(`### [${md(title)}](${url})`), text(md(artists)), text(`-# ${meta || md(SITE)}`)], thumbnail(image, title)),
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

  return renderPage({ title, description, image, imageAlt: title, url, componentEmbed })
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
          { label: '999 FM', url: `${origin()}/radio`, emoji: '📻' },
          { label: 'News', url: `${origin()}/news`, emoji: '📰' },
        ),
      ]),
    [{ withLatest: true }, { withLatest: false }],
  )

  return renderPage({ title, description: HOME_DESCRIPTION, image: defaultImage(), imageAlt: title, url, componentEmbed })
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

const server = http.createServer((req, res) => requestOrigin.run(originForHost(req.headers.host), () => handle(req, res)))

async function handle(req, res) {
  try {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost')
    let html = null
    let match

    if ((match = pathname.match(/^\/track\/(\d+)\/?$/))) {
      html = await renderTrack(match[1])
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
