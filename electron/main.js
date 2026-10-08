const { app, BrowserWindow, shell, dialog, Menu, Tray, ipcMain, nativeImage, protocol, net, globalShortcut, screen, clipboard, session, powerMonitor } = require('electron')
const { autoUpdater } = require('electron-updater')
const { loadOfflineLibraryFile, updateOfflineLibraryFile } = require('./offlineLibrary')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const https = require('https')
const { pathToFileURL, fileURLToPath } = require('url')
const { Readable } = require('stream')
const discordRpc = require('./discordRpc')
const { configureRuntime } = require('./platform')

// Response() only accepts web ReadableStreams, not Node streams
const webStreamFromNode = (stream) => Readable.toWeb(stream)

const isSmokeTest = process.argv.includes('--smoke-test')
const isDev = (!app.isPackaged || process.env.NODE_ENV === 'development') && !isSmokeTest

// Must run before ready: Chromium reads Ozone/GPU switches while booting.
// Explicit --ozone-platform flags are preserved; see platform.js.
const runtimePlatform = configureRuntime(app)

// Dev runs (unpackaged, launched via `electron .`) must NOT share the
// packaged app's AppUserModelID — Windows uses this id to decide whether two
// processes/shortcuts are "the same app" for taskbar grouping, jump lists,
// and pinning. Sharing it let a stray dev run poison the shell's cached icon
// for the real installed app (dev's raw node_modules/electron/dist/electron.exe
// showing up in place of the installed Unreleased.exe).
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'Unreleased' : 'Unreleased.Dev')
Menu.setApplicationMenu(null)

// Only one instance may run at a time — launching a second copy (e.g. double-
// clicking the exe again, or a shortcut) just focuses the existing window
// instead of spinning up a competing process against the same userData files.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

// Dev mode loads the renderer from http://localhost:3018 (see electron:dev
// script), and Chromium blocks <audio>/<img>/<video> loading a `file://`
// resource from a non-file-origin page ("Not allowed to load local resource").
// A custom scheme sidesteps that restriction in both dev and the packaged
// (file://) build, and — with `stream: true` below — still supports Range
// requests so audio/video seeking works.
protocol.registerSchemesAsPrivileged([
  // bypassCSP dropped: the app's CSP (src/renderer/index.html) explicitly
  // allowlists local-media: in img-src/media-src, so nothing needs to bypass
  // it — and everything else loaded by the page stays governed by the policy.
  { scheme: 'local-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
])

// ── Settings persistence ──────────────────────────────────────────────────────
const settingsPath = path.join(app.getPath('userData'), 'app-settings.json')
let appSettings = {
  downloadPath: app.getPath('downloads'),
  autoDownload: true,
  minimizeToTray: false,
  // 'taskbar' | 'tray' — where minimizing sends the window. 'tray' hides it to
  // the tray icon (Windows itself decides whether that icon sits in the
  // visible strip or the overflow — the user pins it via Taskbar settings).
  minimizeTo: 'taskbar',
  startupView: 'api-tracker',
  discordRpcEnabled: true,
  // What the "Listening to X" header in Discord's Rich Presence shows —
  // 'app' leaves it unset (falls back to the app's own registered name,
  // "Unreleased"), 'artist' shows the track's artist (or "Juice WRLD" when
  // none is known — radio/unmatched local files), 'song' shows the title.
  discordRpcLabel: 'artist',
  offlineLibraryPath: path.join(app.getPath('userData'), 'offline-audio'),
  // When on, opening the mini player hides every other window (main + other
  // pop-outs); they're restored when the mini player closes.
  miniPlayerHidesWindows: false,
  // Prompt "a song is still playing — quit?" when a close would fully exit the
  // app (not a minimize-to-tray) while audio is playing. Guards only the direct
  // window close (X button / Alt+F4); deliberate quits skip it (see
  // skipCloseConfirm + the before-quit handler).
  confirmCloseWhilePlaying: true,
  // When on, the main window's title (taskbar / alt-tab label) follows the
  // current track instead of staying "Unreleased".
  windowTitleNowPlaying: true,
  // Remember how big the user left each window (main + every pop-out) and
  // reopen it at that size. See the window-size persistence block below.
  rememberWindowSizes: true,
  // { [key]: { width, height, maximized? } } — key is 'main' or a pop-out view
  // name. Written by rememberSize(); wiped when rememberWindowSizes is turned
  // off so re-enabling starts from the built-in defaults again.
  windowSizes: {},
}
let settingsLoadError = null
try {
  const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
  appSettings = { ...appSettings, ...saved }
} catch (e) {
  // ENOENT on first run is normal and not worth logging; anything else means
  // app-settings.json exists but is unreadable/corrupt, silently reverting to
  // defaults — worth a trail once runLog exists (defined further down).
  if (e && e.code !== 'ENOENT') settingsLoadError = e
}
// Migrate the removed 'notification' minimize mode (an always-pin-the-tray-icon
// experiment that Windows wouldn't reliably honor) down to plain 'tray'.
if (appSettings.minimizeTo === 'notification') appSettings.minimizeTo = 'tray'

function saveSettings() {
  try { fs.writeFileSync(settingsPath, JSON.stringify(appSettings, null, 2)) } catch {}
}

// ── Logging ───────────────────────────────────────────────────────────────────
const logFile = path.join(app.getPath('userData'), 'updater.log')
const MAX_LOG_BYTES = 2 * 1024 * 1024
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`
  try {
    const stat = fs.statSync(logFile, { throwIfNoEntry: false })
    if (stat && stat.size > MAX_LOG_BYTES) fs.writeFileSync(logFile, '')
    fs.appendFileSync(logFile, line)
  } catch {}
  if (isDev) console.log(...args)
}

// ── Run / crash logging ─────────────────────────────────────────────────────
// A rolling log of the current run. At startup the previous run's log is kept
// as `previous-run.log` so that after a hang/crash (or a plain restart) we can
// still read what the app was doing right before it died — even when the app
// never showed an error. Renderer-side breadcrumbs are forwarded here over IPC
// (see 'run-log' handler + preload logRun), so a browser-side freeze like the
// tracker's "sort by name" full-library load leaves a trail too.
const runLogPath = path.join(app.getPath('userData'), 'current-run.log')
const prevRunLogPath = path.join(app.getPath('userData'), 'previous-run.log')
try {
  if (fs.existsSync(runLogPath)) fs.renameSync(runLogPath, prevRunLogPath)
} catch {}

function runLog(scope, ...args) {
  const msg = args
    .map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })()))
    .join(' ')
  const line = `[${new Date().toISOString()}] [${scope}] ${msg}\n`
  try { fs.appendFileSync(runLogPath, line) } catch {}
  if (isDev) console.log(`[${scope}]`, ...args)
}

if (settingsLoadError) {
  runLog('settings', 'app-settings.json unreadable, reverted to defaults:', settingsLoadError.message)
}

function memSnapshot() {
  try {
    const m = process.memoryUsage()
    const mb = (n) => Math.round(n / 1024 / 1024)
    return `rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB`
  } catch { return '' }
}

runLog('main', `=== app start === v${app.getVersion?.() || '?'} pid=${process.pid} platform=${runtimePlatform.platform} display=${runtimePlatform.displayServer} ${memSnapshot()}`)

// Main-process crashes: log them (and to updater.log) before the app dies.
process.on('uncaughtException', (err) => {
  runLog('main', 'UNCAUGHT EXCEPTION:', err?.stack || String(err))
  log('Uncaught exception:', err?.stack || String(err))
})
process.on('unhandledRejection', (reason) => {
  runLog('main', 'UNHANDLED REJECTION:', (reason instanceof Error && reason.stack) || String(reason))
})

// ── Shared file download helper (used by force-update + offline library) ──────
// Writes to a `.part` temp file and renames into place only after the byte
// count checks out against Content-Length. Writing straight to `dest` meant a
// dropped connection could leave a truncated file that later passed the
// offline library's "already downloaded" existence check — or, on a
// re-download of a changed track, destroy the old good copy with partial data.
function downloadFile(url, dest, onProgress) {
  const tmp = dest + '.part'
  return new Promise((resolve, reject) => {
    function doGet(u) {
      const opts = new URL(u)
      https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { 'User-Agent': 'Unreleased-App' } }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) return doGet(res.headers.location)
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let received = 0
        const out = fs.createWriteStream(tmp)
        const fail = (err) => {
          out.destroy()
          try { fs.unlinkSync(tmp) } catch {}
          reject(err)
        }
        res.on('data', chunk => {
          received += chunk.length
          if (onProgress) onProgress(total > 0 ? Math.round(received / total * 100) : 0, received, total)
        })
        res.pipe(out)
        out.on('finish', () => {
          if (total > 0 && received !== total) return fail(new Error(`Truncated download: got ${received} of ${total} bytes`))
          try { fs.renameSync(tmp, dest) } catch (e) { return fail(e) }
          resolve()
        })
        out.on('error', fail)
        res.on('error', fail)
      }).on('error', reject)
    }
    doGet(url)
  })
}

// ── Auto-updater setup ────────────────────────────────────────────────────────
autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} }
autoUpdater.autoDownload = appSettings.autoDownload
autoUpdater.autoInstallOnAppQuit = true

// Startup-only checking meant a user who left the app running (or asleep on a
// laptop) for days never saw an update until their next full relaunch. These
// two flags let the periodic/resume checks below skip themselves when a check
// is already in flight or a downloaded update is already sitting there
// waiting on "Restart now" — re-checking in either case just wastes a request.
let updateCheckInProgress = false
let updateDownloadedPending = false
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

// Set for the duration of the app-launch check so 'update-downloaded' can tell
// a fresh-at-startup download (or a previous session's update that never got
// installed, e.g. the user declined the restart prompt and later relaunched
// instead of hitting Restart) apart from one found mid-session. Startup
// installs silently and relaunches; mid-session still asks before restarting
// the user's active work.
let isStartupUpdateCheck = false

function runUpdateCheck(reason) {
  if (isDev || updateCheckInProgress || updateDownloadedPending) return
  log(`Checking for updates (${reason})...`)
  updateCheckInProgress = true
  if (reason === 'startup') isStartupUpdateCheck = true
  autoUpdater.checkForUpdatesAndNotify()
    .catch(err => log('checkForUpdates error:', err.message))
    .finally(() => { updateCheckInProgress = false })
}
// Beta channel — gated server-side by juicewrldapi.com, not by anything
// baked into this app (see build/fetch-releases.ps1 for the full endpoint
// contract). The marker file holds the *validated code itself*, used as a
// bearer credential on every update check, not just a yes/no flag. It's
// dropped by the Windows installer's options page (build/installer.nsh) on
// a valid code, or by the beta-join handler below when joined from Settings.
const BETA_API_BASE = 'https://juicewrldapi.com/beta'
const betaMarkerPath = path.join(app.getPath('userData'), 'beta-access')

function readBetaCode() {
  try { return fs.readFileSync(betaMarkerPath, 'utf-8').trim() || null } catch { return null }
}

// Stable feed's GitHub repo — see scripts/python/release.py, which publishes
// every stable release here.
const UPDATE_REPO = { owner: 'Juice-WRLD-API', repo: 'Unreleased' }

// Switches the updater between the normal stable (GitHub) feed and the
// gated beta feed. electron-updater allows re-pointing the feed at runtime,
// so join/leave (and switching update source) take effect immediately, no
// restart needed.
let activeBetaCode = null
function applyUpdateFeed(code) {
  activeBetaCode = code || null
  if (code) {
    autoUpdater.setFeedURL({ provider: 'generic', url: `${BETA_API_BASE}/update-feed`, channel: 'latest' })
    autoUpdater.requestHeaders = { 'X-Beta-Code': code }
    autoUpdater.allowPrerelease = true
  } else {
    const { owner, repo } = UPDATE_REPO
    autoUpdater.setFeedURL({ provider: 'github', owner, repo })
    autoUpdater.requestHeaders = null
    autoUpdater.allowPrerelease = false
  }
}

// The beta feed is served by juicewrldapi.com, whose SPA answers unknown paths
// with index.html at HTTP 200 rather than a 404. So when the /beta endpoints go
// away, `latest.yml` comes back as a page of HTML, js-yaml throws on it, and the
// updater fails — with no status code anywhere to reveal that the endpoint is
// simply gone. Because the marker lives in userData, that state survives
// uninstall, reinstall, and the force-update path, which is how a user ends up
// permanently stuck on "check failed" while force-install keeps working.
//
// Any failure that means "this feed isn't speaking the update protocol" is
// therefore treated as "beta is unavailable", not as a fatal update error: we
// re-point at the stable GitHub feed and finish the check there. The marker is
// deliberately left on disk, so beta resumes by itself if the backend returns —
// the cost is one wasted request per launch, which beats bricking the updater.
// Certificate errors are deliberately excluded: they're the signal of a
// possible interception attempt, not "the feed is down," so they should
// surface as a real update error instead of silently falling back to the
// stable feed.
function isBetaFeedUnavailable(msg) {
  return /Cannot parse update info|YAMLException|HTTP 4\d\d|ENOTFOUND|ECONNREFUSED/i.test(msg)
}
let betaFallbackDone = false

const initialBetaCode = readBetaCode()
applyUpdateFeed(initialBetaCode)
if (initialBetaCode) log('Beta access marker present — gated beta update feed enabled')

// On Windows, BrowserWindow/Tray icons are loaded by native code that can't
// read files packed inside app.asar — it silently falls back to Electron's
// default icon (only the taskbar/alt-tab icon is affected; the .exe's own
// PE resource icon, used by File Explorer and shortcuts, is unaffected).
// So when packaged, load icon.ico from the extraResources copy sitting next
// to app.asar instead of the one bundled inside it.
const iconPath = process.platform === 'linux'
  ? path.join(__dirname, '..', 'resources', 'icon-512.png')
  : app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, 'icon.ico')
const preloadPath = path.join(__dirname, 'preload.js')

let mainWindow = null
let tray = null
let isQuitting = false
// Deliberate/programmatic quits (tray "Quit", restart, update install, OS
// shutdown) all route through app.quit() → 'before-quit', which sets this
// before any window 'close' fires. A direct window close (X button, Alt+F4)
// does not, so that's the only path the "song still playing" prompt guards.
let skipCloseConfirm = false

// ── Floating pop-out windows ──────────────────────────────────────────────────
// Each entry is a second frameless BrowserWindow booting the same renderer
// bundle with ?float=<view> (+ any params, e.g. songId) — the renderer sees
// that param and mounts just that one view (see src/renderer/src/FloatApp.tsx)
// instead of the full app. One window per view: reopening focuses the existing
// one and hands it the new params over 'float-params' (so "Info" on a second
// song swaps the open info window's content rather than stacking windows).
// Store state is mirrored between windows by the 'window-sync' relay below.
const FLOAT_SIZES = {
  settings:      { width: 860,  height: 640, minWidth: 520, minHeight: 420 },
  'song-info':   { width: 540,  height: 760, minWidth: 420, minHeight: 480 },
  editor:        { width: 1000, height: 760, minWidth: 700, minHeight: 520 },
  // Wider than the API editor: the local tag editor carries more field cards
  // (credits/numbers/details/lyrics). 1200 clears Tailwind's lg breakpoint
  // (1024px) so the art rail sits beside the fields instead of stacking above
  // them, and fits the body's max-w-6xl (1152px) plus its px-6 padding.
  'local-editor': { width: 1200, height: 860, minWidth: 700, minHeight: 520 },
  // Compact bar height — must match MiniPlayer.tsx's h-[192px]. The window
  // stays height-locked at this until the lyrics/queue panel expands it
  // (see 'mini-player-set-expanded' below).
  'mini-player': { width: 480,  height: 192, minWidth: 420, minHeight: 192 },
  // Sized to the panel's fixed w-[340px] plus chrome; content scrolls
  // vertically when the window is shorter than the full panel.
  equalizer:     { width: 384,  height: 720, minWidth: 372, minHeight: 420 },
  // Fits the convert dialog's max-w-md body (format grid + bitrate + options)
  // without scrolling; content scrolls if the user shrinks it.
  convert:       { width: 460,  height: 660, minWidth: 380, minHeight: 440 },
  // The staff profile: proposals, comp files, reports, admin. Every one of
  // those tabs is a master-detail split (a ~18rem list column plus a detail
  // pane), so it needs real width — below ~760 the detail pane stops being
  // usable and the tab strip starts scrolling.
  profile:       { width: 1180, height: 820, minWidth: 760, minHeight: 560 },
}
// Window titles for the pop-outs. Every window boots the same renderer bundle,
// whose <title> is "unreleased", so without these each pop-out would be an
// indistinguishable "unreleased" entry in the taskbar / alt-tab list. The
// windows are frameless, so this is the only place the name shows.
const FLOAT_TITLES = {
  settings:       'Settings',
  'song-info':    'Song Info',
  editor:         'Song Editor',
  'local-editor': 'Tag Editor',
  'mini-player':  'Mini Player',
  equalizer:      'Equalizer',
  convert:        'Convert Format',
  profile:        'Profile',
}
function floatTitle(view) {
  return `${FLOAT_TITLES[view] || 'Unreleased'} — Unreleased`
}

// Extra per-view BrowserWindow options on top of FLOAT_SIZES. The mini
// player floats above other apps by default (its pin button toggles this).
// `alwaysOnTop` here only gets it topmost from the first paint — the level is
// upgraded to 'screen-saver' on ready-to-show (see applyAlwaysOnTop).
const FLOAT_OPTIONS = {
  'mini-player': { alwaysOnTop: true, maximizable: false, fullscreenable: false },
}
const floatWindows = new Map()

// ── Always-on-top (mini player pin) ──────────────────────────────────────────
// A bare setAlwaysOnTop(true) uses the 'floating' level, which loses to plenty
// of other windows — most visibly apps running borderless fullscreen, i.e.
// games. 'screen-saver' is the highest level Electron exposes and is what
// actually keeps the mini player visible over one.
function applyAlwaysOnTop(win, on) {
  if (!win || win.isDestroyed()) return
  // Electron's named z-order levels are implemented on Windows/macOS only.
  // Linux window managers/compositors own the exact stacking policy.
  if (process.platform === 'linux') win.setAlwaysOnTop(on)
  else win.setAlwaysOnTop(on, 'screen-saver')
  // macOS: ride along onto other apps' fullscreen Spaces instead of staying
  // stuck to the desktop the mini player was opened on. skipTransformProcessType
  // avoids the dock-icon flicker the call otherwise causes.
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: true, skipTransformProcessType: true })
  }
}

// Windows keeps topmost windows in their own z-order band, ordered by when
// each was last raised — so a game going fullscreen (or any other topmost
// app activating) can land ABOVE an already-topmost mini player. That's the
// "pin randomly stops working" case: the flag is still set, the window just
// isn't at the front of the band anymore. Re-asserting it puts it back.
//
// Only runs while pinned, visible and unfocused — a focused window is already
// on top, and re-asserting then would be pure churn.
const TOP_REASSERT_MS = 10000
let miniTopKeeper = null

function startTopKeeper(win) {
  stopTopKeeper()
  // Re-adding a window to the topmost z-order band is a Windows workaround.
  // Repeating it on Linux can cause focus/flicker issues and cannot override a
  // Wayland compositor's security policy anyway.
  if (process.platform !== 'win32') return
  miniTopKeeper = setInterval(() => {
    if (!win || win.isDestroyed()) { stopTopKeeper(); return }
    if (!win.isAlwaysOnTop() || !win.isVisible() || win.isMinimized() || win.isFocused()) return
    // Toggle off→on rather than re-applying 'screen-saver': setting the level
    // it already has is a no-op internally, and it's the re-add that actually
    // moves the window to the front of the topmost band.
    win.setAlwaysOnTop(false)
    applyAlwaysOnTop(win, true)
  }, TOP_REASSERT_MS)
}

function stopTopKeeper() {
  if (miniTopKeeper) { clearInterval(miniTopKeeper); miniTopKeeper = null }
}

// Renderer-supplied params ride the URL / float-params events — keep them to
// plain string/number/boolean values.
function sanitizeFloatParams(params) {
  const out = {}
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
    }
  }
  return out
}

// ── Window size persistence (setting: rememberWindowSizes) ────────────────────
// Only the SIZE is remembered, never the position: pop-outs still get centered
// on the active display (below), so a window can't reopen off-screen or on a
// monitor that has since been unplugged.
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)) }

// Saved size for `key`, clamped to the window's own minimums and to the work
// area it's about to open on. Returns null when the feature is off or nothing
// has been recorded yet, in which case callers fall back to the defaults.
function savedWindowSize(key, base, workArea) {
  if (!appSettings.rememberWindowSizes) return null
  const s = appSettings.windowSizes?.[key]
  if (!s || typeof s !== 'object') return null
  const size = {}
  if (Number.isFinite(s.width)) size.width = clamp(Math.round(s.width), base.minWidth || 0, workArea.width)
  if (Number.isFinite(s.height)) size.height = clamp(Math.round(s.height), base.minHeight || 0, workArea.height)
  return Object.keys(size).length ? size : null
}

// Record `win`'s size under `key` as the user resizes it. Debounced so a drag
// doesn't write the settings file on every frame, and flushed on close so the
// final size always lands.
function rememberSize(win, key) {
  let timer = null
  const record = () => {
    if (win.isDestroyed() || !appSettings.rememberWindowSizes) return
    // A minimized window reports junk bounds on some platforms, and
    // getNormalBounds() ignores the maximized/fullscreen frame so un-maximizing
    // returns to the size the user actually picked.
    if (win.isMinimized()) return
    const { width, height } = win.getNormalBounds()
    if (!appSettings.windowSizes || typeof appSettings.windowSizes !== 'object') appSettings.windowSizes = {}
    appSettings.windowSizes[key] = key === 'mini-player'
      // The mini player's height is driven by the compact/expanded toggle
      // (mini-player-set-expanded), which locks it via setMaximumSize —
      // restoring a stored height would fight that, so only the width persists.
      ? { width }
      : { width, height, ...(key === 'main' ? { maximized: win.isMaximized() } : {}) }
    saveSettings()
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(record, 400) }
  win.on('resize', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', () => { clearTimeout(timer); record() })
}

// A new BrowserWindow with no x/y lands centered on the PRIMARY display, so a
// pop-out opened while the app sits on a second monitor would jump to the main
// screen. Center it on whichever display currently holds the app instead —
// preferring the focused window (the pop-out could be opened from another
// pop-out), falling back to the main window. Also resolves the window's size,
// since centering depends on it.
function floatBounds(view) {
  const base = runtimePlatform.nativeWayland && view === 'mini-player'
    // Native Wayland does not permit reliable app-driven resizing after a
    // surface is mapped. Start the mini player at its panel size instead; the
    // renderer keeps a panel open in this fixed-height mode.
    ? { ...FLOAT_SIZES[view], height: MINI_EXPANDED_HEIGHT, minHeight: MINI_EXPANDED_MIN_HEIGHT }
    : FLOAT_SIZES[view]
  if (runtimePlatform.nativeWayland) {
    // Wayland deliberately hides global coordinates and lets the compositor
    // place new surfaces. Supplying X/Y would be ignored and can trigger GTK
    // warnings, so only restore a size that fits the primary work area.
    const { workArea } = screen.getPrimaryDisplay()
    const { width, height } = { ...base, ...savedWindowSize(view, base, workArea) }
    return { width, height }
  }
  const ref = BrowserWindow.getFocusedWindow() || mainWindow
  const { workArea } = ref && !ref.isDestroyed()
    ? screen.getDisplayMatching(ref.getBounds())
    : screen.getPrimaryDisplay()
  const { width, height } = { ...base, ...savedWindowSize(view, base, workArea) }
  return {
    width, height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  }
}

function createFloatWindow(view, params) {
  const query = {
    float: view,
    ...sanitizeFloatParams(params),
    ...(runtimePlatform.nativeWayland && view === 'mini-player' ? { fixedHeight: 'true' } : {}),
  }
  const existing = floatWindows.get(view)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    if (view !== 'mini-player') existing.focus()
    existing.webContents.send('float-params', query)
    if (view === 'mini-player' && appSettings.miniPlayerHidesWindows) hideWindowsForMiniPlayer()
    return
  }
  const win = new BrowserWindow({
    ...FLOAT_SIZES[view],
    ...floatBounds(view),
    ...(runtimePlatform.nativeWayland && view === 'mini-player' ? { minHeight: MINI_EXPANDED_MIN_HEIGHT } : {}),
    ...(FLOAT_OPTIONS[view] || {}),
    title: floatTitle(view),
    backgroundColor: '#0a0a0a', icon: iconPath, frame: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, webSecurity: true, preload: preloadPath,
    },
    show: false,
  })
  // The shared bundle's <title> would otherwise overwrite the title above the
  // moment the page loads.
  win.on('page-title-updated', (e) => e.preventDefault())
  rememberSize(win, view)
  floatWindows.set(view, win)
  broadcastFloatWindows()
  win.once('ready-to-show', () => {
    win.show()
    if (view !== 'mini-player') win.focus()
    if (view === 'mini-player') {
      // Upgrade from the constructor's default 'floating' level to the one
      // that actually clears fullscreen games, and start holding it there.
      applyAlwaysOnTop(win, true)
      startTopKeeper(win)
    }
    // Hide the other windows only once the mini player is actually on screen,
    // so there's never a moment with no visible window.
    if (view === 'mini-player' && appSettings.miniPlayerHidesWindows) hideWindowsForMiniPlayer()
  })
  win.on('closed', () => {
    if (floatWindows.get(view) === win) floatWindows.delete(view)
    broadcastFloatWindows()
    // Always restore on close (even if the setting was turned off meanwhile) so
    // hidden windows can never be stranded.
    if (view === 'mini-player') {
      stopTopKeeper()
      restoreWindowsAfterMiniPlayer()
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url)
    return { action: 'deny' }
  })
  guardNavigation(win)
  if (isDev) {
    win.loadURL(`http://localhost:3018/?${new URLSearchParams(query)}`)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'), { query })
  }
}

