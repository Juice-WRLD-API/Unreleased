const { contextBridge, ipcRenderer, webUtils } = require('electron')

// electron:dev only: mirror the installed app's file:// localStorage into the
// dev server's origin before the app's scripts run (see main.js
// readInstalledLocalStorage). Main hands it out once per launch; null means
// nothing to copy, so dev keeps whatever it already has.
if (location.origin === 'http://localhost:3018') {
  const seed = ipcRenderer.sendSync('dev-storage-seed')
  if (seed) {
    try {
      localStorage.clear()
      for (const [k, v] of seed) localStorage.setItem(k, v)
    } catch (err) {
      console.warn('[dev-seed] could not copy installed app storage', err)
    }
  }
}

contextBridge.exposeInMainWorld('electron', {
  // Window controls
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  forceUpdate:     () => ipcRenderer.invoke('force-update'),
  installUpdate:   () => ipcRenderer.invoke('install-update'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow:    () => ipcRenderer.invoke('close-window'),
  relaunchApp:    () => ipcRenderer.invoke('relaunch-app'),
  isMaximized:    () => ipcRenderer.invoke('is-maximized'),
  setFullscreen:  (value) => ipcRenderer.invoke('set-fullscreen', value),
  isFullscreen:   ()      => ipcRenderer.invoke('is-fullscreen'),
  toggleDevTools: ()      => ipcRenderer.invoke('toggle-devtools'),
  onFullscreenChange: (cb) => {
    const fn = (_, v) => cb(v)
    ipcRenderer.on('fullscreen-changed', fn)
    return () => ipcRenderer.removeListener('fullscreen-changed', fn)
  },
  platform: process.platform,
  getRuntimePlatform: () => ipcRenderer.invoke('get-runtime-platform'),

  // Floating pop-out windows (see main.js createFloatWindow). The *Self
  // variants act on whichever window called them — pop-outs must not use
  // closeWindow/minimizeWindow/maximizeWindow, which target the main window.
  openFloatWindow: (view, params) => ipcRenderer.invoke('open-float-window', view, params),
  toggleFloatWindow: (view, params) => ipcRenderer.invoke('toggle-float-window', view, params),
  closeFloatWindows: ()   => ipcRenderer.invoke('close-float-windows'),
  getFloatWindows: ()     => ipcRenderer.invoke('get-float-windows'),
  closeSelf:       ()     => ipcRenderer.invoke('close-self'),

  // OS-global shortcuts. The renderer sends the full desired set (accelerator →
  // action id); main re-registers atomically and pushes the fired action id
  // back over 'global-shortcut'. Sending [] clears them all.
  registerGlobalShortcuts: (entries) => ipcRenderer.invoke('register-global-shortcuts', entries),
  onGlobalShortcut: (cb) => {
    const fn = (_, id) => cb(id)
    ipcRenderer.on('global-shortcut', fn)
    return () => ipcRenderer.removeListener('global-shortcut', fn)
  },
  minimizeSelf:    ()     => ipcRenderer.invoke('minimize-self'),
  maximizeSelf:    ()     => ipcRenderer.invoke('maximize-self'),
  focusMainWindow: ()     => ipcRenderer.invoke('focus-main-window'),
  // Mini player: panel expand/collapse resizes the window; pin toggles
  // always-on-top and returns the new state; hideOtherWindows closes the
  // other pop-outs and hides the main window off the taskbar ("solo" mode).
  miniPlayerSetExpanded: (expanded) => ipcRenderer.invoke('mini-player-set-expanded', expanded),
  toggleAlwaysOnTopSelf: ()         => ipcRenderer.invoke('toggle-always-on-top-self'),
  hideOtherWindows:      ()         => ipcRenderer.invoke('hide-other-windows'),
  windowSyncSend:  (msg)  => ipcRenderer.send('window-sync', msg),
  onWindowSync: (cb) => {
    const fn = (_, msg) => cb(msg)
    ipcRenderer.on('window-sync', fn)
    return () => ipcRenderer.removeListener('window-sync', fn)
  },
  // Which pop-out views are currently open — fires on every open/close so a
  // window can avoid showing an in-app copy of an already-popped-out view.
  onFloatWindows: (cb) => {
    const fn = (_, views) => cb(views)
    ipcRenderer.on('float-windows', fn)
    return () => ipcRenderer.removeListener('float-windows', fn)
  },
  // Fired when an already-open pop-out is asked to show something new
  // (e.g. "Info" clicked on a different song).
  onFloatParams: (cb) => {
    const fn = (_, params) => cb(params)
    ipcRenderer.on('float-params', fn)
    return () => ipcRenderer.removeListener('float-params', fn)
  },

  // Local filesystem
  browseLocal: (dirPath, opts) => ipcRenderer.invoke('browse-local', dirPath, opts),
  pickFolder:  ()        => ipcRenderer.invoke('pick-folder'),
  openPath:    (p)       => ipcRenderer.invoke('open-path', p),
  // Reveals a file/folder in Explorer/Finder without ever launching it —
  // what every "show in folder" button actually wants, as opposed to openPath
  // above (which hands the path to the OS's default-app launcher).
  showItemInFolder: (p)  => ipcRenderer.invoke('show-item-in-folder', p),
  // Local file management, used by Files > Local. The name is validated and
  // resolved against its parent in main, so it can't escape the folder.
  // localCreate/localRename resolve { ok, path } | { error }; localDelete
  // takes one path or a list, prompts once and trashes, resolving
  // { ok, failed? } | { canceled } | { error }.
  // Reads a text file for the in-app viewer, capped at 2 MB. Resolves
  // { ok, text, truncated, size } | { error }.
  readTextFile: (filePath)           => ipcRenderer.invoke('read-text-file', filePath),
  localCreate: (dirPath, name, kind) => ipcRenderer.invoke('local-create', dirPath, name, kind),
  localRename: (filePath, name)      => ipcRenderer.invoke('local-rename', filePath, name),
  localDelete: (paths)               => ipcRenderer.invoke('local-delete', paths),
  // Opens an OS file picker and copies the chosen file(s) into dirPath.
  // Resolves { ok, paths } | { canceled }.
  localUpload: (dirPath)             => ipcRenderer.invoke('local-upload', dirPath),
  selectImageFile: ()    => ipcRenderer.invoke('select-image-file'),
  fetchImageAsDataUrl: (url) => ipcRenderer.invoke('fetch-image-as-data-url', url),
  fetchImageBytes: (url) => ipcRenderer.invoke('fetch-image-bytes', url),
  openDiscordLogin: (url) => ipcRenderer.invoke('open-discord-login', url),
  // Passkeys: whether this OS can show the prompt, and the prompt itself in
  // its own player.juicewrldapi.com window (see passkey.js). Resolves
  // { ok, credential } | { cancelled } | { error }.
  passkeySupport: () => ipcRenderer.invoke('passkey-support'),
  passkeyCeremony: (req) => ipcRenderer.invoke('passkey-ceremony', req),

  // App settings
  getAppSettings:  ()           => ipcRenderer.invoke('get-app-settings'),
  setAppSetting:   (key, value) => ipcRenderer.invoke('set-app-setting', key, value),

  // Beta channel
  betaGetStatus: ()     => ipcRenderer.invoke('beta-get-status'),
  betaJoin:      (code) => ipcRenderer.invoke('beta-join', code),
  betaLeave:     ()     => ipcRenderer.invoke('beta-leave'),

  // Run/crash logging — fire-and-forget breadcrumbs into the run log
  runLog:        (scope, message) => ipcRenderer.send('run-log', scope, message),
  openLogsFolder: ()             => ipcRenderer.invoke('open-logs-folder'),
  openOnlineInstaller: ()        => ipcRenderer.invoke('open-online-installer'),
  getLogPaths:   ()              => ipcRenderer.invoke('get-log-paths'),
  // Chromium's HTTP cache (cover art) — separate from apiCache's localStorage
  // JSON cache, so Settings' "Clear cache" clears both.
  clearImageCache: ()            => ipcRenderer.invoke('clear-image-cache'),

  // Tray — playback state up to main, media commands back down
  setTrayPlayback: (state) => ipcRenderer.send('tray-playback-state', state),
  onTrayCommand: (cb) => {
    const fn = (_, cmd) => cb(cmd)
    ipcRenderer.on('tray-command', fn)
    return () => ipcRenderer.removeListener('tray-command', fn)
  },

  // Desktop (electron/desktop, Windows): the light round the screens and the desktop widgets, driven from the main
  // window - its settings and what's playing go out, the widgets' presses and questions come back.
  desktop: {
    setSettings: (settings) => ipcRenderer.send('desktop:settings', settings),
    setState: (patch) => ipcRenderer.send('desktop:state', patch),
    meter: (value) => ipcRenderer.send('desktop:meter', value),
    vizLook: (look) => ipcRenderer.send('desktop:viz-look', look),
    vizFrame: (frame) => ipcRenderer.send('desktop:viz-frame', frame),
    displays: () => ipcRenderer.invoke('desktop:displays'),
    clearDesk: (on) => ipcRenderer.send('desktop:clear', on === undefined ? null : Boolean(on)),
    reply: (id, value) => ipcRenderer.send('desktop:reply', id, value),
    onCommand: (cb) => {
      const fn = (_, cmd, arg) => cb(cmd, arg)
      ipcRenderer.on('desktop:command', fn)
      return () => ipcRenderer.removeListener('desktop:command', fn)
    },
    onRequest: (cb) => {
      const fn = (_, id, kind, arg) => cb(id, kind, arg)
      ipcRenderer.on('desktop:request', fn)
      return () => ipcRenderer.removeListener('desktop:request', fn)
    },
    onPlace: (cb) => {
      const fn = (_, which, place) => cb(which, place)
      ipcRenderer.on('desktop:place', fn)
      return () => ipcRenderer.removeListener('desktop:place', fn)
    },
    onClearState: (cb) => {
      const fn = (_, on) => cb(on)
      ipcRenderer.on('desktop:clear-state', fn)
      return () => ipcRenderer.removeListener('desktop:clear-state', fn)
    },
  },

  // Discord Rich Presence
  discordRpcSetActivity: (activity) => ipcRenderer.invoke('discord-rpc-set-activity', activity),
  discordRpcClearActivity: ()       => ipcRenderer.invoke('discord-rpc-clear-activity'),

  // Library
  loadLibraryData:    ()              => ipcRenderer.invoke('load-library-data'),
  saveLibraryData:    (data)          => ipcRenderer.invoke('save-library-data', data),
  scanLibrary:        (folders, previousTracks) => ipcRenderer.invoke('scan-library', folders, previousTracks),
  readAlbumArt:       (filePath, maxSize) => ipcRenderer.invoke('read-album-art', filePath, maxSize),
  readTrackMetadata:  (filePath)      => ipcRenderer.invoke('read-track-metadata', filePath),
  writeTrackMetadata: (filePath, meta) => ipcRenderer.invoke('write-track-metadata', filePath, meta),
  downloadToLibrary:  (payload)       => ipcRenderer.invoke('download-to-library', payload),
  // Prompts (in the main process) and moves the file to the OS trash.
  // Resolves { ok } | { canceled } | { error }.
  deleteLibraryFile:  (filePath)      => ipcRenderer.invoke('delete-library-file', filePath),
  // Copy/move prompt for a destination folder first. Both resolve
  // { ok, path } | { canceled } | { error }; `path` is the new file's location.
  copyLibraryFile:    (filePath)      => ipcRenderer.invoke('copy-library-file', filePath),
  moveLibraryFile:    (filePath)      => ipcRenderer.invoke('move-library-file', filePath),
  // copyFileToClipboard puts the actual file on the clipboard (paste into
  // Explorer/Finder); on Linux it falls back to the path and reports
  // { fallback: 'path' }.
  copyFileToClipboard: (filePath)     => ipcRenderer.invoke('copy-file-to-clipboard', filePath),
  copyTextToClipboard: (text)         => ipcRenderer.invoke('copy-text-to-clipboard', text),
  // Cover art, as bytes the renderer already fetched (see lib/coverImage.ts):
  // copyImageToClipboard wants a PNG data URL; saveImageFile takes any image
  // data URL plus the filename to offer, and resolves { ok, path } | { canceled }.
  copyImageToClipboard: (dataUrl)     => ipcRenderer.invoke('copy-image-to-clipboard', dataUrl),
  saveImageFile:       (payload)      => ipcRenderer.invoke('save-image-file', payload),

  // On-demand tool binaries (ffmpeg / yt-dlp): downloaded into userData/bin on
  // first use instead of shipping ~100 MB with every install.
  // toolsStatus resolves { ffmpeg: bool, ytdlp: bool }; toolsDownload fetches
  // the given tools ({ tools?: ['ffmpeg'|'ytdlp'], force?: bool }, default =
  // whichever are missing) and resolves { ok } | { error }. Progress arrives on
  // 'tools-download-progress' as { tool, percent, received, total, done }.
  toolsStatus:   ()     => ipcRenderer.invoke('tools-status'),
  toolsDownload: (opts) => ipcRenderer.invoke('tools-download', opts),
  onToolsDownloadProgress: (cb) => {
    const fn = (_, d) => cb(d)
    ipcRenderer.on('tools-download-progress', fn)
    return () => ipcRenderer.removeListener('tools-download-progress', fn)
  },

  // Local audio format conversion (on-demand ffmpeg). Progress arrives on
  // 'convert-progress' keyed by the id passed into convertAudio.
  convertAudio: (payload) => ipcRenderer.invoke('convert-audio', payload),
  onConvertProgress: (cb) => {
    const fn = (_, d) => cb(d)
    ipcRenderer.on('convert-progress', fn)
    return () => ipcRenderer.removeListener('convert-progress', fn)
  },

  // Import audio from any URL — a direct file link is downloaded as-is, any
  // other link goes through yt-dlp (YouTube, SoundCloud, Bandcamp, …) with
  // ffmpeg for extraction. Progress arrives on 'url-import-progress' keyed by
  // the id passed into urlImport.
  // Resolves { track, outPath } | { error, needsUpdate? } | { warning }.
  urlImport: (payload) => ipcRenderer.invoke('url-import', payload),
  onUrlImportProgress: (cb) => {
    const fn = (_, d) => cb(d)
    ipcRenderer.on('url-import-progress', fn)
    return () => ipcRenderer.removeListener('url-import-progress', fn)
  },
  // Checks whether the yt-dlp/ffmpeg binaries are present (gates the dialog on
  // the one-time download page when they aren't).
  // Resolves { available: true } | { available: false, reason, missing }.
  urlImportStatus: () => ipcRenderer.invoke('url-import-status'),

  // Local playlists
  loadLocalPlaylists: ()          => ipcRenderer.invoke('load-local-playlists'),
  saveLocalPlaylists: (playlists) => ipcRenderer.invoke('save-local-playlists', playlists),
  // M3U import/export. importM3u resolves { ok, name, entries:[{path,title,duration}] }
  // | { canceled } | { error }; exportM3u resolves { ok, path } | { canceled } | { error }.
  importM3u: ()                   => ipcRenderer.invoke('import-m3u'),
  exportM3u: (payload)            => ipcRenderer.invoke('export-m3u', payload),
  // Parse an .m3u dropped onto the window (path from getPathForFile), same
  // shape as importM3u. importTextLines resolves { ok, name, lines } | … for a
  // titles text file; the renderer resolves each line against the API.
  readM3uPath: (filePath)         => ipcRenderer.invoke('read-m3u-path', filePath),
  importTextLines: ()             => ipcRenderer.invoke('import-text-lines'),
  readTextLinesPath: (filePath)   => ipcRenderer.invoke('read-text-lines-path', filePath),
  // Electron 32+ removed File.path; this is the supported way to get the real
  // filesystem path of a dragged-in File for the main process to read.
  getPathForFile: (file)          => webUtils.getPathForFile(file),

  // Offline playlist sync
  offlineGetLibrary:    ()                        => ipcRenderer.invoke('offline-get-library'),
  offlineGetStats:      ()                        => ipcRenderer.invoke('offline-get-stats'),
  offlineDownloadTrack: (payload)                  => ipcRenderer.invoke('offline-download-track', payload),
  offlineRemoveTrack:   (id)                       => ipcRenderer.invoke('offline-remove-track', id),
  offlineUpdateTrackMeta: (id, patch)              => ipcRenderer.invoke('offline-update-track-meta', id, patch),
  offlineSetPlaylist:   (key, songIds, name)        => ipcRenderer.invoke('offline-set-playlist', key, songIds, name),
  offlineRemovePlaylist: (key)                     => ipcRenderer.invoke('offline-remove-playlist', key),
  offlineSetLibraryPath: (newPath)                 => ipcRenderer.invoke('offline-set-library-path', newPath),
  offlineCancelDownloads: (ids)                    => ipcRenderer.invoke('offline-cancel-downloads', ids),
  offlineGetTrackSizes: ()                         => ipcRenderer.invoke('offline-get-track-sizes'),
  offlineGetDiskSpace:  ()                         => ipcRenderer.invoke('offline-get-disk-space'),
  onOfflineDownloadProgress: (cb) => {
    const fn = (_, d) => cb(d)
    ipcRenderer.on('offline-download-progress', fn)
    return () => ipcRenderer.removeListener('offline-download-progress', fn)
  },

  // WrldData (albums JSON)
  loadWrldData: ()       => ipcRenderer.invoke('load-wrlddata'),
  saveWrldData: (data)   => ipcRenderer.invoke('save-wrlddata', data),

  // Update status events (returns cleanup fn)
  onUpdateStatus: (cb) => {
    const fn = (_, d) => cb(d)
    ipcRenderer.on('update-status', fn)
    return () => ipcRenderer.removeListener('update-status', fn)
  },

  // Download events (returns cleanup fn)
  onDownloadStarted: (cb) => {
    const fn = (_, d) => cb(d)
    ipcRenderer.on('download-started', fn)
    return () => ipcRenderer.removeListener('download-started', fn)
  },
  onDownloadProgress: (cb) => {
    const fn = (_, d) => cb(d)
    ipcRenderer.on('download-progress', fn)
    return () => ipcRenderer.removeListener('download-progress', fn)
  },
  onDownloadDone: (cb) => {
    const fn = (_, d) => cb(d)
    ipcRenderer.on('download-done', fn)
    return () => ipcRenderer.removeListener('download-done', fn)
  },
})
