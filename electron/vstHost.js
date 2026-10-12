// VST3 plug-ins for the Session Maker. Web Audio can't load them, so the work goes to
// native/vsthost (built into build/vsthost, shipped as resources/vsthost.exe): one helper
// process per job, so a plug-in that crashes or hangs takes only that job with it.
//
//   vst-available      whether plug-ins can be used here
//   vst-scan           the installed effects, cached by module and re-checked when one changes
//   vst-add-folder     pick another folder to look in, then scan
//   vst-process        run audio through a chain of plug-ins (offline, latency trimmed)
//   vst-edit-open      open a plug-in's own window; its state comes back as 'vst-editor' events
//   vst-edit-close     close one

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const SCAN_TIMEOUT = 20000
const SCAN_PARALLEL = 3

function register({ app, ipcMain, dialog, BrowserWindow }) {
  const helper = () => {
    if (process.platform !== 'win32') return null
    const p = app.isPackaged
      ? path.join(process.resourcesPath, 'vsthost.exe')
      : path.join(__dirname, '..', 'build', 'vsthost', 'vsthost.exe')
    return fs.existsSync(p) ? p : null
  }
  const cacheFile = () => path.join(app.getPath('userData'), 'vst-plugins.json')
  const readCache = () => {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
      return { modules: c.modules || {}, folders: Array.isArray(c.folders) ? c.folders : [] }
    } catch { return { modules: {}, folders: [] } }
  }
  const writeCache = (c) => { try { fs.writeFileSync(cacheFile(), JSON.stringify(c)) } catch {} }

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

  let scanning = null
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
    writeCache({ modules, folders: cache.folders })
    return listing(modules)
  }
  const listing = (modules) => {
    const plugins = []
    const failed = []
    for (const [p, m] of Object.entries(modules)) {
      if (m.error) failed.push({ path: p, error: m.error })
      for (const c of m.classes) {
        // Instruments need notes; the Session Maker only has audio to give them.
        if (/instrument/i.test(c.sub || '') && !/fx/i.test(c.sub || '')) continue
        plugins.push({ path: p, cid: c.cid, name: c.name, vendor: c.vendor || '', version: c.version || '', sub: c.sub || '' })
      }
    }
    plugins.sort((a, b) => a.name.localeCompare(b.name))
    return { plugins, failed, folders: readCache().folders }
  }

  ipcMain.handle('vst-available', () => !!helper())
  ipcMain.handle('vst-scan', async (_, force) => {
    if (!helper()) return { plugins: [], failed: [], folders: [] }
    if (!force) {
      const cache = readCache()
      if (Object.keys(cache.modules).length && !scanning) return listing(cache.modules)
    }
    if (!scanning) scanning = scan(!!force).finally(() => { scanning = null })
    return scanning
  })
  ipcMain.handle('vst-add-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await dialog.showOpenDialog(win, { title: 'Add a VST3 folder', properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    const cache = readCache()
    if (!cache.folders.includes(res.filePaths[0])) cache.folders.push(res.filePaths[0])
    writeCache(cache)
    if (!scanning) scanning = scan(false).finally(() => { scanning = null })
    return scanning
  })

  ipcMain.handle('vst-process', async (_, req) => {
    const chans = (req && Array.isArray(req.channels) ? req.channels : []).slice(0, 2)
    const frames = chans[0] ? chans[0].length : 0
    if (!chans.length || !Array.isArray(req.chain) || !req.chain.length) return { error: 'Nothing to process' }
    const head = { sampleRate: req.sampleRate, channels: chans.length, frames, bpm: req.bpm || 120, chain: req.chain }
    const input = [Buffer.from(JSON.stringify(head) + '\n'), ...chans.map((c) => Buffer.from(c.buffer, c.byteOffset, frames * 4))]
    // Generous: some plug-ins run slower than real time, and each one loads separately.
    const seconds = frames / (req.sampleRate || 48000)
    const res = await run(['process'], input, 60000 + seconds * 4000 * req.chain.length)
    const { head: out, rest } = firstLine(res.out)
    if (!out) return { error: res.error || `The plug-in host crashed (${res.code})` }
    if (!out.ok) return { error: out.error || 'The plug-in failed', plugin: out.plugin }
    if (rest.length < out.channels * out.frames * 4) return { error: res.error || 'The plug-in host stopped early' }
    // Copied out so each channel is its own aligned Float32Array.
    const channels = []
    for (let c = 0; c < out.channels; c++) {
      const f = new Float32Array(out.frames)
      rest.copy(Buffer.from(f.buffer), 0, c * out.frames * 4, (c + 1) * out.frames * 4)
      channels.push(f)
    }
    return { channels }
  })

  const editors = new Map()
  ipcMain.handle('vst-edit-open', (event, req) => {
    const exe = helper()
    if (!exe) return { error: 'The plug-in host is missing' }
    const have = editors.get(req.key)
    if (have) { have.stdin.write('focus\n'); return {} }
    const win = BrowserWindow.fromWebContents(event.sender)
    const args = ['edit']
    if (win) {
      const h = win.getNativeWindowHandle()
      args.push('--owner', String(h.length >= 8 ? h.readBigUInt64LE(0) : h.readUInt32LE(0)))
    }
    const child = spawn(exe, args, { windowsHide: false })
    editors.set(req.key, child)
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
        send(msg)
      }
    })
    child.stderr.on('data', () => {})
    child.stdin.on('error', () => {})
    child.on('error', (e) => send({ type: 'error', error: e.message }))
    child.on('close', (code) => {
      editors.delete(req.key)
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
  app.on('before-quit', () => { for (const child of editors.values()) try { child.stdin.write('close\n') } catch {} })
}

module.exports = { register }