function closeAllFloatWindows() {
  for (const win of floatWindows.values()) {
    if (!win.isDestroyed()) win.close()
  }
  floatWindows.clear()
  broadcastFloatWindows()
}

// Which pop-outs are currently open, pushed to every window. Lets a renderer
// avoid rendering an in-app copy of a view that's already popped out (the
// equalizer panel) and route its button to the existing window instead.
function openFloatViews() {
  return [...floatWindows.entries()].filter(([, w]) => !w.isDestroyed()).map(([view]) => view)
}

function broadcastFloatWindows() {
  broadcastToWindows('float-windows', openFloatViews())
}

// ── Mini-player "solo" mode (setting: miniPlayerHidesWindows) ─────────────────
// When enabled, opening the mini player hides every other currently-visible
// window (the main window + any other pop-outs), leaving just the compact bar;
// closing the mini player brings them back. Only windows that were actually
// visible are remembered, so a window the user had already hidden (e.g. to the
// tray) isn't force-revealed on restore.
let miniPlayerHiddenWindows = []

function hideWindowsForMiniPlayer() {
  const mini = floatWindows.get('mini-player')
  miniPlayerHiddenWindows = []
  for (const win of BrowserWindow.getAllWindows()) {
    if (win === mini || win.isDestroyed() || !win.isVisible()) continue
    miniPlayerHiddenWindows.push(win)
    win.hide()
  }
}

function restoreWindowsAfterMiniPlayer() {
  for (const win of miniPlayerHiddenWindows) {
    if (win && !win.isDestroyed()) win.show()
  }
  miniPlayerHiddenWindows = []
}

// Send to every window (main + floats). Used for events any window might be
// showing UI for — e.g. update-status feeds the Settings header, which can
// live in a pop-out.
function broadcastToWindows(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

// ── Tray ──────────────────────────────────────────────────────────────────────
// Playback state mirrored from the renderer (via 'tray-playback-state') so the
// tray menu can show now-playing info and offer media controls. The renderer
// owns the actual audio element; tray buttons just send commands back to it.
let trayPlayback = { hasTrack: false, isPlaying: false, title: '', artist: '', liked: false }

function sendTrayCommand(cmd) {
  mainWindow?.webContents.send('tray-command', cmd)
}

function buildTrayMenu() {
  // `hasTrack` gates the controls (false during FM radio, matching the in-app
  // buttons), but the now-playing label follows `title` so FM still shows
  // what's on air.
  const { hasTrack, isPlaying, title, artist, liked } = trayPlayback
  const nowPlaying = title
    ? `${title}${artist ? ` — ${artist}` : ''}`
    : 'Nothing playing'
  return Menu.buildFromTemplate([
    { label: nowPlaying.length > 60 ? nowPlaying.slice(0, 57) + '…' : nowPlaying, enabled: false },
    { type: 'separator' },
    { label: isPlaying ? 'Pause' : 'Play', enabled: hasTrack, click: () => sendTrayCommand('play-pause') },
    { label: 'Next track', enabled: hasTrack, click: () => sendTrayCommand('next') },
    { label: 'Previous track', enabled: hasTrack, click: () => sendTrayCommand('previous') },
    { label: liked ? 'Unlike song' : 'Like song', enabled: hasTrack, click: () => sendTrayCommand('toggle-like') },
    { type: 'separator' },
    { label: 'Open Unreleased', click: () => showMainWindow() },
    { label: 'Open mini player', click: () => createFloatWindow('mini-player') },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } },
  ])
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function hideWindowToTray() {
  mainWindow?.hide()
}

function updateTray() {
  if (!tray) return
  const { isPlaying, title, artist } = trayPlayback
  tray.setToolTip(title
    ? `Unreleased — ${isPlaying ? 'Playing' : 'Paused'}: ${title}${artist ? ` — ${artist}` : ''}`
    : 'Unreleased')
  tray.setContextMenu(buildTrayMenu())
}

function createTray() {
  try {
    tray = new Tray(iconPath)
    updateTray()
    tray.on('click', () => showMainWindow())
    // Windows only, but harmless elsewhere: double-click also restores.
    tray.on('double-click', () => showMainWindow())
  } catch (e) {
    log('Tray creation failed:', e.message)
  }
}

ipcMain.on('tray-playback-state', (_, state) => {
  if (!state || typeof state !== 'object') return
  trayPlayback = {
    hasTrack: !!state.hasTrack,
    isPlaying: !!state.isPlaying,
    title: typeof state.title === 'string' ? state.title : '',
    artist: typeof state.artist === 'string' ? state.artist : '',
    liked: !!state.liked,
  }
  updateTray()
  updateMainWindowTitle()
})

// The main window's taskbar / alt-tab label. With `windowTitleNowPlaying` on
// (the default) it follows the current track; otherwise — and whenever nothing
// is loaded — it falls back to the plain app name.
function updateMainWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // Follows `title` rather than `hasTrack` for the same reason the tray's
  // now-playing label does: during FM radio `hasTrack` is false (it gates the
  // transport controls) but there is still a track name worth showing.
  const { title, artist } = trayPlayback
  mainWindow.setTitle(appSettings.windowTitleNowPlaying !== false && title
    ? `${title}${artist ? ` — ${artist}` : ''} • Unreleased`
    : 'Unreleased')
}

// Only these schemes make sense to hand off to the OS's default handler —
// blocks a compromised renderer (or a malicious link in fetched content) from
// using shell.openExternal to launch e.g. a file:// path or a custom
// protocol some other installed app registered.
function isSafeExternalUrl(url) {
  try {
    const scheme = new URL(url).protocol
    return scheme === 'https:' || scheme === 'http:' || scheme === 'mailto:'
  } catch {
    return false
  }
}
function safeOpenExternal(url) {
  if (isSafeExternalUrl(url)) shell.openExternal(url)
}

// Blocks in-place navigation away from the app's own bundle (index.html /
// the Vite dev server) on every window — without this, a compromised
// renderer (or content it loads) could navigate the whole window to an
// attacker origin, which then inherits this window's preload bridge.
// Opening a *new* window for an external link is setWindowOpenHandler's job,
// not this one's.
function guardNavigation(win) {
  const allowedOrigin = isDev ? 'http://localhost:3018' : 'file://'
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedOrigin)) event.preventDefault()
  })
}

// ── Window creation ───────────────────────────────────────────────────────────
function createWindow() {
  const mainDefaults = { width: 1280, height: 800, minWidth: 960, minHeight: 600 }
  const { workArea } = screen.getPrimaryDisplay()
  mainWindow = new BrowserWindow({
    ...mainDefaults,
    ...savedWindowSize('main', mainDefaults, workArea),
    title: 'Unreleased',
    backgroundColor: '#0a0a0a', icon: iconPath, frame: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, webSecurity: true, preload: preloadPath,
    },
    show: false,
  })

  if (isSmokeTest) {
    const timeout = setTimeout(() => {
      console.error(`[smoke] timed out on ${runtimePlatform.displayServer}`)
      app.exit(1)
    }, 20000)
    mainWindow.webContents.once('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame) return
      clearTimeout(timeout)
      console.error(`[smoke] renderer failed on ${runtimePlatform.displayServer}: ${code} ${description}`)
      app.exit(1)
    })
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        // A loaded HTML file is not enough: wait for React to mount a child in
        // #root so CI also catches renderer bootstrap failures.
        await new Promise((resolve) => setTimeout(resolve, 250))
        const mounted = await mainWindow.webContents.executeJavaScript(
          "Boolean(document.querySelector('#root')?.firstElementChild)",
          true,
        )
        if (!mounted) throw new Error('React did not mount into #root')
        clearTimeout(timeout)
        console.log(`[smoke] renderer mounted on ${runtimePlatform.platform}/${runtimePlatform.displayServer}`)
        app.exit(0)
      } catch (error) {
        clearTimeout(timeout)
        console.error(`[smoke] renderer bootstrap failed on ${runtimePlatform.displayServer}: ${error.message}`)
        app.exit(1)
      }
    })
  }

  // The renderer's <title> would otherwise clobber the now-playing title.
  mainWindow.on('page-title-updated', (e) => e.preventDefault())

  rememberSize(mainWindow, 'main')

  mainWindow.once('ready-to-show', () => {
    // Maximize before showing so the window doesn't visibly snap open at its
    // restored size first.
    if (appSettings.rememberWindowSizes && appSettings.windowSizes?.main?.maximized) mainWindow.maximize()
    mainWindow.show()
    updateMainWindowTitle()
  })

  // Renderer crash / freeze diagnostics. `render-process-gone` fires when the
  // renderer dies (crash, OOM-kill) even though the main process — and thus the
  // app window frame — may survive; `unresponsive` fires when the renderer is
  // frozen (e.g. a synchronous blowup like sorting/rendering a huge list), which
  // is the classic "nearly crashed my PC" hang. Both land in the run log.
  mainWindow.webContents.on('render-process-gone', (_, details) => {
    runLog('renderer', `PROCESS GONE reason=${details.reason} exitCode=${details.exitCode}`)
  })
  mainWindow.webContents.on('unresponsive', () => {
    runLog('renderer', `UNRESPONSIVE (renderer frozen) ${memSnapshot()}`)
  })
  mainWindow.webContents.on('responsive', () => {
    runLog('renderer', 'responsive again')
  })

  mainWindow.on('close', (e) => {
    // Minimize-to-tray close: hide instead of quitting. The app (and playback)
    // keeps running, so there's nothing to confirm.
    if (!isQuitting && appSettings.minimizeToTray && tray) {
      e.preventDefault()
      mainWindow.hide()
      return
    }
    // Otherwise the window is really closing and the app will exit — which stops
    // playback. If a song is playing, confirm first. macOS keeps running after a
    // window close (window-all-closed doesn't quit there), so nothing is
    // interrupted and there's no prompt; deliberate quits skip it too.
    if (
      !skipCloseConfirm &&
      process.platform !== 'darwin' &&
      appSettings.confirmCloseWhilePlaying &&
      trayPlayback.isPlaying
    ) {
      e.preventDefault()
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Quit', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'Quit Unreleased?',
        message: 'A song is still playing.',
        detail: 'Quit anyway? Playback will stop.',
        checkboxLabel: "Don't ask me again",
        checkboxChecked: false,
      }).then(({ response, checkboxChecked }) => {
        if (checkboxChecked) {
          appSettings.confirmCloseWhilePlaying = false
          saveSettings()
        }
        if (response === 0) {
          // Confirmed — re-issue the close, this time past the guard.
          skipCloseConfirm = true
          mainWindow?.close()
        } else {
          // Cancelled — drop back to the normal state so a later close still
          // honors the minimize-to-tray setting instead of force-quitting.
          isQuitting = false
        }
      })
    }
  })

  // The titlebar button goes through the 'minimize-window' IPC handler, but
  // the window can also be minimized natively (Win+Down, clicking the taskbar
  // preview, shake gestures) — catch those too so "minimize to tray" holds no
  // matter how the minimize happened. preventDefault stops the native
  // minimize where supported; where it doesn't, hiding a minimized window
  // still works, and showMainWindow() restores from either state.
  mainWindow.on('minimize', (e) => {
    if (appSettings.minimizeTo === 'tray' && tray) {
      e.preventDefault()
      hideWindowToTray()
    }
  })

  // Pop-outs can't outlive the main window — leaving one open would keep the
  // app running headless (window-all-closed never fires) with handlers still
  // pointed at a destroyed mainWindow.
  mainWindow.on('closed', () => {
    mainWindow = null
    closeAllFloatWindows()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:3018')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url)
    return { action: 'deny' }
  })
  guardNavigation(mainWindow)

  // Frameless windows don't get the browser's native F11-toggles-fullscreen
  // behavior for free — wire it up so it behaves like users expect.
  mainWindow.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
    }
  })

  // Let the renderer react when fullscreen is entered/exited by any means
  // (F11 above, OS window-manager gestures, etc.) so UI like the WRLD tab's
  // fullscreen toggle button can stay in sync instead of just tracking its
  // own click state.
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('fullscreen-changed', true))
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('fullscreen-changed', false))

  // Track file downloads via session
  mainWindow.webContents.session.on('will-download', (event, item) => {
    const filename = item.getFilename()
    const savePath = path.join(appSettings.downloadPath, filename)
    item.setSavePath(savePath)

    // The window can be destroyed while a download is still running (quit
    // during a transfer) — sending on destroyed webContents throws in main.
    const send = (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
    }

    send('download-started', {
      filename,
      savePath,
      total: item.getTotalBytes(),
    })

    item.on('updated', (_, state) => {
      if (state === 'progressing') {
        const total = item.getTotalBytes()
        send('download-progress', {
          filename,
          received: item.getReceivedBytes(),
          total,
          percent: total > 0 ? Math.round((item.getReceivedBytes() / total) * 100) : 0,
        })
      }
    })

    item.once('done', (_, state) => {
      send('download-done', {
        filename,
        state,
        savePath: item.getSavePath(),
      })
    })
  })
}

