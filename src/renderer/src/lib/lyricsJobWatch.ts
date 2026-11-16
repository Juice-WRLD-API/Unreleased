// Tells the user when a lyrics job they started finishes, through the in-app
// banner and the notification area, wherever they are in the app and whether
// or not the Synced lyrics dialog is still open. The dialog and the terminal
// hand each job they start to watchLyricsJob; the main window then polls it
// until it's done.
//
// The watched ids are kept in localStorage, so a job still running when the
// app closes is reported on the next launch. Only the main window polls (a
// pop-out would raise the same banner twice); other tabs on the web each
// poll, and the notification area's id keeps that to one entry.
import { IS_FLOAT_WINDOW } from '../store/useStore'
import { showNotificationBanner } from './chatNotifications'
import { recordNotification } from './notificationHistory'
import { openNotificationTarget } from './openNotification'
import { getLyricsJob, isFinished, jobTitle, type LyricsGenJob, type LyricsGenMode } from './lyricsGenApi'

interface WatchedJob { id: string; title: string; mode: LyricsGenMode; at: number }

const KEY = 'unreleased:lyricsJobWatch'
const POLL_MS = 10_000
// A job the server never finishes (or one we can't reach) stops being watched after a day.
const MAX_AGE_MS = 24 * 60 * 60 * 1000

const MODE_LABEL: Record<LyricsGenMode, string> = { plain: 'Lyrics', synced: 'Synced lyrics', word_synced: 'Word-synced lyrics' }

let timer = 0
let running = false
let started = false
// Jobs open in the dialog right now: the user is watching them finish, so
// they go to the notification area as read, with no banner.
const onScreen = new Map<string, number>()

function load(): WatchedJob[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(arr) ? arr.filter((j): j is WatchedJob => !!j && typeof j.id === 'string') : []
  } catch {
    return []
  }
}

function save(list: WatchedJob[]): void {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch {}
}

function drop(id: string): void {
  save(load().filter((j) => j.id !== id))
}

function notify(job: LyricsGenJob, watched: WatchedJob): void {
  const title = jobTitle(job) || watched.title || 'your audio'
  const what = MODE_LABEL[job.mode] ?? MODE_LABEL[watched.mode] ?? 'Lyrics'
  const [heading, body, level] = job.status === 'completed'
    ? [`${what} ready`, `${title} is done. Click to review it.`, 'success' as const]
    : job.status === 'cancelled'
      ? [`${what} job cancelled`, title, 'warning' as const]
      : [`${what} job failed`, job.error ? `${title}: ${job.error}` : title, 'error' as const]
  const target = { view: 'lyrics' as const, jobId: job.id }
  const payload = {
    id: 0,
    tag: `lyrics-${job.id}`,
    kind: 'app' as const,
    title: heading,
    body,
    level,
    target,
    onOpen: () => openNotificationTarget(target),
  }
  if (onScreen.has(job.id)) recordNotification({ id: payload.tag, kind: 'app', title: heading, body, level, target, read: true })
  else showNotificationBanner(payload)
}

async function poll(): Promise<void> {
  if (running) return
  running = true
  try {
    const now = Date.now()
    for (const watched of load()) {
      if (now - watched.at > MAX_AGE_MS) { drop(watched.id); continue }
      try {
        const job = await getLyricsJob(watched.id)
        if (!isFinished(job)) continue
        // Another tab may have reported it while this request was out.
        if (!load().some((j) => j.id === watched.id)) continue
        drop(watched.id)
        notify(job, watched)
      } catch (e) {
        // Deleted, or no longer ours to read (signed out, another account).
        if (/not found|\(40[134]\)|credentials|permission/i.test(e instanceof Error ? e.message : '')) drop(watched.id)
      }
    }
  } finally {
    running = false
    schedule()
  }
}

function schedule(): void {
  window.clearTimeout(timer)
  timer = 0
  if (started && load().length) timer = window.setTimeout(() => void poll(), POLL_MS)
}

/** Watch a job the user just started, and notify them when it finishes. */
export function watchLyricsJob(job: Pick<LyricsGenJob, 'id' | 'mode' | 'filename' | 'source' | 'status'>): void {
  if (isFinished(job)) return
  save([{ id: job.id, title: jobTitle(job), mode: job.mode, at: Date.now() }, ...load().filter((j) => j.id !== job.id)])
  if (started && !timer && !running) schedule()
}

/** Marks a job as shown in the dialog until the returned function is called. */
export function showingLyricsJob(id: string): () => void {
  onScreen.set(id, (onScreen.get(id) ?? 0) + 1)
  return () => {
    const n = (onScreen.get(id) ?? 1) - 1
    if (n > 0) onScreen.set(id, n)
    else onScreen.delete(id)
  }
}

/** Starts polling in the main window; called once from App. */
export function startLyricsJobWatch(): () => void {
  if (IS_FLOAT_WINDOW || started) return () => {}
  started = true
  void poll()
  const onStorage = (e: StorageEvent): void => { if (e.key === KEY && !timer && !running) schedule() }
  window.addEventListener('storage', onStorage)
  return () => {
    started = false
    window.clearTimeout(timer)
    timer = 0
    window.removeEventListener('storage', onStorage)
  }
}
