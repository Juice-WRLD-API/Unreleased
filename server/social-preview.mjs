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
// 127.0.0.1 - only nginx should reach this), JWAPI_BASE, SITE_ORIGIN

import http from 'node:http'
import { URL } from 'node:url'

const PORT = Number(process.env.SOCIAL_PREVIEW_PORT || 8788)
const HOST = process.env.SOCIAL_PREVIEW_HOST || '127.0.0.1'
const JWAPI_BASE = process.env.JWAPI_BASE || 'https://juicewrldapi.com/juicewrld'
const ORIGIN = process.env.SITE_ORIGIN || 'https://player.juicewrldapi.com'
const SITE = 'unreleased'
const FETCH_TIMEOUT_MS = 5000
const DEFAULT_IMAGE = `${ORIGIN}/icon-512.png`

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
const text = (content) => ({ type: 10, content })
const thumbnail = (url, description) => ({ type: 11, media: { url }, ...(description ? { description } : {}) })
const gallery = (url, description) => ({ type: 12, items: [{ media: { url }, ...(description ? { description } : {}) }] })
const separator = () => ({ type: 14, divider: true, spacing: 1 })
const linkButtons = (...buttons) => ({ type: 1, components: buttons.map(({ label, url }) => ({ type: 2, style: 5, label, url })) })
const section = (texts, accessory) => ({ type: 9, components: texts, accessory })
const container = (components) => ({ component: { type: 17, components } })

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
  const componentJson = serializeComponentEmbed(componentEmbed)
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
${componentJson ? `<script id="discord:component-embed" type="application/json">${componentJson}</script>` : ''}
</head>
<body>
<p><a href="${escapeHtml(url)}">${escapeHtml(fullTitle)}</a></p>
</body>
</html>`
}

async function renderTrack(songId) {
  const url = `${ORIGIN}/track/${songId}`
  const song = await fetchJson(`${JWAPI_BASE}/songs/${encodeURIComponent(songId)}/`)

  if (!song) {
    return renderPage({
      title: 'Track',
      description: 'A Juice WRLD song on unreleased.',
      image: DEFAULT_IMAGE,
      url,
    })
  }

  const title = song.name || 'Track'
  const categoryLabel = CATEGORY_LABELS[song.category] || song.category || ''
  const era = song.era?.name
  const description = [categoryLabel, era, song.credited_artists || 'Juice WRLD']
    .filter(Boolean)
    .join(' · ') || 'Stream this Juice WRLD song free on unreleased.'
  const image = buildImageUrl(song.image_url) || DEFAULT_IMAGE

  const md = escapeDiscordMarkdown
  const akas = (song.track_titles || []).filter((t) => t && t !== title).slice(0, 3)
  const eraLine = [categoryLabel, song.era?.name && (song.era.description ? `${song.era.name} (${song.era.description})` : song.era.name), song.length]
    .filter(Boolean)
    .map(md)
    .join(' · ')
  const credits = [
    song.credited_artists && `**Artists** ${md(song.credited_artists)}`,
    song.producers && `**Prod.** ${md(truncate(song.producers, 120))}`,
    akas.length && `**AKA** ${md(akas.join(', '))}`,
  ].filter(Boolean)

  const componentEmbed = container([
    section([text(`### [${md(title)}](${url})`), text(`-# ${eraLine || md(SITE)}`), ...(credits.length ? [text(credits.join('\n'))] : [])], thumbnail(image, title)),
    separator(),
    linkButtons({ label: 'Play on unreleased', url }),
  ])

  return renderPage({ title, description, image, imageAlt: title, url, componentEmbed })
}