// ── IPC: window controls ──────────────────────────────────────────────────────

ipcMain.handle('force-update', async () => {
  const https = require('https')
  log('Force update requested')

  // Linux: hand off to electron-updater. Its AppImageUpdater replaces the
  // installed AppImage in place on quitAndInstall — the manual flow below
  // would just run the freshly downloaded AppImage once from temp and leave
  // the installed copy outdated (unlike Windows, where the downloaded .exe
  // is an installer). Status updates and the restart dialog come from the
  // shared autoUpdater event handlers at the bottom of this file.
  if (process.platform === 'linux') {
    try {
      const result = await autoUpdater.checkForUpdates()
      if (result?.downloadPromise) await result.downloadPromise
      else if (result?.updateInfo && result.updateInfo.version !== app.getVersion()) await autoUpdater.downloadUpdate()
      return
    } catch (err) {
      log('Force update error:', err.message)
      broadcastToWindows('update-status', { type: 'error', message: err.message })
      throw err
    }
  }

  function fetchJson(url) {
    return new Promise((resolve, reject) => {
      const opts = new URL(url)
      https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { 'User-Agent': 'Unreleased-App', 'Accept': 'application/vnd.github+json' } }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) return fetchJson(res.headers.location).then(resolve).catch(reject)
        // A 403 (rate limit) still returns parseable JSON — without this check
        // it flowed through and died later on `release.assets` being undefined,
        // surfacing a cryptic TypeError instead of the real cause.
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`GitHub API HTTP ${res.statusCode}`)) }
        let data = ''
        res.on('data', d => data += d)
        res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
      }).on('error', reject)
    })
  }

  try {
    broadcastToWindows('update-status', { type: 'checking' })
    const { owner, repo } = UPDATE_REPO
    const release = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`)
    const assetSuffix = process.platform === 'win32' ? '.exe' : process.platform === 'darwin' ? '.dmg' : '.AppImage'
    const asset = release.assets.find(a => a.name.endsWith(assetSuffix))
    if (!asset) throw new Error('No installer found in latest release')

    const tmpPath = path.join(app.getPath('temp'), asset.name)
    log('Force-downloading installer:', asset.name, 'to', tmpPath)
    broadcastToWindows('update-status', { type: 'downloading', percent: 0, version: release.tag_name.replace(/^v/, '') })

    await downloadFile(asset.browser_download_url, tmpPath, (percent) => {
      broadcastToWindows('update-status', { type: 'downloading', percent, version: release.tag_name.replace(/^v/, '') })
    })

    log('Force update installer ready:', tmpPath)
    broadcastToWindows('update-status', { type: 'downloaded', version: release.tag_name.replace(/^v/, '') })

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart & Install', 'Later'],
      defaultId: 0,
      title: 'Update ready',
      message: `Version ${release.tag_name} is ready to install.`,
      detail: 'The app will restart and reinstall.',
    })
    if (response === 0) {
      if (process.platform === 'linux') fs.chmodSync(tmpPath, 0o755)
      shell.openPath(tmpPath)
      app.quit()
    }
  } catch (err) {
    log('Force update error:', err.message)
    broadcastToWindows('update-status', { type: 'error', message: err.message })
    throw err
  }
})

ipcMain.handle('check-for-updates', () => {
  log('Manual update check triggered')
  return autoUpdater.checkForUpdatesAndNotify()
})
ipcMain.handle('install-update', () => {
  log('Manual install-update triggered')
  quitAndInstallSilently()
})
ipcMain.handle('minimize-window', () => {
  if (appSettings.minimizeTo === 'tray' && tray) {
    hideWindowToTray()
  } else {
    mainWindow?.minimize()
  }
})
ipcMain.handle('maximize-window', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('close-window', () => {
  if (!appSettings.minimizeToTray || !tray) isQuitting = true
  mainWindow?.close()
})
// Full app restart (backs the "restart app" shortcut). relaunch() queues a
// fresh instance to spawn once this one exits; isQuitting bypasses the
// minimize-to-tray-on-close guard so exit() actually terminates.
ipcMain.handle('relaunch-app', () => {
  isQuitting = true
  app.relaunch()
  app.exit(0)
})
ipcMain.handle('is-maximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.handle('set-fullscreen', (_, value) => mainWindow?.setFullScreen(!!value))
ipcMain.handle('is-fullscreen', () => mainWindow?.isFullScreen() ?? false)
ipcMain.handle('get-runtime-platform', () => runtimePlatform)
// Toggles DevTools on whichever window asked (main or a pop-out), not always
// mainWindow — lets a float window's own Diagnostics/hotkey inspect itself.
ipcMain.handle('toggle-devtools', (event) => event.sender.toggleDevTools())

// ── IPC: floating pop-out windows ─────────────────────────────────────────────
ipcMain.handle('open-float-window', (_, view, params) => {
  if (Object.prototype.hasOwnProperty.call(FLOAT_SIZES, view)) createFloatWindow(view, params)
})

// Closes every pop-out (mini player, settings, editor, …) but leaves the main
// window alone — backs the "close all pop-out windows" shortcut.
ipcMain.handle('close-float-windows', () => closeAllFloatWindows())

// Boot-time read of what's already open (the broadcast only covers changes).
ipcMain.handle('get-float-windows', () => openFloatViews())

// Open/focus-vs-close toggle for a single-content pop-out (currently just
// Settings) — clicking its launcher icon again should close the window
// instead of just refocusing it. Distinct from open-float-window, which
// always focuses/retargets an existing window (the right behavior for
// e.g. the song editor, where reclicking "Edit" on another song should
// swap its content rather than close it).
ipcMain.handle('toggle-float-window', (_, view, params) => {
  const existing = floatWindows.get(view)
  if (existing && !existing.isDestroyed()) { existing.close(); return { open: false } }
  if (Object.prototype.hasOwnProperty.call(FLOAT_SIZES, view)) createFloatWindow(view, params)
  return { open: true }
})

// ── OS-global shortcuts ──────────────────────────────────────────────────────
// The renderer owns which accelerators map to which action; main just registers
// them and relays a fire back to the main window's hotkey dispatcher. Each
// register call replaces the whole set (unregisterAll first), so toggling the
// feature off is just registerGlobalShortcuts([]).
// `id` is checked against the app's known hotkey actions (src/renderer/src/lib/hotkeys.ts)
// so a compromised renderer can't have main grab arbitrary OS-global combos
// under a made-up id. `accelerator` is still user-customizable, so it's only
// sanity-checked against Electron's modifier+key grammar, not an exact allowlist.
const KNOWN_GLOBAL_SHORTCUT_IDS = new Set([
  'play-pause', 'play', 'pause', 'next', 'previous', 'seek-forward', 'seek-backward',
  'speed-up', 'speed-down', 'shuffle', 'loop', 'clear-queue', 'like', 'song-info',
  'edit-song', 'equalizer', 'ab-loop', 'crossfade', 'smooth-playback', 'prefer-og',
  'sleep-timer', 'seek-0', 'seek-10', 'seek-20', 'seek-30', 'seek-40', 'seek-50',
  'seek-60', 'seek-70', 'seek-80', 'seek-90', 'volume-up', 'volume-down', 'mute',
  'view-tracker', 'view-playlists', 'view-library', 'view-wrld', 'view-admin',
  'open-settings', 'open-diagnostics', 'toggle-queue', 'focus-search', 'mini-player',
  'close-float-windows', 'restart-app', 'rescan-library', 'discord-status', 'toggle-devtools',
])
const ACCELERATOR_RE = /^(?:Cmd|Command|Ctrl|Control|CommandOrControl|CmdOrCtrl|Alt|Option|AltGr|Shift|Super|Meta)(?:\+(?:Cmd|Command|Ctrl|Control|CommandOrControl|CmdOrCtrl|Alt|Option|AltGr|Shift|Super|Meta))*\+[A-Za-z0-9`~!@#$%^&*()\-=_+[\]{}\\|;:'",.<>/?]$|^(?:F(?:[1-9]|1[0-9]|2[0-4])|[A-Za-z0-9]|Plus|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPreviousTrack|MediaStop|MediaPlayPause|PrintScreen)$/
ipcMain.handle('register-global-shortcuts', (_, entries) => {
  globalShortcut.unregisterAll()
  const failed = []
  for (const { accelerator, id } of entries || []) {
    if (!accelerator || !id) continue
    if (!KNOWN_GLOBAL_SHORTCUT_IDS.has(id) || !ACCELERATOR_RE.test(accelerator)) { failed.push(accelerator); continue }
    try {
      // register returns false when the OS/another app already owns the combo.
      const ok = globalShortcut.register(accelerator, () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('global-shortcut', id)
      })
      if (!ok) failed.push(accelerator)
    } catch {
      failed.push(accelerator)
    }
  }
  return { failed }
})

// Pop-outs are frameless and render their own window buttons; the
// 'close/minimize/maximize-window' handlers target the MAIN window
// specifically, so they need sender-scoped variants.
ipcMain.handle('close-self', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})
ipcMain.handle('minimize-self', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
// Toggles and returns the new state so the caller's restore/maximize icon
// can track it without a second round-trip.
ipcMain.handle('maximize-self', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})

ipcMain.handle('focus-main-window', () => showMainWindow())

// Mini-player panel toggle. Compact mode locks the window height (only the
// width resizes); expanding for the lyrics/queue panel frees vertical
// resizing and grows the window if it's still at compact height. 100000
// stands in for "unbounded" — Electron has no documented way to clear a
// maximum once set.
const MINI_EXPANDED_MIN_HEIGHT = 440
const MINI_EXPANDED_HEIGHT = 540
ipcMain.handle('mini-player-set-expanded', (event, expanded) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return
  // Programmatic resize APIs are intentionally unavailable on native
  // Wayland. The fixed-height renderer mode never calls this handler, but
  // keep the boundary safe if a stale renderer or IPC replay does.
  if (runtimePlatform.nativeWayland) return
  const { minWidth, height: compactHeight } = FLOAT_SIZES['mini-player']
  const [w, h] = win.getSize()
  if (expanded) {
    win.setMaximumSize(100000, 100000)
    win.setMinimumSize(minWidth, MINI_EXPANDED_MIN_HEIGHT)
    if (h < MINI_EXPANDED_HEIGHT) win.setSize(w, MINI_EXPANDED_HEIGHT)
  } else {
    win.setMinimumSize(minWidth, compactHeight)
    win.setSize(w, compactHeight)
    win.setMaximumSize(100000, compactHeight)
  }
})

// Pin toggle for the mini player — returns the new state so the button's
// icon can track it without a second round-trip.
ipcMain.handle('toggle-always-on-top-self', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  const next = !win.isAlwaysOnTop()
  applyAlwaysOnTop(win, next)
  // The keeper only makes sense while pinned, and only for the mini player —
  // it's the one window that's meant to survive a fullscreen app taking over.
  if (win === floatWindows.get('mini-player')) {
    if (next) startTopKeeper(win)
    else stopTopKeeper()
  }
  return win.isAlwaysOnTop()
})

// "Solo" button on the mini player — get every other window off the screen
// AND out of the taskbar. Other pop-outs are closed for real. The main
// window can't be: it owns the audio, and its 'closed' handler tears down
// every pop-out (mini included) and quits the app — so it's hidden instead,
// which drops its taskbar entry while playback keeps running. It's recorded
// in miniPlayerHiddenWindows so closing the mini player restores it (see
// restoreWindowsAfterMiniPlayer); the "Show full app" button brings it back
// sooner. A main window already hidden (e.g. to the tray) is left as-is so
// restore semantics match the solo-mode setting.
ipcMain.handle('hide-other-windows', (event) => {
  const sender = BrowserWindow.fromWebContents(event.sender)
  for (const win of BrowserWindow.getAllWindows()) {
    if (win === sender || win.isDestroyed()) continue
    if (win === mainWindow) {
      if (win.isVisible() || win.isMinimized()) {
        if (!miniPlayerHiddenWindows.includes(win)) miniPlayerHiddenWindows.push(win)
        win.hide()
      }
    } else {
      win.close()
    }
  }
})

// Store-sync relay: a renderer broadcasts a state patch and every OTHER
// window receives it (each window runs its own store instance — see
// src/renderer/src/lib/windowSync.ts for what gets mirrored and why).
// Shape-checked against windowSync.ts's SyncMessage union before relaying —
// this only rejects structurally-wrong messages (a compromised renderer
// injecting garbage), it doesn't validate the SYNC_KEYS payload contents,
// which every receiving window still owns via useStore.setState.
const WINDOW_SYNC_TYPES = new Set(['patch', 'snapshot', 'request', 'navigate', 'attach', 'command', 'library-patch', 'library-add'])
function isValidWindowSyncMessage(msg) {
  return !!msg && typeof msg === 'object' && typeof msg.type === 'string' && WINDOW_SYNC_TYPES.has(msg.type)
}
ipcMain.on('window-sync', (event, msg) => {
  if (!isValidWindowSyncMessage(msg)) return
  if (!BrowserWindow.fromWebContents(event.sender)) return
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents.id !== event.sender.id) {
      win.webContents.send('window-sync', msg)
    }
  }
})

// ── IPC: local file browsing ──────────────────────────────────────────────────
ipcMain.handle('browse-local', async (_, dirPath) => {
  try {
    const target = dirPath || app.getPath('home')
    const st = fs.statSync(target)
    if (!st.isDirectory()) return { error: 'Not a directory', path: target, entries: [] }
    const names = fs.readdirSync(target)
    const entries = []
    for (const name of names) {
      if (name.startsWith('.')) continue
      try {
        const fullPath = path.join(target, name)
        const s = fs.statSync(fullPath)
        entries.push({
          name,
          path: fullPath,
          type: s.isDirectory() ? 'directory' : 'file',
          size: s.isFile() ? s.size : null,
        })
      } catch {}
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return { path: target, entries }
  } catch (err) {
    return { error: err.message, path: dirPath || '', entries: [] }
  }
})

// Reads a local file as UTF-8 for the in-app text viewer. Capped so a huge or
// mis-identified file can't be pulled wholesale into the renderer, and the cap
// is applied by reading a prefix rather than rejecting outright — a 2 MB log
// is still worth showing the head of. `truncated` lets the viewer say so.
const TEXT_VIEW_MAX = 2 * 1024 * 1024
ipcMain.handle('read-text-file', async (_, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { error: 'No path' }
  try {
    const st = fs.statSync(filePath)
    if (!st.isFile()) return { error: 'Not a file' }
    const size = st.size
    const length = Math.min(size, TEXT_VIEW_MAX)
    const buf = Buffer.alloc(length)
    const fd = fs.openSync(filePath, 'r')
    try { fs.readSync(fd, buf, 0, length, 0) } finally { fs.closeSync(fd) }
    // A NUL in the first chunk means this isn't text, whatever the extension
    // said — report it instead of rendering mojibake.
    if (buf.subarray(0, 8000).includes(0)) return { error: 'This looks like a binary file' }
    return { ok: true, text: buf.toString('utf8'), truncated: size > length, size }
  } catch (e) {
    if (e.code === 'ENOENT') return { error: 'File not found' }
    if (e.code === 'EACCES' || e.code === 'EPERM') return { error: 'No permission to read this file' }
    return { error: e.message }
  }
})

// ── IPC: local file management (create / rename / delete) ───────────────────
// These act on the user's own filesystem from the Files > Local browser, so
// they share the same rules as the copy/move handlers further down: a name is
// only ever a single path segment (never a path, never traversal), nothing
// silently overwrites an existing entry, and the one destructive op goes
// through the OS trash behind a modal confirm.

// Windows rejects <>:"/\|?* and trailing dots/spaces in file names, and
// reserves a handful of device names; the separator/traversal checks matter on
// every platform, since a name is a single segment by construction here.
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i
function validateEntryName(name) {
  if (typeof name !== 'string') return 'No name given'
  const trimmed = name.trim()
  if (!trimmed) return 'Name can\'t be empty'
  if (trimmed === '.' || trimmed === '..') return 'Invalid name'
  if (/[/\\]/.test(trimmed)) return 'Name can\'t contain slashes'
  if (/[<>:"|?*]/.test(trimmed)) return 'Name contains invalid characters'
  // Control characters, checked by code point rather than a regex class so no
  // literal control bytes end up in this source file.
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) < 32) return 'Name contains invalid characters'
  }
  if (process.platform === 'win32') {
    if (WIN_RESERVED.test(trimmed)) return 'That name is reserved by Windows'
    if (trimmed.endsWith('.')) return 'Name can\'t end with a dot'
  }
  if (trimmed.length > 255) return 'Name is too long'
  return null
}

