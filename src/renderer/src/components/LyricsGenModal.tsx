import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import {
  AlertCircle, AudioLines, Check, Clock, FileText, Heart, ListChecks, Loader2, LogIn, MicVocal, Music2, Plus, ShieldCheck, Sparkles, Upload, X,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import type { LyricsGenTarget } from '../types'
import {
  createLyricsJob, fetchTrackAudio, getLyricsGenOptions, getLyricsJob, isFinished, listLyricsJobs, looksLikeLrc, lyricsForMode,
  LYRICS_AUDIO_EXTENSIONS, LYRICS_MAX_FILE_SIZE, LYRICS_MAX_TEXT,
  type LyricsGenJob, type LyricsGenJobSummary, type LyricsGenMode, type LyricsGenOptions,
} from '../lib/lyricsGenApi'
import { getSongById } from '../lib/juicewrldApi'
import { trackIdToSongId } from '../lib/userApi'
import { extensionOf } from '../lib/donorFilesApi'
import { isAbortError } from '../lib/apiClient'
import { errorMessage, formatBytes } from '../lib/format'
import { isDonorStreamUrl } from '../lib/donorPlayback'
import { pickLocalFile } from '../lib/terminal/pick'
import { useSlidingIndicator } from '../hooks/useSlidingIndicator'
import { useContentMotion } from '../hooks/useContentMotion'
import { ModalOverlay, LockToggle } from './Modal'
import ThemedSelect from './ThemedSelect'
import { relativeTime } from './adminShared'
import { MODE_INFO } from './lyricsGenShared'
import LyricsGenJobView from './LyricsGenJobView'
import { AdminJobs, MyJobs } from './LyricsGenJobLists'

// "Generate lyrics": the donor lyrics generation (Whisper on the server) as a
// dialog, the same jobs the terminal's lyricsgen / lyricsjobs / lyricsmodel
// reach. New job is a short form - the audio (a file, or a song's own audio),
// what to make, the lyrics to time for the sync modes, the language - and a
// started job opens straight into its live view. Your jobs lists the account's
// jobs; administrators also get All jobs, with the Whisper model choice.
//
// Results are previews: nothing here writes to a song. The audio is held by
// the dialog, because the server deletes it after every job and a follow-up
// (sync the transcript you just fixed) has to upload it again.

type Tab = 'create' | 'jobs' | 'admin'
type SourceTrack = NonNullable<LyricsGenTarget['track']>

const JOBS_POLL_MS = 5000
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

  const [tab, setTab] = useState<Tab>(target.tab ?? (!isDonor && isAdmin ? 'admin' : 'create'))
  const [openJob, setOpenJob] = useState<{ id: string; admin: boolean } | null>(null)

  // ── The form ──
  const [audio, setAudio] = useState<File | null>(null)
  // The song the audio came from (its lyrics can seed a sync), and the one on
  // offer before any audio is chosen.
  const [audioTrack, setAudioTrack] = useState<SourceTrack | null>(null)
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
  const [language, setLanguage] = useState('')
  // The file a follow-up or retry should run on, when it isn't the one held.
  const [expectedAudio, setExpectedAudio] = useState<string | null>(null)
  const [options, setOptions] = useState<LyricsGenOptions | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<number | null>(null)
  const uploadAbort = useRef<AbortController | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

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
    const ac = new AbortController()
    loadAbort.current = ac
    setFormError(null)
    setLoadingTrack({ track, progress: 0 })
    fetchTrackAudio(track, (progress) => setLoadingTrack({ track, progress }), ac.signal)
      .then((file) => { setAudio(file); setAudioTrack(track) })
      .catch((e) => { if (!isAbortError(e)) setFormError(errorMessage(e, `Couldn't load ${track.title}`)) })
      .finally(() => { if (loadAbort.current === ac) { loadAbort.current = null; setLoadingTrack(null) } })
  }, [])

  // Opened (or re-opened) on a song: offer it, and load its audio straight
  // away unless some audio is already here.
  const audioRef = useRef(audio)
  audioRef.current = audio
  useEffect(() => {
    if (target.tab) setTab(target.tab)
    if (!target.track) return
    setSuggested(target.track)
    if (!audioRef.current && isDonor && canLoad(target.track)) {
      setTab('create')
      setOpenJob(null)
      loadTrack(target.track)
    }
  }, [target, isDonor, loadTrack])

  useEffect(() => () => { loadAbort.current?.abort(); uploadAbort.current?.abort() }, [])

  const offer = suggested ?? (currentTrack && currentTrack.genre !== 'unsurfaced' ? currentTrack : null)
  const lyricsTrack = audioTrack ?? offer
  const lyricsSongId = lyricsTrack ? (lyricsTrack === target.track && target.songId) || trackIdToSongId(lyricsTrack.id) : null
  const maxSize = options?.max_file_size || LYRICS_MAX_FILE_SIZE

  const takeFile = (file: File): void => {
    loadAbort.current?.abort()
    if (!isAudioName(file.name)) { setFormError(`${file.name} isn't an audio file the server takes (${LYRICS_AUDIO_EXTENSIONS.join(', ')})`); return }
    if (!file.size) { setFormError(`${file.name} is empty`); return }
    if (file.size > maxSize) { setFormError(`${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(maxSize)}`); return }
    setFormError(null)
    setAudio(file)
    setAudioTrack(null)
  }
  const pickAudio = (): void => { pickLocalFile('audio/*').then(takeFile, () => {}) }
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) takeFile(file)
  }

  // ── Lyrics sources for the sync modes ──
  // Text filled from a song or a job keeps both its versions: line sync gets
  // the plain words, word sync the LRC (see lyricsForMode). Switching between
  // the two swaps it for the other version, unless it has been edited since.
  const [filled, setFilled] = useState<{ plain: string; lrc: string; text: string } | null>(null)
  const fill = (plain: string, lrc: string): boolean => {
    const t = lyricsForMode(mode, plain, lrc)
    if (!t) return false
    setText(t)
    setFilled({ plain, lrc, text: t })
    setFormError(null)
    return true
  }
  const pickMode = (m: LyricsGenMode): void => {
    setMode(m)
    setModePicked(true)
    setFormError(null)
    if (filled && m !== 'plain' && text.trim() === filled.text) {
      const t = lyricsForMode(m, filled.plain, filled.lrc)
      setText(t)
      setFilled({ ...filled, text: t })
    }
  }

  const fillFromSong = async (): Promise<void> => {
    if (!lyricsTrack) return
    const full = currentTrackFull && currentTrackFull.id === lyricsTrack.id && !currentTrackFull.lyricsPending ? currentTrackFull : null
    let plain = full?.lyrics ?? ''
    let lrc = full?.syncedLyrics ?? ''
    if (!plain.trim() && !lrc.trim() && lyricsSongId) {
      setTextBusy(true)
      try {
        const song = await getSongById(lyricsSongId)
        plain = song.lyrics ?? ''
        lrc = song.synced_lyrics ?? ''
      } catch (e) {
        setFormError(errorMessage(e, `Couldn't load ${lyricsTrack.title}'s lyrics`))
        return
      } finally {
        setTextBusy(false)
      }
    }
    if (!fill(plain, lrc)) setFormError(`${lyricsTrack.title} has no lyrics yet. Transcribe it first, then sync the result`)
  }
  const fillFromJob = async (id: string): Promise<void> => {
    setTextBusy(true)
    try {
      const job = await getLyricsJob(id)
      if (!fill(job.result.plain_lyrics || job.plain_lyrics || '', job.result.synced_lyrics ?? '')) setFormError('That job has no lyrics in it')
      setExpectedAudio(job.filename)
    } catch (e) {
      setFormError(errorMessage(e, 'Could not load that job'))
    } finally {
      setTextBusy(false)
    }
  }
  const fillFromFile = (): void => {
    pickLocalFile('.txt,.lrc,text/plain').then((f) => f.text()).then((t) => { setText(t.trim()); setFilled(null); setFormError(null) }, () => {})
  }

  // Follow-ups from a job: back to the form with its text, same audio.
  const continueFrom = (job: Pick<LyricsGenJob, 'filename'>, nextMode: LyricsGenMode, nextText: string, lang?: string): void => {
    setMode(nextMode)
    setModePicked(false)
    setText(nextText.trim())
    setFilled(null)
    if (lang !== undefined) setLanguage(lang)
    setExpectedAudio(job.filename)
    setFormError(null)
    setOpenJob(null)
    setTab('create')
  }

  const trimmed = text.trim()
  const needsText = mode !== 'plain'
  const modeOption = options?.options.find((o) => o.mode === mode)
  const blocked = !options ? (optionsError ? 'Lyrics generation is out of reach right now' : 'Checking the server…')
    : !options.available ? `Lyrics generation is off: ${options.unavailable_reason || 'unavailable'}`
    : modeOption && !modeOption.available ? `${MODE_INFO[mode].title} is off: ${modeOption.unavailable_reason || 'unavailable'}`
    : !audio ? 'Choose the audio first'
    : needsText && !trimmed ? 'Add the lyrics to time'
    : needsText && trimmed.length > LYRICS_MAX_TEXT ? `The lyrics are over ${LYRICS_MAX_TEXT.toLocaleString()} characters`
    : null

  const submit = async (): Promise<void> => {
    if (blocked || !audio || uploading !== null) return
    const ac = new AbortController()
    uploadAbort.current = ac
    setFormError(null)
    setUploading(0)
    try {
      const lyrics = needsText ? (looksLikeLrc(trimmed) ? { syncedLyrics: trimmed } : { plainLyrics: trimmed }) : {}
      const job = await createLyricsJob(audio, { mode, language: language || undefined, ...lyrics }, setUploading, ac.signal)
      setJobs((js) => [job, ...(js ?? []).filter((j) => j.id !== job.id)])
      setExpectedAudio(null)
      setOpenJob({ id: job.id, admin: false })
    } catch (e) {
      if (!isAbortError(e)) setFormError(errorMessage(e, 'Lyrics generation failed to start'))
    } finally {
      uploadAbort.current = null
      setUploading(null)
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof Plus; badge?: number }[] = [
    ...(isDonor ? [{ id: 'create' as Tab, label: 'New job', icon: Sparkles }, { id: 'jobs' as Tab, label: 'Your jobs', icon: ListChecks, badge: activeCount }] : []),
    ...(isAdmin ? [{ id: 'admin' as Tab, label: 'All jobs', icon: ShieldCheck }] : []),
  ]
  const shownTab: Tab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? 'create'
  const { containerRef: tabsRef, indicatorRef } = useSlidingIndicator<HTMLDivElement>(shownTab)
  const bodyRef = useRef<HTMLDivElement>(null)
  useContentMotion(bodyRef, `${shownTab}:${openJob?.id ?? ''}`)

  const showForm = isDonor && shownTab === 'create' && !openJob
  const completedJobs = (jobs ?? []).filter((j) => j.status === 'completed')
  const wrongAudio = expectedAudio && audio && audio.name !== expectedAudio

  return (
    <ModalOverlay
      onClose={close}
      zIndexClassName="z-[60]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-[600px] h-[90svh] md:h-[740px] max-h-[92svh]"
      minWidth={420} minHeight={480}
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
                <h2 className="text-text-primary text-[15px] font-semibold leading-tight">Generate lyrics</h2>
                <p className="text-[11px] text-text-muted truncate">Whisper on the server · previews only, nothing is saved to a song</p>
              </div>
              <div className="flex items-center gap-1">
                {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
                <button onClick={close} title="Close" className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
                  <X size={17} />
                </button>
              </div>
            </div>
            {tabs.length > 1 && (
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
            )}
          </div>

          <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
            {!account ? (
              <Gate
                icon={<LogIn size={24} className="text-accent" />}
                tone="accent"
                title="Sign in to generate lyrics"
                blurb="Lyrics generation is for donors. Sign in to check your account."
                action={<button onClick={() => setShowUserAuth(true)} className={PRIMARY_BTN}><LogIn size={15} /> Sign in</button>}
              />
            ) : !isDonor && shownTab !== 'admin' ? (
              <Gate
                icon={<Heart size={24} className="text-pink-400" fill="currentColor" />}
                tone="pink"
                title="A donor perk"
                blurb="Donors can turn any song into lyrics, line-synced LRC or word-by-word karaoke timing, then review and download the result."
              />
            ) : openJob ? (
              <LyricsGenJobView
                key={openJob.id}
                jobId={openJob.id}
                admin={openJob.admin}
                audio={audio}
                backLabel={openJob.admin ? 'All jobs' : shownTab === 'jobs' ? 'Your jobs' : 'New job'}
                onBack={() => setOpenJob(null)}
                onContinue={(job, m, t) => continueFrom(job, m, t)}
                onRetry={(job) => continueFrom(job, job.mode, job.plain_lyrics ?? '', job.language ?? '')}
                onDeleted={(id) => { setJobs((js) => js?.filter((j) => j.id !== id) ?? js); setOpenJob(null) }}
                onUpdate={(job) => { if (!openJob.admin) setJobs((js) => js?.map((j) => (j.id === job.id ? { ...j, status: job.status, error: job.error, language: job.language } : j)) ?? js) }}
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
            ) : (
              <div>
                {options && !options.available && (
                  <Banner tone="amber">Lyrics generation is off right now: {options.unavailable_reason || 'unavailable'}</Banner>
                )}
                {optionsError && <Banner tone="red">{optionsError}</Banner>}

                {/* 1. Audio */}
                <Step n={1} title="Audio" done={!!audio}>
                  {loadingTrack ? (
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
                      {audioTrack ? <Cover track={audioTrack} /> : (
                        <span className="w-11 h-11 shrink-0 rounded-xl bg-accent/15 text-accent flex items-center justify-center"><AudioLines size={20} /></span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text-primary font-medium truncate" title={audio.name}>{audioTrack?.title ?? audio.name}</p>
                        <p className="text-[11px] text-text-muted truncate">
                          {formatBytes(audio.size)} · {audioTrack ? audio.name : 'from this computer'}
                        </p>
                      </div>
                      <button onClick={pickAudio} disabled={uploading !== null} className={SMALL_BTN}>Change</button>
                      <button
                        onClick={() => { setAudio(null); setAudioTrack(null) }}
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
                      className={`rounded-2xl border-2 border-dashed px-4 py-6 flex flex-col items-center text-center transition-colors ${
                        dragOver ? 'border-accent bg-accent/5' : 'border-[var(--border)] bg-surface-overlay/20'
                      }`}
                    >
                      <span className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${dragOver ? 'bg-accent text-white' : 'bg-surface-overlay text-text-muted'}`}>
                        <Upload size={19} />
                      </span>
                      <p className="mt-3 text-sm text-text-primary font-medium">Drop a song here</p>
                      <p className="mt-0.5 text-[11px] text-text-muted">MP3, FLAC, WAV, M4A and more · up to {formatBytes(maxSize)} and 30 minutes</p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        <button onClick={pickAudio} className={SMALL_BTN}><FileText size={13} /> Choose a file</button>
                        {canLoad(offer) && (
                          <button onClick={() => loadTrack(offer)} className={`${SMALL_BTN} max-w-[260px]`}>
                            <Music2 size={13} className="shrink-0" /> <span className="truncate">Use {offer.title}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {expectedAudio && (!audio || wrongAudio) && !loadingTrack && (
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300/90">
                      <AlertCircle size={12} className="shrink-0 mt-px" />
                      <span>
                        {audio ? `This isn't ${expectedAudio}, the audio that job used. ` : `Choose ${expectedAudio} again. `}
                        The server deletes the audio after every job, so each one uploads it.
                      </span>
                    </p>
                  )}
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
                  <Step n={3} title="Lyrics to time" done={!!trimmed && trimmed.length <= LYRICS_MAX_TEXT} className={modePicked ? 'animate-disclosure-in' : ''}>
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
                          options={completedJobs.map((j) => ({ value: j.id, label: `${j.filename} · ${MODE_INFO[j.mode].title} · ${relativeTime(j.created_at)}` }))}
                          className={`${CHIP} pr-2`}
                          menuClassName="max-w-[360px]"
                        />
                      )}
                      <button onClick={fillFromFile} disabled={textBusy} className={CHIP}><FileText size={12} /> Open .txt or .lrc</button>
                      {textBusy && <Loader2 size={13} className="animate-spin text-text-muted" />}
                    </div>
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      disabled={uploading !== null}
                      spellCheck={false}
                      placeholder={'One lyric line per line, exactly as sung.\nPaste an LRC to keep its line times as guides.'}
                      className="w-full h-44 resize-y rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-4 py-3 text-sm leading-relaxed text-text-primary placeholder:text-text-muted/70 focus:outline-none focus:border-accent/60 transition-colors"
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-text-muted flex items-center gap-1.5 min-w-0">
                        {trimmed && looksLikeLrc(trimmed)
                          ? <><Clock size={11} className="text-accent shrink-0" /> <span className="truncate">LRC times found. Each line is timed within its own window</span></>
                          : trimmed ? `${trimmed.split('\n').filter((l) => l.trim()).length} lines` : 'Your text is kept exactly as written'}
                      </span>
                      <span className={`tabular-nums shrink-0 ${trimmed.length > LYRICS_MAX_TEXT ? 'text-red-300' : 'text-text-muted'}`}>
                        {trimmed.length.toLocaleString()} / {LYRICS_MAX_TEXT.toLocaleString()}
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
                      Whisper detects it from the start of the song. Set it for songs with a long intro.
                    </p>
                  </div>
                </Step>
              </div>
            )}
          </div>

          {showForm && (
            <div className="shrink-0 px-5 py-3 border-t border-[var(--border)] bg-surface flex items-center gap-3">
              {formError && uploading === null ? (
                <p className="flex-1 min-w-0 flex items-start gap-1.5 text-[11px] text-red-300 leading-snug">
                  <AlertCircle size={12} className="shrink-0 mt-px" /> <span className="min-w-0 break-words">{formError}</span>
                </p>
              ) : (
                <p className="flex-1 min-w-0 text-[11px] text-text-muted leading-snug">
                  {uploading !== null ? `Uploading ${audio?.name}` : blocked ?? 'Two jobs can run at once, ten new ones an hour.'}
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
