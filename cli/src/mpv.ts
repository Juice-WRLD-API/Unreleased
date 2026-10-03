import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { VERSION } from './api'
import { HOME_DIR, loadConfig } from './config'

// A hidden mpv driven over its JSON IPC (https://mpv.io/manual/master/#json-ipc):
// one request per line, answers matched by request_id, events in between.
// mpv only ever plays the current file; the queue lives in player.ts.

/** Where mpv is: $UNRELEASED_MPV, "mpv" in config.json, PATH, then the
 *  usual install folders (installers often don't touch PATH). */
export function findMpv(): string | null {
  const configured = process.env.UNRELEASED_MPV || (loadConfig() as { mpv?: string }).mpv
  if (configured) return existsSync(configured) ? configured : null
  const win = process.platform === 'win32'
  const names = win ? ['mpv.exe', 'mpv.com'] : ['mpv']
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of names) if (existsSync(join(dir, name))) return join(dir, name)
  }
  const env = (k: string): string => process.env[k] ?? ''
  const guesses = win
    ? [
        join(env('ProgramFiles'), 'MPV Player', 'mpv.exe'),
        join(env('ProgramFiles'), 'mpv', 'mpv.exe'),
        join(env('LOCALAPPDATA'), 'Programs', 'mpv', 'mpv.exe'),
        join(env('USERPROFILE'), 'scoop', 'apps', 'mpv', 'current', 'mpv.exe'),
        join(env('ProgramData'), 'chocolatey', 'bin', 'mpv.exe'),
      ]
    : ['/opt/homebrew/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/mpv', '/snap/bin/mpv', '/Applications/mpv.app/Contents/MacOS/mpv']
  return guesses.find((p) => p && existsSync(p)) ?? null
}

export const MPV_MISSING = `playback needs mpv, which isn't installed (or isn't where I looked).
Install it: ${process.platform === 'win32' ? 'winget install shinchiro.mpv' : process.platform === 'darwin' ? 'brew install mpv' : 'your package manager (apt install mpv, pacman -S mpv, …)'}
or point at it: set UNRELEASED_MPV to the mpv executable's path`

// mpv quits by itself if the shell stops checking in: on Windows a child
// process outlives its parent, so a closed terminal would otherwise leave the
// music playing with nothing left to stop it.
const WATCHDOG = `local last = mp.get_time()
mp.register_script_message('unreleased-heartbeat', function() last = mp.get_time() end)
mp.add_periodic_timer(1, function()
  if mp.get_time() - last > 10 then mp.command('quit') end
end)
`
const HEARTBEAT_MS = 2000

export type MpvEvent = { event: string; reason?: string; file_error?: string; [k: string]: unknown }

export class Mpv {
  private proc: ChildProcess | null = null
  private socket: Socket | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private buffer = ''
  private heartbeat: NodeJS.Timeout | null = null
  alive = false

  constructor(private readonly onEvent: (e: MpvEvent) => void, private readonly onExit: () => void) {}

  async start(binary: string): Promise<void> {
    const pipe = process.platform === 'win32'
      ? `\\\\.\\pipe\\unreleased-mpv-${process.pid}`
      : join(tmpdir(), `unreleased-mpv-${process.pid}.sock`)
    mkdirSync(HOME_DIR, { recursive: true })
    const watchdog = join(HOME_DIR, 'mpv-watchdog.lua')
    writeFileSync(watchdog, WATCHDOG)

    const proc = spawn(binary, [
      '--idle=yes', '--no-video', '--force-window=no', '--no-terminal', '--audio-display=no',
      `--input-ipc-server=${pipe}`, `--script=${watchdog}`, `--user-agent=unreleased-cli/${VERSION}`,
    ], { stdio: 'ignore', windowsHide: true })
    this.proc = proc
    proc.on('exit', () => this.closed())
    proc.on('error', () => this.closed())

    // The pipe appears once mpv has started; keep trying for a few seconds.
    const deadline = Date.now() + 8000
    for (;;) {
      try {
        this.socket = await new Promise<Socket>((resolve, reject) => {
          const s = connect(pipe)
          s.once('connect', () => resolve(s))
          s.once('error', reject)
        })
        break
      } catch (err) {
        if (proc.exitCode !== null || Date.now() > deadline) {
          this.stop()
          throw new Error(`couldn't start mpv (${(err as Error).message})`)
        }
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    this.alive = true
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk: string) => this.read(chunk))
    this.socket.on('close', () => this.closed())
    this.socket.on('error', () => this.closed())
    const beat = (): void => { void this.command('script-message', 'unreleased-heartbeat').catch(() => {}) }
    beat()
    this.heartbeat = setInterval(beat, HEARTBEAT_MS)
    this.heartbeat.unref()
  }

  private read(chunk: string): void {
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (!line) continue
      let msg: { request_id?: number; error?: string; data?: unknown; event?: string }
      try { msg = JSON.parse(line) } catch { continue }
      if (msg.event) { this.onEvent(msg as MpvEvent); continue }
      const waiter = msg.request_id !== undefined ? this.pending.get(msg.request_id) : undefined
      if (!waiter) continue
      this.pending.delete(msg.request_id!)
      if (msg.error === 'success') waiter.resolve(msg.data)
      else waiter.reject(new Error(`mpv: ${msg.error}`))
    }
  }

  command(...args: unknown[]): Promise<unknown> {
    if (!this.socket || !this.alive) return Promise.reject(new Error('the player has stopped'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('mpv did not answer')) }, 5000)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.socket!.write(JSON.stringify({ command: args, request_id: id }) + '\n')
    })
  }

  get<T>(prop: string): Promise<T> { return this.command('get_property', prop) as Promise<T> }
  set(prop: string, value: unknown): Promise<unknown> { return this.command('set_property', prop, value) }

  private closed(): void {
    if (!this.alive && !this.proc) return
    const wasAlive = this.alive
    this.alive = false
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    for (const w of this.pending.values()) w.reject(new Error('the player has stopped'))
    this.pending.clear()
    this.socket?.destroy()
    this.socket = null
    this.proc = null
    if (wasAlive) this.onExit()
  }

  /** Quits mpv (and kills it if it doesn't go). */
  stop(): void {
    const proc = this.proc
    if (this.alive) this.socket?.write(JSON.stringify({ command: ['quit'] }) + '\n')
    this.alive = false
    if (proc && proc.exitCode === null) {
      const t = setTimeout(() => { try { proc.kill() } catch { /* gone */ } }, 500)
      t.unref()
    }
    this.closed()
  }
}
