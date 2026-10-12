import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { isAndroidApp } from './androidUpdate'

// Renderer-side breadcrumb logging — a trail of what the UI was doing.
// Always goes to the dev console in DEV. On Android it's also appended to a
// small on-device file (see persistFile below) — there's no way to attach a
// PC and read logcat on a phone in someone's hands, and the console-only
// version is a no-op in a production build (import.meta.env.DEV is false),
// so without this there was no way to get a trail off a real device at all.
// Fire-and-forget and never throws: logging must not itself break the thing
// it's diagnosing.
export function runLog(scope: string, ...args: unknown[]): void {
  if (import.meta.env?.DEV) console.log(`[${scope}]`, ...args)
  if (isAndroidApp()) appendToFile(scope, args)
}

// Install once at startup: catch otherwise-silent renderer errors and
// unhandled promise rejections and route them into the run log.
export function installGlobalErrorLogging(): void {
  window.addEventListener('error', (e) => {
    runLog('renderer-error', e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '', e.error?.stack || '')
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    runLog('renderer-rejection', r?.stack || r?.message || String(r))
  })
}

// ── On-device persistence (Android only) ────────────────────────────────────
// A flat, capped file in app-private cache storage (Filesystem's Cache
// directory — no storage permission needed, survives app restarts, cleared
// automatically if the OS needs the space back under pressure, which is fine
// for a rolling diagnostic trail). Read back and shown in DiagnosticsModal.
const LOG_FILE = 'runlog.txt'
const MAX_LOG_CHARS = 500_000 // trimmed from the front once exceeded — plenty for a session's trail, small enough to read/share instantly

let queue: Promise<void> = Promise.resolve()
let warnedOnce = false

function stringifyArg(a: unknown): string {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack || a.message
  try { return JSON.stringify(a) } catch { return String(a) }
}

// Kept in memory once loaded so every log line doesn't re-read the whole
// file — null until the first append actually loads (or fails to find) it.
let buffer: string | null = null

function appendToFile(scope: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${scope}] ${args.map(stringifyArg).join(' ')}\n`
  // Serialized through one promise chain — concurrent writeFile calls on the
  // same file would otherwise race and could drop lines.
  queue = queue.then(async () => {
    try {
      if (buffer === null) {
        try {
          const res = await Filesystem.readFile({ path: LOG_FILE, directory: Directory.Cache, encoding: Encoding.UTF8 })
          buffer = typeof res.data === 'string' ? res.data : ''
        } catch {
          buffer = '' // First write — no file yet.
        }
      }
      buffer += line
      if (buffer.length > MAX_LOG_CHARS) buffer = buffer.slice(buffer.length - MAX_LOG_CHARS)
      await Filesystem.writeFile({ path: LOG_FILE, directory: Directory.Cache, data: buffer, encoding: Encoding.UTF8 })
    } catch (e) {
      if (!warnedOnce) { warnedOnce = true; console.error('runLog: failed to persist to file', e) }
    }
  })
}

/** Reads the on-device log file back (Android only). Used by DiagnosticsModal.
 *  Waits on the write queue first so a just-logged line is never missed. */
export async function readLogFile(): Promise<string | null> {
  if (!isAndroidApp()) return null
  await queue
  if (buffer !== null) return buffer
  try {
    const res = await Filesystem.readFile({ path: LOG_FILE, directory: Directory.Cache, encoding: Encoding.UTF8 })
    return typeof res.data === 'string' ? res.data : null
  } catch {
    return null
  }
}

/** Clears the on-device log file (Android only). Routed through the same
 *  queue as appendToFile so it can't race a log line that's mid-write. */
export async function clearLogFile(): Promise<void> {
  if (!isAndroidApp()) return
  queue = queue.then(async () => {
    buffer = ''
    try {
      await Filesystem.deleteFile({ path: LOG_FILE, directory: Directory.Cache })
    } catch {
      // Nothing to delete — fine.
    }
  })
  await queue
}