// Guards every handler below: resolves the final path and confirms it stays
// inside the parent directory, so a name that slipped past validation still
// can't write outside the folder the user is looking at.
function resolveChildPath(dirPath, name) {
  const parent = path.resolve(dirPath)
  const target = path.resolve(parent, name.trim())
  const rel = path.relative(parent, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return target
}

ipcMain.handle('local-create', async (event, dirPath, name, kind) => {
  if (typeof dirPath !== 'string' || !dirPath) return { error: 'No folder' }
  const invalid = validateEntryName(name)
  if (invalid) return { error: invalid }
  const target = resolveChildPath(dirPath, name)
  if (!target) return { error: 'Invalid name' }
  if (fs.existsSync(target)) return { error: 'Something with that name already exists' }
  try {
    if (kind === 'directory') fs.mkdirSync(target)
    // 'wx' fails rather than truncating if the file appeared in between.
    else fs.closeSync(fs.openSync(target, 'wx'))
    return { ok: true, path: target }
  } catch (e) {
    fileOpError(event, 'Create', name, e.message)
    return { error: e.message }
  }
})

ipcMain.handle('local-rename', async (event, filePath, name) => {
  if (typeof filePath !== 'string' || !filePath) return { error: 'No path' }
  const invalid = validateEntryName(name)
  if (invalid) return { error: invalid }
  const target = resolveChildPath(path.dirname(filePath), name)
  if (!target) return { error: 'Invalid name' }
  if (target === path.resolve(filePath)) return { ok: true, path: filePath }
  // Case-only renames on Windows/macOS look like a collision against the file
  // itself, so only treat a *different* existing entry as one.
  if (fs.existsSync(target) && target.toLowerCase() !== path.resolve(filePath).toLowerCase()) {
    return { error: 'Something with that name already exists' }
  }
  try {
    fs.renameSync(filePath, target)
    return { ok: true, path: target }
  } catch (e) {
    fileOpError(event, 'Rename', path.basename(filePath), e.message)
    return { error: e.message }
  }
})

// Same treatment as delete-library-file: OS trash (recoverable), never without
// a modal confirm, and Cancel is both the default and the escape action.
ipcMain.handle('local-delete', async (event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { error: 'No path' }
  const name = path.basename(filePath)
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  let isDir = false
  try { isDir = fs.statSync(filePath).isDirectory() } catch {}
  const binName = process.platform === 'darwin' ? 'Trash'
    : process.platform === 'win32' ? 'Recycle Bin' : 'trash'
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: isDir ? 'Delete folder' : 'Delete file',
    message: `Delete "${name}"?`,
    detail: isDir
      ? `The folder and everything inside it is moved to the ${binName}.`
      : `The file is moved to the ${binName}.`,
  })
  if (response !== 0) return { canceled: true }
  try {
    await shell.trashItem(filePath)
    return { ok: true }
  } catch (e) {
    fileOpError(event, 'Delete', name, e.message)
    return { error: e.message }
  }
})

// Copies one or more OS-picked files into a Local Files folder. Reuses the
// same collision-safe naming as copy/move-library-file rather than failing
// like local-create does — picking several files at once shouldn't abort on
// the first name clash.
ipcMain.handle('local-upload', async (event, dirPath) => {
  if (typeof dirPath !== 'string' || !dirPath) return { error: 'No folder' }
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const result = await dialog.showOpenDialog(win, {
    title: 'Upload files',
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  const paths = []
  for (const src of result.filePaths) {
    const target = uniqueDestPath(dirPath, path.basename(src))
    try {
      fs.copyFileSync(src, target)
      paths.push(target)
    } catch (e) {
      fileOpError(event, 'Upload', path.basename(src), e.message)
    }
  }
  return { ok: true, paths }
})

// Parent the dialog to whichever window asked (Settings can live in a
// pop-out) — falling back to the main window for safety.
ipcMain.handle('pick-folder', async (event) => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) ?? mainWindow, {
    properties: ['openDirectory'],
    title: 'Select folder',
  })
  return result.canceled ? null : result.filePaths[0]
})

// Extensions capable of running code on their own if double-clicked — blocked
// here so a compromised renderer can't turn "open this file with its default
// app" (the Local Files browser's legitimate use of this) into launching an
// arbitrary executable it just wrote via save-image-file/download-to-library.
// Media/document files (what the browser actually opens) are unaffected.
const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.msp', '.ps1', '.psm1', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.scr', '.jar', '.lnk', '.reg', '.sh', '.bash',
  '.command', '.app', '.appimage', '.deb', '.rpm', '.apk', '.dmg', '.pkg', '.gadget',
])
ipcMain.handle('open-path', (_, p) => {
  if (EXECUTABLE_EXTENSIONS.has(path.extname(String(p)).toLowerCase())) {
    return 'Refused: this file type is not opened directly'
  }
  return shell.openPath(p)
})
// The safe alternative above's callers actually want: reveals the item in
// the OS file manager without ever executing it.
ipcMain.handle('show-item-in-folder', (_, p) => {
  shell.showItemInFolder(p)
})

// The small web-installer stub ships inside the app (see package.json
// win.extraResources) as an emergency repair/reinstall tool — it works even
// if the app itself is broken, since it's a standalone .exe next to the
// install, not something the app has to run. Prefer that local copy (no
// download needed); fall back to the GitHub download link when it's missing
// (dev builds or an old install predating this).
// macOS/Linux have no bundled repair stub (nothing analogous to the NSIS
// installer), so they always fall back to the releases page.
ipcMain.handle('open-online-installer', async () => {
  const { owner, repo } = UPDATE_REPO
  if (process.platform === 'win32') {
    const bundled = app.isPackaged ? path.join(process.resourcesPath, 'Unreleased-Setup.exe') : null
    if (bundled && fs.existsSync(bundled)) {
      const err = await shell.openPath(bundled)
      if (!err) return { source: 'bundled' }
      log('Bundled installer failed to launch, falling back to web:', err)
    }
    shell.openExternal(`https://github.com/${owner}/${repo}/releases/latest/download/Unreleased-Setup.exe`)
    return { source: 'web' }
  }
  // Unlike the Windows .exe, mac/Linux asset filenames are versioned (and mac
  // also varies by arch), so there's no fixed "latest/download/<name>" URL to
  // link straight to — send the user to the releases page instead.
  shell.openExternal(`https://github.com/${owner}/${repo}/releases/latest`)
  return { source: 'web' }
})

// ── IPC: run logging ──────────────────────────────────────────────────────────
// Renderer breadcrumbs (window errors, unhandled rejections, and explicit
// diagnostic logs like the tracker sort loop) funnel here into the run log.
ipcMain.on('run-log', (_, scope, message) => runLog(scope || 'renderer', message))
ipcMain.handle('open-logs-folder', () => shell.showItemInFolder(runLogPath))
ipcMain.handle('get-log-paths', () => ({ current: runLogPath, previous: prevRunLogPath }))

// Cover images live in Chromium's own disk cache (see the onHeadersReceived
// max-age injection in whenReady), not apiCache, so Settings' "Clear cache"
// has to reach them separately. Reports the bytes freed so the button can say
// something useful. clearCache() drops all cached HTTP responses, which for
// this app is essentially just images — every JSON response is cached in
// localStorage by apiCache instead.
ipcMain.handle('clear-image-cache', async () => {
  try {
    const before = await session.defaultSession.getCacheSize()
    await session.defaultSession.clearCache()
    return { ok: true, bytes: before }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── IPC: app settings ─────────────────────────────────────────────────────────
ipcMain.handle('get-app-settings', () => appSettings)

ipcMain.handle('set-app-setting', (_, key, value) => {
  appSettings[key] = value
  // Turning the option off drops what was recorded, so windows go straight back
  // to their built-in default sizes instead of silently keeping the old ones.
  if (key === 'rememberWindowSizes' && !value) appSettings.windowSizes = {}
  saveSettings()
  if (key === 'autoDownload') autoUpdater.autoDownload = value
  if (key === 'discordRpcEnabled') discordRpc.setEnabled(value)
  if (key === 'discordRpcLabel') discordRpc.refreshLabel(value)
  if (key === 'windowTitleNowPlaying') updateMainWindowTitle()
  return true
})

// ── IPC: beta channel ─────────────────────────────────────────────────────────
// Validates against the backend itself (GET {BETA_API_BASE}/unlock?code=...
// -> {"valid": true|false}) — see build/fetch-releases.ps1 for the full
// contract shared with the installer. No code/hash is ever baked into the app.
function checkBetaCode(code) {
  return new Promise((resolve, reject) => {
    const url = `${BETA_API_BASE}/unlock?code=${encodeURIComponent(code)}`
    https.get(url, { headers: { 'User-Agent': 'Unreleased-App' } }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        // The site's SPA serves index.html at 200 for paths it doesn't route,
        // so a missing endpoint arrives looking like success. Without this the
        // JSON.parse below fails and every code reads as "invalid", hiding the
        // fact that the backend is simply gone.
        const type = String(res.headers['content-type'] || '')
        if (!type.includes('json')) return reject(new Error(`beta endpoint returned ${type || 'unknown content-type'}, not JSON`))
        try { resolve(!!JSON.parse(data).valid) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

ipcMain.handle('beta-get-status', () => !!readBetaCode())

ipcMain.handle('beta-join', async (_, code) => {
  const trimmed = String(code ?? '').trim()
  if (!trimmed) return false
  try {
    if (!(await checkBetaCode(trimmed))) return false
  } catch (err) {
    // Distinct from a rejected code: the backend is unreachable or not
    // answering the documented contract. Saying "invalid code" here sends
    // people hunting for a typo in a code that's perfectly fine.
    log('beta-join: code check failed:', err.message)
    return 'unavailable'
  }
  try {
    fs.writeFileSync(betaMarkerPath, trimmed)
  } catch (err) {
    log('beta-join: marker write failed:', err.message)
    return false
  }
  applyUpdateFeed(trimmed)
  log('Beta access unlocked via Settings')
  return true
})

ipcMain.handle('beta-leave', () => {
  try { fs.rmSync(betaMarkerPath, { force: true }) } catch {}
  applyUpdateFeed(null)
  log('Left beta channel')
  return true
})

// ── IPC: Discord Rich Presence ────────────────────────────────────────────────
ipcMain.handle('discord-rpc-set-activity', (_, nowPlaying) => {
  discordRpc.setNowPlaying({ ...nowPlaying, labelMode: appSettings.discordRpcLabel })
  return true
})

ipcMain.handle('discord-rpc-clear-activity', () => {
  discordRpc.clearActivity()
  return true
})


// ── IPC: library management ───────────────────────────────────────────────────

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.aac', '.m4a', '.ogg', '.opus', '.wav', '.wma', '.aiff', '.ape', '.wv'])

const libraryDataPath = path.join(app.getPath('userData'), 'library-data.json')
const localPlaylistsPath = path.join(app.getPath('userData'), 'local-playlists.json')

function loadLibraryData() {
  try { return JSON.parse(fs.readFileSync(libraryDataPath, 'utf-8')) } catch { return { tracks: [], folders: [], lastScanned: null } }
}
function saveLibraryData(data) {
  try { fs.writeFileSync(libraryDataPath, JSON.stringify(data)) } catch(e) { log('saveLibraryData error:', e.message) }
}
function loadLocalPlaylists() {
  try { return JSON.parse(fs.readFileSync(localPlaylistsPath, 'utf-8')) } catch { return [] }
}
function saveLocalPlaylists(playlists) {
  try { fs.writeFileSync(localPlaylistsPath, JSON.stringify(playlists)) } catch(e) { log('saveLocalPlaylists error:', e.message) }
}

ipcMain.handle('load-library-data', () => loadLibraryData())
ipcMain.handle('save-library-data', (_, data) => { saveLibraryData(data); return true })
ipcMain.handle('load-local-playlists', () => loadLocalPlaylists())
ipcMain.handle('save-local-playlists', (_, playlists) => { saveLocalPlaylists(playlists); return true })

// ── IPC: M3U import / export ────────────────────────────────────────────────
// M3U is a plain text playlist: one file path per line, optional `#EXTINF`
// header lines carrying duration + display title. We only parse/serialize the
// text here — matching paths to the user's scanned library happens in the
// renderer, which is where the library list lives.

// Parse .m3u/.m3u8 text into ordered entries. `baseDir` resolves relative
// paths (they're relative to the playlist file's own folder).
function parseM3u(text, baseDir) {
  const entries = []
  let pendingTitle = null
  let pendingDuration = null
  // Strip a UTF-8 BOM so the first path doesn't get a stray ﻿ prefix.
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      // #EXTINF:<seconds>,<Artist - Title>
      const m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)\s*,\s*(.*)$/i.exec(line)
      if (m) {
        const secs = parseFloat(m[1])
        pendingDuration = Number.isFinite(secs) && secs > 0 ? secs : null
        pendingTitle = m[2].trim() || null
      }
      continue // every other #directive (#EXTM3U, #PLAYLIST, …) is ignored
    }
    // Skip remote URLs — they can't map to a local library track.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line) && !/^file:/i.test(line)) {
      pendingTitle = null; pendingDuration = null
      continue
    }
    let p = line
    if (/^file:/i.test(p)) {
      try { p = fileURLToPath(p) } catch { /* fall through with raw value */ }
    }
    if (!path.isAbsolute(p)) p = path.resolve(baseDir, p)
    entries.push({ path: path.normalize(p), title: pendingTitle, duration: pendingDuration })
    pendingTitle = null; pendingDuration = null
  }
  return entries
}

ipcMain.handle('import-m3u', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const result = await dialog.showOpenDialog(win, {
    title: 'Import M3U playlist',
    properties: ['openFile'],
    filters: [{ name: 'M3U Playlists', extensions: ['m3u', 'm3u8'] }],
  })
  if (result.canceled || !result.filePaths.length) return { canceled: true }
  const file = result.filePaths[0]
  try {
    const text = fs.readFileSync(file, 'utf-8')
    const entries = parseM3u(text, path.dirname(file))
    // Suggested playlist name = the file's basename without extension.
    const name = path.basename(file, path.extname(file)) || 'Imported Playlist'
    return { ok: true, name, entries }
  } catch (e) {
    log('import-m3u error:', e.message)
    return { error: e.message }
  }
})

// tracks: [{ path, title, artist, duration }] in playlist order. We write
// absolute paths so the file survives being opened from anywhere; #EXTINF
// lines carry duration + "Artist - Title" for players that show metadata.
ipcMain.handle('export-m3u', async (event, { name, tracks }) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const safeName = String(name || 'playlist').replace(/[\\/:*?"<>|]/g, '_').trim() || 'playlist'
  const result = await dialog.showSaveDialog(win, {
    title: 'Export playlist as M3U',
    defaultPath: `${safeName}.m3u8`,
    filters: [{ name: 'M3U Playlist', extensions: ['m3u8', 'm3u'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  try {
    const lines = ['#EXTM3U']
    for (const t of tracks || []) {
      if (!t || !t.path) continue
      const dur = Number.isFinite(t.duration) && t.duration > 0 ? Math.round(t.duration) : -1
      const label = [t.artist, t.title].filter(Boolean).join(' - ') || path.basename(t.path)
      lines.push(`#EXTINF:${dur},${label}`)
      lines.push(t.path)
    }
    // BOM so non-ASCII paths/titles round-trip on players that assume Latin-1
    // for a bare .m3u; .m3u8 is UTF-8 by definition either way.
    fs.writeFileSync(result.filePath, '﻿' + lines.join('\r\n') + '\r\n', 'utf-8')
    return { ok: true, path: result.filePath }
  } catch (e) {
    log('export-m3u error:', e.message)
    return { error: e.message }
  }
})

// Parse an .m3u/.m3u8 at a known path (a file dropped onto the window), no
// dialog. Same shape as import-m3u so the renderer can share matching logic.
ipcMain.handle('read-m3u-path', async (_, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { error: 'No file path' }
  if (!/\.m3u8?$/i.test(filePath)) return { error: 'Not an M3U file' }
  try {
    const text = fs.readFileSync(filePath, 'utf-8')
    const entries = parseM3u(text, path.dirname(filePath))
    const name = path.basename(filePath, path.extname(filePath)) || 'Imported Playlist'
    return { ok: true, name, entries }
  } catch (e) {
    log('read-m3u-path error:', e.message)
    return { error: e.message }
  }
})

// Import a plain text file where each non-empty line is a song title to look
// up in the API. Blank lines and #comments are skipped here; the actual
// title→song resolution happens in the renderer (it owns the API client).
ipcMain.handle('import-text-lines', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const result = await dialog.showOpenDialog(win, {
    title: 'Import song titles',
    properties: ['openFile'],
    filters: [{ name: 'Text files', extensions: ['txt', 'csv', 'text'] }, { name: 'All files', extensions: ['*'] }],
  })
  if (result.canceled || !result.filePaths.length) return { canceled: true }
  return readTextLines(result.filePaths[0])
})

// Same as import-text-lines but for a file dropped onto the window (no dialog).
ipcMain.handle('read-text-lines-path', async (_, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { error: 'No file path' }
  return readTextLines(filePath)
})

function readTextLines(file) {
  try {
    const text = fs.readFileSync(file, 'utf-8').replace(/^﻿/, '')
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    const name = path.basename(file, path.extname(file)) || 'Imported Playlist'
    return { ok: true, name, lines }
  } catch (e) {
    log('readTextLines error:', e.message)
    return { error: e.message }
  }
}

// Deleting a song is the only thing the library does to a user's *own* files
// that can't be undone from inside the app, so it goes through the OS trash
// (recoverable) rather than a hard unlink, and never happens without a modal
// confirm. The renderer purges its own state only after this returns { ok }.
ipcMain.handle('delete-library-file', async (event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { error: 'No file path' }
  const name = path.basename(filePath)
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const binName = process.platform === 'darwin' ? 'Trash'
    : process.platform === 'win32' ? 'Recycle Bin' : 'trash'
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    // Cancel is both the default and the escape action — a stray Enter/Esc on
    // a destructive prompt must never be the one that deletes the file.
    defaultId: 1,
    cancelId: 1,
    title: 'Delete song',
    message: `Delete "${name}"?`,
    detail: `The file is moved to the ${binName} and removed from your library. Any local playlists that reference it are updated.`,
  })
  if (response !== 0) return { canceled: true }
  try {
    await shell.trashItem(filePath)
    return { ok: true }
  } catch (e) {
    // Usually the file is still open (playing) or sits on a volume with no
    // trash folder. Report it here so the failure can't pass silently.
    dialog.showMessageBox(win, {
      type: 'error', buttons: ['OK'], title: 'Delete failed',
      message: `Couldn't delete "${name}".`, detail: e.message,
    })
    return { error: e.message }
  }
})

// ── IPC: local file operations (copy / move / clipboard) ────────────────────
// These all act on the user's own files, so they share two rules: never
// overwrite something that's already there (collisions get a " (n)" suffix),
// and never touch anything before the user has picked a destination.

// Returns a path in destDir that doesn't exist yet, so a copy/move can never
// clobber an unrelated file that happens to share a name.
function uniqueDestPath(destDir, baseName) {
  const ext = path.extname(baseName)
  const stem = baseName.slice(0, baseName.length - ext.length)
  let candidate = path.join(destDir, baseName)
  for (let n = 1; fs.existsSync(candidate); n++) {
    candidate = path.join(destDir, `${stem} (${n})${ext}`)
  }
  return candidate
}

async function pickDestFolder(event, filePath, title) {
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const result = await dialog.showOpenDialog(win, {
    title,
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: path.dirname(filePath),
  })
  return result.canceled ? null : result.filePaths[0]
}

function fileOpError(event, action, name, message) {
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  dialog.showMessageBox(win, {
    type: 'error', buttons: ['OK'], title: `${action} failed`,
    message: `Couldn't ${action.toLowerCase()} "${name}".`, detail: message,
  })
}

ipcMain.handle('copy-library-file', async (event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { error: 'No file path' }
  const destDir = await pickDestFolder(event, filePath, 'Copy song to folder')
  if (!destDir) return { canceled: true }
  const target = uniqueDestPath(destDir, path.basename(filePath))
  try {
    fs.copyFileSync(filePath, target)
    return { ok: true, path: target }
  } catch (e) {
    fileOpError(event, 'Copy', path.basename(filePath), e.message)
    return { error: e.message }
  }
})

ipcMain.handle('move-library-file', async (event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { error: 'No file path' }
  const destDir = await pickDestFolder(event, filePath, 'Move song to folder')
  if (!destDir) return { canceled: true }
  // Moving into the folder it already lives in would otherwise "succeed" by
  // leaving a " (1)" duplicate behind — nothing to do.
  if (path.resolve(destDir) === path.resolve(path.dirname(filePath))) return { canceled: true }
  const target = uniqueDestPath(destDir, path.basename(filePath))
  try {
    try {
      fs.renameSync(filePath, target)
    } catch (e) {
      // rename() can't cross volumes — fall back to copy-then-remove so moving
      // to another drive still works.
      if (e.code !== 'EXDEV') throw e
      fs.copyFileSync(filePath, target)
      fs.unlinkSync(filePath)
    }
    return { ok: true, path: target }
  } catch (e) {
    fileOpError(event, 'Move', path.basename(filePath), e.message)
    return { error: e.message }
  }
})

ipcMain.handle('copy-text-to-clipboard', (_, text) => {
  clipboard.writeText(String(text ?? ''))
  return { ok: true }
})

// Putting a real *file* on the clipboard (so Explorer/Finder pastes the file,
// not its name) needs the platform's native file-list format. Electron can't
// write it: clipboard.writeBuffer('CF_HDROP', …) registers a new *custom*
// format under that name, which Explorer ignores. So shell out to the OS.
ipcMain.handle('copy-file-to-clipboard', async (_, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { error: 'No file path' }
  if (!fs.existsSync(filePath)) return { error: 'File not found' }
  const { execFile } = require('child_process')
  const run = (cmd, args) => new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err) => resolve(err ? { error: err.message } : { ok: true }))
  })
  if (process.platform === 'win32') {
    // Single-quoted PowerShell literal — the only escape needed is doubling '.
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Set-Clipboard -LiteralPath '${filePath.replace(/'/g, "''")}'`])
  }
  if (process.platform === 'darwin') {
    const esc = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return run('osascript', ['-e', `set the clipboard to POSIX file "${esc}"`])
  }
  // No portable file-clipboard on Linux — fall back to the path as text and
  // say so, rather than silently doing something different than advertised.
  clipboard.writeText(filePath)
  return { ok: true, fallback: 'path' }
})

