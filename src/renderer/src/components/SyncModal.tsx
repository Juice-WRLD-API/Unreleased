import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle, AlertTriangle, Check, CloudOff, Download, FolderOpen, HardDrive, Loader2, Music2, Pause, Play, RefreshCw, Trash2, X,
} from 'lucide-react'
import { ModalOverlay, LockToggle } from './Modal'
import { Toggle } from './SettingsRow'
import { ProgressiveCover } from './ProgressiveCover'
import { MotionDisclosure } from './MotionDisclosure'
import { useContentMotion } from '../hooks/useContentMotion'
import { useListMotion } from '../hooks/useListMotion'
import {
  useCatalogSync, remainingBytes, catalogSyncComplete, formatSyncEta, CATALOG_SYNC_CATEGORIES,
  type CatalogSyncActive, type CatalogSyncCategory, type CatalogSyncFinished, type CatalogSyncState,
} from '../store/catalogSyncStore'
import {
  catalogSyncFootprint, moveOfflineFolder, pauseCatalogSync, previewCatalogSync, removeCatalogSyncFiles, resumeCatalogSync,
  retryCatalogSyncFailures, setCatalogSyncCategories, setCatalogSyncEnabled, syncCatalogNow,
} from '../lib/catalogSync'
import { formatBytes } from '../lib/format'
import { relativeTime } from './adminShared'

// Sync (Home → Tools, desktop only): one switch that keeps every released and
// unreleased song on this computer, and a live view of it - how much is here,
// what's downloading, what to keep, and where it goes. The work itself is
// lib/catalogSync's; this dialog only reads its store and calls it, so closing
// the dialog doesn't stop anything.

const CATEGORY_LABEL: Record<CatalogSyncCategory, string> = { released: 'Released', unreleased: 'Unreleased' }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const electron = (): any => (window as any).electron

function headline(s: CatalogSyncState): string {
  switch (s.phase) {
    case 'off': return 'Sync is off'
    case 'checking': return 'Checking the catalogue…'
    case 'syncing': return 'Syncing'
    case 'paused': return 'Paused'
    case 'waiting': return 'Waiting for a connection'
    case 'nospace': return 'The drive is full'
    case 'error': return 'Couldn’t sync'
    case 'idle': return catalogSyncComplete(s) ? 'Everything is on this computer' : 'Up to date'
  }
}

function detail(s: CatalogSyncState): string {
  const left = remainingBytes(s)
  switch (s.phase) {
    case 'off':
      return s.target
        ? `Turn it on to keep all ${s.target.toLocaleString()} songs here, about ${formatBytes(s.bytes + left)}.`
        : 'Turn it on to keep every released and unreleased song here.'
    case 'checking': return 'Looking for new and changed songs.'
    case 'syncing': {
      if (!s.speedBps) return 'Starting downloads…'
      const eta = formatSyncEta(left / s.speedBps)
      return `${formatBytes(s.speedBps)}/s${eta ? ` · ${eta} left` : ''}`
    }
    case 'paused': return 'Resume to pick up where it left off.'
    case 'waiting': return 'It carries on when you’re back online.'
    case 'nospace': return 'Free up some space, or move the folder to another drive.'
    case 'error': return s.error ?? 'Something went wrong. Sync will try again soon.'
    case 'idle': {
      const checked = s.lastCheckedAt ? `Checked ${relativeTime(new Date(s.lastCheckedAt).toISOString())}` : 'Checked'
      if (s.failures.length) return `${checked}. ${s.failures.length} song${s.failures.length === 1 ? '' : 's'} couldn’t download.`
      return `${checked}. New songs are picked up every 30 minutes.`
    }
  }
}

// ─── Ring ────────────────────────────────────────────────────────────────────

