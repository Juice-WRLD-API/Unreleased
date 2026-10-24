import { relativeTime } from '../../components/adminShared'
import { formatBytes } from '../format'
import { extensionOf } from '../donorFilesApi'
import {
  cancelAdminLyricsJob, createLyricsJob, createLyricsJobFromServer, deleteLyricsJob, fetchAdminLyricsJobOutput, fetchLyricsJobOutput, fetchTrackAudio,
  getAdminLyricsJob, getLyricsAdminSettings, getLyricsGenOptions, getLyricsJob, isFinished, jobServerAudio, jobTitle, listAdminLyricsJobs,
  listLyricsJobs, looksLikeLrc, lyricsToTime, removeAdlibs, textForMode, trackServerAudio, LYRICS_AUDIO_EXTENSIONS as AUDIO_EXTENSIONS, LYRICS_MAX_FILE_SIZE, LYRICS_MAX_TEXT, setLyricsWhisperModel,
  type LyricsAdminJobSummary, type LyricsGenJob, type LyricsGenJobSummary, type LyricsGenMode, type LyricsGenRequest, type LyricsOutput, type LyricsSegment,
  type LyricsServerAudio,
} from '../lyricsGenApi'
import {
  countTimingEdits, isMoved, jobTiming, lrcTime, offsetText, resetTiming, saveTimingDraft, setTimingStart, targetStart, timingOutput, type TimingTarget,
} from '../lyricsTiming'
import { isAbortError } from '../apiClient'
import { ls } from '../persist'
import { useStore } from '../../store/useStore'
import { pickLocalFile, saveBlob } from './pick'
import { asJson, confirmAction, fail, parseArgs, table, type TermCommand, type TermCtx } from './types'

// Donor lyrics generation: Whisper on the server transcribes a song's audio
// (plain), or lines the user's own text up with it (synced, per-word). Audio
// the server has (the playing song, --song, --path) is named rather than
// uploaded, and a follow-up on such a job names it again. The
// result is a preview to read and download; nothing reaches the library. The
// server lists the account's jobs (newest first); the terminal keeps that list,
// per account, so a job can be named by its number in `lyricsgen ls`. If the
// list can't be fetched (offline, older server) it falls back to the ids this
// device started. `timing` moves a line or word the way Adjust timing does in
// the dialog, into the same draft on this device, and get uses it.
const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

const POLL_MS = 3000
const REMEMBER = 100
const MODES: Record<string, LyricsGenMode> = { plain: 'plain', sync: 'synced', synced: 'synced', words: 'word_synced', word: 'word_synced', word_synced: 'word_synced' }
const MODE_NAME: Record<LyricsGenMode, string> = { plain: 'plain', synced: 'sync', word_synced: 'words' }
const OUTPUTS: Record<string, LyricsOutput> = { txt: 'txt', text: 'txt', plain: 'txt', lrc: 'lrc', enhanced: 'enhanced_lrc', enhanced_lrc: 'enhanced_lrc', words: 'enhanced_lrc' }
const SUBCOMMANDS = ['ls', 'status', 'plain', 'sync', 'words', 'show', 'wait', 'get', 'timing', 'rm']

interface Remembered { id: string; mode: LyricsGenMode; filename: string; created_at: string }

// The audio the last job was made from. The server deletes uploads after every
// job, so a follow-up (sync the text you just reviewed) uploads this again
// rather than asking for the file a second time; server audio is just named
// again. Kept for this run of the app only.
let lastAudio: File | null = null
let lastServer: { audio: LyricsServerAudio; name: string } | null = null

const storeKey = (): string => `lyricsJobs:${st().account?.id ?? 0}`
const remembered = (): Remembered[] => ls.get<Remembered[]>(storeKey()) ?? []
const remember = (list: Remembered[]): void => ls.set(storeKey(), list.slice(0, REMEMBER))

let summaries = new Map<string, LyricsGenJobSummary>()

/** Pulls the account's jobs from the server so numbers and `ls` agree on every
 *  device. Quietly keeps the saved list when the server can't be reached. */
async function refreshJobs(signal: AbortSignal): Promise<void> {
  try {
    const jobs = await listLyricsJobs(signal)
    summaries = new Map(jobs.map((j) => [j.id, j]))
    remember(jobs.map((j) => ({ id: j.id, mode: j.mode, filename: jobTitle(j), created_at: j.created_at })))
  } catch (err) {
    if (isAbortError(err) || signal.aborted) throw err
    summaries = new Map()
  }
}

/** A job by its number in `lyricsgen ls` (1 = newest), the start of its id, or
 *  "last". Nothing typed means the newest. */
