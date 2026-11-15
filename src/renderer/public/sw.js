// Service worker for the installable web build (PWA). NOT used by the Electron
// app - registration is guarded to http(s) only (see main.tsx), so this never
// runs under file://.
//
// Caching strategy is deliberately conservative because shipping stale renderer
// code has bitten this project before: app HTML is ALWAYS network-first, so an
// online user never boots an old build. The cache only serves as an offline
// fallback. Content-hashed build assets (/assets/*) are immutable - new deploys
// get new filenames - so those alone are cache-first for speed.

// v3: drops v2's asset cache, which could hold 404s (see /assets/ below).
const VERSION = 'v3'
const SHELL_CACHE = `shell-${VERSION}`
const ASSET_CACHE = `assets-${VERSION}`

// Minimal precache so the app shell can boot offline right after install.
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop caches from previous VERSIONs. Saved covers aren't versioned: they
    // belong to the user's downloads, not to a build.
    const keys = await caches.keys()
    await Promise.all(
      keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE && k !== 'offline-covers').map((k) => caches.delete(k))
    )
    await self.clients.claim()
  })())
})

// Streaming downloads for browsers without showSaveFilePicker (Firefox,
// Safari, mobile). The page opens a MessageChannel with {type:'zip-open'},
// then points a hidden iframe at /__zip-download/<id>; we answer that request
// with an attachment response whose body is fed from the channel, so a huge
// ZIP goes straight to disk instead of piling up in tab memory. The page
// sends one chunk at a time and waits for our 'ack' (sent on each pull).
const zipStreams = new Map()

self.addEventListener('message', (event) => {
  const data = event.data
  if (data && data.type === 'precache') {
    event.waitUntil(precacheAssets(data.commit))
    return
  }
  if (data && data.type === 'covers-changed') {
    coversAvailable = null
    return
  }
  if (!data || data.type !== 'zip-open' || !event.ports[0]) return
  zipStreams.set(data.id, { filename: data.filename, port: event.ports[0] })
  // Never answered (iframe failed to load) - don't leak the channel.
  setTimeout(() => zipStreams.delete(data.id), 30000)
})

// ── Offline downloads ────────────────────────────────────────────────────────
// The installed iOS app can keep playlists offline (lib/offlineDownloads). Two
// things here make that work with no network at all:
//
// 1. The whole build. Views load lazily, and a chunk is normally only cached
//    once its view has been opened - offline, any other view would fail to
//    load. So a page with downloads asks for every file in the build's
//    precache.json. This runs on request rather than at install because this
//    file doesn't change between deploys, so install wouldn't run again for a
//    new build. When the page asking is that same build, files from older
//    builds are dropped, so the cache doesn't grow with every deploy.
//
// 2. Covers. Downloads save each track's cover in COVER_CACHE under its own
//    URL; cross-origin images fall back to it when the network fails.
const COVER_CACHE = 'offline-covers'
let precaching = null

function precacheAssets(commit) {
  if (precaching) return precaching
  precaching = (async () => {
    const res = await fetch('/precache.json', { cache: 'no-cache' })
    if (!res.ok) return
    const list = await res.json()
    const files = Array.isArray(list.files) ? list.files : []
    const cache = await caches.open(ASSET_CACHE)
    const wanted = new Set(files.map((f) => new URL('/' + f, self.location.origin).href))
    const missing = []
    for (const href of wanted) if (!(await cache.match(href))) missing.push(href)
    // A few at a time: a phone on cellular shouldn't open dozens at once.
    for (let i = 0; i < missing.length; i += 4) {
      await Promise.all(missing.slice(i, i + 4).map(async (href) => {
        try {
          const r = await fetch(href)
          if (r.ok) await cache.put(href, r)
        } catch { /* offline again - the next request picks it up */ }
      }))
    }
    if (commit && list.commit === commit) {
      for (const req of await cache.keys()) {
        const url = new URL(req.url)
        if (url.pathname.startsWith('/assets/') && !wanted.has(req.url)) await cache.delete(req)
      }
    }
  })().catch(() => {}).finally(() => { precaching = null })
  return precaching
}

// null = not checked yet. Checked lazily, and re-checked when a page says the
// set of saved covers changed, so a device with no downloads never routes its
// images through here.
let coversAvailable = null

function refreshCoversAvailable() {
  caches.has(COVER_CACHE).then((has) => { coversAvailable = has }).catch(() => {})
}

