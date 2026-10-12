// Bridges to the native Android media session — see android's
// PlaybackService.java / MediaSessionPlugin.java for the native half.
//
// The Web MediaSession API (wired separately in Player.tsx, for desktop/web
// and as a harmless no-op fallback here) doesn't reliably survive
// backgrounding in this WebView, shows no real system notification, and does
// nothing to stop Android killing the app as an idle background process —
// this drives a real foreground Service + MediaSessionCompat on top of it.
// Deliberately doesn't also request its own AudioManager focus — see
// PlaybackService's doc comment for why.
//
// Every playback *decision* stays in JS (this module and PlaybackService only
// report state one way and forward OS events the other); see Player.tsx for
// where those events turn into setIsPlaying/nextTrack/prevTrack calls.

import { isAndroidApp } from './androidUpdate'

interface MediaControlPlugin {
  start(): Promise<void>
  stop(): Promise<void>
  updateMetadata(opts: {
    title: string
    artist: string
    album: string
    artworkUrl: string | null
    artworkBase64: string | null
    duration: number
  }): Promise<void>
  updatePlaybackState(opts: { playing: boolean; position: number; speed: number }): Promise<void>
  addListener(eventName: string, cb: (data: unknown) => void): Promise<{ remove: () => void }>
}

function plugin(): MediaControlPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { MediaControl?: MediaControlPlugin } } }).Capacitor
  return cap?.Plugins?.MediaControl ?? null
}

let started = false

/** Starts the foreground service + media session. Idempotent — safe to call
 *  on every track load; only actually does anything the first time. */
export function startMediaSession(): void {
  if (!isAndroidApp() || started) return
  const p = plugin()
  if (!p) return
  started = true
  p.start().catch(() => { started = false })
}

export function updateMediaMetadata(opts: {
  title: string
  artist: string
  album: string
  artworkUrl: string | null
  artworkBase64: string | null
  duration: number
}): void {
  if (!isAndroidApp()) return
  plugin()?.updateMetadata(opts).catch(() => {})
}

export function updateMediaPlaybackState(opts: { playing: boolean; position: number; speed: number }): void {
  if (!isAndroidApp()) return
  plugin()?.updatePlaybackState(opts).catch(() => {})
}

/** Subscribes to a native event ('play' | 'pause' | 'next' | 'previous' |
 *  'seek' | 'focus'). Returns an unsubscribe function; a no-op off-Android. */
export function onMediaControlEvent<T = unknown>(eventName: string, cb: (data: T) => void): () => void {
  const p = plugin()
  if (!p) return () => {}
  let removed = false
  let handle: { remove: () => void } | undefined
  Promise.resolve(p.addListener(eventName, cb as (data: unknown) => void)).then((listener) => {
    if (removed) listener.remove()
    else handle = listener
  }).catch(() => {})
  return () => { removed = true; handle?.remove() }
}

// ── Local-track artwork ─────────────────────────────────────────────────────
// Embedded-cover reads (lib/localLibrary.ts's readArt) come back as a `data:`
// URI straight from the native plugin bridge — never a network fetch, so
// there's no CORS concern here at all (that's specifically an http(s) CDN
// problem, handled instead by MediaSessionPlugin's own native download via
// `artworkUrl`). fetch() still resolves data:/blob: URIs directly with no
// origin restriction, so this stays a JS-side decode: read it back through
// canvas to downscale before it goes over the bridge as base64, so a full-
// resolution embedded cover doesn't get shipped on every track change.
// Memoized by URL since Player.tsx's metadata effect re-fires on unrelated
// track-object churn, not just on the art actually changing.
let lastArtUrl: string | null = null
let lastArtBase64: string | null = null

export async function readLocalArtworkBase64(url: string): Promise<string | null> {
  if (url === lastArtUrl) return lastArtBase64
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const size = 300
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    lastArtUrl = url
    lastArtBase64 = base64
    return base64
  } catch {
    lastArtUrl = url
    lastArtBase64 = null
    return null
  }
}