function jobRef(arg: string | undefined): Remembered {
  const list = remembered()
  const q = (arg ?? '').trim().toLowerCase().replace(/^#/, '')
  if (!q || q === 'last') return list[0] ?? fail('no lyrics jobs yet (lyricsgen plain)')
  if (/^\d+$/.test(q) && Number(q) >= 1 && Number(q) <= list.length) return list[Number(q) - 1]
  const hits = list.filter((j) => j.id.toLowerCase().startsWith(q))
  if (hits.length === 1) return hits[0]
  if (/^[0-9a-f-]{36}$/.test(q)) return { id: q, mode: 'plain', filename: '', created_at: '' }
  return fail(hits.length ? `${hits.length} jobs match "${q}" - type more of the id` : `no job "${q}" (lyricsgen ls)`)
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = (): void => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })

/** Polls until the job finishes. Ctrl+C stops waiting, not the job. */
async function follow(ctx: TermCtx, id: string): Promise<LyricsGenJob | null> {
  const signal = ctx.signal
  let seen = ''
  let quarter = 0
  try {
    for (;;) {
      const job = await getLyricsJob(id, signal)
      if (isFinished(job)) return job
      if (job.status !== seen) { seen = job.status; ctx.print(`${job.status}… (Ctrl+C stops waiting; the job keeps going)`, 'dim') }
      // Progress once per quarter, so a long job shows it's moving.
      const q = Math.floor((job.progress ?? 0) / 25)
      if (job.status === 'processing' && q > quarter && q < 4) { quarter = q; ctx.print(`${job.progress}%`, 'dim') }
      await sleep(POLL_MS, signal)
    }
  } catch (err) {
    if (!isAbortError(err) && !signal.aborted) throw err
    ctx.print('stopped waiting - the job is still running. lyricsgen wait picks it up again', 'dim')
    return null
  }
}

function printResult(ctx: TermCtx, job: LyricsGenJob, n: number | null): void {
  const ref = n ?? job.id.slice(0, 8)
  if (job.status === 'cancelled') { ctx.print(job.error || 'cancelled', 'dim'); return }
  if (job.status === 'failed') { ctx.print(`failed: ${job.error || 'no reason given'}`, 'error'); return }
  if (job.status !== 'completed') { ctx.print(`${job.status} - lyricsgen wait ${ref}`, 'dim'); return }
  const r = job.result
  const tuned = job.mode === 'plain' ? null : jobTiming(job)
  const text = job.mode === 'plain' ? r.plain_lyrics : tuned?.edits ? timingOutput(tuned.lines, 'lrc') : r.synced_lyrics
  ctx.print(text?.trim() || '(no lyrics came back)')
  if (tuned?.edits) ctx.print(`with your timing changes on this device (lyricsgen timing ${ref})`, 'dim')
  const lost = [
    r.unaligned_lines && `${r.unaligned_lines} line${r.unaligned_lines === 1 ? '' : 's'}`,
    job.mode === 'word_synced' && r.unaligned_words && `${r.unaligned_words} word${r.unaligned_words === 1 ? '' : 's'}`,
  ].filter(Boolean)
  if (job.mode !== 'plain' && lost.length) {
    ctx.print(`${lost.join(' and ')} couldn't be matched to the audio, so their timing is estimated. A misspelled or missing lyric is the usual cause: fix the text and sync again.`, 'dim')
  }
  const next = job.mode === 'plain'
    ? `get it: lyricsgen get ${ref} txt · sync this text: lyricsgen sync ${ref} (or words ${ref}) · to fix lines first, edit the .txt and run lyricsgen sync --file`
    : job.mode === 'synced'
      ? `get it: lyricsgen get ${ref} lrc · word sync the same lyrics: lyricsgen words ${ref}`
      : `get it: lyricsgen get ${ref} enhanced (per word) or lrc (per line)`
  ctx.print(`preview only, nothing was saved to the song. ${next}`, 'dim')
}

/** A job's status, with its progress while it runs. */
const statusText = (job: Pick<LyricsGenJob, 'status' | 'progress'>): string =>
  job.status === 'processing' && job.progress ? `processing ${job.progress}%` : job.status

/** " · from <channel>: <path>" for a job on server audio. */
const fromText = (job: Pick<LyricsGenJob, 'source'>): string =>
  job.source ? ` · from ${job.source.channel ? `${job.source.channel}: ` : ''}${job.source.path}` : ''

/** Saves a finished job's text: built from this device's timing changes when
 *  it has some (and `original` isn't asked for), otherwise the server's. */