// Cover art → clipboard as an actual image (pasteable into Discord, Photoshop,
// a message box), not a URL. The renderer fetches the bytes and re-encodes to
// PNG first (see lib/coverImage.ts) since nativeImage only decodes PNG/JPEG.
ipcMain.handle('copy-image-to-clipboard', (_, dataUrl) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return { error: 'Invalid image data' }
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) return { error: 'Could not decode image' }
  clipboard.writeImage(image)
  return { ok: true }
})

// Cover art → disk, through a native Save-as dialog. Writes the bytes verbatim
// (no image decode) so the saved file is the original JPEG/WebP/PNG the API
// served, with the extension the renderer derived from its mime type.
ipcMain.handle('save-image-file', async (event, payload) => {
  const { defaultName, dataUrl } = payload || {}
  const base64 = typeof dataUrl === 'string' ? /^data:[^;,]*;base64,([\s\S]*)$/.exec(dataUrl)?.[1] : null
  if (!base64) return { error: 'Invalid image data' }
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const safeName = String(defaultName || 'cover.jpg').replace(/[/\\:*?"<>|]/g, '_').trim() || 'cover.jpg'
  const ext = path.extname(safeName).slice(1).toLowerCase() || 'jpg'
  const result = await dialog.showSaveDialog(win, {
    title: 'Save cover art',
    defaultPath: path.join(appSettings.downloadPath, safeName),
    filters: [{ name: 'Image', extensions: [ext] }, { name: 'All files', extensions: ['*'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  try {
    fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'))
    return { ok: true, path: result.filePath }
  } catch (e) {
    return { error: e.message }
  }
})

// ── IPC: offline playlist sync (download API songs for offline playback) ─────
//
// tracks: keyed by track id ("jw-{songId}") — the audio file plus enough of
// the song's own metadata (title, lyrics, art...) to play fully offline.
// playlists: keyed by "api-{playlistId}" — just the list of track ids that
// playlist wants kept offline, so removing a playlist can tell whether a
// track is still needed by some other synced playlist before deleting it.
const offlineLibraryDataPath = path.join(app.getPath('userData'), 'offline-library.json')
function getOfflineAudioDir() { return appSettings.offlineLibraryPath }

function loadOfflineLibrary() {
  return loadOfflineLibraryFile(offlineLibraryDataPath)
}
function updateOfflineLibrary(mutate) {
  return updateOfflineLibraryFile(offlineLibraryDataPath, mutate, (e) => {
    log('updateOfflineLibrary error:', e instanceof Error ? e.message : String(e))
  })
}

ipcMain.handle('offline-get-library', () => loadOfflineLibrary())

// Reads actual file sizes off disk (rather than trusting cached metadata)
// so the Settings display stays accurate even for tracks downloaded before
// size tracking existed, or if a file was moved/edited outside the app.
ipcMain.handle('offline-get-stats', () => {
  const lib = loadOfflineLibrary()
  let totalSize = 0
  let count = 0
  for (const track of Object.values(lib.tracks)) {
    try {
      totalSize += fs.statSync(track.localPath).size
      count++
    } catch {}
  }
  return { count, totalSize }
})

// Songs are always served from the API's own domain (and its CDN subdomains,
// if it grows one) — a renderer-supplied url pointing anywhere else has no
// legitimate use in these two handlers and shouldn't be fetched onto disk.
function isAllowedLibraryDownloadHost(url) {
  try {
    const { hostname, protocol } = new URL(url)
    return protocol === 'https:' && (hostname === 'juicewrldapi.com' || hostname.endsWith('.juicewrldapi.com'))
  } catch {
    return false
  }
}

ipcMain.handle('offline-download-track', async (event, { id, url, ext, path: songPath, meta }) => {
  if (!isAllowedLibraryDownloadHost(url)) return { error: 'Download blocked: untrusted host' }
  const existing = loadOfflineLibrary().tracks[id]
  const localPath = path.join(getOfflineAudioDir(), `${id}.${ext || 'mp3'}`)

  // Audio unchanged and still on disk — just refresh the display metadata
  // (title/lyrics/art may have been edited without the file itself moving).
  if (existing && existing.path === songPath && fs.existsSync(existing.localPath)) {
    updateOfflineLibrary((library) => {
      library.tracks[id] = { ...(library.tracks[id] || existing), ...meta, path: songPath }
    })
    let size = 0
    try { size = fs.statSync(existing.localPath).size } catch {}
    return { localPath: existing.localPath, skipped: true, size }
  }

  try { fs.mkdirSync(getOfflineAudioDir(), { recursive: true }) } catch {}
  try {
    await downloadFile(url, localPath, (percent, received, total) => {
      mainWindow?.webContents.send('offline-download-progress', { id, percent, received, total })
    })
  } catch (e) {
    return { error: 'Download failed: ' + e.message }
  }

  updateOfflineLibrary((library) => {
    library.tracks[id] = { ...meta, path: songPath, localPath, ext: ext || 'mp3', downloadedAt: Date.now() }
  })
  let size = 0
  try { size = fs.statSync(localPath).size } catch {}
  return { localPath, size }
})

ipcMain.handle('offline-remove-track', (_, id) => {
  updateOfflineLibrary((library) => {
    const entry = library.tracks[id]
    if (!entry) return
    try { fs.unlinkSync(entry.localPath) } catch {}
    delete library.tracks[id]
  })
  return true
})

ipcMain.handle('offline-set-playlist', (_, key, songIds, name) => {
  updateOfflineLibrary((library) => {
    library.playlists[key] = { songIds, name, updatedAt: Date.now() }
    // Prune any previously-offline track that's no longer referenced by ANY
    // synced playlist (song was removed from the playlist, or the playlist's
    // song list shrank on resync).
    const stillReferenced = new Set(Object.values(library.playlists).flatMap(p => p.songIds))
    for (const trackId of Object.keys(library.tracks)) {
      if (!stillReferenced.has(trackId)) {
        try { fs.unlinkSync(library.tracks[trackId].localPath) } catch {}
        delete library.tracks[trackId]
      }
    }
  })
  return true
})

ipcMain.handle('offline-remove-playlist', (_, key) => {
  updateOfflineLibrary((library) => {
    delete library.playlists[key]
    const stillReferenced = new Set(Object.values(library.playlists).flatMap(p => p.songIds))
    for (const trackId of Object.keys(library.tracks)) {
      if (!stillReferenced.has(trackId)) {
        try { fs.unlinkSync(library.tracks[trackId].localPath) } catch {}
        delete library.tracks[trackId]
      }
    }
  })
  return true
})

// Moves every downloaded offline audio file from the old folder into the new
// one and repoints the library's localPath entries, so switching folders
// doesn't orphan (or silently re-download) what's already been saved.
ipcMain.handle('offline-set-library-path', async (_, newPath) => {
  const oldPath = getOfflineAudioDir()
  if (!newPath || newPath === oldPath) return { path: oldPath }

  try { fs.mkdirSync(newPath, { recursive: true }) } catch (e) {
    return { error: 'Could not create folder: ' + e.message }
  }

  const failed = []
  updateOfflineLibrary((library) => {
    for (const trackId of Object.keys(library.tracks)) {
      const track = library.tracks[trackId]
      const oldFile = track.localPath
      if (!oldFile || !fs.existsSync(oldFile)) continue
      const newFile = path.join(newPath, path.basename(oldFile))
      try {
        fs.renameSync(oldFile, newFile)
        track.localPath = newFile
      } catch (e) {
        // Cross-device moves can fail with EXDEV — fall back to copy + delete.
        try {
          fs.copyFileSync(oldFile, newFile)
          fs.unlinkSync(oldFile)
          track.localPath = newFile
        } catch (e2) {
          failed.push(trackId)
        }
      }
    }
  })

  appSettings.offlineLibraryPath = newPath
  saveSettings()

  return failed.length ? { path: newPath, failedCount: failed.length } : { path: newPath }
})

ipcMain.handle('scan-library', async (_, folders, previousTracks) => {
  let mm
  try { mm = require('music-metadata') } catch(e) { return { error: 'music-metadata not installed: ' + e.message, tracks: [] } }

  // Keyed by file path so an unchanged file (same size + mtime as last scan)
  // can be reused as-is instead of re-parsing its tags — makes it cheap
  // enough to re-run automatically (see "Auto-refresh changed files" setting)
  // without reparsing an entire library just to pick up a couple of edits.
  const prevByPath = new Map((previousTracks || []).map((t) => [t.filePath, t]))

  // Walk first (cheap directory listing), parse after with a small worker
  // pool — tag parsing is the expensive part, and strictly one-file-at-a-time
  // left the disk and CPU idling in turns. Results land in indexed slots so
  // the track order still matches the walk order exactly.
  const files = []
  function walk(dirPath) {
    let entries
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) walk(fullPath)
      else if (entry.isFile() && AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath)
    }
  }
  for (const folder of folders) walk(folder)

  const tracks = new Array(files.length)
  const errors = []
  let nextIdx = 0
  const SCAN_CONCURRENCY = 4

  async function scanWorker() {
    while (true) {
      const i = nextIdx++
      if (i >= files.length) return
      const fullPath = files[i]
      const ext = path.extname(fullPath).toLowerCase()
      const prev = prevByPath.get(fullPath)
      if (prev) {
        try {
          const stat = fs.statSync(fullPath)
          if (prev.fileSize === stat.size && prev.lastModified === stat.mtimeMs) {
            tracks[i] = prev
            continue
          }
        } catch {}
      }
      try {
        const metadata = await mm.parseFile(fullPath, { duration: true, skipCovers: true })
        const common = metadata.common
        const format = metadata.format
        const stat = fs.statSync(fullPath)
        tracks[i] = {
          id: 'local-' + fullPath,
          filePath: fullPath,
          ext: ext.slice(1),
          title: common.title || path.basename(fullPath).replace(/\.[^.]+$/, ''),
          artist: (common.artists || []).join(', ') || common.artist || '',
          album: common.album || '',
          albumArtist: common.albumartist || '',
          year: common.year || null,
          trackNumber: common.track?.no || null,
          discNumber: common.disk?.no || null,
          composer: (common.composer || []).join(', '),
          genre: (common.genre || []).join(', '),
          duration: format.duration || 0,
          bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
          sampleRate: format.sampleRate || null,
          fileSize: stat.size,
          lastModified: stat.mtimeMs,
          hasAlbumArt: (common.picture && common.picture.length > 0) ? true : false,
          // A re-parsed file is an *edited* file, not a new one — keep its
          // original added date so "recently added" sorting doesn't reshuffle
          // whenever tags change.
          addedAt: prev?.addedAt ?? Date.now(),
          // Not included: albumArt base64 (loaded on-demand), lyrics
        }
      } catch(e) {
        errors.push({ path: fullPath, error: e.message })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, files.length) }, scanWorker))

  return { tracks: tracks.filter(Boolean), errors }
})

// Embedded album art is often full-resolution (1400px+). Returning it raw meant
// the renderer decoded a multi-MB bitmap PER track row and kept it in memory for
// every track — opening the Library tab could pull gigabytes of RAM. Downscale to
// a JPEG thumbnail (longest edge <= maxSize) before handing it to the renderer.
function coverToThumbDataUri(rawBuffer, fallbackFormat, maxSize) {
  try {
    const img = nativeImage.createFromBuffer(rawBuffer)
    if (img.isEmpty()) throw new Error('decode failed')
    const { width, height } = img.getSize()
    const longest = Math.max(width, height)
    const sized = (maxSize && longest > maxSize)
      ? img.resize(width >= height ? { width: maxSize, quality: 'good' } : { height: maxSize, quality: 'good' })
      : img
    return `data:image/jpeg;base64,${sized.toJPEG(82).toString('base64')}`
  } catch {
    // Unsupported format (rare, e.g. webp on some platforms) — fall back to raw.
    return `data:${fallbackFormat};base64,${Buffer.from(rawBuffer).toString('base64')}`
  }
}

// ── Album-art thumbnail cache ────────────────────────────────────────────────
// Extracting a cover means parsing the whole audio file's metadata — far too
// expensive to redo per row per session. Thumbs are cached by
// (path, mtime, size, maxSize): in memory for repeat asks this session, and on
// disk (the finished data-URI string) so covers survive app restarts. An empty
// cache file means "parsed before, no embedded art" so artless files aren't
// re-parsed either. File edits change mtime/size → new key → stale entries are
// simply never read again.
const crypto = require('crypto')
const artCacheDir = path.join(app.getPath('userData'), 'art-thumbs')
const artMemCache = new Map() // key → data URI ('' = known artless); LRU capped
const ART_MEM_MAX = 500

function artMemPut(key, dataUri) {
  artMemCache.delete(key)
  artMemCache.set(key, dataUri)
  if (artMemCache.size > ART_MEM_MAX) artMemCache.delete(artMemCache.keys().next().value)
}

function artCacheGet(key) {
  if (artMemCache.has(key)) {
    const hit = artMemCache.get(key)
    artMemPut(key, hit) // refresh LRU position
    return hit
  }
  try {
    const data = fs.readFileSync(path.join(artCacheDir, key), 'utf-8')
    artMemPut(key, data)
    return data
  } catch { return undefined }
}

function artCachePut(key, dataUri) {
  artMemPut(key, dataUri)
  try {
    fs.mkdirSync(artCacheDir, { recursive: true })
    fs.writeFileSync(path.join(artCacheDir, key), dataUri)
  } catch {}
}

ipcMain.handle('read-album-art', async (_, filePath, maxSize = 256) => {
  let st
  try { st = fs.statSync(filePath) } catch { return null }
  const key = crypto.createHash('sha1').update(`${filePath}|${st.mtimeMs}|${st.size}|${maxSize}`).digest('hex')
  const cached = artCacheGet(key)
  if (cached !== undefined) return cached || null

  let mm
  try { mm = require('music-metadata') } catch { return null }
  try {
    const metadata = await mm.parseFile(filePath, { skipCovers: false, duration: false })
    const pic = metadata.common.picture?.[0]
    const uri = pic ? coverToThumbDataUri(Buffer.from(pic.data), pic.format, maxSize) : null
    artCachePut(key, uri || '')
    return uri
  } catch { return null } // transient read/parse error — don't cache the failure
})

ipcMain.handle('read-track-metadata', async (_, filePath) => {
  let mm
  try { mm = require('music-metadata') } catch { return null }
  try {
    const metadata = await mm.parseFile(filePath, { skipCovers: false, duration: true })
    const common = metadata.common
    const format = metadata.format
    const pic = common.picture?.[0]
    // Larger cap here — this feeds the full Now Playing art, not a list thumbnail.
    const albumArt = pic ? coverToThumbDataUri(Buffer.from(pic.data), pic.format, 512) : null
    let fileSize = null
    try { fileSize = fs.statSync(filePath).size } catch {}
    return {
      title: common.title || '',
      artist: (common.artists || []).join(', ') || common.artist || '',
      album: common.album || '',
      albumArtist: common.albumartist || '',
      year: common.year || null,
      trackNumber: common.track?.no || null,
      discNumber: common.disk?.no || null,
      composer: (common.composer || []).join(', '),
      genre: (common.genre || []).join(', '),
      // Additional ID3 text frames the local editor lets the user edit. Most
      // map to string[] in music-metadata (join them); comment is an IComment.
      comment: common.comment?.[0]?.text || (typeof common.comment?.[0] === 'string' ? common.comment[0] : '') || '',
      conductor: (common.conductor || []).join(', '),
      publisher: (common.publisher || []).join(', '),
      copyright: common.copyright || '',
      bpm: common.bpm != null ? String(common.bpm) : '',
      originalArtist: common.originalartist || '',
      remixArtist: (common.remixer || []).join(', '),
      mood: common.mood || '',
      initialKey: common.key || '',
      isrc: (common.isrc || []).join(', '),
      grouping: common.grouping || '',
      subtitle: (common.subtitle || []).join(', '),
      encodedBy: common.encodedby || '',
      lyrics: common.lyrics?.[0]?.text || '',
      syncedLyrics: common.lyrics?.find(l => l.syncText)?.syncText?.map(s => `[${formatTime(s.timestamp)}]${s.text}`).join('\n') || '',
      albumArt,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
      sampleRate: format.sampleRate || null,
      bitsPerSample: format.bitsPerSample || null,
      channels: format.numberOfChannels || null,
      fileSize,
      duration: format.duration || 0,
    }
  } catch(e) { return { error: e.message } }
})

function formatTime(ms) {
  const total = Math.floor(ms / 1000)
  const min = Math.floor(total / 60).toString().padStart(2, '0')
  const sec = (total % 60).toString().padStart(2, '0')
  const msRem = (ms % 1000).toString().padStart(3, '0')
  return `${min}:${sec}.${msRem}`
}

// Reverse of the [mm:ss.mmm]text reading above — parses LRC-style text back
// into the {text, timeStamp} list a SYLT (synchronised lyrics) ID3 frame
// needs. Mirrors the renderer's parseLrc() regex (lib/lyrics.ts) so anything
// the app considers valid synced lyrics round-trips through writing too.
function parseLrcToSylt(lrc) {
  const timeRegex = /\[(\d{1,2}):(\d{2})[.:](\d{2,3})\]/g
  const lines = []
  for (const rawLine of lrc.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(timeRegex)]
    if (matches.length === 0) continue
    const text = rawLine.replace(timeRegex, '').trim()
    for (const match of matches) {
      const min = parseInt(match[1], 10)
      const sec = parseInt(match[2], 10)
      const ms = parseInt(match[3].padEnd(3, '0'), 10)
      lines.push({ text, timeStamp: (min * 60 + sec) * 1000 + ms })
    }
  }
  return lines.sort((a, b) => a.timeStamp - b.timeStamp)
}

ipcMain.handle('write-track-metadata', async (_, filePath, metadata) => {
  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.mp3') return { error: 'Only MP3 metadata writing is supported currently' }
  let NodeID3
  try { NodeID3 = require('node-id3') } catch { return { error: 'node-id3 not installed' } }
  try {
    const tags = {}
    if (metadata.title !== undefined) tags.title = metadata.title
    if (metadata.artist !== undefined) tags.artist = metadata.artist
    if (metadata.album !== undefined) tags.album = metadata.album
    if (metadata.albumArtist !== undefined) tags.performerInfo = metadata.albumArtist
    if (metadata.year !== undefined) tags.year = metadata.year != null ? String(metadata.year) : ''
    if (metadata.trackNumber !== undefined) tags.trackNumber = metadata.trackNumber != null ? String(metadata.trackNumber) : ''
    if (metadata.composer !== undefined) tags.composer = metadata.composer
    if (metadata.genre !== undefined) tags.genre = metadata.genre
    // Additional editable text frames. Empty strings clear the frame; comment
    // (COMM) needs the {language,text} object shape, the rest are plain strings.
    if (metadata.comment !== undefined) tags.comment = { language: 'eng', text: metadata.comment || '' }
    if (metadata.conductor !== undefined) tags.conductor = metadata.conductor
    if (metadata.publisher !== undefined) tags.publisher = metadata.publisher
    if (metadata.copyright !== undefined) tags.copyright = metadata.copyright
    if (metadata.bpm !== undefined) tags.bpm = metadata.bpm != null && metadata.bpm !== '' ? String(metadata.bpm) : ''
    if (metadata.originalArtist !== undefined) tags.originalArtist = metadata.originalArtist
    if (metadata.remixArtist !== undefined) tags.remixArtist = metadata.remixArtist
    if (metadata.mood !== undefined) tags.mood = metadata.mood
    if (metadata.initialKey !== undefined) tags.initialKey = metadata.initialKey
    if (metadata.isrc !== undefined) tags.ISRC = metadata.isrc
    if (metadata.grouping !== undefined) tags.contentGroup = metadata.grouping
    if (metadata.subtitle !== undefined) tags.subtitle = metadata.subtitle
    if (metadata.encodedBy !== undefined) tags.encodedBy = metadata.encodedBy
    if (metadata.lyrics !== undefined) tags.unsynchronisedLyrics = { language: 'eng', text: metadata.lyrics }
    if (metadata.syncedLyrics !== undefined) {
      const synced = parseLrcToSylt(metadata.syncedLyrics || '')
      tags.synchronisedLyrics = synced.length ? [{
        language: 'eng',
        timeStampFormat: NodeID3.TagConstants.TimeStampFormat.MILLISECONDS,
        contentType: NodeID3.TagConstants.SynchronisedLyrics.ContentType.LYRICS,
        shortText: 'Synced lyrics',
        synchronisedText: synced,
      }] : []
    }
    if (metadata.albumArtBase64) {
      // albumArtBase64 is a data URL: "data:<mime>;base64,<data>"
      const match = metadata.albumArtBase64.match(/^data:([^;]+);base64,(.+)$/)
      if (match) {
        tags.image = {
          mime: match[1],
          type: { id: 3, name: 'front cover' },
          description: 'Cover',
          imageBuffer: Buffer.from(match[2], 'base64'),
        }
      }
    }
    // Present-but-empty means "this file should end up with no cover", which
    // is distinct from the key being absent ("leave the cover alone").
    const clearImage = metadata.albumArtBase64 !== undefined && !metadata.albumArtBase64

    const result = NodeID3.update(tags, filePath)
    // writeSync returns true on success and the fs Error on failure (false only
    // comes from older paths) — treat anything that isn't success as an error,
    // otherwise a failed write is reported back as a save.
    if (result === false) return { error: 'Failed to write tags' }
    if (result instanceof Error) return { error: result.message }

    if (clearImage) {
      // update() merges onto the file's existing raw frame map and can only
      // add or overwrite frames — there's no way to express "drop this one".
      // So do the removal as its own pass: re-read the frames the update just
      // produced, delete the picture frame, and write the rest back. (This is
      // the same read/modify/write update() itself performs, so it's no more
      // lossy than an ordinary save.)
      const current = NodeID3.read(filePath)
      const raw = (current && current.raw) || {}
      // APIC is the v2.3/v2.4 identifier, PIC the v2.2 one. Skip the rewrite
      // entirely when there's no cover to remove, so saving an artless file
      // doesn't rewrite its whole tag every time.
      if (raw.APIC !== undefined || raw.PIC !== undefined) {
        delete raw.APIC
        delete raw.PIC
        const cleared = NodeID3.write(raw, filePath)
        if (cleared === false) return { error: 'Failed to remove album art' }
        if (cleared instanceof Error) return { error: cleared.message }
      }
    }
    return { success: true }
  } catch(e) { return { error: e.message } }
})

ipcMain.handle('load-wrlddata', async () => {
  const filePath = path.join(app.getAppPath(), 'src', 'renderer', 'public', 'wrlddata.json')
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return null }
})

ipcMain.handle('save-wrlddata', async (_, data) => {
  if (app.isPackaged) return { error: 'Read-only in production' }
  const filePath = path.join(app.getAppPath(), 'src', 'renderer', 'public', 'wrlddata.json')
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
  return { ok: true }
})
ipcMain.handle('download-to-library', async (_, { url, songName, artist, songPath }) => {
  if (!isAllowedLibraryDownloadHost(url)) return { error: 'Download blocked: untrusted host' }
  // Determine save folder: Music/JuiceWRLD Library. On Linux without
  // xdg-user-dirs configured, getPath('music') throws — fall back to ~/Music.
  let musicDir
  try { musicDir = app.getPath('music') } catch { musicDir = path.join(app.getPath('home'), 'Music') }
  const libraryFolder = path.join(musicDir, 'JuiceWRLD Library')
  try { fs.mkdirSync(libraryFolder, { recursive: true }) } catch {}

  // Build filename from songPath (keeps original extension)
  const ext = path.extname(songPath || '').toLowerCase() || '.mp3'
  const baseName = (songName || 'track').replace(/[/\\:*?"<>|]/g, '_').trim()
  const savePath = path.join(libraryFolder, baseName + ext)

  // Download
  try {
    await downloadFile(url, savePath)
  } catch (e) {
    return { error: 'Download failed: ' + e.message }
  }

  // Parse metadata
  let mm
  try { mm = require('music-metadata') } catch { return { error: 'music-metadata not installed' } }
  let trackMeta = {}
  try {
    const meta = await mm.parseFile(savePath, { duration: true, skipCovers: true })
    const c = meta.common
    const f = meta.format
    const stat = fs.statSync(savePath)
    trackMeta = {
      id: 'local-' + savePath,
      filePath: savePath,
      ext: ext.slice(1),
      title: c.title || songName || baseName,
      artist: (c.artists || []).join(', ') || c.artist || artist || '',
      album: c.album || '',
      albumArtist: c.albumartist || '',
      year: c.year || null,
      trackNumber: c.track?.no || null,
      discNumber: c.disk?.no || null,
      composer: (c.composer || []).join(', '),
      genre: (c.genre || []).join(', '),
      duration: f.duration || 0,
      bitrate: f.bitrate ? Math.round(f.bitrate / 1000) : null,
      sampleRate: f.sampleRate || null,
      fileSize: stat.size,
      lastModified: stat.mtimeMs,
      hasAlbumArt: (c.picture && c.picture.length > 0) ? true : false,
      addedAt: Date.now(),
    }
  } catch (e) {
    return { error: 'Metadata read failed: ' + e.message }
  }

  // Add to library-data.json
  const libData = loadLibraryData()
  const existingIdx = libData.tracks.findIndex(t => t.id === trackMeta.id)
  if (existingIdx >= 0) {
    libData.tracks[existingIdx] = trackMeta
  } else {
    libData.tracks.push(trackMeta)
  }
  saveLibraryData(libData)

  return { track: trackMeta }
})

// ── Audio format conversion (ffmpeg) ─────────────────────────────────────────
// Local library files can be transcoded to another format via the on-demand
// ffmpeg binary (see the tools section above). The output lands next to the
// source (never overwriting it), inherits tags + embedded cover where the
// target container supports one, and is registered into library-data.json so
// it shows up in the library.

// ── On-demand tool binaries (ffmpeg / yt-dlp) ────────────────────────────────
// Neither binary ships with the app — together they'd add ~100 MB to every
// install for features many users never touch. Instead each is downloaded on
// first use into userData/bin (progress streamed to the requesting window via
// 'tools-download-progress') and reused forever after. In dev the copies inside
// node_modules (ffmpeg-static / youtube-dl-exec, both devDependencies now, so
// absent from packaged builds) serve as a fallback, keeping `electron:dev`
// working without any download.

// SHA256 of each platform/arch .gz asset from the pinned ffmpeg-static release
// (b6.1.1) — computed once against the real GitHub release and hardcoded here,
// so a hijacked redirect or a compromised release asset can't swap in a
// different binary without the checksum catching it before it's ever chmod'd
// or executed.
const FFMPEG_SHA256 = {
  'win32-x64': '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d7',
  'darwin-x64': '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb424210',
  'darwin-arm64': '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bb',
  'linux-x64': 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dff',
  'linux-arm64': '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac',
}

const TOOL_SPECS = {
  ffmpeg: {
    // The exact build ffmpeg-static would have bundled, from its own releases.
    // Served gzipped (~40 MB down, ~80 MB on disk).
    url: () => `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-${process.platform}-${process.arch}.gz`,
    gunzip: true,
    file: process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    sha256: () => FFMPEG_SHA256[`${process.platform}-${process.arch}`] || null,
  },
  ytdlp: {
    // Always the latest release: yt-dlp's site extractors rot quickly, so a
    // fresh copy beats anything pinned. Re-downloading (force:true) is also the
    // fix when a site link fails with an "outdated downloader" error. Since the
    // binary itself can't be pinned, its checksum is instead fetched fresh from
    // the same release's own SHA2-256SUMS asset and verified after download.
    url: () => {
      const name = process.platform === 'win32' ? 'yt-dlp.exe'
        : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp'
      return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`
    },
    checksumFileName: () => (process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp'),
    checksumsUrl: () => 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS',
    gunzip: false,
    file: process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
  },
}

function sha256File(filePath) {
  const crypto = require('crypto')
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// Fetches yt-dlp's own SHA2-256SUMS text asset (small, plain HTTPS GET — not
// worth downloadAnyUrl's redirect/gunzip machinery) and returns the hex digest
// for `fileName`, or null if the sums file doesn't mention it.
function fetchYtDlpChecksum(fileName) {
  return new Promise((resolve) => {
    https.get(TOOL_SPECS.ytdlp.checksumsUrl(), { headers: { 'User-Agent': 'Unreleased-App' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        https.get(res.headers.location, { headers: { 'User-Agent': 'Unreleased-App' } }, (res2) => {
          let body = ''
          res2.on('data', (c) => { body += c })
          res2.on('end', () => resolve(body))
          res2.on('error', () => resolve(''))
        }).on('error', () => resolve(''))
        return
      }
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve(body))
      res.on('error', () => resolve(''))
    }).on('error', () => resolve(''))
  }).then((body) => {
    const line = body.split('\n').find((l) => l.trim().endsWith(fileName))
    const match = line && /^([0-9a-f]{64})\s/.exec(line.trim())
    return match ? match[1] : null
  })
}

function toolsDir() {
  return path.join(app.getPath('userData'), 'bin')
}

function downloadedToolPath(tool) {
  const p = path.join(toolsDir(), TOOL_SPECS[tool].file)
  return fs.existsSync(p) ? p : null
}

function devFfmpegPath() {
  let p
  try { p = require('ffmpeg-static') } catch { return null }
  if (!p) return null
  if (app.isPackaged) p = p.replace('app.asar', 'app.asar.unpacked')
  return fs.existsSync(p) ? p : null
}

function devYtDlpPath() {
  let dir
  try { dir = path.dirname(require.resolve('youtube-dl-exec/package.json')) } catch { return null }
  if (app.isPackaged) dir = dir.replace('app.asar', 'app.asar.unpacked')
  const p = path.join(dir, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  return fs.existsSync(p) ? p : null
}

// Downloaded copy first: it's the one the "update downloader" path refreshes,
// so it must win over a stale dev copy when both exist.
function resolveFfmpegPath() {
  return downloadedToolPath('ffmpeg') || devFfmpegPath()
}

function resolveYtDlpPath() {
  return downloadedToolPath('ytdlp') || devYtDlpPath()
}

// One download per tool at a time; concurrent requests (e.g. the convert dialog
// and the URL-import dialog both open at once) latch onto the same promise —
// only the first caller's progress callback is wired, which is fine because a
// second dialog re-checks tools-status when the handler resolves.
const toolDownloadsInFlight = {}

function downloadTool(tool, onProgress) {
  if (toolDownloadsInFlight[tool]) return toolDownloadsInFlight[tool]
  const spec = TOOL_SPECS[tool]
  const dest = path.join(toolsDir(), spec.file)
  const run = (async () => {
    fs.mkdirSync(toolsDir(), { recursive: true })
    if (spec.gunzip) {
      // Checksums are pinned against the .gz release asset, so it has to be
      // hashed before decompression — download it raw (gunzip:false here),
      // verify, then decompress to `dest` ourselves.
      const gzPath = dest + '.gz'
      await downloadAnyUrl(spec.url(), gzPath, onProgress, 0, false, true)
      const expected = spec.sha256()
      if (!expected) { try { fs.unlinkSync(gzPath) } catch {}; throw new Error(`No pinned checksum for this platform/arch (${process.platform}-${process.arch})`) }
      const actual = await sha256File(gzPath)
      if (actual !== expected) {
        try { fs.unlinkSync(gzPath) } catch {}
        throw new Error(`Checksum mismatch for ${tool} — downloaded file discarded`)
      }
      await new Promise((resolve, reject) => {
        const zlib = require('zlib')
        fs.createReadStream(gzPath).pipe(zlib.createGunzip()).pipe(fs.createWriteStream(dest))
          .on('finish', resolve).on('error', reject)
      })
      try { fs.unlinkSync(gzPath) } catch {}
    } else {
      await downloadAnyUrl(spec.url(), dest, onProgress, 0, false, true)
      const expected = await fetchYtDlpChecksum(spec.checksumFileName())
      if (!expected) { try { fs.unlinkSync(dest) } catch {}; throw new Error('Could not fetch yt-dlp release checksum — refusing to trust an unverified binary') }
      const actual = await sha256File(dest)
      if (actual !== expected) {
        try { fs.unlinkSync(dest) } catch {}
        throw new Error(`Checksum mismatch for ${tool} — downloaded file discarded`)
      }
    }
    if (process.platform !== 'win32') { try { fs.chmodSync(dest, 0o755) } catch {} }
  })()
  toolDownloadsInFlight[tool] = run.finally(() => { delete toolDownloadsInFlight[tool] })
  return toolDownloadsInFlight[tool]
}

// { ffmpeg: bool, ytdlp: bool } — whether each binary is currently runnable
// (downloaded copy or dev fallback).
ipcMain.handle('tools-status', () => ({
  ffmpeg: !!resolveFfmpegPath(),
  ytdlp: !!resolveYtDlpPath(),
}))

// Download the given tools (default: both), skipping any that already resolve
// unless force:true — which re-fetches even a present copy, the "update the
// downloader" path when yt-dlp reports its extractors are stale. Progress
// arrives on 'tools-download-progress' as { tool, percent, received, total,
// done }. Resolves { ok: true } | { error }.
ipcMain.handle('tools-download', async (event, opts) => {
  const { tools, force } = opts || {}
  const wanted = (Array.isArray(tools) && tools.length ? tools : ['ytdlp', 'ffmpeg'])
    .filter(t => TOOL_SPECS[t])
  for (const tool of wanted) {
    const present = tool === 'ffmpeg' ? resolveFfmpegPath() : resolveYtDlpPath()
    if (present && !force) continue
    let lastPct = -1
    const emit = (percent, received, total) => {
      if (percent === lastPct) return
      lastPct = percent
      if (!event.sender.isDestroyed()) {
        event.sender.send('tools-download-progress', { tool, percent, received, total, done: false })
      }
    }
    try {
      await downloadTool(tool, emit)
    } catch (e) {
      const label = tool === 'ytdlp' ? 'the downloader' : 'the audio converter'
      return { error: `Could not download ${label}: ${e.message}` }
    }
    if (!event.sender.isDestroyed()) {
      event.sender.send('tools-download-progress', { tool, percent: 100, done: true })
    }
  }
  return { ok: true }
})

// Target format → { file extension, codec-arg builder, whether the container
// can carry an embedded cover }. `bitrate` is only consulted for lossy codecs.
// libvorbis rejects CBR (`-b:a`) on some inputs (e.g. mono) with "encoder setup
// failed" — it wants VBR quality instead, so map the requested bitrate onto a
// vorbis quality level (-q:a 0..10).
const VORBIS_QUALITY = { '320k': 9, '256k': 8, '192k': 6, '128k': 4 }

const CONVERT_FORMATS = {
  mp3:  { ext: 'mp3',  cover: true,  codec: (br) => ['-c:a', 'libmp3lame', '-b:a', br] },
  m4a:  { ext: 'm4a',  cover: true,  codec: (br) => ['-c:a', 'aac', '-b:a', br] },
  flac: { ext: 'flac', cover: true,  codec: ()   => ['-c:a', 'flac'] },
  wav:  { ext: 'wav',  cover: false, codec: ()   => ['-c:a', 'pcm_s16le'] },
  ogg:  { ext: 'ogg',  cover: false, codec: (br) => ['-c:a', 'libvorbis', '-q:a', String(VORBIS_QUALITY[br] ?? 6)] },
  opus: { ext: 'opus', cover: false, codec: (br) => ['-c:a', 'libopus', '-b:a', br] },
}

// Pick an output path next to the source that clobbers neither an existing file
// nor the source itself (matters most for same-format re-encodes, where the
// natural name collides with the input).
function uniqueConvertPath(dir, base, ext, srcPath) {
  const src = path.resolve(srcPath)
  let candidate = path.join(dir, `${base}.${ext}`)
  if (path.resolve(candidate) !== src && !fs.existsSync(candidate)) return candidate
  candidate = path.join(dir, `${base} (converted).${ext}`)
  let n = 1
  while (path.resolve(candidate) === src || fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (converted ${++n}).${ext}`)
  }
  return candidate
}

ipcMain.handle('convert-audio', async (event, { id, filePath, format, bitrate, stripMetadata }) => {
  const spec = CONVERT_FORMATS[format]
  if (!spec) return { error: `Unsupported target format: ${format}` }
  if (!filePath || !fs.existsSync(filePath)) return { error: 'Source file not found' }

  const ffmpegPath = resolveFfmpegPath()
  if (!ffmpegPath) return { error: 'The audio converter is not installed — reopen this dialog to download it.' }

  let mm
  try { mm = require('music-metadata') } catch { return { error: 'music-metadata not installed' } }

  // Total duration drives the progress percentage.
  let durationSec = 0
  try {
    const probe = await mm.parseFile(filePath, { duration: true, skipCovers: true })
    durationSec = probe.format.duration || 0
  } catch {}

  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outPath = uniqueConvertPath(dir, base, spec.ext, filePath)

  const br = bitrate || '256k'
  const args = ['-hide_banner', '-nostdin', '-y', '-i', filePath]
  // When stripping, drop the cover (and everything else) — keep only audio.
  const keepCover = spec.cover && !stripMetadata
  if (keepCover) {
    // Keep audio + carry the cover (an "attached_pic" video stream) if present;
    // `?` makes the video mapping optional so cover-less files don't fail.
    args.push('-map', '0:a', '-map', '0:v?', '-c:v', 'copy')
  } else {
    args.push('-map', '0:a')
  }
  // -map_metadata -1 wipes tags; also drop chapters so nothing identifying
  // survives. Otherwise inherit the source's tags (-map_metadata 0).
  args.push('-map_metadata', stripMetadata ? '-1' : '0')
  if (stripMetadata) args.push('-map_chapters', '-1')
  args.push(...spec.codec(br))
  // Machine-readable progress on stdout; keep stderr for the failure message.
  args.push('-progress', 'pipe:1', '-nostats', outPath)

  const { spawn } = require('child_process')

  try {
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegPath, args, { windowsHide: true })
      let stderr = ''
      ff.on('error', reject)
      ff.stderr.on('data', (d) => {
        stderr += d.toString()
        if (stderr.length > 8000) stderr = stderr.slice(-8000)
      })
      ff.stdout.on('data', (d) => {
        if (durationSec <= 0) return
        const matches = [...d.toString().matchAll(/out_time_us=(\d+)/g)]
        if (!matches.length) return
        const us = parseInt(matches[matches.length - 1][1], 10)
        const percent = Math.max(1, Math.min(99, Math.round((us / 1e6 / durationSec) * 100)))
        if (!event.sender.isDestroyed()) event.sender.send('convert-progress', { id, percent })
      })
      ff.on('close', (code) => {
        if (code === 0) return resolve()
        const tail = stderr.split('\n').map(l => l.trim()).filter(Boolean).slice(-3).join(' ')
        reject(new Error(tail || `ffmpeg exited with code ${code}`))
      })
    })
  } catch (e) {
    try { fs.unlinkSync(outPath) } catch {} // clean up any partial output
    return { error: 'Conversion failed: ' + e.message }
  }

  // Build a library entry for the new file (mirrors scan-library's shape).
  let trackMeta
  try {
    const meta = await mm.parseFile(outPath, { duration: true, skipCovers: true })
    const c = meta.common
    const f = meta.format
    const stat = fs.statSync(outPath)
    trackMeta = {
      id: 'local-' + outPath,
      filePath: outPath,
      ext: spec.ext,
      title: c.title || base,
      artist: (c.artists || []).join(', ') || c.artist || '',
      album: c.album || '',
      albumArtist: c.albumartist || '',
      year: c.year || null,
      trackNumber: c.track?.no || null,
      discNumber: c.disk?.no || null,
      composer: (c.composer || []).join(', '),
      genre: (c.genre || []).join(', '),
      duration: f.duration || 0,
      bitrate: f.bitrate ? Math.round(f.bitrate / 1000) : null,
      sampleRate: f.sampleRate || null,
      fileSize: stat.size,
      lastModified: stat.mtimeMs,
      hasAlbumArt: !!(c.picture && c.picture.length > 0),
      addedAt: Date.now(),
    }
  } catch (e) {
    // The file converted fine; only the re-read failed. Report success with the
    // path so the UI can still point the user at it.
    return { outPath, warning: 'Converted, but metadata could not be read: ' + e.message }
  }

  const libData = loadLibraryData()
  const existingIdx = libData.tracks.findIndex(t => t.id === trackMeta.id)
  if (existingIdx >= 0) libData.tracks[existingIdx] = trackMeta
  else libData.tracks.push(trackMeta)
  saveLibraryData(libData)

  if (!event.sender.isDestroyed()) event.sender.send('convert-progress', { id, percent: 100 })
  return { track: trackMeta, outPath }
})


// ── URL import (direct audio files + yt-dlp for everything else) ─────────────
// Takes any http(s) URL and gets audio from it into the library. Two modes,
// picked automatically:
//   • direct file  — the URL serves an audio file (by extension, or by
//     Content-Type when the path has no useful extension). Downloaded byte-for
//     -byte, no re-encode, keeping whatever format it already is.
//   • site link    — anything else goes to yt-dlp, which covers YouTube plus
//     ~1800 other sites; audio is extracted to the requested format with the
//     thumbnail embedded as cover art.
// Either way the file lands in the same Music/JuiceWRLD Library folder as
// download-to-library and is registered in library-data.json, so it shows up
// like any other local track.

// yt-dlp resolution lives with the other on-demand tools — see the
// "On-demand tool binaries" section above resolveFfmpegPath.

// format id → { yt-dlp --audio-format value, final file extension, is it lossy
// (so a target bitrate applies) }.
const YT_AUDIO_FORMATS = {
  mp3:  { fmt: 'mp3',    ext: 'mp3',  lossy: true },
  m4a:  { fmt: 'm4a',    ext: 'm4a',  lossy: true },
  opus: { fmt: 'opus',   ext: 'opus', lossy: true },
  ogg:  { fmt: 'vorbis', ext: 'ogg',  lossy: true },
  flac: { fmt: 'flac',   ext: 'flac', lossy: false },
  wav:  { fmt: 'wav',    ext: 'wav',  lossy: false },
}

// Pick a name inside `dir` that doesn't clobber an existing file.
function uniqueLibraryPath(dir, base, ext) {
  let candidate = path.join(dir, `${base}.${ext}`)
  let n = 1
  while (fs.existsSync(candidate)) candidate = path.join(dir, `${base} (${++n}).${ext}`)
  return candidate
}

// Extensions that mean "this URL IS the audio file" — fetch it directly rather
// than paying yt-dlp's page-scrape cost for a plain file link.
const DIRECT_AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'alac']

