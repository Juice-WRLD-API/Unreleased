// Desktop: the light round the screens, the player, playlist and clock on the desktop, and the desk cleared - on
// Windows. The main window stays the source of truth: it sends the Desktop settings and what's playing (desktop/
// bridge in the renderer), and everything the desktop's windows press or ask for goes back to it, so a press on the
// desktop player runs exactly the code the app's own buttons do.
const { ipcMain, screen, Menu } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
const { EdgeLights } = require('./light')
const { Widget, displayName } = require('./widgets')
const { ClearDesk } = require('./cleardesk')
const { closeHost } = require('./windows')
const { screenWatch } = require('./screenwatch')
const { fitOf } = require('./fit')
const frost = require('./frost')

/** How long the light stays after the music stops before it fades: a song changing, a moment paused. */
const LIGHT_LINGER_MS = 4000
/** How long a question to the main window waits for its answer. */
const REQUEST_TIMEOUT_MS = 10000

/**
 * @param {{ isDev: boolean, devUrl: string, distDir: string, getMainWindow: () => Electron.BrowserWindow | null,
 *   showMainWindow: () => void, log: (...args: unknown[]) => void, onChange?: () => void }} options
 */
function createDesktop(options) {
  const { isDev, devUrl, distDir, getMainWindow, showMainWindow, log } = options
  const pagePreload = path.join(__dirname, '..', 'desktopPreload.js')
  const pageUrl = (name) => (isDev ? `${devUrl}/desktop/${name}.html` : pathToFileURL(path.join(distDir, 'desktop', `${name}.html`)).href)
  const shared = { hostUrl: pageUrl('host'), preload: pagePreload }

  /** @type {any} the Desktop settings, from the main window */
  let settings = null
  /** @type {Record<string, unknown>} what's playing, as the main window last told it */
  const state = {}
  /** What each desktop window is, by its page. */
  /** @type {WeakMap<Electron.WebContents, { which: string, display?: Electron.Display }>} */
  const roles = new WeakMap()
  let lastPlayingAt = 0
  /** @type {NodeJS.Timeout | undefined} */
  let lingering
  /** @type {{ mode: string | null } | null} what the cleared desk draws behind the widgets, as the main window last
   *  told it (src/renderer/src/desktop/deskViz.ts); `mode` null for the wallpaper */
  let vizLook = null

  const main = () => {
    const win = getMainWindow()
    return win && !win.isDestroyed() ? win : null
  }
  const fromMain = (event) => event.sender === main()?.webContents

  const shownDisplays = () => {
    const hidden = new Set(settings?.hiddenDisplays || [])
    const shown = screen.getAllDisplays().filter((d) => !hidden.has(displayName(d)))
    return shown.length ? shown : [screen.getPrimaryDisplay()]
  }

  /** Everything a desktop window shows, sent as its page finishes loading: should its page have asked before the window
   *  was known to be one of ours, it isn't left without. */
  function greet(win) {
    win.webContents.on('did-finish-load', () => {
      if (win.isDestroyed()) return
      win.webContents.send('desktop:settings', { settings, fit: fitFor(win.webContents) })
      win.webContents.send('desktop:state', state)
      win.webContents.send('desktop:frost', frostNow())
      win.webContents.send('desktop:primary', screen.getPrimaryDisplay().bounds)
      win.webContents.send('desktop:clear-state', clear.isOn)
      sendHidden()
    })
  }

  const lights = new EdgeLights({
    pageUrl, preload: pagePreload, displays: shownDisplays,
    onWindow: (win, display) => { roles.set(win.webContents, { which: 'light', display }); greet(win) },
    onShown: (win) => clear.adopt(win),
  })

  const widgetOptions = (seeThrough = false) => ({
    pageUrl, shared, preload: pagePreload, seeThrough,
    settings: () => settings,
    displays: shownDisplays,
    onPlace: (which, place) => main()?.webContents.send('desktop:place', which, place),
    onWindow: (win, which) => { roles.set(win.webContents, { which }); greet(win); clear.adopt(win) },
  })
  const widgets = {
    player: new Widget('player', widgetOptions(true)),
    playlist: new Widget('playlist', widgetOptions()),
    clock: new Widget('clock', widgetOptions()),
  }
  const widgetWindows = () => Object.values(widgets).map((w) => w.window).filter((w) => w && !w.isDestroyed())

  const clear = new ClearDesk({
    pageUrl, shared, preload: pagePreload,
    widgets: () => /** @type {Electron.BrowserWindow[]} */ (widgetWindows()),
    lights: () => lights.windows,
    wallpaper: () => frost.wallpaperUrl(),
    viz: () => vizLook,
    onWindow: (win) => roles.set(win.webContents, { which: 'curtain' }),
  })
  clear.on('change', (on) => {
    broadcast('desktop:clear-state', on)
    broadcast('desktop:frost', frostNow())
    main()?.webContents.send('desktop:clear-state', on)
    throttleMain()
    options.onChange?.()
  })
  // An app on every display: nothing to clear. Said on the player, and in the app should the press have been there.
  clear.on('refused', () => {
    const title = 'Nothing to clear'
    const detail = screen.getAllDisplays().length > 1 ? 'Every display has an app open on it' : 'An app is open on the display'
    const player = widgets.player.window
    if (player && !player.isDestroyed()) player.webContents.send('desktop:notice', { title, detail })
    const win = main()
    if (win?.isVisible() && !win.isMinimized()) win.webContents.send('desktop:command', 'notice', `${title}: ${detail.toLowerCase()}`)
  })

  /** The widgets' glass shows the wallpaper behind them, blurred - but over the cleared desk's visualizer, a glass of
   *  its own, as in the WRLD tab. */
  const frostNow = () => (clear.isOn && vizLook?.mode ? null : frost.frostUrl())

  /** Every desktop window there is now. */
  const pages = () => [...lights.windows, ...widgetWindows()].filter((w) => w && !w.isDestroyed())

  function fitFor(webContents) {
    const role = roles.get(webContents)
    if (!role) return 1
    if (role.display) return fitOf(role.display)
    const widget = widgets[role.which]
    return widget ? widget.fit() : 1
  }

  function broadcast(channel, value) {
    for (const win of pages()) win.webContents.send(channel, value)
  }

  function sendSettings() {
    for (const win of pages()) win.webContents.send('desktop:settings', { settings, fit: fitFor(win.webContents) })
  }

  // ---- the light ----

  /** The light shows while a song plays, and a moment after; and, set to show only on the desktop, only then. */
  function updateLight() {
    clearTimeout(lingering)
    const on = Boolean(settings?.light?.isOn)
    if (state.playing) lastPlayingAt = Date.now()
    const recent = Date.now() - lastPlayingAt < LIGHT_LINGER_MS
    lights.want(on && (Boolean(state.playing) || recent))
    if (on && !state.playing && recent) lingering = setTimeout(updateLight, LIGHT_LINGER_MS - (Date.now() - lastPlayingAt) + 50)
    screenWatch.need('light', on && Boolean(settings?.light?.onlyOnDesktop))
    sendHidden()
  }

  function sendHidden() {
    const hidden = Boolean(settings?.light?.onlyOnDesktop) && !screenWatch.desktopInFront() && !clear.isOn
    for (const win of lights.windows) win.webContents.send('desktop:hidden', hidden)
  }
  screenWatch.on('front', sendHidden)

  // ---- applying the settings ----

  /** The main window drives the desktop's windows and feeds the cleared desk's visualizer, and it's usually hidden
   *  while they're in use: its timers mustn't be held back meanwhile. */
  function throttleMain() {
    const anyWidget = Object.keys(widgets).some((which) => settings?.[which]?.isOn)
    main()?.webContents.setBackgroundThrottling(!(anyWidget || settings?.light?.isOn || clear.isOn))
  }

  let lastDisplays = ''
  function applyAll() {
    if (!settings) return
    const anyWidget = Object.keys(widgets).some((which) => settings[which]?.isOn)
    if (anyWidget) frost.start()
    // Where the apps' windows are, known before the widgets' clear button is pressed: the desk then clears at once.
    screenWatch.need('widgets', anyWidget)
    throttleMain()
    const displays = JSON.stringify(shownDisplays().map((d) => [d.id, d.bounds]))
    if (displays !== lastDisplays) { lastDisplays = displays; lights.rebuild() }
    updateLight()
    for (const widget of Object.values(widgets)) widget.apply()
    sendSettings()
  }

  const onDisplays = () => {
    lastDisplays = ''
    applyAll()
  }
  screen.on('display-added', onDisplays)
  screen.on('display-removed', onDisplays)
  screen.on('display-metrics-changed', onDisplays)
  frost.on('change', () => broadcast('desktop:frost', frostNow()))
  const onPrimary = () => broadcast('desktop:primary', screen.getPrimaryDisplay().bounds)
  screen.on('display-metrics-changed', onPrimary)

  // ---- asking the main window ----

  let asked = 0
  /** @type {Map<number, (value: unknown) => void>} */
  const waiting = new Map()
  function ask(kind, arg) {
    const win = main()
    if (!win) return Promise.resolve(null)
    const id = ++asked
    return new Promise((resolve) => {
      const timer = setTimeout(() => { waiting.delete(id); resolve(null) }, REQUEST_TIMEOUT_MS)
      waiting.set(id, (value) => { clearTimeout(timer); waiting.delete(id); resolve(value) })
      win.webContents.send('desktop:request', id, kind, arg)
    })
  }

  /** A press on a desktop window (or a row of its menu), for the main window to act on - but the desk, which is ours. */
  function command(cmd, arg) {
    if (cmd === 'clear') { clear.set(arg === undefined ? undefined : Boolean(arg)); return }
    if (cmd === 'open-app' || cmd === 'open-settings' || cmd === 'song-info' || cmd === 'edit-song') showMainWindow()
    main()?.webContents.send('desktop:command', cmd, arg)
  }

  /** The system's menu from a widget's menu as the main window describes it (src/renderer/src/desktop/widgetMenu.ts).
   *  @returns {Electron.MenuItemConstructorOptions[]} */
  function menuTemplate(entries) {
    if (!Array.isArray(entries)) return []
    return entries.map((e) => {
      if (e === 'divider' || !e || typeof e !== 'object') return /** @type {Electron.MenuItemConstructorOptions} */ ({ type: 'separator' })
      /** @type {Electron.MenuItemConstructorOptions} */
      const item = { label: String(e.label ?? '').replace(/&/g, '&&'), enabled: !e.disabled }
      if (Array.isArray(e.children)) item.submenu = menuTemplate(e.children)
      else if (typeof e.checked === 'boolean') { item.type = e.radio ? 'radio' : 'checkbox'; item.checked = e.checked }
      if (typeof e.cmd === 'string') { const { cmd, arg } = e; item.click = () => command(cmd, arg) }
      return item
    })
  }

  /** A widget right-clicked: its menu at the pointer (the lyrics' own, for `part` 'lyrics'). */
  async function showMenu(which, part) {
    const win = widgets[which]?.window
    const entries = await ask('widget-menu', { which, isClear: clear.isOn, part })
    if (!entries || !win || win.isDestroyed()) return
    Menu.buildFromTemplate(menuTemplate(entries)).popup({ window: win })
  }

  // ---- from the main window ----

  const handlers = {
    'desktop:settings': (event, next) => {
      if (!fromMain(event) || !next || typeof next !== 'object') return
      settings = next
      applyAll()
      options.onChange?.()
    },
    'desktop:state': (event, patch) => {
      if (!fromMain(event) || !patch || typeof patch !== 'object') return
      Object.assign(state, patch)
      broadcast('desktop:state', patch)
      if ('playing' in patch) updateLight()
    },
    'desktop:meter': (event, value) => {
      if (!fromMain(event)) return
      for (const win of lights.windows) win.webContents.send('desktop:meter', value)
      const player = widgets.player.window
      if (player && !player.isDestroyed()) player.webContents.send('desktop:meter', value)
    },
    'desktop:clear': (event, on) => {
      if (fromMain(event)) clear.set(on === null ? undefined : on)
    },
    'desktop:viz-look': (event, look) => {
      if (!fromMain(event) || !look || typeof look !== 'object') return
      const wasShown = Boolean(vizLook?.mode)
      vizLook = { ...look, mode: typeof look.mode === 'string' ? look.mode : null }
      clear.send('desktop:curtain-viz', vizLook)
      if (clear.isOn && Boolean(vizLook.mode) !== wasShown) broadcast('desktop:frost', frostNow())
    },
    'desktop:viz-frame': (event, frame) => {
      if (fromMain(event) && frame instanceof Float32Array) clear.send('desktop:curtain-frame', frame)
    },
    'desktop:reply': (event, id, value) => {
      if (fromMain(event)) waiting.get(id)?.(value)
    },
    // ---- from the desktop's pages ----
    'desktop:command': (event, cmd, arg) => {
      if (roles.has(event.sender) && typeof cmd === 'string') command(cmd, arg)
    },
    'desktop:menu': (event, part) => {
      const role = roles.get(event.sender)
      if (role && widgets[role.which]) void showMenu(role.which, part === 'lyrics' ? 'lyrics' : undefined)
    },
    'desktop:solid': (event, on) => { const role = roles.get(event.sender); if (role) widgets[role.which]?.solid(Boolean(on)) },
    'desktop:drag': (event, phase) => { const role = roles.get(event.sender); if (role) widgets[role.which]?.dragPhase(phase) },
    'desktop:keys': (event, on) => { const role = roles.get(event.sender); if (role) widgets[role.which]?.keys(Boolean(on)) },
    'desktop:size': (event, size) => { const role = roles.get(event.sender); if (role) widgets[role.which]?.resize(size) },
    'desktop:curtain-opened': (event) => clear.opened(event.sender),
  }
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.on(channel, handler)

  const invokers = {
    'desktop:displays': () => {
      const primary = screen.getPrimaryDisplay().id
      return screen.getAllDisplays().map((d) => ({ label: displayName(d), primary: d.id === primary }))
    },
    'desktop:page-hello': (event) => {
      const role = roles.get(event.sender)
      if (!role) return null
      return { which: role.which, settings, state, fit: fitFor(event.sender), frost: frostNow(), isClear: clear.isOn,
        // The frost is the main display's wallpaper: where that display lies, for the glass to line it up.
        primary: screen.getPrimaryDisplay().bounds,
        hidden: Boolean(settings?.light?.onlyOnDesktop) && !screenWatch.desktopInFront() && !clear.isOn }
    },
    'desktop:request': (event, kind, arg) => (roles.has(event.sender) && typeof kind === 'string' ? ask(kind, arg) : null),
  }
  for (const [channel, handler] of Object.entries(invokers)) ipcMain.handle(channel, handler)

  log('[desktop] ready')
  let disposed = false

  return {
    /** The main window is gone for good (the app quitting): every desktop window goes with it. */
    dispose() {
      if (disposed) return
      disposed = true
      for (const channel of Object.keys(handlers)) ipcMain.removeAllListeners(channel)
      for (const channel of Object.keys(invokers)) ipcMain.removeHandler(channel)
      screen.removeListener('display-added', onDisplays)
      screen.removeListener('display-removed', onDisplays)
      screen.removeListener('display-metrics-changed', onDisplays)
      screen.removeListener('display-metrics-changed', onPrimary)
      lights.close()
      for (const widget of Object.values(widgets)) widget.hide()
      clear.dispose()
      screenWatch.need('light', false)
      screenWatch.need('widgets', false)
      closeHost()
    },
    /** Clears the desk, or brings it all back (the tray, the hotkeys); undefined turns it over. */
    toggleClear: (on) => clear.set(on),
    get isClear() { return clear.isOn },
    /** The Desktop settings as the main window last sent them (the tray's ticks). */
    get settings() { return settings },
    /** A setting changed from outside the main window (the tray): the main window keeps it, and sends it back. */
    set(patch) { main()?.webContents.send('desktop:command', 'set', patch) },
  }
}

module.exports = { createDesktop }