async function saveOutput(
  ctx: TermCtx,
  job: LyricsGenJob,
  want: string | undefined,
  original: boolean,
  fetchText: (id: string, output: LyricsOutput, signal?: AbortSignal) => Promise<string>,
): Promise<void> {
  if (job.status !== 'completed') fail(`that job is ${job.status}${job.error ? `: ${job.error}` : ''}`)
  const output = want ? OUTPUTS[want] ?? fail('get <job> txt | lrc | enhanced') : job.mode === 'plain' ? 'txt' : job.mode === 'synced' ? 'lrc' : 'enhanced_lrc'
  const timing = jobTiming(job)
  const tuned = !original && timing.edits && (output !== 'enhanced_lrc' || job.mode === 'word_synced') ? timingOutput(timing.lines, output) : null
  const text = tuned ?? await fetchText(job.id, output, ctx.signal)
  const base = (job.filename || 'lyrics').replace(/\.[^.]+$/, '')
  const name = output === 'txt' ? `${base}.txt` : output === 'lrc' ? `${base}.lrc` : `${base}.words.lrc`
  saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), name)
  ctx.print(`saved ${name} to your downloads${tuned !== null ? ' with your timing changes (--original for the sync as it came back)' : ''}`, 'ok')
}

/** "12" is line 12, "12.3" its third word. */
function timingTarget(arg: string, lines: LyricsSegment[]): TimingTarget {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(arg) ?? fail(`"${arg}" isn't a line: 12 for line 12, 12.3 for its third word`)
  const line = Number(m[1]) - 1
  const l = lines[line] ?? fail(`there are ${lines.length} lines`)
  if (m[2] === undefined) return { line, word: null }
  const n = l.words?.length ?? 0
  if (!n) fail(`line ${line + 1} has no word times`)
  const word = Number(m[2]) - 1
  return word >= 0 && word < n ? { line, word } : fail(`line ${line + 1} has ${n} word${n === 1 ? '' : 's'}`)
}

/** "+0.2" / "-0.05" seconds from where it is, or a time like "1:13.40". */
function timingGoal(arg: string, from: number): number {
  const rel = /^([+-])(\d*\.?\d+)s?$/.exec(arg)
  if (rel) return from + (rel[1] === '-' ? -1 : 1) * Number(rel[2])
  const at = /^(\d+):(\d{1,2}(?:\.\d{1,3})?)$/.exec(arg)
  if (at && Number(at[2]) < 60) return Number(at[1]) * 60 + Number(at[2])
  return fail(`"${arg}": move by +0.2 or -0.05 (seconds), or to a time like 1:13.40`)
}

// lyricsgen timing: list a sync job's lines (or one line's words) with their
// times, move one, or put things back. The same draft as the dialog's Adjust
// timing, so either picks up where the other left off.
async function runTiming(ctx: TermCtx, words: string[], json: boolean): Promise<void> {
  const ref = jobRef(words[0])
  const job = await getLyricsJob(ref.id, ctx.signal)
  if (job.status !== 'completed') fail(`that job is ${job.status}${job.error ? `: ${job.error}` : ''}`)
  if (job.mode === 'plain') fail('a transcript has no timing - sync it first (lyricsgen sync <job>)')
  const n = remembered().findIndex((j) => j.id === ref.id)
  const name = n >= 0 ? String(n + 1) : job.id.slice(0, 8)
  const timing = jobTiming(job)
  const { original } = timing
  let { lines } = timing
  const [what, arg] = words.slice(1)
  const label = (t: TimingTarget): string => (t.word === null
    ? `line ${t.line + 1}`
    : `"${lines[t.line].words![t.word].word.trim()}" (line ${t.line + 1}, word ${t.word + 1})`)
  const shown = (t: TimingTarget): string => {
    const d = targetStart(lines, t) - targetStart(original, t)
    return `${lrcTime(targetStart(lines, t))}${Math.abs(d) >= 0.005 ? ` (${offsetText(d)})` : ''}`
  }
  const keep = (): void => saveTimingDraft(job.id, countTimingEdits(original, lines) ? lines : null)

  if (!what) {
    if (asJson(ctx, json, lines)) return
    const edits = countTimingEdits(original, lines)
    ctx.print(table(lines.map((l, i) => [String(i + 1), shown({ line: i, word: null }), isMoved(lines, original, { line: i, word: null }) ? '*' : '', l.text || '♪'])))
    ctx.print(`${edits ? `${edits} moved (* marks their lines) · ` : ''}words of a line: lyricsgen timing ${name} <line> · move: lyricsgen timing ${name} <line>[.<word>] +0.2 | -0.05 | 1:13.40 · undo: lyricsgen timing ${name} reset [<line>[.<word>]]`, 'dim')
    return
  }
  if (what.toLowerCase() === 'reset') {
    if (!arg) {
      saveTimingDraft(job.id, null)
      ctx.print('timing is back to the sync as it came back', 'ok')
      return
    }
    const t = timingTarget(arg, lines)
    lines = resetTiming(lines, original, t)
    keep()
    const stuck = isMoved(lines, original, t)
    ctx.print(`${label(t)} starts at ${shown(t)}`, stuck ? 'dim' : 'ok')
    if (stuck) ctx.print('a neighbour has moved into its place - move that one first', 'dim')
    return
  }
  const t = timingTarget(what, lines)
  if (!arg) {
    const l = lines[t.line]
    if (asJson(ctx, json, t.word === null ? l : l.words![t.word])) return
    ctx.print(`${label(t)} starts at ${shown(t)}${t.word === null ? ` · ${l.text || '♪'}` : ''}`)
    if (t.word === null && l.words?.length) {
      ctx.print(table(l.words.map((w, j) => [String(j + 1), shown({ line: t.line, word: j }), w.estimated ? 'estimated' : '', w.word.trim()])))
    }
    return
  }
  const wanted = timingGoal(arg, targetStart(lines, t))
  lines = setTimingStart(lines, t, wanted)
  keep()
  const now = targetStart(lines, t)
  ctx.print(`${label(t)} now starts at ${shown(t)}`, 'ok')
  if (wanted > 0 && Math.abs(now - wanted) > 0.005) {
    ctx.print(`stopped short: it can't pass the ${wanted > now ? 'next' : 'previous'} ${t.word === null ? 'line' : 'word'}. Move that one first.`, 'dim')
  }
}

