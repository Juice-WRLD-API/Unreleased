// VST3 plug-ins for the Session Maker. Web Audio can't load them, so the work goes to
// native/vsthost (built into build/vsthost, shipped as resources/vsthost.exe).
// Native Session Maker playback has one persistent helper; exports, scans, and
// editor windows remain isolated jobs so their failures cannot crash Electron.
//
//   vst-available      whether plug-ins can be used here
//   vst-scan           the installed effects, cached by module and re-checked when one changes
//   vst-add-folder     pick another folder to look in, then scan
//   vst-remove-folder  stop looking in one of those
//   vst-set-hidden     hide plug-ins from the Session Maker's lists, or bring them back
//   vst-open-folder    open a plug-in folder in Explorer; vst-show-module shows one module
//   Every change to the list goes out to all windows as 'vst-plugins'.
//   vst-process        run audio through a chain of plug-ins (offline, latency trimmed)
//   vst-edit-open      open a plug-in's own window; its state comes back as 'vst-editor' events
//   vst-edit-close     close one
//   vst-edit-param     generic editors (req.generic): set one parameter; 'params'/'param' events carry the list and changes

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const SCAN_TIMEOUT = 20000
const SCAN_PARALLEL = 3

function register({ app, ipcMain, dialog, shell, BrowserWindow, openControls }) {
  const helper = () => {
    if (process.platform !== 'win32') return null
    const p = app.isPackaged
      ? path.join(process.resourcesPath, 'vsthost.exe')
      : path.join(__dirname, '..', 'build', 'vsthost', 'vsthost.exe')
    return fs.existsSync(p) ? p : null
  }
  // userData/vst-plugins.json: what each module held when last scanned (keyed by path,
  // re-scanned when its size or date changes), extra folders to look in, and the
  // plug-ins hidden from the lists ("path|cid").
  const cacheFile = () => path.join(app.getPath('userData'), 'vst-plugins.json')
  const readCache = () => {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
      return {
        modules: c.modules || {},
        folders: Array.isArray(c.folders) ? c.folders : [],
        hidden: Array.isArray(c.hidden) ? c.hidden : [],
        scannedAt: c.scannedAt || null,
      }
    } catch { return { modules: {}, folders: [], hidden: [], scannedAt: null } }
  }
  const writeCache = (c) => { try { fs.writeFileSync(cacheFile(), JSON.stringify(c)) } catch {} }
  /** The folders Windows plug-in installers use - always looked in. */
  const standardFolders = () => [
    path.join(process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files', 'VST3'),
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'Common', 'VST3')] : []),
  ]

  /** Runs the helper and collects stdout. Resolves with what it printed, even on a crash. */
  const run = (args, input, timeout) => new Promise((resolve) => {
    const exe = helper()
    if (!exe) return resolve({ out: Buffer.alloc(0), code: -1, error: 'The plug-in host is missing' })
    const child = spawn(exe, args, { windowsHide: true })
    const chunks = []
    let killed = false
    const timer = timeout ? setTimeout(() => { killed = true; child.kill() }, timeout) : null
    child.stdout.on('data', (d) => chunks.push(d))
    child.stderr.on('data', () => {})
    child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ out: Buffer.alloc(0), code: -1, error: e.message }) })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ out: Buffer.concat(chunks), code, error: killed ? 'Took too long' : null })
    })
    child.stdin.on('error', () => {})
    if (input) for (const part of input) child.stdin.write(part)
    child.stdin.end()
  })
  const firstLine = (buf) => {
    const nl = buf.indexOf(10)
    try { return { head: JSON.parse(buf.subarray(0, nl < 0 ? buf.length : nl).toString('utf8')), rest: nl < 0 ? Buffer.alloc(0) : buf.subarray(nl + 1) } } catch { return { head: null, rest: Buffer.alloc(0) } }
  }

  /** Every .vst3 under a folder - a bundle folder or a plain file counts as one. */
  const findModules = (dir, out = [], depth = 0) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.name.toLowerCase().endsWith('.vst3')) out.push(p)
      else if (e.isDirectory() && depth < 6) findModules(p, out, depth + 1)
    }
    return out
  }

  const scan = async (force) => {
    const cache = readCache()
    const listed = firstLine((await run(['list'], null, SCAN_TIMEOUT)).out).head
    const paths = [...new Set([...(Array.isArray(listed) ? listed : []), ...cache.folders.flatMap((f) => findModules(f))].map((p) => path.normalize(p)))]
    const modules = {}
    const todo = []
    for (const p of paths) {
      let st
      try { st = fs.statSync(p) } catch { continue }
      const stamp = `${st.size}:${st.mtimeMs}`
      const had = cache.modules[p]
      if (!force && had && had.stamp === stamp) modules[p] = had
      else todo.push({ p, stamp })
    }
    const next = async () => {
      const job = todo.shift()
      if (!job) return
      const res = await run(['scan', job.p], null, SCAN_TIMEOUT)
      const head = firstLine(res.out).head
      modules[job.p] = head && head.ok
        ? { stamp: job.stamp, classes: head.classes || [] }
        : { stamp: job.stamp, classes: [], error: (head && head.error) || res.error || `The scan crashed (${res.code})` }
      await next()
    }
    await Promise.all(Array.from({ length: SCAN_PARALLEL }, next))
    // Folders and hidden plug-ins may have changed while it ran.
    writeCache({ ...readCache(), modules, scannedAt: Date.now() })
  }
  /** Scans after any scan already running, so a folder added mid-scan is still looked in. */
  let scanning = null
  const rescan = (force) => {
    const settled = (scanning || Promise.resolve())
      .then(() => scan(force))
      .catch(() => {})
      .then(() => { if (scanning === settled) scanning = null })
    scanning = settled
    // After it's cleared, so the list that goes out no longer says it's scanning.
    return settled.then(changed)
  }

  const listing = () => {
    const cache = readCache()
    const hidden = new Set(cache.hidden)
    const plugins = []
    const failed = []
    for (const [p, m] of Object.entries(cache.modules)) {
      if (m.error) failed.push({ path: p, error: m.error })
      for (const c of m.classes) {
        // Instruments need notes; the Session Maker only has audio to give them.
        if (/instrument/i.test(c.sub || '') && !/fx/i.test(c.sub || '')) continue
        plugins.push({ path: p, cid: c.cid, name: c.name, vendor: c.vendor || '', version: c.version || '', sub: c.sub || '', hidden: hidden.has(`${p}|${c.cid}`) })
      }
    }
    plugins.sort((a, b) => a.name.localeCompare(b.name))
    failed.sort((a, b) => a.path.localeCompare(b.path))
    return { plugins, failed, folders: cache.folders, standardFolders: standardFolders(), scannedAt: cache.scannedAt, scanning: !!scanning }
  }
  /** Tells every window - the Session Maker and Settings can both be showing the list. */
  const changed = () => {
    const l = listing()
    for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('vst-plugins', l)
    return l
  }

  ipcMain.handle('vst-available', () => !!helper())
  ipcMain.handle('vst-scan', async (_, force) => {
    if (!helper()) return { plugins: [], failed: [], folders: [], standardFolders: [], scannedAt: null, scanning: false }
    if (!force && scanning) return scanning.then(listing)
    if (!force && readCache().scannedAt) return listing()
    const job = rescan(!!force)
    changed() // so every list shows it scanning
    return job
  })
  ipcMain.handle('vst-add-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await dialog.showOpenDialog(win, { title: 'Add a VST3 folder', properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    const cache = readCache()
    if (!cache.folders.includes(res.filePaths[0])) cache.folders.push(res.filePaths[0])
    writeCache(cache)
    const job = rescan(false)
    changed()
    return job
  })
  const within = (p, dir) => path.normalize(p).toLowerCase().startsWith(path.normalize(dir).toLowerCase().replace(/[\\/]+$/, '') + path.sep)
  ipcMain.handle('vst-remove-folder', (_, folder) => {
    const cache = readCache()
    if (!cache.folders.includes(folder)) return listing()
    cache.folders = cache.folders.filter((f) => f !== folder)
    // Its plug-ins go now (unless another folder still holds them) - no rescan to wait for.
    const still = standardFolders().concat(cache.folders)
    for (const p of Object.keys(cache.modules)) {
      if (within(p, folder) && !still.some((f) => within(p, f))) delete cache.modules[p]
    }
    writeCache(cache)
    return changed()
  })
  ipcMain.handle('vst-set-hidden', (_, keys, hide) => {
    const cache = readCache()
    const hidden = new Set(cache.hidden)
    for (const k of Array.isArray(keys) ? keys : []) {
      if (typeof k !== 'string') continue
      if (hide) hidden.add(k)
      else hidden.delete(k)
    }
    cache.hidden = [...hidden]
    writeCache(cache)
    return changed()
  })
  ipcMain.handle('vst-open-folder', async (_, folder) => {
    if (!standardFolders().concat(readCache().folders).includes(folder)) return false
    try { fs.mkdirSync(folder, { recursive: true }) } catch {}
    return !(await shell.openPath(folder))
  })
  ipcMain.handle('vst-show-module', (_, p) => {
    if (!Object.prototype.hasOwnProperty.call(readCache().modules, p)) return false
    shell.showItemInFolder(p)
    return true
  })

  ipcMain.handle('vst-process', async (_, req) => {
    const chans = (req && Array.isArray(req.channels) ? req.channels : []).slice(0, 2)
    const frames = chans[0] ? chans[0].length : 0
    if (!chans.length || !Array.isArray(req.chain) || !req.chain.length) return { error: 'Nothing to process' }
    const head = { sampleRate: req.sampleRate, channels: chans.length, frames, bpm: req.bpm || 120, chain: req.chain }
    const input = [Buffer.from(JSON.stringify(head) + '\n'), ...chans.map((c) => Buffer.from(c.buffer, c.byteOffset, frames * 4))]
    // Generous: some plug-ins run slower than real time, and each one loads separately.
    const seconds = frames / (req.sampleRate || 48000)
    const res = await runProcess(input, 60000 + seconds * 4000 * req.chain.length)
    const out = res.head
    if (!out) return { error: res.error || `The plug-in host crashed (${res.code})` }
    if (!out.ok) return { error: out.error || 'The plug-in failed', plugin: out.plugin }
    if (!res.complete) return { error: res.error || 'The plug-in host stopped early' }
    return { channels: res.channels }
  })

  /** Runs a 'process' job, writing the audio that comes back straight into one
   *  Float32Array per channel - no gathering it all up first, so long takes don't
   *  sit in memory twice. */
  const runProcess = (input, timeout, mode = 'process') => new Promise((resolve) => {
    const exe = helper()
    if (!exe) return resolve({ head: null, error: 'The plug-in host is missing' })
    const child = spawn(exe, [mode], { windowsHide: true })
    let killed = false
    const timer = setTimeout(() => { killed = true; child.kill() }, timeout)
    let pending = Buffer.alloc(0)
    let head = null
    let channels = null
    let chBytes = 0
    let total = 0
    let got = 0
    child.stdout.on('data', (d) => {
      if (!head) {
        pending = Buffer.concat([pending, d])
        const nl = pending.indexOf(10)
        if (nl < 0) return
        try { head = JSON.parse(pending.subarray(0, nl).toString('utf8')) } catch { head = { ok: false, error: 'The plug-in host sent something odd' } }
        d = pending.subarray(nl + 1)
        pending = null
        if (head.ok && head.channels > 0 && head.frames > 0) {
          channels = Array.from({ length: head.channels }, () => new Float32Array(head.frames))
          chBytes = head.frames * 4
          total = chBytes * head.channels
        }
      }
      if (!channels) return
      for (let off = 0; off < d.length && got < total;) {
        const ch = Math.floor(got / chBytes)
        const at = got % chBytes
        const n = Math.min(d.length - off, chBytes - at)
        d.copy(Buffer.from(channels[ch].buffer), at, off, off + n)
        off += n
        got += n
      }
    })
    child.stderr.on('data', () => {})
    child.stdin.on('error', () => {})
    child.on('error', (e) => { clearTimeout(timer); resolve({ head: null, error: e.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const complete = !!head && (!head.ok || got >= total)
      resolve({ head, code, channels: channels || [], complete, error: killed ? 'Took too long' : null })
    })
    for (const part of input) child.stdin.write(part)
    child.stdin.end()
  })

  ipcMain.handle('session-native-render', async (_, req) => {
    const input = []
    for (const asset of req.assets) {
      const channels = asset.channels
      if (!channels.length || channels.length > 2 || channels.some((c) => !(c instanceof Float32Array) || c.length !== channels[0].length)) return { error: 'Invalid render audio' }
      input.push(Buffer.from(JSON.stringify({ op: 'asset', id: asset.id, sampleRate: asset.sampleRate, frames: channels[0].length, channels: channels.length }) + '\n'))
      for (const c of channels) input.push(Buffer.from(c.buffer, c.byteOffset, c.byteLength))
    }
    input.push(Buffer.from(JSON.stringify({ op: 'render', project: req.project, sampleRate: req.sampleRate, duration: req.duration }) + '\n'))
    const result = await runProcess(input, 60000 + req.duration * 10000, 'session-render')
    if (!result.head?.ok || !result.complete) return { error: result.head?.error || result.error || 'Native export failed' }
    return { channels: result.channels }
  })

  const editors = new Map()
  const controls = new Map() // key -> { params } for open generic editors
  ipcMain.handle('vst-controls-get', (_, key) => controls.get(key)?.params ?? null)
  const nativeSessions = require('./nativeSession').registerNativeSessions({ app, ipcMain, helper })
  ipcMain.handle('vst-edit-open', (event, req) => {
    const exe = helper()
    if (!exe) return { error: 'The plug-in host is missing' }
    const have = editors.get(req.key)
    if (have) {
      if (!!have.generic !== !!req.generic) return { error: "Close this plug-in's other window first" }
      if (have.generic) openControls(req.key, req.title)
      else have.stdin.write('focus\n')
      return {}
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const args = ['edit']
    if (req.generic) args.push('--generic')
    else if (win) {
      const h = win.getNativeWindowHandle()
      args.push('--owner', String(h.length >= 8 ? h.readBigUInt64LE(0) : h.readUInt32LE(0)))
    }
    const child = spawn(exe, args, { windowsHide: false })
    child.generic = !!req.generic
    editors.set(req.key, child)
    // Generic editors show their parameters in a window of the app's own; it asks for the
    // current list when it opens and gets changes as 'vst-controls' events.
    let controlsWin = null
    if (child.generic) {
      controls.set(req.key, { params: [] })
      controlsWin = openControls(req.key, req.title)
      controlsWin.on('closed', () => { if (editors.get(req.key) === child) child.stdin.write('close\n') })
    }
    const send = (msg) => { if (!event.sender.isDestroyed()) event.sender.send('vst-editor', { key: req.key, ...msg }) }
    let buf = ''
    let closed = false
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      buf += d
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.type === 'closed') closed = true
        nativeSessions.editor(event.sender, req, msg)
        if (msg.type === 'params' || msg.type === 'param') {
          const c = controls.get(req.key)
          if (c && msg.type === 'params') c.params = msg.params
          else if (c) c.params = c.params.map((p) => (p.id === msg.id ? { ...p, value: msg.value, text: msg.text } : p))
          if (controlsWin && !controlsWin.isDestroyed()) controlsWin.webContents.send('vst-controls', { key: req.key, ...msg })
        } else if (msg.type !== 'parameter') send(msg)
      }
    })
    child.stderr.on('data', () => {})
    child.stdin.on('error', () => {})
    child.on('error', (e) => send({ type: 'error', error: e.message }))
    child.on('close', (code) => {
      editors.delete(req.key)
      controls.delete(req.key)
      if (controlsWin && !controlsWin.isDestroyed()) controlsWin.close()
      if (!closed) send({ type: code === 0 ? 'closed' : 'error', error: code === 0 ? undefined : 'The plug-in window crashed' })
      if (code !== 0) send({ type: 'closed' })
    })
    child.stdin.write(JSON.stringify({ path: req.path, cid: req.cid, state: req.state || '', title: req.title || '', sampleRate: req.sampleRate || 48000 }) + '\n')
    return {}
  })
  ipcMain.handle('vst-edit-close', (_, key) => {
    const child = editors.get(key)
    if (child) child.stdin.write('close\n')
  })
  // Generic controls: one parameter's new normalized value (0-1) for an open generic editor.
  ipcMain.handle('vst-edit-param', (_, key, param, value) => {
    const child = editors.get(key)
    if (!child || !child.generic || !Number.isFinite(param) || !Number.isFinite(value)) return
    child.stdin.write(JSON.stringify({ cmd: 'set', param, value }) + '\n')
  })
  app.on('before-quit', () => { for (const child of editors.values()) try { child.stdin.write('close\n') } catch {} })
}

module.exports = { register }