// Content-Type → extension, for direct links whose path carries no usable
// extension (CDN/query-string downloads). Only audio/* types belong here — a
// text/html response means it's a page, which is yt-dlp's job.
const AUDIO_MIME_EXT = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac', 'audio/x-flac': 'flac',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/ogg': 'ogg', 'application/ogg': 'ogg',
  'audio/opus': 'opus',
}

function directExtFromUrl(u) {
  try {
    const ext = (new URL(u).pathname.split('.').pop() || '').toLowerCase()
    return DIRECT_AUDIO_EXTS.includes(ext) ? ext : null
  } catch { return null }
}

// HEAD the URL to see whether it serves audio. Resolves an extension when it
// does, else null (→ hand the URL to yt-dlp). Never rejects: any failure here
// just means "not provably a direct file", and the yt-dlp path is the correct
// fallback anyway.
function probeAudioUrl(u, depth = 0) {
  return new Promise((resolve) => {
    if (depth > 4) return resolve(null)
    let parsed
    try { parsed = new URL(u) } catch { return resolve(null) }
    const mod = parsed.protocol === 'http:' ? require('http') : require('https')
    const req = mod.request({
      method: 'HEAD',
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': 'Unreleased-App' },
    }, (res) => {
      res.resume()
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return resolve(probeAudioUrl(new URL(res.headers.location, u).href, depth + 1))
      }
      if (res.statusCode !== 200) return resolve(null)
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
      resolve(AUDIO_MIME_EXT[type] || null)
    })
    req.on('error', () => resolve(null))
    req.setTimeout(8000, () => { req.destroy(); resolve(null) })
    req.end()
  })
}