/** The playing song's audio, fetched from its stream (when the server doesn't have it). */
async function nowPlayingAudio(ctx: TermCtx): Promise<File> {
  const track = st().currentTrack ?? fail('nothing is playing')
  if (!track.streamUrl) fail(`${track.title} plays from this computer - drop --now and pick its file`)
  ctx.print(`fetching ${track.title}…`, 'dim')
  try {
    return await fetchTrackAudio(track, undefined, ctx.signal)
  } catch (err) {
    if (isAbortError(err)) throw err
    return fail((err as Error).message)
  }
}

function checkAudio(file: File, max: number): File {
  if (!AUDIO_EXTENSIONS.includes(extensionOf(file.name))) fail(`${file.name}: pick an audio file (${AUDIO_EXTENSIONS.join(', ')})`)
  if (file.size === 0) fail(`${file.name} is empty`)
  if (file.size > max) fail(`${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(max)}`)
  return file
}

// Word sync always gets plain text; --no-adlibs leaves out everything in ( ).
function lyricsBody(text: string, source: string, mode: LyricsGenMode, ctx: TermCtx, dropAdlibs: boolean): Pick<LyricsGenRequest, 'plainLyrics' | 'syncedLyrics'> {
  const raw = text.replace(/\r\n?/g, '\n').trim()
  if (!raw) fail(`${source} has no lyrics`)
  if (mode === 'word_synced' && looksLikeLrc(raw)) ctx.print('word sync times the words alone - the LRC times are left out', 'dim')
  const t = textForMode(mode, dropAdlibs ? removeAdlibs(raw) : raw)
  if (dropAdlibs && t !== textForMode(mode, raw)) ctx.print('adlibs in ( ) left out', 'dim')
  if (!t) fail(`${source} is nothing but adlibs - drop --no-adlibs`)
  if (t.length > LYRICS_MAX_TEXT) fail(`${source} is ${t.length.toLocaleString()} characters; the limit is ${LYRICS_MAX_TEXT.toLocaleString()}`)
  return looksLikeLrc(t) ? { syncedLyrics: t } : { plainLyrics: t }
}