function ProgressRing({ have, target, active }: { have: number; target: number; active: boolean }): JSX.Element {
  const size = 120
  const stroke = 9
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const ratio = target ? Math.min(1, have / target) : 0
  // Floored, so the last song still shows 99% rather than a premature 100%.
  const percent = target ? Math.floor(ratio * 100) : 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-overlay)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="rgb(var(--accent-rgb))" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - ratio)}
          className="transition-[stroke-dashoffset,opacity] duration-[600ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
          style={{ opacity: target ? 1 : 0 }}
        />
      </svg>
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full motion-safe:animate-[spin_2.8s_linear_infinite]"
          style={{ background: 'conic-gradient(from 0deg, transparent 0 82%, rgb(var(--accent-rgb) / 0.28) 96%, transparent)', mask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`, WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))` }}
        />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {target && have >= target
          ? <Check size={30} className="text-accent" strokeWidth={2.5} />
          : <span className="text-text-primary text-[26px] font-bold tabular-nums leading-none">{percent}<span className="text-sm font-semibold text-text-muted">%</span></span>}
        <span className="mt-1 text-[10px] text-text-muted tabular-nums">
          {target ? `${have.toLocaleString()} / ${target.toLocaleString()}` : '—'}
        </span>
      </div>
    </div>
  )
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function Stat({ icon, label, value, tone }: { icon: JSX.Element; label: string; value: string; tone?: 'warn' }): JSX.Element {
  return (
    <div className="min-w-0 rounded-xl bg-surface-overlay/60 border border-[var(--border)] px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-text-muted text-[10px] font-semibold uppercase tracking-wider">
        {icon}<span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 text-sm font-semibold tabular-nums truncate ${tone === 'warn' ? 'text-amber-400' : 'text-text-primary'}`}>{value}</div>
    </div>
  )
}

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h3 className="flex-1 min-w-0 text-text-muted text-[10px] font-bold uppercase tracking-wider truncate">{children}</h3>
      {aside}
    </div>
  )
}

function Cover({ src, size = 'w-9 h-9' }: { src: string | null; size?: string }): JSX.Element {
  return (
    <span className={`${size} shrink-0 rounded-md overflow-hidden bg-surface-overlay flex items-center justify-center`}>
      {src ? <ProgressiveCover src={src} alt="" className="w-full h-full object-cover" /> : <Music2 size={14} className="text-text-muted" />}
    </span>
  )
}

function ActiveRow({ item }: { item: CatalogSyncActive }): JSX.Element {
  const ratio = item.total ? Math.min(1, item.received / item.total) : 0
  return (
    <div data-flip-key={item.songId} className="flex items-center gap-2.5 py-1.5">
      <Cover src={item.imageUrl} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="flex-1 min-w-0 text-text-primary text-xs truncate">{item.title}</span>
          <span className="shrink-0 text-[10px] text-text-muted tabular-nums">
            {item.total ? `${formatBytes(item.received)} of ${formatBytes(item.total)}` : 'Starting…'}
          </span>
        </div>
        <div className="mt-1.5 h-1 rounded-full bg-surface-overlay overflow-hidden">
          <div
            className="h-full rounded-full bg-accent origin-left transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
      </div>
    </div>
  )
}

function RecentRow({ item }: { item: CatalogSyncFinished }): JSX.Element {
  return (
    <div data-flip-key={`${item.songId}:${item.at}`} className="flex items-center gap-2.5 py-1">
      <Cover src={item.imageUrl} size="w-7 h-7" />
      <span className="flex-1 min-w-0 text-text-secondary text-xs truncate">{item.title}</span>
      <Check size={13} className="shrink-0 text-accent" />
    </div>
  )
}

function CategoryChip({ category, on, only, stat, bytesPerSecond, onToggle }: {
  category: CatalogSyncCategory
  on: boolean
  only: boolean
  stat?: { songs: number; seconds: number }
  bytesPerSecond: number
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={only}
      title={only ? 'Sync keeps at least one of these' : undefined}
      aria-pressed={on}
      className={`group flex-1 min-w-0 flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        on ? 'border-accent/60 bg-accent/10' : 'border-[var(--border)] bg-surface-overlay/40 hover:bg-surface-overlay'
      } ${only ? 'cursor-default' : ''}`}
    >
      <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center control-motion ${on ? 'bg-accent text-black' : 'border border-[var(--border)] text-transparent'}`}>
        <Check size={12} strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="block text-text-primary text-xs font-semibold">{CATEGORY_LABEL[category]}</span>
        <span className="block text-text-muted text-[10px] truncate tabular-nums">
          {stat ? `${stat.songs.toLocaleString()} songs · about ${formatBytes(stat.seconds * bytesPerSecond)}` : '…'}
        </span>
      </span>
    </button>
  )
}