// Like downloadFile above, but for arbitrary user-supplied URLs: handles http
// as well as https, preserves a non-default port, and follows the full set of
// redirect codes. Kept separate so the updater/offline paths keep using the
// helper they were written against. gunzip:true decompresses on the way to
// disk (the ffmpeg release assets are served as .gz); progress still tracks
// the compressed byte count, which is what content-length describes.
function downloadAnyUrl(url, dest, onProgress, depth = 0, gunzip = false, httpsOnly = false) {
  const tmp = dest + '.part'
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'))
    let parsed
    try { parsed = new URL(url) } catch { return reject(new Error('Invalid URL')) }
    if (httpsOnly && parsed.protocol !== 'https:') return reject(new Error('Refused non-HTTPS URL/redirect: ' + url))
    const mod = parsed.protocol === 'http:' ? require('http') : require('https')
    mod.get({
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': 'Unreleased-App' },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        return resolve(downloadAnyUrl(new URL(res.headers.location, url).href, dest, onProgress, depth + 1, gunzip, httpsOnly))
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)) }
      const total = parseInt(res.headers['content-length'] || '0', 10)
      let received = 0
      const out = fs.createWriteStream(tmp)
      const sink = gunzip ? require('zlib').createGunzip() : out
      if (gunzip) sink.pipe(out)
      const fail = (err) => {
        sink.destroy()
        out.destroy()
        try { fs.unlinkSync(tmp) } catch {}
        reject(err)
      }
      res.on('data', (chunk) => {
        received += chunk.length
        if (onProgress) onProgress(total > 0 ? Math.round(received / total * 100) : 0, received, total)
      })
      res.pipe(sink)
      out.on('finish', () => {
        if (total > 0 && received !== total) return fail(new Error(`Truncated download: got ${received} of ${total} bytes`))
        try { fs.renameSync(tmp, dest) } catch (e) { return fail(e) }
        resolve()
      })
      sink.on('error', fail)
      out.on('error', fail)
      res.on('error', fail)
    }).on('error', reject)
  })
}

// Lets the renderer show the one-time download page the moment the dialog
// opens, instead of a bare error after a failed attempt. Direct file downloads
// don't actually need either binary, but gating up front keeps the flow simple
// and the binaries are needed for every site link anyway. Freshness (whether
// yt-dlp's extractors still work) can't be known without a real request, so
// that's surfaced reactively via `needsUpdate` below.
ipcMain.handle('url-import-status', () => {
  const missing = []
  if (!resolveYtDlpPath()) missing.push('ytdlp')
  if (!resolveFfmpegPath()) missing.push('ffmpeg')
  if (missing.length) return { available: false, reason: 'needs-download', missing }
  return { available: true }
})

// yt-dlp prints this family of phrases when a failure is likely caused by a
// site-side change its extractor doesn't understand yet — as opposed to a
// bad URL, a private/deleted video, or a network hiccup. When it matches, the
// renderer shows a distinct "needs an update" page whose button re-downloads
// the latest yt-dlp (tools-download with force:true) rather than a plain
// error the user might retry forever.
function looksOutdated(stderr) {
  return /yt-dlp(?:\.exe)? -U\b|update-to\b|on the latest version|yt-dlp is outdated|please update yt-dlp/i.test(stderr)
}

ipcMain.handle('url-import', async (event, { id, url, format, bitrate }) => {
  const spec = YT_AUDIO_FORMATS[format] || YT_AUDIO_FORMATS.mp3
  const target = String(url || '').trim()
  if (!/^https?:\/\//i.test(target)) {
    return { error: 'Enter a valid URL starting with http:// or https://' }
  }

  let mm
  try { mm = require('music-metadata') } catch { return { error: 'music-metadata not installed' } }

  // Destination library folder (same as download-to-library).
  let musicDir
  try { musicDir = app.getPath('music') } catch { musicDir = path.join(app.getPath('home'), 'Music') }
  const libraryFolder = path.join(musicDir, 'JuiceWRLD Library')
  try { fs.mkdirSync(libraryFolder, { recursive: true }) } catch {}

  const emit = (percent, stage) => {
    if (!event.sender.isDestroyed()) event.sender.send('url-import-progress', { id, percent, stage })
  }

  // Direct file link, or a page for yt-dlp to extract from? Extension first
  // (free); only pay for a HEAD request when the path doesn't say.
  let directExt = directExtFromUrl(target)
  if (!directExt) {
    emit(1, 'probe')
    directExt = await probeAudioUrl(target)
  }

  let savePath, finalExt, base

  if (directExt) {
    // ── Direct file: fetch the bytes as-is, no re-encode ──────────────────
    finalExt = directExt
    let rawName = 'audio'
    try {
      rawName = decodeURIComponent(path.basename(new URL(target).pathname)) || 'audio'
    } catch {}
    base = path.basename(rawName, path.extname(rawName)).replace(/[/\\:*?"<>|]/g, '_').trim() || 'audio'
    savePath = uniqueLibraryPath(libraryFolder, base, finalExt)

    try {
      await downloadAnyUrl(target, savePath, (percent) => {
        emit(Math.max(1, Math.min(99, percent)), 'download')
      })
    } catch (e) {
      return { error: 'Download failed: ' + e.message }
    }
  } else {
    // ── Site link: hand off to yt-dlp ─────────────────────────────────────
    const ytDlpPath = resolveYtDlpPath()
    if (!ytDlpPath) return { error: 'The downloader component is not installed — reopen this dialog to download it.' }
    const ffmpegPath = resolveFfmpegPath()
    if (!ffmpegPath) return { error: 'The audio converter is not installed — reopen this dialog to download it.' }

    // Download into a throwaway dir so exactly one produced file is easy to
    // find, regardless of how yt-dlp renders the title into the filename.
    const os = require('os')
    let tmpDir
    try { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'urlimport-')) } catch (e) {
      return { error: 'Could not create a temp folder: ' + e.message }
    }

    const args = [
      target,
      '-f', 'bestaudio/best',
      '-x',
      '--audio-format', spec.fmt,
      '--embed-thumbnail',
      '--embed-metadata',
      '--no-playlist',
      '--newline',
      '--no-color',
      '--ffmpeg-location', path.dirname(ffmpegPath),
      '-o', path.join(tmpDir, '%(title).150B.%(ext)s'),
    ]
    // Target bitrate only meaningfully applies to lossy encoders.
    if (spec.lossy && bitrate) args.push('--audio-quality', String(bitrate).replace('k', 'K'))

    const { spawn } = require('child_process')

    try {
      await new Promise((resolve, reject) => {
        const yt = spawn(ytDlpPath, args, { windowsHide: true })
        let stderr = ''
        yt.on('error', reject)
        const onData = (buf) => {
          const text = buf.toString()
          // Download lines: "[download]  42.7% of 3.20MiB at ...". Map the raw
          // download progress into 0–90%, leaving headroom for post-processing.
          const m = [...text.matchAll(/\[download\]\s+([\d.]+)%/g)]
          if (m.length) {
            const pct = parseFloat(m[m.length - 1][1])
            if (!Number.isNaN(pct)) emit(Math.max(1, Math.min(90, Math.round(pct * 0.9))), 'download')
          }
          if (/\[ExtractAudio\]/.test(text)) emit(93, 'extract')
          if (/\[EmbedThumbnail\]|\[Metadata\]/.test(text)) emit(96, 'finalize')
        }
        yt.stdout.on('data', onData)
        yt.stderr.on('data', (d) => {
          stderr += d.toString()
          if (stderr.length > 8000) stderr = stderr.slice(-8000)
          onData(d)
        })
        yt.on('close', (code) => {
          if (code === 0) return resolve()
          const tail = stderr.split('\n').map(l => l.trim())
            .filter(l => l && !l.startsWith('[download]')).slice(-3).join(' ')
          const err = new Error(tail || `yt-dlp exited with code ${code}`)
          if (looksOutdated(stderr)) err.needsUpdate = true
          reject(err)
        })
      })
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
      if (e.needsUpdate) {
        return {
          error: 'This link needs a newer downloader — update it below and try again.',
          needsUpdate: true,
        }
      }
      return { error: 'Download failed: ' + e.message }
    }

    // Locate the produced audio file (prefer the target extension; fall back
    // to whatever single file landed in the temp dir).
    let produced
    try {
      const files = fs.readdirSync(tmpDir).filter(f => !f.endsWith('.part'))
      produced = files.find(f => f.toLowerCase().endsWith('.' + spec.ext)) || files[0]
    } catch {}
    if (!produced) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
      return { error: 'Download finished but no audio file was produced.' }
    }
    const producedPath = path.join(tmpDir, produced)
    finalExt = (path.extname(produced).slice(1) || spec.ext).toLowerCase()
    base = path.basename(produced, path.extname(produced)).replace(/[/\\:*?"<>|]/g, '_').trim() || 'audio'
    savePath = uniqueLibraryPath(libraryFolder, base, finalExt)

    // Move out of the temp dir; rename can fail across volumes, so copy+unlink.
    try { fs.renameSync(producedPath, savePath) }
    catch { try { fs.copyFileSync(producedPath, savePath); fs.unlinkSync(producedPath) } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
      return { error: 'Could not save the file into the library: ' + e.message }
    } }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }

  // Build a library entry (mirrors scan-library / convert-audio shape).
  let trackMeta
  try {
    const meta = await mm.parseFile(savePath, { duration: true, skipCovers: true })
    const c = meta.common
    const f = meta.format
    const stat = fs.statSync(savePath)
    trackMeta = {
      id: 'local-' + savePath,
      filePath: savePath,
      ext: finalExt,
      title: c.title || base,
      artist: (c.artists || []).join(', ') || c.artist || '',
      album: c.album || '',
      albumArtist: c.albumartist || '',
      year: c.year || null,
      trackNumber: c.track?.no || null,
      discNumber: c.disk?.no || null,
      composer: (c.composer || []).join(', '),
      genre: (c.genre || []).join(', '),
      duration: f.duration || 0,
      bitrate: f.bitrate ? Math.round(f.bitrate / 1000) : null,
      sampleRate: f.sampleRate || null,
      fileSize: stat.size,
      lastModified: stat.mtimeMs,
      hasAlbumArt: !!(c.picture && c.picture.length > 0),
      addedAt: Date.now(),
    }
  } catch (e) {
    return { outPath: savePath, warning: 'Downloaded, but metadata could not be read: ' + e.message }
  }

  const libData = loadLibraryData()
  const existingIdx = libData.tracks.findIndex(t => t.id === trackMeta.id)
  if (existingIdx >= 0) libData.tracks[existingIdx] = trackMeta
  else libData.tracks.push(trackMeta)
  saveLibraryData(libData)

  emit(100, 'done')
  return { track: trackMeta, outPath: savePath }
})