// Start a job, then follow it to the end. Pickers only open straight after a
// keypress, so whichever file has to be picked first is picked first thing,
// and a second pick waits for Enter.
async function start(mode: LyricsGenMode, args: string, ctx: TermCtx): Promise<void> {
  const { rest, bool, value } = parseArgs(args, ['lang', 'language', 'song', 'path', 'channel'])
  // English unless told otherwise; --lang auto lets Whisper detect it.
  const lang = (value.get('lang') ?? value.get('language') ?? 'en').toLowerCase()
  const language = lang === 'auto' || lang === 'detect' ? '' : lang
  if (language && !/^[a-z]{2,3}$/.test(language)) fail('--lang takes a two or three letter code like en, or auto to detect it')
  const now = bool.has('now')
  const songArg = value.get('song')
  const pathArg = value.get('path')
  const channel = value.get('channel')
  if ([now, songArg, pathArg].filter(Boolean).length > 1) fail('one audio source at a time: --now, --song or --path')
  if (channel && !pathArg) fail('--channel goes with --path')
  // Audio the server has: named, never uploaded.
  let server: { audio: LyricsServerAudio; name: string } | null = songArg
    ? { audio: { songId: /^\d+$/.test(songArg) ? Number(songArg) : fail('--song takes a song id (or its public number)'), path: '' }, name: `song ${songArg}` }
    : pathArg ? { audio: { path: pathArg.replace(/\\/g, '/').replace(/^\/+/, ''), channel: channel || null }, name: pathArg } : null
  const fromArg = rest[0]
  if (mode === 'plain' && (fromArg || bool.has('file') || bool.has('f') || bool.has('no-adlibs'))) fail('plain transcribes the audio alone - it takes no lyrics')
  const dropAdlibs = bool.has('no-adlibs')

  // Where the text comes from (sync modes): an earlier job, a file, or the
  // playing song's own lyrics.
  let from: LyricsGenJob | null = null
  let text: Pick<LyricsGenRequest, 'plainLyrics' | 'syncedLyrics'> = {}
  let pickLyrics = false
  if (mode !== 'plain') {
    if (fromArg) {
      from = await getLyricsJob(jobRef(fromArg).id, ctx.signal)
      if (from.status !== 'completed') fail(`that job is ${from.status}${from.error ? `: ${from.error}` : ''}`)
      text = lyricsBody(lyricsToTime(from.result.plain_lyrics || from.plain_lyrics || '', from.result.synced_lyrics ?? ''), 'that job', mode, ctx, dropAdlibs)
    } else if (!bool.has('file') && !bool.has('f') && now) {
      const track = st().currentTrack ?? fail('nothing is playing')
      const full = st().currentTrackFull
      const loaded = full && full.id === track.id && !full.lyricsPending ? full : fail(`${track.title}'s lyrics are still loading - try again in a moment`)
      const own = lyricsToTime(loaded.lyrics ?? '', loaded.syncedLyrics ?? '') || fail(`${track.title} has no lyrics - run lyricsgen plain --now first, or add --file`)
      text = lyricsBody(own, `${track.title}'s lyrics`, mode, ctx, dropAdlibs)
    } else pickLyrics = true
  }

  // The audio: --song/--path, the playing song, the job's own server audio,
  // the audio the last job used (same song), or a pick.
  const fresh = !bool.has('audio') && !now && !server
  const fromServer = from && jobServerAudio(from)
  if (fresh && from && fromServer) server = { audio: fromServer, name: jobTitle(from) }
  else if (fresh && !from && lastServer) server = lastServer
  const reused = !!server && server === lastServer
  if (now) {
    const track = st().currentTrack ?? fail('nothing is playing')
    const own = trackServerAudio(track)
    if (own) server = { audio: own, name: track.title }
  }
  const sameSong = fresh && !server && lastAudio && (!from || from.filename === lastAudio.name)
  let audio: File | null = sameSong ? lastAudio : null
  const pickAudio = !now && !server && !audio
  if (pickAudio) audio = await pickLocalFile('audio/*')
  if (pickLyrics) {
    if (pickAudio) await ctx.ask('press Enter to choose the lyrics (.txt or .lrc) ')
    const file = await pickLocalFile('.txt,.lrc,text/plain')
    text = lyricsBody(await file.text(), file.name, mode, ctx, dropAdlibs)
  }

  const options = await getLyricsGenOptions(ctx.signal)
  const opt = options.options.find((o) => o.mode === mode)
  if (!options.available) fail(`lyrics generation is off: ${options.unavailable_reason || 'unavailable'}`)
  if (opt && !opt.available) fail(`${MODE_NAME[mode]} isn't available: ${opt.unavailable_reason || 'unavailable'}`)
  const req = { mode, language: language || undefined, ...text }

  let job: LyricsGenJob
  if (server) {
    if (reused) ctx.print(`using ${server.name} again (--audio picks another)`, 'dim')
    ctx.print(`starting on ${server.name} (on the server, nothing to upload)…`, 'dim')
    job = await createLyricsJobFromServer(server.audio, req, ctx.signal)
    lastServer = server
    lastAudio = null
  } else {
    if (now) audio = await nowPlayingAudio(ctx)
    const file = checkAudio(audio!, options.max_file_size || LYRICS_MAX_FILE_SIZE)
    if (!pickAudio && !now) ctx.print(`using ${file.name} again (--audio picks another)`, 'dim')
    lastAudio = file
    lastServer = null
    ctx.print(`uploading ${file.name} (${formatBytes(file.size)})…`, 'dim')
    let shown = 0
    job = await createLyricsJob(file, req, (f) => {
      const pct = Math.floor(f * 4) * 25
      if (pct > shown && pct < 100) { shown = pct; ctx.print(`${file.name} ${pct}%`, 'dim') }
    }, ctx.signal)
  }
  remember([{ id: job.id, mode: job.mode, filename: jobTitle(job) || audio?.name || '', created_at: job.created_at }, ...remembered().filter((j) => j.id !== job.id)])
  ctx.print(`started ${MODE_NAME[mode]} job 1 (${job.id.slice(0, 8)}) for ${jobTitle(job)}`, 'ok')
  const done = await follow(ctx, job.id)
  if (done) printResult(ctx, done, 1)
}

