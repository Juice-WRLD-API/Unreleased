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
    // Drop caches from previous VERSIONs.
    const keys = await caches.keys()
    await Promise.all(
      keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))
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
  if (!data || data.type !== 'zip-open' || !event.ports[0]) return
  zipStreams.set(data.id, { filename: data.filename, port: event.ports[0] })
  // Never answered (iframe failed to load) - don't leak the channel.
  setTimeout(() => zipStreams.delete(data.id), 30000)
})

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
  // Only same-origin. The juicewrldapi.com API and remote cover images go
  // straight to the network - the app has its own localStorage cache for API
  // responses, and we never want to serve stale songs/metadata.
  if (url.origin !== self.location.origin) return

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
        const net = await fetch(req)
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
