// Discord Rich Presence — shows what's playing in the user's Discord status.
//
// Uses @xhayper/discord-rpc (the maintained successor to Discord's archived
// `discord-rpc` package), which talks to the local Discord client over its
// IPC pipe. No OAuth/login is needed for this — `client.login()` with no
// scopes just opens the local connection.
//
// Connection is resilient on purpose: the desktop Discord client may not be
// running yet (or may restart) independently of this app, so failures here
// are expected and silently retried rather than surfaced as errors.

const { Client, StatusDisplayType } = require('@xhayper/discord-rpc')
const { ActivityType } = require('discord-api-types/v10')

const CLIENT_ID = '1521540582558924902'
const RECONNECT_MS = 15000
// Key of the image uploaded under Discord Developer Portal -> your app ->
// Rich Presence -> Art Assets. Fallback when a track has no usable cover URL
// (e.g. local files whose art is a base64 data URI with no public address).
const LARGE_IMAGE_KEY = 'logo'
// Rich Presence link button. Discord caps the label at 32 characters and the
// URL at 512; an activity that breaks either is rejected wholesale, taking the
// whole presence down with it, so both are enforced before sending.
const BUTTON_LABEL = 'Listen on API'
const BUTTON_URL_LIMIT = 512

let client = null
let connected = false
let reconnectTimer = null
let enabled = false
// Last requested presence op, applied once a connection is ready. Replaces
// itself on every call, so only the latest state is ever sent.
let pendingOp = null // { clear: true } | { clear: false, activity }

function clearReconnectTimer() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
}

function scheduleReconnect() {
  if (!enabled || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, RECONNECT_MS)
}

function createClient() {
  const c = new Client({ clientId: CLIENT_ID })
  // A client dropped by setEnabled(false) can still finish logging in; it
  // mustn't mark the current one connected, or connect() never runs again.
  c.on('ready', () => {
    if (c !== client) return
    connected = true
    if (pendingOp) { const op = pendingOp; pendingOp = null; applyOp(op) }
  })
  c.on('disconnected', () => {
    if (c !== client) return
    connected = false
    scheduleReconnect()
  })
  return c
}

async function connect() {
  if (!enabled || connected) return
  if (!client) client = createClient()
  try {
    await client.login()
  } catch {
    // Discord not running, or pipe unavailable — retry later, no error surfaced.
    scheduleReconnect()
  }
}

async function applyOp(op) {
  if (!connected || !client?.user) { pendingOp = op; return }
  try {
    if (op.clear) {
      await client.user.clearActivity()
      return
    }
    // Discord's client can retain the previous activity's start/end
    // timestamps when a later SET_ACTIVITY simply omits them, instead of
    // fully replacing — observed as a paused track showing its elapsed
    // timer keep ticking up (looking like the song had just restarted).
    // Force a real reset first whenever this update has no timestamps.
    if (op.activity.startTimestamp == null && op.activity.endTimestamp == null) {
      await client.user.clearActivity().catch(() => {})
    }
    await client.user.setActivity(op.activity)
  } catch {
    // Activity updates can race a disconnect — ignore, next call will retry.
  }
}

function setEnabled(value) {
  if (value === enabled) return
  enabled = value
  if (value) {
    connect()
  } else {
    clearReconnectTimer()
    pendingOp = null
    if (client) {
      const old = client
      client = null
      connected = false
      // Not logged in yet has no user, but still a connection attempt to close.
      const cleared = old.user ? old.user.clearActivity().catch(() => {}) : Promise.resolve()
      cleared.finally(() => old.destroy().catch(() => {}))
    }
  }
}

function setActivity(activity) {
  if (!enabled) return
  applyOp({ clear: false, activity })
}