// Covers are requested at several sizes (small/size params) for the same
// art; any saved size beats a placeholder.
function coverKey(href) {
  try {
    const u = new URL(href)
    u.searchParams.delete('size')
    u.searchParams.delete('small')
    return u.href
  } catch {
    return href
  }
}

async function savedCover(req) {
  const cache = await caches.open(COVER_CACHE)
  const exact = await cache.match(req.url, { ignoreVary: true })
  if (exact) return exact
  const key = coverKey(req.url)
  let fallback = null
  for (const k of await cache.keys()) {
    if (coverKey(k.url) !== key) continue
    // Prefer a larger copy over the 128px one.
    if (!new URL(k.url).searchParams.has('small')) return cache.match(k, { ignoreVary: true })
    fallback = fallback || k
  }
  return fallback ? cache.match(fallback, { ignoreVary: true }) : undefined
}

function zipDownloadResponse(id) {
  const entry = zipStreams.get(id)
  if (!entry) return new Response('Not found', { status: 404 })
  zipStreams.delete(id)
  const { port, filename } = entry
  const body = new ReadableStream({
    start(controller) {
      port.onmessage = ({ data }) => {
        if (data.type === 'chunk') controller.enqueue(new Uint8Array(data.chunk))
        else if (data.type === 'end') controller.close()
        else if (data.type === 'abort') controller.error(new Error('aborted'))
      }
    },
    pull() { port.postMessage({ type: 'ack' }) },
    cancel() { port.postMessage({ type: 'cancel' }) },
  })
  port.postMessage({ type: 'started' })
  return new Response(body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16))}`,
      'Cache-Control': 'no-store',
    },
  })
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin === self.location.origin && url.pathname.startsWith('/__zip-download/')) {
    event.respondWith(zipDownloadResponse(url.pathname.slice('/__zip-download/'.length)))
    return
  }
  // Only same-origin, except covers saved by offline downloads (see above),
  // which images fall back to when the network fails. The juicewrldapi.com
  // API goes straight to the network - the app has its own localStorage
  // cache for API responses, and we never want to serve stale songs/metadata.
  if (url.origin !== self.location.origin) {
    if (req.destination !== 'image') return
    if (coversAvailable === null) refreshCoversAvailable()
    if (coversAvailable === false) return
    event.respondWith(fetch(req).catch(async () => (await savedCover(req).catch(() => undefined)) || Response.error()))
    return
  }

  // Never touch the OAuth flow. The Discord login redirects back to
  // /auth/discord/callback?code=…&state=… and the app reads those params on
  // boot (see App.tsx). A service worker sitting in the middle of an auth
  // redirect is a classic footgun - let the browser handle it end-to-end so
  // installed (standalone PWA) sign-in behaves exactly like a normal tab.
  if (url.pathname.startsWith('/auth/')) return

  // Page loads: network-first so a fresh deploy is always picked up; fall back
  // to the cached shell only when the network is unavailable.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // The host sends index.html without Cache-Control, so a plain fetch
        // can be answered from the browser's heuristic cache - an old build
        // whose hashed chunks no longer exist. Revalidate instead. A navigate
        // Request can't be re-issued with options, so fetch by URL; a
        // redirected response can't answer a navigation, so redo those as-is.
        let net = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        if (net.redirected) net = await fetch(req)
        if (net.ok) {
          const cache = await caches.open(SHELL_CACHE)
          cache.put('/', net.clone())
        }
        return net
      } catch {
        return (await caches.match('/')) || Response.error()
      }
    })())
    return
  }

  // Content-hashed build assets are immutable - safe to serve cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req)
      if (hit) return hit
      const net = await fetch(req)
      // Only cache real hits. A chunk requested mid-deploy (or after one) 404s,
      // and caching that 404 cache-first would pin the failure - lazyView's
      // reload would boot the same build and get the same cached 404 forever.
      if (net.ok) {
        const cache = await caches.open(ASSET_CACHE)
        cache.put(req, net.clone())
      }
      return net
    })())
    return
  }

  // Other same-origin static files (favicon, manifest, icons):
  // network-first, cache as offline fallback.
  event.respondWith((async () => {
    try {
      const net = await fetch(req)
      if (net.ok) {
        const cache = await caches.open(ASSET_CACHE)
        cache.put(req, net.clone())
      }
      return net
    } catch {
      return (await caches.match(req)) || Response.error()
    }
  })())
})
