import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  AlertCircle, AudioLines, Check, Clock, Copy, Download, FileText, Heart, ListChecks, Loader2, LogIn, Maximize2, MicVocal, Minimize2, Music2, Plus,
  ShieldCheck, Sparkles,
  Upload, X,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import type { LyricsGenTarget } from '../types'
import {
  createLyricsJob, createLyricsJobFromServer, fetchTrackAudio, findAdlibs, getLyricsGenOptions, getLyricsJob, isFinished, jobServerAudio, jobTitle,
  listLyricsJobs, looksLikeLrc, lyricsToTime, removeAdlibs, sameServerAudio, serverAudioUrl, textForMode, trackServerAudio,
  LYRICS_AUDIO_EXTENSIONS, LYRICS_MAX_FILE_SIZE, LYRICS_MAX_TEXT,
  type LyricsGenJob, type LyricsGenJobSummary, type LyricsGenMode, type LyricsGenOptions, type LyricsServerAudio,
} from '../lib/lyricsGenApi'
import { jobTiming, timingOutput } from '../lib/lyricsTiming'
import { hasWordTiming, linesFromPlain, parseSyncedLyrics, plainOf, serializeSyncedLyrics, syncProgress } from '../lib/syncedLyrics'
import { getSongById } from '../lib/juicewrldApi'
import { trackIdToSongId } from '../lib/userApi'
import { extensionOf } from '../lib/donorFilesApi'
import { isAbortError } from '../lib/apiClient'
import { errorMessage, formatBytes } from '../lib/format'
import { isDonorStreamUrl } from '../lib/donorPlayback'
import { showAppToast } from '../lib/appToast'
import { ls } from '../lib/persist'
import { pickLocalFile } from '../lib/terminal/pick'
import { useSlidingIndicator } from '../hooks/useSlidingIndicator'
import { useContentMotion } from '../hooks/useContentMotion'
import { ModalOverlay, LockToggle } from './Modal'
import ThemedSelect from './ThemedSelect'
import { Toggle } from './SettingsRow'
import { relativeTime } from './adminShared'
import { MODE_INFO, outputName, saveText } from './lyricsGenShared'
import LyricsGenJobView from './LyricsGenJobView'
import { AdminJobs, MyJobs } from './LyricsGenJobLists'
import LyricsGenTextInput, { shiftOffsets } from './LyricsGenTextInput'
import LyricsSyncTab from './LyricsSyncTab'
import { useAudioClock, useSyncMode } from './SyncedLyricsTool'

// "Synced lyrics": timing lyrics to a song, by hand or with Whisper. Sync is
// the Synced lyrics tool (the same one as the song editor's Sync) on audio the
// dialog holds, for anyone: tap along a line or a word at a time, then nudge.
// Generate is the donor lyrics generation (Whisper on the server), the same
// jobs the terminal's lyricsgen / lyricsjobs / lyricsmodel reach: a short form
// - the audio (a file, or a song's own audio), what to make, the lyrics to
// time for the sync modes, the language - and a started job opens straight
// into its live view, where a sync's timing is fine-tuned with the same tool.
// Your jobs lists the account's jobs; administrators also get All jobs, with
// the Whisper model choice.
//
// Results are previews: nothing here writes to a song, unless the song editor
// opened the dialog and takes them back. A song or comp file the server
// already has is named, not downloaded and sent back, and a follow-up (sync
// the transcript you just fixed) names it again. Other audio is held by the
// dialog, because the server deletes uploads after every job and a follow-up
// has to upload it again.

type Tab = 'sync' | 'create' | 'jobs' | 'admin'
type SourceTrack = NonNullable<LyricsGenTarget['track']>
/** The chosen audio: a file to upload, or audio the server has. `track` is the
 *  song it came from, when there is one. */
type AudioChoice =
  | { file: File; server?: undefined; track: SourceTrack | null }
  | { file?: undefined; server: LyricsServerAudio; track: SourceTrack }
/** The audio a follow-up or retry should run on, when it isn't the one held. */
type Expected = { name: string; server: LyricsServerAudio | null }