ipcMain.handle('open-discord-login', (_, authorizeUrl) => {
  // Guard against a compromised renderer handing this an arbitrary URL — this
  // window has no preload script, but it's still an in-app popup a user would
  // trust, so it's worth pinning to Discord's real OAuth origin.
  try {
    if (new URL(authorizeUrl).origin !== 'https://discord.com') return Promise.resolve(null)
  } catch {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const loginWin = new BrowserWindow({
      width: 520, height: 720,
      parent: mainWindow || undefined,
      modal: false,
      title: 'Log in with Discord',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    loginWin.setMenu(null)
    loginWin.loadURL(authorizeUrl)

    const CALLBACK_HOST = 'player.juicewrldapi.com'
    const CALLBACK_PATH = '/auth/discord/callback'

    const intercept = (_, url) => {
      try {
        const parsed = new URL(url)
        if (parsed.hostname === CALLBACK_HOST && parsed.pathname === CALLBACK_PATH) {
          const code = parsed.searchParams.get('code')
          const state = parsed.searchParams.get('state')
          loginWin.close()
          resolve(code && state ? { code, state } : null)
        }
      } catch {}
    }

    loginWin.webContents.on('will-navigate', intercept)
    loginWin.webContents.on('will-redirect', intercept)
    loginWin.on('closed', () => resolve(null))
  })
})

ipcMain.handle('select-image-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    title: 'Select album art',
  })
  if (result.canceled || !result.filePaths[0]) return null
  try {
    const buf = fs.readFileSync(result.filePaths[0])
    const ext = path.extname(result.filePaths[0]).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch { return null }
})

// Fetches a remote image (e.g. an API cover URL the CoverPickerModal hands
// back) and returns it as a resized JPEG data URL ready to embed as album art.
// Done in the main process so it isn't subject to the renderer's CORS rules,
// and normalised through coverToThumbDataUri so a huge source image doesn't
// bloat the MP3 tag — the same 640px cap the editor's own art uses. Returns
// { error } on failure so the renderer can surface it.
ipcMain.handle('fetch-image-as-data-url', async (_, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { error: 'Invalid image URL' }
  try {
    const buf = await new Promise((resolve, reject) => {
      const MAX_BYTES = 20 * 1024 * 1024 // guard against a non-image response
      function doGet(u, redirects) {
        const opts = new URL(u)
        https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { 'User-Agent': 'Unreleased-App' } }, (res) => {
          if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
            res.resume()
            if (redirects <= 0) return reject(new Error('Too many redirects'))
            return doGet(new URL(res.headers.location, u).toString(), redirects - 1)
          }
          if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)) }
          const chunks = []
          let received = 0
          res.on('data', (c) => {
            received += c.length
            if (received > MAX_BYTES) { res.destroy(); return reject(new Error('Image too large')) }
            chunks.push(c)
          })
          res.on('end', () => resolve(Buffer.concat(chunks)))
          res.on('error', reject)
        }).on('error', reject)
      }
      doGet(url, 5)
    })
    return { dataUrl: coverToThumbDataUri(buf, 'image/jpeg', 640) }
  } catch (e) {
    return { error: e.message || 'Failed to fetch image' }
  }
})

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Deny every permission request by default. Nothing in this app needs
  // notifications/media/geolocation/etc. granted to loaded web content, and
  // Electron's built-in default handler grants most of them — this closes
  // that gap explicitly rather than relying on the default.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  // Sweep partial downloads left by a crash mid-transfer: downloadFile writes
  // to "<file>.part" and renames into place on completion, so any .part still
  // present at startup is abandoned. Runs before the renderer loads, so no
  // download can be mid-write yet.
  try {
    for (const name of fs.readdirSync(getOfflineAudioDir())) {
      if (name.endsWith('.part')) {
        try { fs.unlinkSync(path.join(getOfflineAudioDir(), name)) } catch {}
      }
    }
  } catch {}

  // A page loaded over file:// sends `Origin: null` on a crossOrigin fetch;
  // the dev server sends its real localhost origin. Reflecting only one of
  // those two expected values (instead of a blanket '*') means the response
  // is still readable by the app itself but not by some other page that
  // happened to end up with local-media: reachable in a stray window.
  function mediaCorsOrigin(request) {
    const origin = request.headers.get('origin')
    if (isDev) return origin === 'http://localhost:3018' ? origin : null
    return origin === 'null' || origin === null ? 'null' : null
  }
  protocol.handle('local-media', (request) => {
    try {
      const filePath = new URL(request.url).searchParams.get('p')
      if (!filePath) return new Response('Missing path', { status: 400 })

      // Serve Range requests ourselves: net.fetch on a file:// URL ignores the
      // Range header entirely, so every seek got the whole file back as a 200
      // and Chromium restarted playback from 0. A real 206 + Content-Range is
      // what makes the <audio> element treat the track as seekable.
      const stat = fs.statSync(filePath)
      const size = stat.size
      const mimeByExt = {
        '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav',
        '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aac': 'audio/aac',
        '.opus': 'audio/ogg', '.wma': 'audio/x-ms-wma', '.aiff': 'audio/aiff',
        '.aif': 'audio/aiff', '.caf': 'audio/x-caf',
        '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
        '.m4v': 'video/mp4', '.mkv': 'video/x-matroska',
      }
      const mime = mimeByExt[path.extname(filePath).toLowerCase()] || 'application/octet-stream'

      // CORS header on every response: the renderer's <audio> elements load
      // with crossOrigin="anonymous" so the Web Audio equalizer chain can
      // process them — without this header, CORS-mode loads fail and local
      // files won't play at all. Scoped to the app's own origin (see
      // mediaCorsOrigin) rather than '*'.
      const corsOrigin = mediaCorsOrigin(request)
      const corsHeaders = corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}
      const rangeHeader = request.headers.get('range')
      const match = rangeHeader && /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      if (match && (match[1] || match[2])) {
        const start = match[1] ? parseInt(match[1], 10) : size - parseInt(match[2], 10)
        const end = match[1] && match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1
        if (start >= size || start < 0 || start > end) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, ...corsHeaders } })
        }
        const stream = fs.createReadStream(filePath, { start, end })
        return new Response(webStreamFromNode(stream), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            ...corsHeaders,
          },
        })
      }

      const stream = fs.createReadStream(filePath)
      return new Response(webStreamFromNode(stream), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(size),
          ...corsHeaders,
        },
      })
    } catch (e) {
      return new Response('Error: ' + e.message, { status: 500 })
    }
  })

  // ── Remote cover-art caching ────────────────────────────────────────────────
  // Cover images (a song's own art, the cover picker's thumbnails, and custom
  // covers pointing at /files/download/) load straight into <img> elements, so
  // they never pass through apiFetch and get none of apiCache's persistence.
  // Whether they're refetched on every render therefore comes down entirely to
  // what Cache-Control juicewrldapi.com sends — which for /files/download/ is
  // nothing, so scrolling a list re-downloaded full-size images every time.
  //
  // Rewriting those URLs to a custom protocol (the local-media:// approach
  // above) was the other option and was rejected: a cover URL isn't purely a
  // render-time value. It's persisted in songPrefs — synced to the server
  // profile and read by the web build, where a custom scheme means nothing —
  // and it's handed to the Media Session API, which drops any artwork src that
  // isn't http (see Player.tsx's artSrc). Injecting a max-age instead leaves
  // every URL canonical and lets Chromium's own disk cache, which already
  // survives restarts, do the work.
  //
  // Scoped to image/* 200s so audio streaming (same /files/download/ endpoint,
  // needs its Range/revalidation behaviour left alone) is never touched.
  const IMAGE_CACHE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://juicewrldapi.com/*'] },
    (details, callback) => {
      const headers = details.responseHeaders
      if (!headers || details.statusCode !== 200) return callback({ cancel: false })
      const typeKey = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type')
      const contentType = typeKey ? String(headers[typeKey]) : ''
      if (!contentType.toLowerCase().includes('image/')) return callback({ cancel: false })

      // Drop the server's own directives rather than appending to them — a
      // lingering `no-store`/`Pragma: no-cache` wins over anything we add.
      for (const k of Object.keys(headers)) {
        const lk = k.toLowerCase()
        if (lk === 'cache-control' || lk === 'pragma' || lk === 'expires') delete headers[k]
      }
      headers['Cache-Control'] = [`public, max-age=${IMAGE_CACHE_MAX_AGE}`]
      callback({ responseHeaders: headers })
    }
  )

  createWindow()
  if (isSmokeTest) return
  createTray()
  discordRpc.setEnabled(appSettings.discordRpcEnabled !== false)

  if (!isDev) {
    mainWindow.once('ready-to-show', () => runUpdateCheck('startup'))
    // Covers the app being left open for a long session (periodic) and a
    // laptop waking from sleep after the interval would've otherwise elapsed
    // unnoticed in the background — resume fires even if the OS suspended
    // the interval timer along with everything else while asleep.
    setInterval(() => runUpdateCheck('periodic'), UPDATE_CHECK_INTERVAL_MS)
    powerMonitor.on('resume', () => runUpdateCheck('resume from sleep'))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('before-quit', () => { isQuitting = true; skipCloseConfirm = true; discordRpc.setEnabled(false); globalShortcut.unregisterAll() })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Auto-updater events ───────────────────────────────────────────────────────
autoUpdater.on('checking-for-update', () => {
  log('Checking for update...')
  broadcastToWindows('update-status', { type: 'checking' })
})

autoUpdater.on('update-available', (info) => {
  log('Update available:', info.version)
  broadcastToWindows('update-status', { type: 'available', version: info.version })
})

autoUpdater.on('update-not-available', (info) => {
  log('Up to date:', info.version)
  isStartupUpdateCheck = false
  broadcastToWindows('update-status', { type: 'not-available', version: info.version })
})

autoUpdater.on('download-progress', (p) => {
  log(`Downloading update: ${Math.round(p.percent)}%`)
  broadcastToWindows('update-status', {
    type: 'downloading',
    percent: Math.round(p.percent),
    bytesPerSecond: Math.round(p.bytesPerSecond),
  })
})

// electron-builder's assisted (oneClick: false) NSIS installer only relaunches
// the app from its interactive Finish-page checkbox — the --force-run flag
// electron-updater passes on quitAndInstall(silent, forceRunAfter) is never
// read by the template in silent (/S) mode, so a silent install just quits
// and never comes back. Work around it ourselves: spawn a detached watcher
// before quitting that waits for this process to exit and for the installer
// to finish overwriting our exe (detected by the file becoming unlockable
// again), then starts the app back up.
function quitAndInstallSilently() {
  if (process.platform !== 'win32') {
    autoUpdater.quitAndInstall(true, true)
    return
  }
  const exePath = process.execPath
  const watcherPath = path.join(app.getPath('temp'), `unreleased-update-relaunch-${process.pid}.ps1`)
  const script = [
    `param([int]$AppPid, [string]$AppExePath, [int]$TimeoutSeconds = 120)`,
    `try { Wait-Process -Id $AppPid -ErrorAction SilentlyContinue -Timeout $TimeoutSeconds } catch {}`,
    `$deadline = (Get-Date).AddSeconds($TimeoutSeconds)`,
    `while ((Get-Date) -lt $deadline) {`,
    `  try { $s = [System.IO.File]::Open($AppExePath, 'Open', 'ReadWrite', 'None'); $s.Close(); break } catch { Start-Sleep -Milliseconds 400 }`,
    `}`,
    `Start-Sleep -Milliseconds 500`,
    `if (Test-Path $AppExePath) { Start-Process -FilePath $AppExePath }`,
    `Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue`,
  ].join('\n')
  try {
    fs.writeFileSync(watcherPath, script, 'utf-8')
    const child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', watcherPath, '-AppPid', String(process.pid), '-AppExePath', exePath,
    ], { detached: true, stdio: 'ignore' })
    child.unref()
  } catch (e) {
    log('Failed to spawn update relaunch watcher:', e.message)
  }
  autoUpdater.quitAndInstall(true, false)
}

autoUpdater.on('update-downloaded', (info) => {
  log('Update downloaded:', info.version)
  updateDownloadedPending = true
  broadcastToWindows('update-status', { type: 'downloaded', version: info.version })

  // At launch there's no in-progress work to interrupt — and this is also the
  // path that catches an update the user downloaded but declined to restart
  // into last time (checkForUpdatesAndNotify re-validates the cached
  // installer against latest.yml and fires this same event without
  // re-downloading). Install it now instead of prompting again.
  if (isStartupUpdateCheck) {
    isStartupUpdateCheck = false
    log('Update ready at launch — installing silently')
    quitAndInstallSilently()
    return
  }

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update ready',
    message: `Unreleased ${info.version} has been downloaded.`,
    detail: 'Restart the app to apply the update.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
  }).then(({ response }) => {
    // Silent install: the Windows installer is an assisted (wizard) installer
    // now, so a non-silent run here would pop the wizard mid-update. Relaunch
    // is handled ourselves — see quitAndInstallSilently.
    if (response === 0) quitAndInstallSilently()
  })
})

// electron-updater caches update artifacts under a dir keyed by package.json
// "name", not productName (see appInfo.js's updaterCacheDirName): the in-flight
// download in "pending", plus current.blockmap / installer.exe / package.7z at
// the root for differential downloads. If a check/download races a release
// that's still mid-upload, truncated files land here and every future check
// re-validates their hashes against the (by-then-correct) latest.yml and fails
// forever, since electron-updater never purges a bad cache on its own.
//
// We nuke the whole dir rather than just "pending" — a half-written blockmap or
// package.7z wedges the differential path the same way. Everything in here is
// re-fetchable, and this only runs after an error, so no live download is lost.
function clearUpdaterCache() {
  const base = process.platform === 'win32' ? (process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'))
    : process.platform === 'darwin' ? path.join(require('os').homedir(), 'Library', 'Caches')
    : (process.env.XDG_CACHE_HOME || path.join(require('os').homedir(), '.cache'))
  const cacheDir = path.join(base, 'unreleased-updater')
  try {
    fs.rmSync(cacheDir, { recursive: true, force: true })
    log('Cleared stale updater cache:', cacheDir)
  } catch (e) {
    log('Failed to clear updater cache:', e.message)
  }
}

// Only integrity failures mean the cache is the problem. Purging on *every*
// error threw away a perfectly good staged update whenever an unrelated check
// failed — e.g. a feed that answered with HTML, which has nothing to do with
// what's on disk but still wiped the pending installer and left
// autoInstallOnAppQuit with nothing to install.
function isCorruptCacheError(msg) {
  return /sha512|checksum|mismatch|corrupt|Unexpected end|unexpected end of/i.test(msg)
}

autoUpdater.on('error', (err) => {
  const msg = err.message || String(err)
  log('Auto-updater error:', msg)
  if (isCorruptCacheError(msg)) {
    clearUpdaterCache()
    updateDownloadedPending = false
  }

  // Beta feed isn't answering with a usable latest.yml → retry on stable rather
  // than surfacing a dead end the user can't clear from inside the app.
  if (activeBetaCode && !betaFallbackDone && isBetaFeedUnavailable(msg)) {
    betaFallbackDone = true
    log('Beta update feed unusable — falling back to the stable GitHub feed for this session')
    applyUpdateFeed(null)
    broadcastToWindows('update-status', { type: 'checking' })
    // activeBetaCode is null now, so a failure here takes the normal path below
    // instead of looping back into the fallback.
    autoUpdater.checkForUpdates().catch(e => log('Stable-feed retry failed:', e.message))
    return
  }

  isStartupUpdateCheck = false
  broadcastToWindows('update-status', { type: 'error', message: msg })
})