function clearActivity() {
  if (!enabled) return
  applyOp({ clear: true })
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

// Default artist name shown in the "Listening to X" header when a track
// carries none of its own (radio/local files without matched metadata).
const DEFAULT_ARTIST = 'Juice WRLD'

/**
 * Build and apply a Rich Presence activity from app-domain "now playing"
 * facts. Keeps Discord's activity shape (timestamps, image keys, ActivityType)
 * out of the renderer — it only needs to report what's playing.
 *
 * @param {{ title: string, artist?: string, isPlaying: boolean, currentTime: number, duration: number, isRadio?: boolean, era?: string, coverUrl?: string | null, linkUrl?: string | null, labelMode?: 'app' | 'artist' | 'song' }} info
 */
// Last "now playing" facts applied, so a mid-track change to the "Show
// Discord Status" label setting can be reflected immediately (see
// refreshLabel) instead of waiting for the next natural update.
let lastInfo = null

function setNowPlaying(info) {
  if (!enabled) return
  if (!info || !info.title) { lastInfo = null; clearActivity(); return }
  lastInfo = info

  const activity = {
    // Discord renders a Spotify-style live time-bar for Listening activities.
    // When we don't supply real timestamps (paused — see below), it falls
    // back to showing time elapsed since the activity was last set, which
    // looks like an unrelated ticking counter. Playing doesn't get that
    // fallback treatment, so use it while paused to avoid the bogus timer.
    type: info.isPlaying ? ActivityType.Listening : ActivityType.Playing,
    details: info.title,
    state: info.artist || undefined,
    largeImageKey: LARGE_IMAGE_KEY,
    // Hover tooltip on the cover art — the song's era when known (e.g. "999
    // Reloaded"), falling back to a generic label for radio/local files with
    // no era data.
    largeImageText: info.era || (info.isRadio ? '999 FM' : 'Unreleased'),
    instance: false,
  }

  // Header line ("Listening to X"). Defaults to the app's own registered
  // name ("Unreleased") when `name` is left unset — labelMode overrides that
  // with the artist or song title instead, per the "Show Discord Status"
  // setting.
  if (info.labelMode === 'song') {
    activity.name = info.title
    activity.statusDisplayType = StatusDisplayType.NAME
  } else if (info.labelMode === 'artist') {
    activity.name = info.artist || DEFAULT_ARTIST
    activity.statusDisplayType = StatusDisplayType.NAME
  }

  // Per-track cover art. Classic RPC's `large_image` (largeImageKey) accepts
  // an external http(s) URL directly — Discord fetches it through its media
  // proxy and shows it as the activity image. Note largeImageUrl is NOT the
  // image source: the library maps it to `assets.large_url`, which is only
  // the click-through link on the image.
  //
  // Only real http(s) URLs work: the proxy fetch happens on Discord's servers
  // (that's how every viewer of the status loads the image), so a local file's
  // embedded art — a base64 data URI on this machine — can never be sent
  // directly, and neither could a localhost URL. Local files instead get the
  // cover of whichever API song they match, resolved renderer-side; when
  // nothing matches, coverUrl is absent and the static logo stands.
  if (info.coverUrl && /^https?:\/\//.test(info.coverUrl)) {
    activity.largeImageKey = info.coverUrl
  }

  // Link button under the card ("Listen on API"). Discord allows up to two
  // buttons, each an http(s) URL — it renders them for anyone viewing the
  // status. The renderer decides where it points and omits it entirely when
  // there's nothing to point at (e.g. a local file with no API match), since a
  // button leading to an empty search is worse than no button.
  if (info.linkUrl && /^https?:\/\//.test(info.linkUrl) && info.linkUrl.length <= BUTTON_URL_LIMIT) {
    activity.buttons = [{ label: BUTTON_LABEL, url: info.linkUrl }]
  }

  if (info.isPlaying && info.duration > 0) {
    // Timestamps drive Discord's own live (animating) progress bar.
    const startMs = Date.now() - Math.max(0, info.currentTime) * 1000
    activity.startTimestamp = startMs
    activity.endTimestamp = startMs + info.duration * 1000
  } else {
    // Paused: Discord's progress bar is always wall-clock driven, so it can't
    // be frozen — supplying timestamps would keep it ticking, omitting them
    // makes it vanish. Show the frozen position as text instead so it neither
    // advances nor resets to 0:00.
    const pos = info.duration > 0
      ? `${fmtTime(info.currentTime)} / ${fmtTime(info.duration)}`
      : fmtTime(info.currentTime)
    activity.state = info.artist ? `⏸ ${pos} · ${info.artist}` : `⏸ ${pos}`
  }

  setActivity(activity)
}

// Re-applies the currently playing/paused activity with a new labelMode —
// called when the "Show Discord Status" setting changes, so the header
// updates right away instead of waiting for the next track/seek.
function refreshLabel(labelMode) {
  if (!lastInfo) return
  setNowPlaying({ ...lastInfo, labelMode })
}

module.exports = { setEnabled, setActivity, clearActivity, setNowPlaying, refreshLabel }