const JOBS_POLL_MS = 5000
const DROP_ADLIBS_KEY = 'lyricsGen:dropAdlibs'
const SYNC_DRAFT_KEY = 'syncedLyrics:draft'
/** Whether the dialog fills the window, for Sync and for the other tabs. */
const SIZE_KEY = 'syncedLyrics:big'
type BigSizes = { sync: boolean; other: boolean }
const LANGUAGES = [
  { value: '', label: 'Detect it' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
]

const isAudioName = (name: string): boolean => LYRICS_AUDIO_EXTENSIONS.includes(extensionOf(name))
const canLoad = (t: SourceTrack | null | undefined): t is SourceTrack => !!t?.streamUrl && (!!t.path || isDonorStreamUrl(t.streamUrl))
const baseName = (path: string): string => path.split(/[\\/]/).pop() || path
const audioName = (a: AudioChoice): string => (a.file ? a.file.name : baseName(a.server.path))

/** A job's audio when the server has it, as a choice the form can hold. */
function jobAudio(job: Pick<LyricsGenJob, 'filename' | 'source'>): { server: LyricsServerAudio; track: SourceTrack } | null {
  const server = jobServerAudio(job)
  if (!server) return null
  const id = server.songId ? `jw-${server.songId}` : `comp:${server.channel ?? ''}:${server.path}`
  return { server, track: { id, title: jobTitle(job) || baseName(server.path), artist: '', path: server.path, streamUrl: serverAudioUrl(server) } }
}

const matches = (a: AudioChoice, e: Expected): boolean =>
  e.server ? !!a.server && sameServerAudio(a.server, e.server) : audioName(a) === e.name

export default function LyricsGenModal(): JSX.Element | null {
  const target = useStore((s) => s.lyricsGenModal)
  if (!target) return null
  return <LyricsGenDialog target={target} />
}

function LyricsGenDialog({ target }: { target: LyricsGenTarget }): JSX.Element {
  const close = useStore((s) => s.closeLyricsGen)
  const account = useStore((s) => s.account)
  const currentTrack = useStore((s) => s.currentTrack)
  const currentTrackFull = useStore((s) => s.currentTrackFull)
  const setShowUserAuth = useStore((s) => s.setShowUserAuth)
  const isDonor = !!account?.is_donor
  const isAdmin = !!account?.is_administrator

  const [tab, setTab] = useState<Tab>(target.tab ?? 'sync')
  const [openJob, setOpenJob] = useState<{ id: string; admin: boolean } | null>(null)

  // ── The form ──
  // The audio, with the song it came from (its lyrics can seed a sync), and
  // the song on offer before any audio is chosen.
  const [audio, setAudio] = useState<AudioChoice | null>(null)
  const [suggested, setSuggested] = useState<SourceTrack | null>(target.track ?? null)
  const [loadingTrack, setLoadingTrack] = useState<{ track: SourceTrack; progress: number } | null>(null)
  const loadAbort = useRef<AbortController | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [mode, setMode] = useState<LyricsGenMode>('plain')
  // The lyrics step slides in when picked here, but not when a follow-up
  // opens the form on a sync mode - the form's own fade covers that.
  const [modePicked, setModePicked] = useState(false)
  const [text, setText] = useState('')
  const [textBusy, setTextBusy] = useState(false)
  // Remove adlibs: every "(…)" is left out of the text sent, except the ones
  // clicked back in, which are held by where they start in `text`.
  const [dropAdlibs, setDropAdlibs] = useState(() => ls.get<boolean>(DROP_ADLIBS_KEY) ?? false)
  const [keptAdlibs, setKeptAdlibs] = useState<ReadonlySet<number>>(() => new Set())
  const [language, setLanguage] = useState('en')
  const [expected, setExpected] = useState<Expected | null>(null)
  const [options, setOptions] = useState<LyricsGenOptions | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<number | null>(null)
  const uploadAbort = useRef<AbortController | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // ── Sync by hand ──
  // The lyrics being timed, kept on this device until they're cleared, so
  // closing the dialog doesn't lose a half-done sync. The audio is the form's.
  const [syncLrc, setSyncLrc] = useState(() => ls.get<string>(SYNC_DRAFT_KEY) ?? '')
  // Sync opens big, with room for the lines; the forms and job lists don't
  // need it. The header's toggle changes either, and it's remembered.
  const [big, setBig] = useState<BigSizes>(() => ({ sync: true, other: false, ...ls.get<Partial<BigSizes>>(SIZE_KEY) }))
  useEffect(() => { if (syncLrc) ls.set(SYNC_DRAFT_KEY, syncLrc); else ls.remove(SYNC_DRAFT_KEY) }, [syncLrc])
  const syncLines = useMemo(() => parseSyncedLyrics(syncLrc), [syncLrc])
  const [syncMode, setSyncMode] = useSyncMode(hasWordTiming(syncLines))
  const fileUrl = useMemo(() => (audio?.file ? URL.createObjectURL(audio.file) : null), [audio?.file])
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl) }, [fileUrl])
  const syncSrc = fileUrl ?? (audio?.server ? serverAudioUrl(audio.server) : null)

  // ── The account's jobs ──
  const [jobs, setJobs] = useState<LyricsGenJobSummary[] | null>(null)
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsError, setJobsError] = useState<string | null>(null)

  const loadJobs = useCallback(async (quiet = false): Promise<void> => {
    if (!quiet) setJobsLoading(true)
    try {
      setJobs(await listLyricsJobs())
      setJobsError(null)
    } catch (e) {
      if (!quiet) setJobsError(errorMessage(e, 'Could not load your jobs'))
    } finally {
      if (!quiet) setJobsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isDonor) return
    void loadJobs()
    const ac = new AbortController()
    getLyricsGenOptions(ac.signal).then(setOptions, (e) => { if (!isAbortError(e)) setOptionsError(errorMessage(e, 'Could not reach lyrics generation')) })
    return () => ac.abort()
  }, [isDonor, loadJobs])

  // While a job runs, keep the list (and the tab's badge) moving on its own.
  const activeCount = jobs?.filter((j) => !isFinished(j)).length ?? 0
  useEffect(() => {
    if (!activeCount) return
    const t = window.setInterval(() => void loadJobs(true), JOBS_POLL_MS)
    return () => window.clearInterval(t)
  }, [activeCount, loadJobs])

  const loadTrack = useCallback((track: SourceTrack): void => {
    loadAbort.current?.abort()
    setFormError(null)
    const server = trackServerAudio(track)
    if (server) {
      loadAbort.current = null
      setLoadingTrack(null)
      setAudio({ server, track })
      return
    }
    const ac = new AbortController()
    loadAbort.current = ac
    setLoadingTrack({ track, progress: 0 })
    fetchTrackAudio(track, (progress) => setLoadingTrack({ track, progress }), ac.signal)
      .then((file) => setAudio({ file, track }))
      .catch((e) => { if (!isAbortError(e)) setFormError(errorMessage(e, `Couldn't load ${track.title}`)) })
      .finally(() => { if (loadAbort.current === ac) { loadAbort.current = null; setLoadingTrack(null) } })
  }, [])

  // Opened (or re-opened) on a song: offer it, and load its audio straight
  // away unless some audio is already here. The song editor's Auto-sync
  // brings its lyrics and mode too, and always this song's audio.
  const audioRef = useRef(audio)
  audioRef.current = audio
  useEffect(() => {
    if (target.tab) setTab(target.tab)
    if (target.prefill) {
      setMode(target.prefill.mode)
      setModePicked(false)
      setText(target.prefill.text.replace(/\r\n?/g, '\n').trim())
      setKeptAdlibs(new Set())
      setFormError(null)
    }
    if (!target.track) return
    setSuggested(target.track)
    if ((target.prefill || !audioRef.current) && canLoad(target.track)) {
      setOpenJob(null)
      loadTrack(target.track)
    }
  }, [target, loadTrack])

  useEffect(() => () => { loadAbort.current?.abort(); uploadAbort.current?.abort() }, [])

  const offer = suggested ?? (currentTrack && currentTrack.genre !== 'unsurfaced' ? currentTrack : null)
  const lyricsTrack = audio?.track ?? offer
  const lyricsSongId = lyricsTrack ? (lyricsTrack === target.track && target.songId) || trackIdToSongId(lyricsTrack.id) : null
  const maxSize = options?.max_file_size || LYRICS_MAX_FILE_SIZE

  const takeFile = (file: File): void => {
    loadAbort.current?.abort()
    if (!isAudioName(file.name)) { setFormError(`${file.name} isn't an audio file the server takes (${LYRICS_AUDIO_EXTENSIONS.join(', ')})`); return }
    if (!file.size) { setFormError(`${file.name} is empty`); return }
    setFormError(null)
    setAudio({ file, track: null })
  }
  const pickAudio = (): void => { pickLocalFile('audio/*').then(takeFile, () => {}) }
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) takeFile(file)
  }

  // ── Lyrics sources for the sync modes ──
  // Text filled from a song or a job is its plain words for both modes (see
  // lyricsToTime). New text starts with every adlib left out again; an edit
  // moves the kept ones along with it.
  const replaceText = (t: string): void => {
    setText(t.replace(/\r\n?/g, '\n'))
    setKeptAdlibs(new Set())
  }
  const editText = (next: string): void => {
    setKeptAdlibs((k) => shiftOffsets(k, text, next))
    setText(next)
  }
  const toggleAdlib = (start: number): void => {
    setKeptAdlibs((k) => {
      const next = new Set(k)
      if (!next.delete(start)) next.add(start)
      return next
    })
  }
  const toggleDropAdlibs = (): void => {
    ls.set(DROP_ADLIBS_KEY, !dropAdlibs)
    setDropAdlibs(!dropAdlibs)
  }
  const fill = (plain: string, lrc: string): boolean => {
    const t = lyricsToTime(plain, lrc)
    if (!t) return false
    replaceText(t)
    setFormError(null)
    return true
  }
  const pickMode = (m: LyricsGenMode): void => {
    setMode(m)
    setModePicked(true)
    setFormError(null)
  }

  /** The song's plain and synced lyrics: the playing track's if it's this one, else the API's. */
  const songLyrics = async (track: SourceTrack): Promise<{ plain: string; lrc: string }> => {
    const full = currentTrackFull && currentTrackFull.id === track.id && !currentTrackFull.lyricsPending ? currentTrackFull : null
    const plain = full?.lyrics ?? ''
    const lrc = full?.syncedLyrics ?? ''
    if (plain.trim() || lrc.trim() || !lyricsSongId) return { plain, lrc }
    setTextBusy(true)
    try {
      const song = await getSongById(lyricsSongId)
      return { plain: song.lyrics ?? '', lrc: song.synced_lyrics ?? '' }
    } catch (e) {
      throw new Error(errorMessage(e, `Couldn't load ${track.title}'s lyrics`))
    } finally {
      setTextBusy(false)
    }
  }

  const fillFromSong = async (): Promise<void> => {
    if (!lyricsTrack) return
    try {
      const { plain, lrc } = await songLyrics(lyricsTrack)
      if (!fill(plain, lrc)) setFormError(`${lyricsTrack.title} has no lyrics yet. Transcribe it first, then sync the result`)
    } catch (e) {
      setFormError((e as Error).message)
    }
  }
  // The audio a job ran on, for the next one: taken at once when the server
  // has it (always for a follow-up, otherwise only while nothing is chosen),
  // or else asked for.
  const expectAudioOf = (job: Pick<LyricsGenJob, 'filename' | 'source'>, take: boolean): void => {
    const own = jobAudio(job)
    if (own && (take || !audioRef.current)) {
      loadAbort.current?.abort()
      setAudio(own)
      setExpected(null)
    } else setExpected({ name: own ? own.track.title : job.filename, server: own?.server ?? null })
  }
  const takeExpected = (): void => {
    if (!expected?.server) return
    const { songId, path, channel } = expected.server
    loadAbort.current?.abort()
    setAudio(jobAudio({ filename: expected.name, source: { channel: channel ?? null, path, song: songId ? { id: songId, public_id: null, name: expected.name } : null } }))
    setExpected(null)
  }

  const fillFromJob = async (id: string): Promise<void> => {
    setTextBusy(true)
    try {
      const job = await getLyricsJob(id)
      if (!fill(job.result.plain_lyrics || job.plain_lyrics || '', job.result.synced_lyrics ?? '')) setFormError('That job has no lyrics in it')
      expectAudioOf(job, false)
    } catch (e) {
      setFormError(errorMessage(e, 'Could not load that job'))
    } finally {
      setTextBusy(false)
    }
  }
  const fillFromFile = (): void => {
    pickLocalFile('.txt,.lrc,text/plain').then((f) => f.text()).then((t) => { replaceText(t.trim()); setFormError(null) }, () => {})
  }

  // Follow-ups from a job: back to the form with its text, same audio.
  const continueFrom = (job: Pick<LyricsGenJob, 'filename' | 'source'>, nextMode: LyricsGenMode, nextText: string, lang?: string): void => {
    setMode(nextMode)
    setModePicked(false)
    replaceText(nextText.trim())
    if (lang !== undefined) setLanguage(lang)
    expectAudioOf(job, true)
    setFormError(null)
    setOpenJob(null)
    setTab('create')
  }

  // ── Lyrics for Sync ──
  // Plain text becomes untimed lines; an LRC (line or word) is taken as it is.
  const takeSyncText = (t: string): void => {
    const text = t.replace(/\r\n?/g, '\n').trim()
    setSyncLrc(looksLikeLrc(text) ? text : serializeSyncedLyrics(linesFromPlain(text)))
  }
  const syncFromSong = async (): Promise<void> => {
    if (!lyricsTrack) return
    try {
      const { plain, lrc } = await songLyrics(lyricsTrack)
      // An existing sync is the place to start: fix it rather than redo it.
      const words = looksLikeLrc(lrc) ? lrc : lyricsToTime(plain, lrc)
      if (words.trim()) takeSyncText(words)
      else showAppToast(`${lyricsTrack.title} has no lyrics yet. Paste them, or have Whisper write them down under Generate`, { tone: 'info' })
    } catch (e) {
      showAppToast((e as Error).message)
    }
  }
  const syncFromJob = async (id: string): Promise<void> => {
    setTextBusy(true)
    try {
      const job = await getLyricsJob(id)
      const text = job.mode === 'plain'
        ? job.result.plain_lyrics ?? ''
        : timingOutput(jobTiming(job).lines, job.mode === 'word_synced' ? 'enhanced_lrc' : 'lrc') ?? ''
      if (text.trim()) takeSyncText(text)
      else showAppToast('That job has no lyrics in it', { tone: 'info' })
      expectAudioOf(job, false)
    } catch (e) {
      showAppToast(errorMessage(e, 'Could not load that job'))
    } finally {
      setTextBusy(false)
    }
  }
  const syncFromFile = (): void => {
    pickLocalFile('.txt,.lrc,text/plain').then((f) => f.text()).then(takeSyncText, () => {})
  }
  // A Whisper result, timing and all, to fix by hand here. Whatever Sync held
  // before can be brought back from the toast.
  const openInSync = (job: LyricsGenJob, lrc: string): void => {
    const before = syncLrc
    const next = lrc.trim()
    setSyncLrc(next)
    if (before.trim() && before.trim() !== next) {
      showAppToast('Opened in Sync, in place of the lyrics that were there', { tone: 'info', action: { label: 'Undo', onClick: () => setSyncLrc(before) } })
    }
    expectAudioOf(job, true)
    setOpenJob(null)
    setTab('sync')
  }
  // Donors: have Whisper time what's in Sync, in Sync's mode.
  const whisperFromSync = (): void => {
    setMode(syncMode === 'words' ? 'word_synced' : 'synced')
    setModePicked(false)
    replaceText(plainOf(syncLines))
    setFormError(null)
    setTab('create')
  }
  // Back to the song editor that opened the dialog, if it's still on that song.
  const applyLrc = (lrc: string): void => {
    if (!target.apply) return
    if (target.apply.onApply(lrc)) {
      showAppToast('In the song editor now. Check it there, then submit', { tone: 'info' })
      close()
    } else showAppToast('The song editor has moved on to another song')
  }

  const trimmed = text.trim()
  const needsText = mode !== 'plain'
  const adlibs = useMemo(() => (needsText && dropAdlibs ? findAdlibs(text) : []), [needsText, dropAdlibs, text])
  const adlibsLeftOut = adlibs.filter((a) => !keptAdlibs.has(a.start)).length
  // What goes up: the text less its left-out adlibs, and for word sync no LRC times.
  const sendText = useMemo(
    () => (needsText ? textForMode(mode, dropAdlibs ? removeAdlibs(text, keptAdlibs) : text) : ''),
    [needsText, mode, dropAdlibs, text, keptAdlibs],
  )
  const modeOption = options?.options.find((o) => o.mode === mode)
  const blocked = !options ? (optionsError ? 'Lyrics generation is out of reach right now' : 'Checking the server…')
    : !options.available ? `Lyrics generation is off: ${options.unavailable_reason || 'unavailable'}`
    : modeOption && !modeOption.available ? `${MODE_INFO[mode].title} is off: ${modeOption.unavailable_reason || 'unavailable'}`
    : !audio ? 'Choose the audio first'
    : audio.file && audio.file.size > maxSize ? `${audio.file.name} is ${formatBytes(audio.file.size)}. The limit is ${formatBytes(maxSize)}`
    : needsText && !trimmed ? 'Add the lyrics to time'
    : needsText && !sendText ? 'Nothing is left once the adlibs are out. Click some to send them'
    : needsText && sendText.length > LYRICS_MAX_TEXT ? `The lyrics are over ${LYRICS_MAX_TEXT.toLocaleString()} characters`
    : null

  const lrcNote = trimmed && looksLikeLrc(trimmed)
    ? mode === 'word_synced' ? 'LRC times found. Word sync leaves them out and times the words alone' : 'LRC times found. Each line is timed within its own window'
    : null
  const adlibNote = !adlibs.length ? null
    : adlibsLeftOut ? `${adlibsLeftOut} of ${adlibs.length} adlib${adlibs.length === 1 ? '' : 's'} left out. Click a grey one to send it`
    : `${adlibs.length === 1 ? 'The adlib is' : `All ${adlibs.length} adlibs are`} sent. Click one to leave it out`
  const sentLines = sendText.split('\n').filter((l) => l.trim()).length
  const textNote = [adlibNote, lrcNote].filter(Boolean).join(' · ')
    || (trimmed ? `${sentLines} line${sentLines === 1 ? '' : 's'}`
      : dropAdlibs ? 'Your text is kept as written, less the adlibs in ( )' : 'Your text is kept exactly as written')

  const submit = async (): Promise<void> => {
    if (blocked || !audio || uploading !== null) return
    const ac = new AbortController()
    uploadAbort.current = ac
    setFormError(null)
    // Server audio has nothing to upload: straight to "Starting…".
    setUploading(audio.server ? 1 : 0)
    try {
      const lyrics = needsText ? (looksLikeLrc(sendText) ? { syncedLyrics: sendText } : { plainLyrics: sendText }) : {}
      const req = { mode, language: language || undefined, ...lyrics }
      const job = audio.server
        ? await createLyricsJobFromServer(audio.server, req, ac.signal)
        : await createLyricsJob(audio.file, req, setUploading, ac.signal)
      setJobs((js) => [job, ...(js ?? []).filter((j) => j.id !== job.id)])
      setExpected(null)
      setOpenJob({ id: job.id, admin: false })
    } catch (e) {
      if (!isAbortError(e)) setFormError(errorMessage(e, 'Lyrics generation failed to start'))
    } finally {
      uploadAbort.current = null
      setUploading(null)
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof Plus; badge?: number }[] = [
    { id: 'sync', label: 'Sync', icon: Clock },
    { id: 'create', label: 'Generate', icon: Sparkles },
    ...(isDonor ? [{ id: 'jobs' as Tab, label: 'Your jobs', icon: ListChecks, badge: activeCount }] : []),
    ...(isAdmin ? [{ id: 'admin' as Tab, label: 'All jobs', icon: ShieldCheck }] : []),
  ]
  const shownTab: Tab = tabs.some((t) => t.id === tab) ? tab : 'sync'
  const { containerRef: tabsRef, indicatorRef } = useSlidingIndicator<HTMLDivElement>(shownTab)
  const bodyRef = useRef<HTMLDivElement>(null)
  useContentMotion(bodyRef, `${shownTab}:${openJob?.id ?? ''}`)

  const showForm = isDonor && shownTab === 'create' && !openJob
  const showSync = shownTab === 'sync' && !openJob
  const { clock: syncClock, element: syncAudio } = useAudioClock(showSync ? syncSrc : null)
  const completedJobs = (jobs ?? []).filter((j) => j.status === 'completed')
  const wrongAudio = !!expected && !!audio && !matches(audio, expected)
  const syncWords = hasWordTiming(syncLines)
  const syncShown = syncLines.some((l) => !l.hidden)
  const syncDone = syncProgress(syncLines, syncMode)
  const syncName = audio?.track?.title ?? (audio ? audioName(audio) : 'lyrics')

  // The audio, for Generate's first step and the top of Sync: loading, chosen, or a drop zone.
  const audioField = (forSync: boolean): JSX.Element => (loadingTrack ? (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-surface-overlay/40 p-3">
      <Cover track={loadingTrack.track} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary font-medium truncate">Loading {loadingTrack.track.title}…</p>
        <div className="mt-2 h-1.5 rounded-full bg-surface-highest overflow-hidden">
          <div className="h-full w-full origin-left bg-accent transition-transform duration-200" style={{ transform: `scaleX(${loadingTrack.progress})` }} />
        </div>
      </div>
      <button onClick={() => loadAbort.current?.abort()} title="Stop" className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
        <X size={15} />
      </button>
    </div>
  ) : audio ? (
    <div className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-3">
      {audio.track ? <Cover track={audio.track} /> : (
        <span className="w-11 h-11 shrink-0 rounded-xl bg-accent/15 text-accent flex items-center justify-center"><AudioLines size={20} /></span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary font-medium truncate" title={audio.server?.path ?? audioName(audio)}>{audio.track?.title ?? audioName(audio)}</p>
        <p className="text-[11px] text-text-muted truncate">
          {audio.server
            ? `${audioName(audio)} · ${forSync ? 'streams from the server' : 'already on the server, nothing to upload'}`
            : `${formatBytes(audio.file.size)} · ${audio.track ? audio.file.name : 'from this computer'}`}
        </p>
      </div>
      <button onClick={pickAudio} disabled={uploading !== null} className={SMALL_BTN}>Change</button>
      <button
        onClick={() => setAudio(null)}
        disabled={uploading !== null}
        title="Remove"
        className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-50"
      >
        <X size={15} />
      </button>
    </div>
  ) : (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`rounded-2xl border-2 border-dashed px-4 ${forSync ? 'py-4' : 'py-6'} flex flex-col items-center text-center transition-colors ${
        dragOver ? 'border-accent bg-accent/5' : 'border-[var(--border)] bg-surface-overlay/20'
      }`}
    >
      <span className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${dragOver ? 'bg-accent text-white' : 'bg-surface-overlay text-text-muted'}`}>
        <Upload size={19} />
      </span>
      <p className="mt-3 text-sm text-text-primary font-medium">Drop a song here</p>
      <p className="mt-0.5 text-[11px] text-text-muted">
        {forSync ? 'MP3, FLAC, WAV, M4A and more · it plays here and isn\'t uploaded' : `MP3, FLAC, WAV, M4A and more · up to ${formatBytes(maxSize)} and 30 minutes`}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button onClick={pickAudio} className={SMALL_BTN}><FileText size={13} /> Choose a file</button>
        {canLoad(offer) && (
          <button onClick={() => loadTrack(offer)} className={`${SMALL_BTN} max-w-[260px]`}>
            <Music2 size={13} className="shrink-0" /> <span className="truncate">Use {offer.title}</span>
          </button>
        )}
      </div>
    </div>
  ))
  const expectedNote = (forSync: boolean): JSX.Element | null => (expected && (!audio || wrongAudio) && !loadingTrack ? (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300/90">
      <AlertCircle size={12} className="shrink-0 mt-px" />
      <span>
        {audio ? `This isn't ${expected.name}, the audio that job used. ` : expected.server ? `That job used ${expected.name}. ` : `Choose ${expected.name} again. `}
        {expected.server
          ? <button onClick={takeExpected} disabled={uploading !== null} className="font-semibold underline underline-offset-2 hover:text-amber-200 transition-colors">Use it</button>
          : forSync ? '' : 'The server deletes uploaded audio after every job, so each one uploads it.'}
      </span>
    </p>
  ) : null)

  const expanded = showSync ? big.sync : big.other
  const toggleBig = (): void => {
    const next = { ...big, [showSync ? 'sync' : 'other']: !expanded }
    ls.set(SIZE_KEY, next)
    setBig(next)
  }

  const copySync = (): void => {
    navigator.clipboard.writeText(syncLrc).then(() => showAppToast('Copied the LRC', { tone: 'info' }), () => showAppToast('Could not copy'))
  }

  return (
    <ModalOverlay
      onClose={close}
      zIndexClassName="z-[60]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-[600px] h-[90svh] md:h-[740px] max-h-[92svh]"
      minWidth={420} minHeight={480}
      expanded={expanded}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
        <div className="bg-surface w-full h-full flex flex-col min-h-0">
          {/* Header: title, then the tabs */}
          <div onMouseDown={onHandleMouseDown} className="relative shrink-0 px-5 pt-4 pb-3 border-b border-[var(--border)] overflow-hidden">
            <div
              aria-hidden="true"
              className="absolute -top-24 -left-16 w-80 h-48 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(closest-side, rgb(var(--accent-rgb) / 0.22), transparent)' }}
            />
            <div className="relative flex items-center gap-3">
              <span className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-accent to-accent/60 text-white flex items-center justify-center shadow-lg shadow-accent/20">
                <MicVocal size={17} />
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="text-text-primary text-[15px] font-semibold leading-tight">Synced lyrics</h2>
                <p className="text-[11px] text-text-muted truncate">
                  {showSync ? 'Time lyrics to a song by hand, line by line or word by word' : 'Whisper on the server · previews only, nothing is saved to a song'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={toggleBig}
                  title={expanded ? 'Smaller window' : 'Bigger window'}
                  aria-pressed={expanded}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
                >
                  {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
                {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
                <button onClick={close} title="Close" className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
                  <X size={17} />
                </button>
              </div>
            </div>
            <div ref={tabsRef} className="relative isolate mt-3.5 inline-flex p-1 rounded-xl bg-surface-overlay/70">
              {tabs.map((t) => {
                const on = shownTab === t.id
                return (
                  <button
                    key={t.id}
                    data-indicator-key={t.id}
                    onClick={() => { setTab(t.id); setOpenJob(null) }}
                    className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-semibold transition-colors ${on ? 'text-text-primary' : 'text-text-muted hover:text-text-primary'}`}
                  >
                    <t.icon size={13} className={on ? 'text-accent' : ''} />
                    {t.label}
                    {t.id === 'create' && !isDonor && <Heart size={10} className="text-pink-400/80" fill="currentColor" />}
                    {!!t.badge && (
                      <span className="inline-flex items-center gap-1 h-4 min-w-4 px-1.5 rounded-full bg-accent/20 text-accent text-[10px] tabular-nums">
                        <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />{t.badge}
                      </span>
                    )}
                  </button>
                )
              })}
              <div ref={indicatorRef} aria-hidden="true" className="nav-indicator rounded-lg bg-surface-raised shadow-sm" />
            </div>
          </div>

          <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
            {syncAudio}
            {openJob ? (
              <LyricsGenJobView
                key={openJob.id}
                jobId={openJob.id}
                admin={openJob.admin}
                audio={audio?.file ?? null}
                backLabel={openJob.admin ? 'All jobs' : shownTab === 'jobs' ? 'Your jobs' : 'New job'}
                onBack={() => setOpenJob(null)}
                onContinue={(job, m, t) => continueFrom(job, m, t)}
                onRetry={(job) => continueFrom(job, job.mode, job.plain_lyrics ?? '', job.language ?? '')}
                onEdit={openJob.admin ? undefined : openInSync}
                apply={target.apply ? { label: target.apply.label, onApply: applyLrc } : undefined}
                onDeleted={(id) => { setJobs((js) => js?.filter((j) => j.id !== id) ?? js); setOpenJob(null) }}
                onUpdate={(job) => { if (!openJob.admin) setJobs((js) => js?.map((j) => (j.id === job.id ? { ...j, status: job.status, progress: job.progress, error: job.error, language: job.language } : j)) ?? js) }}
              />
            ) : shownTab === 'sync' ? (
              <LyricsSyncTab
                lines={syncLines}
                onLines={setSyncLrc}
                mode={syncMode}
                onMode={setSyncMode}
                clock={syncClock}
                audioField={audioField(true)}
                audioHint={expectedNote(true)}
                song={lyricsTrack && (lyricsSongId || currentTrackFull?.id === lyricsTrack.id) ? { title: lyricsTrack.title, load: () => void syncFromSong() } : null}
                jobs={completedJobs.map((j) => ({ value: j.id, label: `${jobTitle(j)} · ${MODE_INFO[j.mode].title} · ${relativeTime(j.created_at)}` }))}
                onJob={(id) => void syncFromJob(id)}
                onFile={syncFromFile}
                onPaste={takeSyncText}
                busy={textBusy}
              />
            ) : shownTab === 'jobs' ? (
              <MyJobs
                jobs={jobs}
                loading={jobsLoading}
                error={jobsError}
                onOpen={(id) => setOpenJob({ id, admin: false })}
                onRefresh={() => void loadJobs()}
                onDeleted={(id) => setJobs((js) => js?.filter((j) => j.id !== id) ?? js)}
                onCreate={() => setTab('create')}
              />
            ) : shownTab === 'admin' ? (
              <AdminJobs onOpen={(id) => setOpenJob({ id, admin: true })} />
            ) : !account ? (
              <Gate
                icon={<LogIn size={24} className="text-accent" />}
                tone="accent"
                title="Sign in to generate lyrics"
                blurb="Whisper is for donors. Sign in to check your account. Sync works without one."
                action={<button onClick={() => setShowUserAuth(true)} className={PRIMARY_BTN}><LogIn size={15} /> Sign in</button>}
              />
            ) : !isDonor ? (
              <Gate
                icon={<Heart size={24} className="text-pink-400" fill="currentColor" />}
                tone="pink"
                title="A donor perk"
                blurb="Donors can have Whisper write a song's lyrics down, or time them by the line or by the word, then fine-tune the result. Anyone can time lyrics by hand."
                action={<button onClick={() => setTab('sync')} className={PRIMARY_BTN}><Clock size={15} /> Sync by hand</button>}
              />
            ) : (
              <div>
                {options && !options.available && (
                  <Banner tone="amber">Lyrics generation is off right now: {options.unavailable_reason || 'unavailable'}</Banner>
                )}
                {optionsError && <Banner tone="red">{optionsError}</Banner>}

                {/* 1. Audio */}
                <Step n={1} title="Audio" done={!!audio}>
                  {audioField(false)}
                  {expectedNote(false)}
                </Step>

                {/* 2. Mode */}
                <Step n={2} title="What to make" done={!!audio}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(Object.keys(MODE_INFO) as LyricsGenMode[]).map((m) => {
                      const info = MODE_INFO[m]
                      const opt = options?.options.find((o) => o.mode === m)
                      const off = !!opt && !opt.available
                      const on = mode === m
                      return (
                        <button
                          key={m}
                          onClick={() => pickMode(m)}
                          disabled={off || uploading !== null}
                          title={off ? opt?.unavailable_reason || 'Unavailable' : undefined}
                          className={`relative flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2 rounded-2xl border p-3 text-left transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                            on ? 'border-accent bg-accent/10' : 'border-[var(--border)] bg-surface-overlay/30 enabled:hover:bg-surface-overlay/70'
                          }`}
                        >
                          <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-colors ${on ? 'bg-accent text-white' : 'bg-surface-overlay text-text-secondary'}`}>
                            <info.icon size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className={`block text-sm font-semibold ${on ? 'text-text-primary' : 'text-text-secondary'}`}>{info.title}</span>
                            <span className="block text-[11px] leading-snug text-text-muted mt-0.5">{off ? opt?.unavailable_reason || 'Unavailable' : info.blurb}</span>
                          </span>
                          <span className={`absolute top-2.5 right-2.5 w-4 h-4 rounded-full bg-accent text-white flex items-center justify-center control-motion ${on ? 'opacity-100' : 'opacity-0'}`}>
                            <Check size={10} strokeWidth={3.5} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </Step>

                {/* 3. Lyrics (sync modes) */}
                {needsText && (
                  <Step n={3} title="Lyrics to time" done={!!sendText && sendText.length <= LYRICS_MAX_TEXT} className={modePicked ? 'animate-disclosure-in' : ''}>
                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      {lyricsTrack && (lyricsSongId || currentTrackFull?.id === lyricsTrack.id) && (
                        <button onClick={() => void fillFromSong()} disabled={textBusy} className={CHIP}>
                          <Music2 size={12} className="shrink-0" /> <span className="truncate max-w-[180px]">{lyricsTrack.title}'s lyrics</span>
                        </button>
                      )}
                      {completedJobs.length > 0 && (
                        <ThemedSelect
                          value=""
                          onChange={(id) => void fillFromJob(id)}
                          placeholder="From a job"
                          disabled={textBusy}
                          options={completedJobs.map((j) => ({ value: j.id, label: `${jobTitle(j)} · ${MODE_INFO[j.mode].title} · ${relativeTime(j.created_at)}` }))}
                          className={`${CHIP} pr-2`}
                          menuClassName="max-w-[360px]"
                        />
                      )}
                      <button onClick={fillFromFile} disabled={textBusy} className={CHIP}><FileText size={12} /> Open .txt or .lrc</button>
                      {textBusy && <Loader2 size={13} className="animate-spin text-text-muted" />}
                      <label
                        title="Leave out everything in ( ). Click an adlib in the text to send it anyway"
                        className="ml-auto inline-flex items-center gap-2 h-7 text-[11px] font-semibold text-text-secondary cursor-pointer select-none"
                      >
                        Remove adlibs
                        <Toggle on={dropAdlibs} onClick={toggleDropAdlibs} locked={uploading !== null} lockedReason="Uploading" />
                      </label>
                    </div>
                    <LyricsGenTextInput
                      value={text}
                      onChange={editText}
                      disabled={uploading !== null}
                      placeholder={mode === 'word_synced'
                        ? 'One lyric line per line, exactly as sung.'
                        : 'One lyric line per line, exactly as sung.\nPaste an LRC to keep its line times as guides.'}
                      adlibs={dropAdlibs ? { kept: keptAdlibs, onToggle: toggleAdlib } : null}
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-text-muted flex items-center gap-1.5 min-w-0">
                        {lrcNote && <Clock size={11} className="text-accent shrink-0" />}
                        <span className="truncate" title={textNote}>{textNote}</span>
                      </span>
                      <span className={`tabular-nums shrink-0 ${sendText.length > LYRICS_MAX_TEXT ? 'text-red-300' : 'text-text-muted'}`}>
                        {sendText.length.toLocaleString()} / {LYRICS_MAX_TEXT.toLocaleString()}
                      </span>
                    </div>
                  </Step>
                )}

                {/* Language */}
                <Step n={needsText ? 4 : 3} title="Language" done={!!audio} last>
                  <div className="flex flex-wrap items-center gap-3">
                    <ThemedSelect
                      value={language}
                      onChange={setLanguage}
                      options={LANGUAGES}
                      disabled={uploading !== null}
                      className="h-9 px-3 rounded-xl bg-surface-overlay border border-[var(--border)] text-sm text-text-primary min-w-[150px]"
                    />
                    <p className="flex-1 min-w-[180px] text-[11px] text-text-muted leading-snug">
                      English unless you pick another. Detect it guesses from the start of the song, which can go wrong on a long intro.
                    </p>
                  </div>
                </Step>
              </div>
            )}
          </div>

          {showSync && syncShown && (
            <div className="shrink-0 px-5 py-3 border-t border-[var(--border)] bg-surface flex items-center gap-2">
              <p className="flex-1 min-w-0 text-[11px] text-text-muted leading-snug">
                {syncDone.done === syncDone.total
                  ? `Every ${syncMode === 'words' ? 'word' : 'line'} has a time.`
                  : `${syncDone.done} of ${syncDone.total} ${syncMode === 'words' ? 'words' : 'lines'} timed.`}
                {' '}Kept on this device until you start over.
              </p>
              {isDonor && (
                <button onClick={whisperFromSync} title="Have Whisper time these lyrics, then fine-tune the result" className={SMALL_BTN}>
                  <Sparkles size={13} /> Auto-sync
                </button>
              )}
              <button onClick={copySync} className={SMALL_BTN}><Copy size={13} /> Copy</button>
              <button
                onClick={() => saveText(syncLrc, outputName(syncName, syncWords ? 'enhanced_lrc' : 'lrc'))}
                title={syncWords ? 'Word LRC (.words.lrc), with the line times too' : 'Line LRC (.lrc)'}
                className={SMALL_BTN}
              >
                <Download size={13} /> {syncWords ? '.words.lrc' : '.lrc'}
              </button>
              {target.apply && (
                <button onClick={() => applyLrc(syncLrc)} className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-bold bg-accent text-white hover:bg-accent/90 transition-colors">
                  <Check size={13} /> {target.apply.label}
                </button>
              )}
            </div>
          )}

          {showForm && (
            <div className="shrink-0 px-5 py-3 border-t border-[var(--border)] bg-surface flex items-center gap-3">
              {formError && uploading === null ? (
                <p className="flex-1 min-w-0 flex items-start gap-1.5 text-[11px] text-red-300 leading-snug">
                  <AlertCircle size={12} className="shrink-0 mt-px" /> <span className="min-w-0 break-words">{formError}</span>
                </p>
              ) : (
                <p className="flex-1 min-w-0 text-[11px] text-text-muted leading-snug">
                  {uploading !== null
                    ? audio?.server ? `Starting on ${audio.track.title}` : `Uploading ${audio ? audioName(audio) : ''}`
                    : blocked ?? 'Two jobs can run at once, ten new ones an hour.'}
                </p>
              )}
              <button
                onClick={() => void submit()}
                disabled={!!blocked || uploading !== null}
                className="relative overflow-hidden shrink-0 inline-flex items-center justify-center gap-2 h-10 min-w-[150px] px-5 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uploading !== null && (
                  <span aria-hidden="true" className="absolute inset-0 origin-left bg-white/20 transition-transform duration-200" style={{ transform: `scaleX(${uploading})` }} />
                )}
                <span className="relative inline-flex items-center gap-2">
                  {uploading !== null ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {uploading === null ? (mode === 'plain' ? 'Transcribe' : mode === 'synced' ? 'Sync lines' : 'Sync words')
                    : uploading < 1 ? `Uploading ${Math.round(uploading * 100)}%` : 'Starting…'}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </ModalOverlay>
  )
}

const PRIMARY_BTN = 'inline-flex items-center gap-1.5 h-9 px-4 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors'
const SMALL_BTN = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-text-secondary bg-surface-overlay hover:bg-surface-raised hover:text-text-primary transition-colors disabled:opacity-50'
const CHIP = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-[var(--border)] text-[11px] font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-50'

// One numbered step of the form, joined to the next by a line.
function Step({ n, title, done, last = false, className = '', children }: {
  n: number
  title: string
  done: boolean
  last?: boolean
  className?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className={`flex gap-3.5 ${className}`}>
      <div className="flex flex-col items-center">
        <span className={`w-6 h-6 shrink-0 rounded-full text-[11px] font-bold flex items-center justify-center border transition-colors duration-300 ${
          done ? 'bg-accent border-accent text-white' : 'border-[var(--border)] text-text-muted bg-surface'
        }`}>
          {done ? <Check size={12} strokeWidth={3} /> : n}
        </span>
        {!last && <span className={`flex-1 w-px mt-1.5 transition-colors duration-300 ${done ? 'bg-accent/40' : 'bg-[var(--border)]'}`} />}
      </div>
      <div className={`flex-1 min-w-0 ${last ? 'pb-1' : 'pb-6'}`}>
        <p className="h-6 flex items-center text-sm font-semibold text-text-primary mb-2">{title}</p>
        {children}
      </div>
    </section>
  )
}

function Cover({ track }: { track: SourceTrack }): JSX.Element {
  return track.imageUrl
    ? <img src={track.imageUrl} alt="" className="w-11 h-11 shrink-0 rounded-xl object-cover bg-surface-overlay" />
    : <span className="w-11 h-11 shrink-0 rounded-xl bg-accent/15 text-accent flex items-center justify-center"><Music2 size={19} /></span>
}

function Banner({ tone, children }: { tone: 'amber' | 'red'; children: React.ReactNode }): JSX.Element {
  return (
    <div className={`mb-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${
      tone === 'amber' ? 'border-amber-400/25 bg-amber-400/5 text-amber-200' : 'border-red-400/25 bg-red-400/5 text-red-300'
    }`}>
      <AlertCircle size={14} className="shrink-0 mt-px" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

function Gate({ icon, tone, title, blurb, action }: {
  icon: React.ReactNode
  tone: 'accent' | 'pink'
  title: string
  blurb: string
  action?: React.ReactNode
}): JSX.Element {
  return (
    <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center px-6">
      <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center ${
        tone === 'pink' ? 'bg-gradient-to-br from-pink-500/25 to-pink-500/5 border-pink-500/20' : 'bg-gradient-to-br from-accent/25 to-accent/5 border-accent/20'
      }`}>
        {icon}
      </div>
      <p className="mt-4 text-[15px] font-semibold text-text-primary">{title}</p>
      <p className="mt-1.5 text-xs text-text-muted max-w-[340px] leading-relaxed">{blurb}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