const buttonCls = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50'
const quietBtn = `${buttonCls} bg-surface-overlay hover:bg-surface-raised border border-[var(--border)] text-text-secondary hover:text-text-primary`
const primaryBtn = `${buttonCls} bg-accent text-black hover:opacity-90`

// ─── Dialog ──────────────────────────────────────────────────────────────────

export default function SyncModal(): JSX.Element {
  const s = useCatalogSync()
  const close = (): void => s.setOpen(false)
  const { enabled, categories } = s.settings
  // Turning Sync off asks what to do with the songs it kept.
  const [confirmingOff, setConfirmingOff] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState<null | 'off' | 'remove' | 'move'>(null)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [showFailures, setShowFailures] = useState(false)
  const heroRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const recentRef = useRef<HTMLDivElement>(null)
  useContentMotion(heroRef, confirmingOff ? 'confirm' : s.phase)
  useListMotion(activeRef)
  useListMotion(recentRef)

  useEffect(() => { void previewCatalogSync() }, [])

  const footprint = catalogSyncFootprint()
  const left = remainingBytes(s)
  const running = s.phase === 'syncing' || s.phase === 'checking'
  const lowSpace = enabled && s.diskFree != null && left > 0 && left > s.diskFree
  const keptWhileOff = !enabled && footprint.songs > 0

  const toggle = (): void => {
    if (enabled) {
      if (footprint.songs > 0) setConfirmingOff(true)
      else void setCatalogSyncEnabled(false)
    } else {
      setConfirmRemove(false)
      void setCatalogSyncEnabled(true)
    }
  }
  const turnOff = async (removeFiles: boolean): Promise<void> => {
    setBusy(removeFiles ? 'remove' : 'off')
    try { await setCatalogSyncEnabled(false, { removeFiles }) } finally {
      setBusy(null)
      setConfirmingOff(false)
    }
  }
  const removeKept = async (): Promise<void> => {
    if (!confirmRemove) { setConfirmRemove(true); return }
    setBusy('remove')
    try { await removeCatalogSyncFiles() } finally {
      setBusy(null)
      setConfirmRemove(false)
    }
  }
  const toggleCategory = (category: CatalogSyncCategory): void => {
    const next = categories.includes(category) ? categories.filter((c) => c !== category) : [...categories, category]
    if (!next.length) return
    void setCatalogSyncCategories(CATALOG_SYNC_CATEGORIES.filter((c) => next.includes(c)))
  }
  const changeFolder = async (): Promise<void> => {
    const picked: string | null = await electron()?.pickFolder?.()
    if (!picked || picked === s.folder) return
    setBusy('move')
    setFolderError(null)
    try {
      const result = await moveOfflineFolder(picked)
      if (result.error) setFolderError(result.error)
      else if (result.failedCount) setFolderError(`${result.failedCount} song${result.failedCount === 1 ? '' : 's'} couldn’t be moved and will download again`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <ModalOverlay
      onClose={close}
      zIndexClassName="z-[60]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-[560px] h-[90svh] md:h-[720px] max-h-[92svh]"
      minWidth={420} minHeight={460}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
        <div className="bg-surface w-full h-full flex flex-col min-h-0">
          {/* Header */}
          <div onMouseDown={onHandleMouseDown} className="relative shrink-0 px-5 pt-4 pb-3.5 border-b border-[var(--border)] overflow-hidden">
            <div
              aria-hidden="true"
              className="absolute -top-24 -left-16 w-80 h-48 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(closest-side, rgb(var(--accent-rgb) / 0.22), transparent)' }}
            />
            <div className="relative flex items-center gap-3">
              <span className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-accent to-accent/60 text-white flex items-center justify-center shadow-lg shadow-accent/20">
                <RefreshCw size={17} className={running ? 'motion-safe:animate-[spin_2.4s_linear_infinite]' : ''} />
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="text-text-primary text-[15px] font-semibold leading-tight">Sync</h2>
                <p className="text-[11px] text-text-muted truncate">Keep every released and unreleased song on this computer</p>
              </div>
              <div className="flex items-center gap-2">
                <Toggle on={enabled} onClick={toggle} locked={busy !== null} lockedReason="One moment…" />
                {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
                <button onClick={close} title="Close" className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
                  <X size={17} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
            {/* Hero: the ring and what's happening, or the turn-off question */}
            <div ref={heroRef}>
              {confirmingOff ? (
                <div className="rounded-2xl border border-[var(--border)] bg-surface-overlay/50 p-4">
                  <p className="text-text-primary text-sm font-semibold">Turn off Sync?</p>
                  <p className="mt-1 text-text-muted text-xs leading-relaxed">
                    {footprint.songs.toLocaleString()} synced song{footprint.songs === 1 ? ' is' : 's are'} on this computer ({formatBytes(footprint.bytes)}).
                    Keep them to play offline, or remove them to free the space. Songs in your offline playlists stay either way.
                  </p>
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    <button onClick={() => void turnOff(false)} disabled={busy !== null} className={primaryBtn}>
                      {busy === 'off' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Keep them
                    </button>
                    <button onClick={() => void turnOff(true)} disabled={busy !== null} className={`${quietBtn} hover:!text-red-400`}>
                      {busy === 'remove' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Remove {formatBytes(footprint.bytes)}
                    </button>
                    <button onClick={() => setConfirmingOff(false)} disabled={busy !== null} className={`${buttonCls} text-text-muted hover:text-text-primary`}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-5">
                  <ProgressRing have={s.have} target={s.target} active={s.phase === 'syncing'} />
                  <div className="flex-1 min-w-0">
                    <p className="flex items-center gap-1.5 text-text-primary text-base font-semibold">
                      {s.phase === 'waiting' && <CloudOff size={15} className="text-text-muted" />}
                      {(s.phase === 'error' || s.phase === 'nospace') && <AlertCircle size={15} className="text-red-400" />}
                      <span className="truncate">{headline(s)}</span>
                    </p>
                    <p className="mt-0.5 text-text-muted text-xs leading-relaxed line-clamp-2">{detail(s)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!enabled && (
                        <button onClick={toggle} disabled={busy !== null} className={primaryBtn}>
                          <Download size={13} /> Turn on Sync
                        </button>
                      )}
                      {enabled && s.phase === 'paused' && (
                        <button onClick={() => void resumeCatalogSync()} className={primaryBtn}>
                          <Play size={13} fill="currentColor" /> Resume
                        </button>
                      )}
                      {enabled && running && (
                        <button onClick={pauseCatalogSync} className={quietBtn}>
                          <Pause size={13} fill="currentColor" /> Pause
                        </button>
                      )}
                      {enabled && !running && s.phase !== 'paused' && (
                        <button onClick={() => void syncCatalogNow()} className={quietBtn}>
                          <RefreshCw size={13} /> Check now
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Numbers */}
            <div className="grid grid-cols-3 gap-2">
              <Stat icon={<HardDrive size={11} />} label="On this computer" value={s.target ? formatBytes(s.bytes) : '—'} />
              <Stat icon={<Download size={11} />} label="Still to get" value={!s.target ? '—' : left ? `about ${formatBytes(left)}` : 'Nothing'} />
              <Stat icon={<HardDrive size={11} />} label="Free space" value={s.diskFree != null ? formatBytes(s.diskFree) : '—'} tone={lowSpace ? 'warn' : undefined} />
            </div>
            {lowSpace && (
              <p className="flex items-start gap-2 -mt-2 rounded-xl bg-amber-400/10 border border-amber-400/25 px-3 py-2 text-amber-300 text-[11px] leading-relaxed">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                Not everything fits: about {formatBytes(left)} to go and {formatBytes(s.diskFree ?? 0)} free. Sync stops just before the drive is full; moving the folder to a bigger drive lets it finish.
              </p>
            )}

            {/* What's downloading, or what just arrived */}
            {(s.active.length > 0 || s.recent.length > 0) && (
              <div>
                <SectionTitle>{s.active.length ? 'Downloading now' : 'Just added'}</SectionTitle>
                {s.active.length > 0 ? (
                  <div ref={activeRef} className="relative">
                    {s.active.map((item) => <ActiveRow key={item.songId} item={item} />)}
                  </div>
                ) : (
                  <div ref={recentRef} className="relative">
                    {s.recent.slice(0, 5).map((item) => <RecentRow key={`${item.songId}:${item.at}`} item={item} />)}
                  </div>
                )}
              </div>
            )}

            {/* What to keep */}
            <div>
              <SectionTitle>What to keep</SectionTitle>
              <div className="flex gap-2">
                {CATALOG_SYNC_CATEGORIES.map((category) => (
                  <CategoryChip
                    key={category}
                    category={category}
                    on={categories.includes(category)}
                    only={categories.length === 1 && categories[0] === category}
                    stat={s.categoryStats[category]}
                    bytesPerSecond={s.bytesPerSecond}
                    onToggle={() => toggleCategory(category)}
                  />
                ))}
              </div>
              <p className="mt-2 text-text-muted text-[10px] leading-relaxed">
                Turning one off removes its songs from this computer, except those in your offline playlists.
                Sessions and unsurfaced songs aren’t synced.
              </p>
            </div>

            {/* Failures */}
            {s.failures.length > 0 && (
              <div>
                <SectionTitle aside={
                  <div className="flex items-center gap-1">
                    <button onClick={() => setShowFailures((v) => !v)} className="px-2 py-0.5 rounded-md text-[10px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
                      {showFailures ? 'Hide' : 'Show'}
                    </button>
                    <button onClick={() => void retryCatalogSyncFailures()} disabled={running} className="px-2 py-0.5 rounded-md text-[10px] font-semibold text-accent hover:bg-accent/10 disabled:opacity-50 transition-colors">
                      Retry
                    </button>
                  </div>
                }>
                  {s.failures.length} couldn’t download
                </SectionTitle>
                <MotionDisclosure open={showFailures}>
                  <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]/60 max-h-44 overflow-y-auto">
                    {s.failures.map((f) => (
                      <div key={f.songId} className="flex items-center gap-2 px-3 py-1.5">
                        <AlertCircle size={12} className="shrink-0 text-red-400" />
                        <span className="flex-1 min-w-0 text-text-primary text-xs truncate">{f.title}</span>
                        <span className="shrink-0 max-w-[45%] text-text-muted text-[10px] truncate" title={f.error}>{f.error}</span>
                      </div>
                    ))}
                  </div>
                </MotionDisclosure>
              </div>
            )}

            {/* Where */}
            <div>
              <SectionTitle>Where they go</SectionTitle>
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-text-muted text-xs truncate bg-surface-overlay/60 rounded-lg px-3 py-2 border border-[var(--border)]" title={s.folder ?? undefined}>
                  {s.folder ?? 'The app’s data folder'}
                </span>
                <button onClick={() => { if (s.folder) void electron()?.openPath?.(s.folder) }} disabled={!s.folder} title="Open the folder" className={quietBtn}>
                  <FolderOpen size={13} />
                </button>
                <button onClick={() => void changeFolder()} disabled={busy !== null} className={quietBtn}>
                  {busy === 'move' ? <><Loader2 size={13} className="animate-spin" /> Moving…</> : 'Change'}
                </button>
              </div>
              {folderError && <p className="mt-1.5 text-red-400 text-[10px]">{folderError}</p>}
              <p className="mt-2 text-text-muted text-[10px] leading-relaxed">
                The same folder as your offline playlists (Settings → Offline songs folder). Changing it moves every offline song.
              </p>
              {keptWhileOff && (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-3 py-2">
                  <span className="flex-1 min-w-0 text-text-secondary text-xs">
                    {footprint.songs.toLocaleString()} song{footprint.songs === 1 ? '' : 's'} from Sync {footprint.songs === 1 ? 'is' : 'are'} still here ({formatBytes(footprint.bytes)}).
                  </span>
                  <button onClick={() => void removeKept()} disabled={busy !== null} className={`${quietBtn} ${confirmRemove ? '!text-red-400 !border-red-400/40' : ''}`}>
                    {busy === 'remove' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    {confirmRemove ? 'Remove them?' : 'Remove'}
                  </button>
                </div>
              )}
            </div>

            <p className="text-text-muted text-[10px] leading-relaxed pb-1">
              Sync works while the app is open. Synced songs play from this computer first, with their lyrics, even with no connection.
            </p>
          </div>
        </div>
      )}
    </ModalOverlay>
  )
}