const JOB_STATUSES = ['active', 'queued', 'processing', 'completed', 'failed', 'cancelled']
const JOBS_PAGE = 25

// The numbers in the last `lyricsjobs` listing, so `show 3` means row 3.
let adminRows: LyricsAdminJobSummary[] = []

function adminRef(arg: string | undefined): string {
  const q = (arg ?? '').trim().toLowerCase().replace(/^#/, '')
  if (!q) fail('lyricsjobs show|get <number from the list, or a job id>')
  if (/^\d+$/.test(q)) return adminRows[Number(q) - 1]?.id ?? fail(adminRows.length ? `no row ${q} in the last list` : 'run lyricsjobs first to number the jobs')
  const hits = adminRows.filter((j) => j.id.toLowerCase().startsWith(q))
  if (hits.length === 1) return hits[0].id
  if (/^[0-9a-f-]{36}$/.test(q)) return q
  return fail(hits.length ? `${hits.length} jobs match "${q}" - type more of the id` : `no job "${q}" in the last list - use the full id`)
}

async function runAdminJobs(args: string, ctx: TermCtx): Promise<void> {
  const [, first, rest] = /^(\S*)\s*([\s\S]*)$/.exec(args.trim())!
  const sub = first.toLowerCase()
  const { rest: words, bool, value } = parseArgs(['show', 'get', 'cancel', 'stop'].includes(sub) ? rest : args, ['user', 'page'])
  if (sub === 'cancel' || sub === 'stop') {
    const id = adminRef(words[0])
    const row = adminRows.find((j) => j.id === id)
    if (!confirmAction(ctx, `Cancel ${row ? `${row.user.username}'s ${row.filename}` : 'this lyrics job'}?`, bool.has('y'))) return
    const job = await cancelAdminLyricsJob(id)
    ctx.print(`cancelled ${job.filename} (${job.user.username})`, 'ok')
    if (row) row.status = job.status
    ctx.print('if Whisper had already started on it, it runs to the end and the result is thrown away', 'dim')
    return
  }
  if (sub === 'show' || sub === 'get') {
    const id = adminRef(words[0])
    if (sub === 'show') {
      const job = await getAdminLyricsJob(id, ctx.signal)
      if (asJson(ctx, bool.has('json'), job)) return
      ctx.print(`${job.user.username} · ${MODE_NAME[job.mode]} · ${jobTitle(job)}${job.language ? ` · ${job.language}` : ''} · ${statusText(job)} · ${relativeTime(job.created_at)}${fromText(job)}`, 'dim')
      printResult(ctx, job, null)
      return
    }
    const job = await getAdminLyricsJob(id, ctx.signal)
    await saveOutput(ctx, job, words[1]?.toLowerCase(), bool.has('original'), fetchAdminLyricsJobOutput)
    return
  }
  const status = (sub && sub !== 'ls' && !sub.startsWith('-') ? sub : '') || (bool.has('active') ? 'active' : '')
  if (status && !JOB_STATUSES.includes(status)) fail(`status is one of: ${JOB_STATUSES.join(', ')}`)
  const page = Math.max(1, Number(value.get('page') ?? 1) || 1)
  const data = await listAdminLyricsJobs({ status, user: value.get('user'), limit: JOBS_PAGE, offset: (page - 1) * JOBS_PAGE }, ctx.signal)
  adminRows = data.results
  if (asJson(ctx, bool.has('json'), data)) return
  ctx.print(`${data.active} running or waiting now · ${data.count} job${data.count === 1 ? '' : 's'}${status || value.get('user') ? ' match' : ''}`, 'dim')
  if (!data.results.length) { ctx.print('no jobs', 'dim'); return }
  ctx.print(table(data.results.map((j, i) => [String(i + 1), j.user.username, MODE_NAME[j.mode], statusText(j), jobTitle(j), relativeTime(j.created_at)])))
  if (data.count > page * JOBS_PAGE) ctx.print(`page ${page} of ${Math.ceil(data.count / JOBS_PAGE)} - lyricsjobs --page ${page + 1}`, 'dim')
}

export const LYRICS_GEN_COMMANDS: TermCommand[] = [
  {
    name: 'lyricsgen', aliases: ['lyricgen'], group: 'Account',
    usage: 'lyricsgen [ls] · status · plain [--now | --song <id> | --path <file> [--channel c]] · sync|words [<job> | --file] [--now | --song | --path] [--no-adlibs] · show|wait|get|rm <job> · timing <job> [<line>[.<word>] [+0.2 | -0.05 | 1:13.40] | reset [<line>[.<word>]]]',
    description: 'Donors: generate lyrics with Whisper. plain transcribes a song; sync and words time your lyrics to it (from an earlier job, a .txt/.lrc file, or with --now the playing song and its lyrics). Audio the server has is named, not uploaded: --now on an API song, --song <id>, or --path <comp file> (--channel for another comp); a follow-up on such a job uses it again. Word sync always sends plain text; --no-adlibs leaves out everything in ( ). Language is English unless --lang es (or --lang auto to detect). --audio picks new audio. get <job> txt|lrc|enhanced downloads. timing <job> lists the lines of a sync and timing <job> 12 the words of line 12; timing <job> 12.3 +0.2 starts its third word 0.2s later (-0.05 earlier, 1:13.40 at that time), timing <job> 12 -0.5 moves the whole line, and timing <job> reset puts it all back. As with Adjust timing in the dialog, the changes stay on this device and get uses them (--original for the timing as the server made it)',
    covers: ['lyricsGenApi.listLyricsJobs', 'lyricsGenApi.getLyricsGenOptions', 'lyricsGenApi.createLyricsJob', 'lyricsGenApi.createLyricsJobFromServer', 'lyricsGenApi.getLyricsJob', 'lyricsGenApi.fetchLyricsJobOutput', 'lyricsGenApi.deleteLyricsJob', 'lyricsGenApi.fetchTrackAudio'],
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return SUBCOMMANDS.filter((v) => v.startsWith(p))
      if (before[0] === 'get' && before.length === 2) return ['txt', 'lrc', 'enhanced'].filter((v) => v.startsWith(p))
      if (before[0] === 'timing' && before.length === 2) return ['reset'].filter((v) => v.startsWith(p))
      return []
    },
    run: async (args, ctx) => {
      const account = st().account ?? fail('sign in first (login)')
      if (account.is_donor === false) fail('lyrics generation is for donors')
      const [, first, rest] = /^(\S*)\s*([\s\S]*)$/.exec(args.trim())!
      const sub = (first || 'ls').toLowerCase()
      if (Object.prototype.hasOwnProperty.call(MODES, sub)) {
        if (rest.trim() && !rest.trim().startsWith('-')) await refreshJobs(ctx.signal)
        await start(MODES[sub], rest, ctx)
        return
      }
      const { rest: words, bool } = parseArgs(rest)
      if (sub !== 'status' && sub !== 'options') await refreshJobs(ctx.signal)
      if (sub === 'ls' || sub === 'list' || sub === '--json') {
        const json = bool.has('json') || sub === '--json'
        const list = remembered()
        if (!list.length) { ctx.print('no lyrics jobs yet (lyricsgen plain)', 'dim'); return }
        const shown = list.slice(0, 20)
        // Rows the server listed carry their status; a saved id the list lacks
        // (server unreachable) is asked for one by one.
        const jobs = await Promise.all(shown.map((j) => summaries.get(j.id) ?? (summaries.size ? null : getLyricsJob(j.id, ctx.signal).catch((err: Error) => (/not found/i.test(err.message) ? null : err)))))
        const gone = new Set(shown.filter((_, i) => jobs[i] === null).map((j) => j.id))
        if (gone.size) remember(list.filter((j) => !gone.has(j.id)))
        const kept = shown.map((j, i) => ({ j, r: jobs[i] })).filter((x) => x.r !== null)
        if (asJson(ctx, json, kept.map((x) => (x.r instanceof Error ? { id: x.j.id, error: x.r.message } : x.r)))) return
        if (!kept.length) { ctx.print('no lyrics jobs left (previews expire after 7 days)', 'dim'); return }
        ctx.print(table(kept.map(({ j, r }, i) => [String(i + 1), MODE_NAME[j.mode], r instanceof Error ? `? ${r.message}` : statusText(r!), r instanceof Error ? j.filename : jobTitle(r!), j.created_at ? relativeTime(j.created_at) : ''])))
      } else if (sub === 'status' || sub === 'options') {
        const o = await getLyricsGenOptions(ctx.signal)
        if (asJson(ctx, bool.has('json'), o)) return
        ctx.print(o.available ? `available · audio up to ${formatBytes(o.max_file_size)}` : `off: ${o.unavailable_reason || 'unavailable'}`, o.available ? 'ok' : 'error')
        ctx.print(table(o.options.map((m) => [MODE_NAME[m.mode], m.label, m.available ? (m.requires_lyrics ? 'needs lyrics' : 'audio only') : `off: ${m.unavailable_reason || 'unavailable'}`])))
        ctx.print('this checks the server has Whisper installed, not that its worker is running', 'dim')
      } else if (sub === 'show' || sub === 'wait') {
        const ref = jobRef(words[0])
        const n = remembered().findIndex((j) => j.id === ref.id)
        const job = sub === 'wait' ? await follow(ctx, ref.id) : await getLyricsJob(ref.id, ctx.signal)
        if (!job || asJson(ctx, bool.has('json'), job)) return
        ctx.print(`${MODE_NAME[job.mode]} · ${jobTitle(job)}${job.language ? ` · ${job.language}` : ''} · ${statusText(job)} · ${relativeTime(job.created_at)}${fromText(job)}`, 'dim')
        printResult(ctx, job, n >= 0 ? n + 1 : null)
      } else if (sub === 'get' || sub === 'download') {
        const job = await getLyricsJob(jobRef(words[0]).id, ctx.signal)
        await saveOutput(ctx, job, words[1]?.toLowerCase(), bool.has('original'), fetchLyricsJobOutput)
      } else if (sub === 'timing' || sub === 'time') {
        await runTiming(ctx, words, bool.has('json'))
      } else if (sub === 'rm' || sub === 'delete') {
        const ref = jobRef(words[0])
        if (!confirmAction(ctx, `Delete the lyrics preview for ${ref.filename || ref.id}?`, bool.has('y'))) return
        await deleteLyricsJob(ref.id)
        remember(remembered().filter((j) => j.id !== ref.id))
        ctx.print(`deleted ${ref.filename || ref.id}`, 'ok')
      } else fail('usage: lyricsgen [ls | status | plain | sync | words | show | wait | get | timing | rm]')
    },
  },
  {
    name: 'lyricsjobs', group: 'Admin', usage: 'lyricsjobs [active|queued|processing|completed|failed|cancelled] [--user name] [--page n] [--json] · show|get|cancel <row|id> [txt|lrc|enhanced]',
    description: "Every user's lyrics generation jobs: what is running or waiting, and the history. show prints a job's lyrics, get downloads them, cancel stops a queued or running job. Row numbers are from the last list",
    covers: ['lyricsGenApi.listAdminLyricsJobs', 'lyricsGenApi.getAdminLyricsJob', 'lyricsGenApi.fetchAdminLyricsJobOutput', 'lyricsGenApi.cancelAdminLyricsJob'],
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return [...JOB_STATUSES, 'show', 'get', 'cancel'].filter((v) => v.startsWith(p))
      if (before[0] === 'get' && before.length === 2) return ['txt', 'lrc', 'enhanced'].filter((v) => v.startsWith(p))
      return []
    },
    run: runAdminJobs,
  },
  {
    name: 'lyricsmodel', group: 'Admin', usage: 'lyricsmodel [<model> | default] [--json]',
    description: 'The Whisper model lyrics generation uses. No argument shows it; default goes back to the server setting. Applies from the next job',
    covers: ['lyricsGenApi.getLyricsAdminSettings', 'lyricsGenApi.setLyricsWhisperModel'],
    complete: async (before, partial) => (before.length === 0 ? ['default', ...(await getLyricsAdminSettings().then((s) => s.available_models).catch(() => []))].filter((m) => m.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { rest, bool } = parseArgs(args)
      const want = rest[0]?.toLowerCase()
      let s = await getLyricsAdminSettings(ctx.signal)
      if (want) {
        const model = want === 'default' || want === 'reset' ? '' : s.available_models.find((m) => m.toLowerCase() === want) ?? fail(`not a Whisper model. Pick one of: ${s.available_models.join(', ')}`)
        s = await setLyricsWhisperModel(model)
      }
      if (asJson(ctx, bool.has('json'), s)) return
      ctx.print(`${s.effective_model}${s.whisper_model ? '' : ' (server default)'}`, want ? 'ok' : 'plain')
      ctx.print(`server default ${s.default_model}${s.updated_by ? ` · last set by ${s.updated_by}${s.updated_at ? ` ${relativeTime(s.updated_at)}` : ''}` : ''}`, 'dim')
      if (!want) ctx.print(`models: ${s.available_models.join(', ')}`, 'dim')
      else ctx.print('the next job uses it; one that has not been used before downloads first, so that job is slow', 'dim')
    },
  },
]
