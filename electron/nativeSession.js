// Persistent Session Maker host. PCM is transferred once per asset; Windows owns
// playback timing, so renderer/main-process scheduling cannot starve the audio.
const { spawn } = require('node:child_process')

class NativeSession {
  constructor(exe, emit, spawnProcess = spawn) {
    this.child = spawnProcess(exe, ['session'], { windowsHide: true })
    this.pending = new Map()
    this.serial = 0
    this.closed = false
    this.emit = emit
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.ready.catch(() => {})
    this.timer = setTimeout(() => this.fail('The native audio engine did not start'), 15000)
    let input = ''
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => {
      input += chunk
      for (let nl; (nl = input.indexOf('\n')) >= 0;) {
        const line = input.slice(0, nl)
        input = input.slice(nl + 1)
        let event
        try { event = JSON.parse(line) } catch { this.fail('Invalid native audio response'); return }
        if (event.type === 'ready') { clearTimeout(this.timer); this.resolveReady() }
        else if (event.type === 'ack') {
          const request = this.pending.get(event.request)
          if (request) { clearTimeout(request.timer); request.resolve(); this.pending.delete(event.request) }
        } else if (event.type === 'error') this.fail(event.error || 'Native audio failed')
        else this.emit(event)
      }
    })
    this.child.stderr.on('data', () => {})
    this.child.stdin.on('error', (error) => this.fail(error.message))
    this.child.on('error', (error) => this.fail(error.message))
    this.child.on('close', () => { if (!this.closed) this.fail('The native audio engine stopped unexpectedly') })
  }

  fail(message) {
    if (this.closed) return
    this.emit({ type: 'error', error: message })
    this.close(new Error(message))
  }

  close(error = new Error('Native audio session closed')) {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.timer)
    this.rejectReady(error)
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error) }
    this.pending.clear()
    this.child.kill()
  }

  async command(command, channels = []) {
    await this.ready
    if (this.closed) throw new Error('Native audio session closed')
    const request = ++this.serial
    const header = { ...command, request }
    if (channels.length) {
      if (channels.length > 2 || channels.some((c) => !(c instanceof Float32Array) || c.length !== channels[0].length)) throw new Error('Invalid native audio asset')
      header.channels = channels.length
      header.frames = channels[0].length
    }
    // All writes for one message are synchronous, keeping headers and PCM adjacent
    // even when another IPC request arrives while this acknowledgement is pending.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('The native audio engine stopped responding'), 30000)
      this.pending.set(request, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify(header) + '\n')
      for (const channel of channels) this.child.stdin.write(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength))
    })
  }
}

function registerNativeSessions({ app, ipcMain, helper }) {
  const sessions = new Map()
  ipcMain.handle('session-native-open', async (event, id) => {
    const exe = helper()
    if (!exe) return { error: 'Native playback requires the Windows audio host' }
    sessions.get(event.sender.id)?.cleanup()
    const host = new NativeSession(exe, (data) => {
      if (!event.sender.isDestroyed()) event.sender.send('session-native-event', { id, ...data })
    })
    const cleanup = () => {
      host.close()
      event.sender.removeListener('destroyed', cleanup)
      event.sender.removeListener('render-process-gone', cleanup)
      if (sessions.get(event.sender.id) === entry) sessions.delete(event.sender.id)
    }
    const entry = { id, host, cleanup }
    sessions.set(event.sender.id, entry)
    event.sender.once('destroyed', cleanup)
    event.sender.once('render-process-gone', cleanup)
    try { await host.ready; return {} } catch (error) { cleanup(); return { error: error.message } }
  })
  ipcMain.handle('session-native-command', async (event, id, command, channels) => {
    const entry = sessions.get(event.sender.id)
    if (!entry || entry.id !== id) return { error: 'Native audio session is no longer active' }
    if (!['asset', 'play', 'mix', 'ab', 'pause'].includes(command?.op)) return { error: 'Invalid native audio command' }
    try { await entry.host.command(command, channels); return {} } catch (error) { return { error: error.message } }
  })
  ipcMain.handle('session-native-close', (event, id) => {
    const entry = sessions.get(event.sender.id)
    if (entry?.id === id) entry.cleanup()
  })
  app.on('before-quit', () => { for (const { cleanup } of sessions.values()) cleanup(); sessions.clear() })
  return {
    editor(sender, request, event) {
      if (event.type !== 'parameter' && event.type !== 'state') return
      const entry = sessions.get(sender.id)
      if (!entry || entry.host.closed) return
      const at = request.key.indexOf(':')
      const command = {
        op: event.type, pluginId: request.key.slice(at + 1),
        lanes: request.lanes || [request.key.slice(0, at)],
        param: event.param, value: event.value, state: event.state,
        parametersOnly: event.parametersOnly === true,
      }
      void entry.host.command(command).catch(() => {})
    },
  }
}

module.exports = { NativeSession, registerNativeSessions }
