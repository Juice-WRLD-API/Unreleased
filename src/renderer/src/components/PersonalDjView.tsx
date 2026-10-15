import { useEffect, useState } from 'react'
import { ChevronLeft, Heart, Loader2, MicVocal, Music, Play, Radio, SkipForward, Square, AlertCircle, X } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { apiFetch, buildImageUrl, getSongById } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import { formatDuration } from '../lib/format'
import { PERSONAL_DJ_VIBES } from '../lib/personalDjApi'
import type { PersonalDjTrack, PersonalDjVibe } from '../lib/personalDjApi'
import { usePersonalDj } from '../hooks/usePersonalDj'
import { GameBackdrop } from './gameShell'
import { ProgressiveCover } from './ProgressiveCover'

const cardClass = 'rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]/80'
const iconButton = 'p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors disabled:opacity-50 disabled:pointer-events-none'

function vibeLabel(vibe: string): string {
  return vibe.charAt(0).toUpperCase() + vibe.slice(1)
}

function useTrackCover(track: PersonalDjTrack | null | undefined): string | null {
  const [cover, setCover] = useState<string | null>(null)
  const songId = track?.song_id ?? null
  const title = track?.title ?? ''
  useEffect(() => {
    setCover(null)
    if (!title) return
    let cancelled = false
    const apply = (song: JWApiSong | undefined): void => {
      if (!cancelled) setCover(buildImageUrl(song?.image_url) ?? null)
    }
    const search = (): void => {
      apiFetch<{ results: JWApiSong[] }>('/songs/', { search: title, page_size: 1 })
        .then((d) => apply(d.results[0]))
        .catch(() => {})
    }
    if (songId) getSongById(songId).then(apply).catch(search)
    else search()
    return () => { cancelled = true }
  }, [songId, title])
  return cover
}