async function renderSharedPlaylist(shareId) {
  const url = `${ORIGIN}/shared/${encodeURIComponent(shareId)}`
  const data = await fetchJson(`${JWAPI_BASE}/playlists/shared/${encodeURIComponent(shareId)}/`)

  if (!data) {
    return renderPage({
      title: 'Shared playlist',
      description: 'A playlist shared from unreleased.',
      image: DEFAULT_IMAGE,
      url,
    })
  }

  const tracks = firstTrackArray(data) ?? []
  const name = playlistName(data) || 'Shared Playlist'
  const firstPath = tracks.length ? trackPath(tracks[0]) : null
  const image = firstPath
    ? `${JWAPI_BASE}/files/cover-art/?path=${encodeURIComponent(firstPath)}&size=1024`
    : DEFAULT_IMAGE
  const description = tracks.length
    ? `${tracks.length} track${tracks.length === 1 ? '' : 's'} - listen free on unreleased.`
    : 'A playlist shared from unreleased.'

  const md = escapeDiscordMarkdown
  const preview = tracks
    .slice(0, 5)
    .map((t) => (t && typeof t === 'object' ? (t.song?.name ?? t.name) : null) || trackPath(t)?.split('/').pop()?.replace(/\.[^.]+$/, ''))
    .filter(Boolean)
    .map((n, i) => `${i + 1}. ${md(truncate(n, 60))}`)
  if (tracks.length > preview.length && preview.length) preview.push(`-# +${tracks.length - preview.length} more`)

  const componentEmbed = container([
    section([text(`### [${md(name)}](${url})`), text(`-# Shared playlist · ${description}`), ...(preview.length ? [text(preview.join('\n'))] : [])], thumbnail(image, name)),
    separator(),
    linkButtons({ label: 'Open playlist', url }),
  ])

  return renderPage({ title: name, description, image, imageAlt: name, url, componentEmbed })
}

async function renderNewsPost(postId) {
  const url = `${ORIGIN}/news/${postId}`
  const item = await fetchJson(`${JWAPI_BASE}/news/${encodeURIComponent(postId)}/`)

  if (!item) {
    return renderPage({
      title: 'News',
      description: 'Juice WRLD news and announcements.',
      image: DEFAULT_IMAGE,
      url,
    })
  }

  const summary = typeof item.summary === 'string' ? item.summary.trim() : ''
  const plainBody = stripMarkdown(item.body || '')
  const description = summary || truncate(plainBody, 300) || 'Juice WRLD news and announcements.'
  const postImage = ensureHttpsMediaUrl(item.image_url)
  const image = postImage || DEFAULT_IMAGE
  const title = item.title || 'News'

  // Body stays plain text (escaped): truncating real markdown mid-link would
  // break the rendering. The generic icon only shows as a small thumbnail -
  // a full-width gallery is reserved for posts with their own image.
  const md = escapeDiscordMarkdown
  const dateRaw = item.published_at ?? item.created_at
  const date = dateRaw ? new Date(dateRaw) : null
  const meta = ['News', date && !Number.isNaN(date.getTime()) ? `<t:${Math.floor(date.getTime() / 1000)}:D>` : null].filter(Boolean).join(' · ')
  const heading = [text(`### [${md(title)}](${url})`), text(`-# ${meta}`)]
  const body = text(md(summary || truncate(plainBody, 700) || description))
  const componentEmbed = container([
    ...(postImage ? [...heading, body, gallery(postImage, title)] : [section(heading, thumbnail(DEFAULT_IMAGE, SITE)), body]),
    separator(),
    linkButtons({ label: 'Read on unreleased', url }),
  ])

  return renderPage({ title, description, image, imageAlt: title, url, componentEmbed })
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost')
    let html = null
    let match

    if ((match = pathname.match(/^\/track\/(\d+)\/?$/))) {
      html = await renderTrack(match[1])
    } else if ((match = pathname.match(/^\/shared\/([^/]+)\/?$/))) {
      html = await renderSharedPlaylist(match[1])
    } else if ((match = pathname.match(/^\/news\/(\d+)\/?$/))) {
      html = await renderNewsPost(match[1])
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
})

server.listen(PORT, HOST, () => {
  console.log(`social-preview listening on ${HOST}:${PORT} (JWAPI_BASE=${JWAPI_BASE}, ORIGIN=${ORIGIN})`)
})
