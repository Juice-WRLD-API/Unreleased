// Service worker for the installable web build (PWA). NOT used by the Electron
// app - registration is guarded to http(s) only (see main.tsx), so this never
// runs under file://.
//
// Caching strategy is deliberately conservative because shipping stale renderer
// code has bitten this project before: app HTML is ALWAYS network-first, so an
// online user never boots an old build. The cache only serves as an offline
// fallback. Content-hashed build assets (/assets/*) are immutable - new deploys
// get new filenames - so those alone are cache-first for speed.

const VERSION = 'v2'
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

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
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
        const cache = await caches.open(SHELL_CACHE)
        cache.put('/', net.clone())
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
      const cache = await caches.open(ASSET_CACHE)
      cache.put(req, net.clone())
      return net
    })())
    return
  }

  // Other same-origin static files (favicon, manifest, icons):
  // network-first, cache as offline fallback.
  event.respondWith((async () => {
    try {
      const net = await fetch(req)
      const cache = await caches.open(ASSET_CACHE)
      cache.put(req, net.clone())
      return net
    } catch {
      return (await caches.match(req)) || Response.error()
    }
  })())
})