function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function Chip({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'accent' | 'live' }): JSX.Element {
  const tones = {
    muted: 'border-[var(--border)] text-text-muted',
    accent: 'border-accent/30 bg-accent/10 text-text-primary',
    live: 'border-red-500/30 bg-red-600/10 text-red-500',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-widest ${tones[tone]}`}>
      {children}
    </span>
  )
}

function QueueRow({ track, label }: { track: PersonalDjTrack; label?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-overlay transition-colors">
      <span className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
        <Music size={14} className="text-accent" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-text-primary text-sm truncate">{track.title}</span>
        <span className="block text-text-muted text-xs truncate">{[track.artist, track.era].filter(Boolean).join(' · ')}</span>
      </span>
      {label && <span className="text-[10px] font-bold uppercase tracking-widest text-accent shrink-0">{label}</span>}
    </div>
  )
}

function SignedOut({ onLogin }: { onLogin: () => void }): JSX.Element {
  return (
    <div className={`${cardClass} p-8 text-center`}>
      <MicVocal size={30} className="mx-auto text-accent mb-3" />
      <p className="text-text-primary font-semibold mb-1">Log in to meet your DJ</p>
      <p className="text-text-muted text-sm mb-5 max-w-sm mx-auto">
        Your DJ learns from what you skip and like, so every station is built around one account.
      </p>
      <button onClick={onLogin} className="px-5 py-2 rounded-full bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity">
        Log in
      </button>
    </div>
  )
}

function StartCard({ starting, djStatus, onStart }: { starting: boolean; djStatus?: string; onStart: () => void }): JSX.Element {
  return (
    <div className={`${cardClass} p-8 text-center`}>
      <span className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/15 flex items-center justify-center">
        <Radio size={28} className="text-accent" />
      </span>
      <p className="text-text-primary font-semibold mb-1">A station that's only yours</p>
      <p className="text-text-muted text-sm mb-6 max-w-sm mx-auto">
        Songs you love, deep cuts you haven't found yet, and a DJ talking you through it.
      </p>
      <button
        onClick={onStart}
        disabled={starting}
        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {starting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
        {starting ? 'Tuning in…' : 'Start listening'}
      </button>
      {starting && djStatus?.startsWith('DJ ') && (
        <p className="text-accent text-xs mt-4 flex items-center justify-center gap-1.5">
          <Loader2 size={12} className="animate-spin" />
          {djStatus}
        </p>
      )}
    </div>
  )
}

export default function PersonalDjView(): JSX.Element {
  const { account, setActiveView, previousView, setShowUserAuth } = useStorePick('account', 'setActiveView', 'previousView', 'setShowUserAuth')
  const dj = usePersonalDj()
  const { live, phase } = dj
  const listening = phase === 'listening'
  const now = useClock(listening)
  const cover = useTrackCover(live?.now_playing)
  const [coverError, setCoverError] = useState(false)
  useEffect(() => { setCoverError(false) }, [cover])

  const durationMs = live?.duration_ms ?? 0
  const elapsedMs = Math.min(durationMs || Infinity, (live?.elapsed_ms ?? 0) + (live ? Math.max(0, now - dj.liveAt) : 0))
  const progress = durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 0
  const current = live?.now_playing ?? null
  const vibe = (live?.vibe ?? 'auto') as PersonalDjVibe
  const queue = (live?.queue_preview ?? []).filter((t) => t.title !== live?.up_next?.title)

  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      <GameBackdrop />
      <audio ref={dj.bindAudio} preload="none" style={{ display: 'none' }} onError={dj.onAudioError} />

      <div className="absolute top-4 left-4 z-20">
        <button
          onClick={() => setActiveView(previousView && previousView !== 'personal-dj' ? previousView : 'home')}
          title="Back"
          className="p-2.5 rounded-xl text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
        >
          <ChevronLeft size={22} />
        </button>
      </div>
      {listening && (
        <div className="absolute top-4 right-4 z-20">
          <button onClick={dj.stopListening} title="Stop listening" className={iconButton}>
            <Square size={18} />
          </button>
        </div>
      )}

      <div className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-6 py-10">
        <div className="mx-auto w-full max-w-2xl">
          <div className="text-center mb-6">
            <h1 className="text-text-primary text-4xl sm:text-5xl font-black tracking-tight">Your DJ</h1>
            <p className="text-text-muted text-sm mt-2">
              {account ? `Picked for ${account.display_name}, live.` : 'Personal Juice WRLD radio, hosted by AI.'}
            </p>
            {(listening || phase === 'starting') && (
              <div className="mt-3 flex items-center justify-center gap-1.5 flex-wrap">
                {listening && (
                  <Chip tone="live"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />On air</Chip>
                )}
                {phase === 'starting' && (
                  <Chip tone="muted"><Loader2 size={10} className="animate-spin" />Tuning in</Chip>
                )}
                {live?.dj_enabled && (
                  live?.status?.startsWith('DJ ')
                    ? <Chip tone="accent"><Loader2 size={10} className="animate-spin" />{live.status}</Chip>
                    : <Chip tone="accent"><MicVocal size={10} />DJ</Chip>
                )}
                <Chip>{vibeLabel(vibe)}</Chip>
              </div>
            )}
          </div>

          {dj.errorMessage && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-600/10 px-3 py-2.5 text-sm text-text-primary">
              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <span className="flex-1">{dj.errorMessage}</span>
              {phase === 'error' && (
                <button onClick={() => { void dj.startListening() }} className="text-xs font-semibold text-accent hover:underline shrink-0">
                  Retry
                </button>
              )}
              <button onClick={dj.dismissError} title="Dismiss" className="text-text-muted hover:text-text-primary shrink-0">
                <X size={14} />
              </button>
            </div>
          )}

          {!account ? (
            <SignedOut onLogin={() => setShowUserAuth(true)} />
          ) : !listening ? (
            <StartCard starting={phase === 'starting'} djStatus={live?.status} onStart={() => { void dj.startListening() }} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className={`${cardClass} p-5 flex flex-col sm:flex-row gap-5 items-center`}>
                <div className="w-40 h-40 shrink-0 rounded-xl overflow-hidden bg-surface-overlay flex items-center justify-center">
                  {cover && !coverError
                    ? <ProgressiveCover src={cover} alt={current?.title ?? ''} className="w-full h-full object-cover" onError={() => setCoverError(true)} />
                    : <Music size={36} className="text-text-muted" />}
                </div>
                <div className="flex-1 min-w-0 w-full">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">Now playing</p>
                  {current ? (
                    <>
                      <p className="text-text-primary text-xl font-bold truncate">{current.title}</p>
                      <p className="text-text-muted text-sm truncate">{[current.artist, current.era].filter(Boolean).join(' · ')}</p>
                      {current.reason && <p className="text-accent text-xs mt-1.5 truncate">{current.reason}</p>}
                    </>
                  ) : (
                    <p className="text-text-muted text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Warming up the decks…</p>
                  )}
                  <div className="mt-4">
                    <div className="h-1 rounded-full bg-surface-overlay overflow-hidden">
                      <div className="h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-text-muted tabular-nums">
                      <span>{formatDuration(elapsedMs / 1000)}</span>
                      <span>{formatDuration(durationMs / 1000)}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button onClick={() => { void dj.toggleLike() }} disabled={dj.busy || !current} title={live?.liked ? 'Unlike' : 'Like'} className={iconButton}>
                      <Heart size={18} className={live?.liked ? 'text-accent' : ''} fill={live?.liked ? 'currentColor' : 'none'} />
                    </button>
                    <button onClick={() => { void dj.skip() }} disabled={dj.busy || !current} title="Skip" className={iconButton}>
                      <SkipForward size={18} />
                    </button>
                  </div>
                </div>
              </div>

              <div className={`${cardClass} p-4`}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2.5">Vibe</p>
                <div className="flex flex-wrap gap-1.5">
                  {PERSONAL_DJ_VIBES.map((v) => (
                    <button
                      key={v}
                      onClick={() => { if (v !== vibe) void dj.changeVibe(v) }}
                      disabled={dj.busy}
                      className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors disabled:opacity-60 ${
                        v === vibe
                          ? 'bg-accent text-white border-transparent'
                          : 'border-[var(--border)] text-text-muted hover:text-text-primary hover:border-accent/40'
                      }`}
                    >
                      {vibeLabel(v)}
                    </button>
                  ))}
                </div>
              </div>

              {(live?.up_next || queue.length > 0) && (
                <div className={`${cardClass} p-2`}>
                  <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">Coming up</p>
                  {live?.up_next && <QueueRow track={live.up_next} label="Next" />}
                  {queue.map((t, i) => <QueueRow key={`${t.title}-${i}`} track={t} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
