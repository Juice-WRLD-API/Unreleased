import { useRef, useState } from 'react'
import { ModalOverlay, LockToggle } from './Modal'
import { X, Info } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { cacheStats } from '../lib/apiCache'
import type { Track } from '../types'
import { formatBytes } from '../lib/format'
import { APP_VERSION } from '../lib/appVersion'

function localStorageBytes(): number {
  let bytes = 0
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    bytes += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2
  }
  return bytes
}

// The filename actually being played - local tracks carry a filesystem
// `path`, API/stream tracks only have a `streamUrl` (the "file" is whatever
// the URL's last path segment resolves to).
function filenameOf(track: Track | null): string {
  if (!track) return 'none'
  if (track.path) {
    const parts = track.path.split(/[\\/]/)
    return parts[parts.length - 1] || track.path
  }
  if (track.streamUrl) {
    try {
      const u = new URL(track.streamUrl)
      const parts = u.pathname.split('/')
      return decodeURIComponent(parts[parts.length - 1] || track.streamUrl)
    } catch {
      const parts = track.streamUrl.split('/')
      return parts[parts.length - 1]
    }
  }
  return track.title
}

function Row({ label, value, onExpand }: { label: string; value: string; onExpand: (label: string, value: string) => void }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border)] last:border-b-0">
      <span className="text-text-muted text-xs shrink-0">{label}</span>
      <button
        onClick={() => onExpand(label, value)}
        className="text-text-primary text-xs font-mono text-right truncate max-w-[62%] hover:text-accent transition-colors cursor-pointer"
        title="Click to view full value"
      >
        {value}
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-4">
      <p className="text-text-muted text-[10px] font-semibold uppercase tracking-widest mb-1.5">{title}</p>
      {children}
    </div>
  )
}

function ValuePopup({ label, value, onClose }: { label: string; value: string; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={ref}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={(e) => { if (e.target === ref.current) onClose() }}
    >
      <div className="bg-surface border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[420px] max-h-[70vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <span className="text-text-muted text-[10px] font-semibold uppercase tracking-widest">{label}</span>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-3 overflow-y-auto">
          <p className="text-text-primary text-xs font-mono break-all whitespace-pre-wrap select-text">{value}</p>
        </div>
      </div>
    </div>
  )
}

export default function DiagnosticsModal(): JSX.Element {
  const [expanded, setExpanded] = useState<{ label: string; value: string } | null>(null)
  const R = ({ label, value }: { label: string; value: string }): JSX.Element => (
    <Row label={label} value={value} onExpand={(l, v) => setExpanded({ label: l, value: v })} />
  )
  const {
    setShowDiagnostics, activeView, queue, queueIndex, currentTrack, currentTrackFull,
    isPlaying, progress, currentTime, shuffle, repeat, volume, playbackSpeed,
    crossfadeEnabled, crossfadeDuration, preferOgVersion, lyricsOffset,
    theme, accentColor, audioOutput, radioFmActive,
    account, playlists, likedTrackIds,
  } = useStorePick('setShowDiagnostics', 'activeView', 'queue', 'queueIndex', 'currentTrack', 'currentTrackFull', 'isPlaying', 'progress', 'currentTime', 'shuffle', 'repeat', 'volume', 'playbackSpeed', 'crossfadeEnabled', 'crossfadeDuration', 'preferOgVersion', 'lyricsOffset', 'theme', 'accentColor', 'audioOutput', 'radioFmActive', 'account', 'playlists', 'likedTrackIds')

  const cache = cacheStats()
  const lsBytes = localStorageBytes()
  const mem = (performance as any).memory as { usedJSHeapSize: number; totalJSHeapSize: number } | undefined

  return (
    <>
    <ModalOverlay
      onClose={() => setShowDiagnostics(false)}
      zIndexClassName="z-[60]"
      panelClassName="bg-surface border border-[var(--border)] rounded-3xl shadow-2xl w-full max-w-[480px] h-[600px] max-h-[85vh]"
      minWidth={420} minHeight={420}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
      <div className="bg-surface w-full h-full flex flex-col overflow-hidden">
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0 cursor-grab active:cursor-grabbing"
          onMouseDown={onHandleMouseDown}
        >
          <div className="flex items-center gap-2">
            <Info size={16} className="text-accent" />
            <h2 className="text-text-primary font-black text-lg tracking-tight">Diagnostics</h2>
          </div>
          <div className="flex items-center gap-1">
            {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
            <button onClick={() => setShowDiagnostics(false)} className="text-text-muted hover:text-text-primary transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Section title="App">
            <R label="Version" value={`v${APP_VERSION}`} />
            <R label="Platform" value={navigator.platform || 'unknown'} />
            <R label="Theme" value={`${theme} · ${accentColor}`} />
            <R label="Active view" value={activeView} />
            <R label="Online" value={navigator.onLine ? 'yes' : 'no'} />
          </Section>

          <Section title="Now playing">
            <R label="Filename" value={filenameOf(currentTrack)} />
            <R label="Title" value={currentTrack?.title || 'none'} />
            <R label="Track ID" value={currentTrack?.id || 'none'} />
            <R label="Source" value={currentTrack ? (currentTrack.streamUrl ? 'stream' : 'local file') : 'none'} />
            {currentTrack?.streamUrl && <R label="Stream URL" value={currentTrack.streamUrl} />}
            {currentTrack?.path && <R label="Path" value={currentTrack.path} />}
            <R label="Playing" value={isPlaying ? 'yes' : 'no'} />
            <R label="Position" value={`${currentTime.toFixed(1)}s / ${currentTrack?.duration?.toFixed(1) ?? '?'}s`} />
            <R label="Progress" value={`${(progress * 100).toFixed(1)}%`} />
            {currentTrackFull && (
              <>
                <R label="Format" value={currentTrackFull.ext || (currentTrack?.streamUrl ? 'streamed' : 'unknown')} />
                <R label="Bitrate" value={currentTrackFull.bitrate ? `${currentTrackFull.bitrate} kbps` : (currentTrack?.streamUrl ? 'n/a (streamed)' : 'unknown')} />
                <R label="Sample rate" value={currentTrackFull.sampleRate ? `${currentTrackFull.sampleRate} Hz` : (currentTrack?.streamUrl ? 'n/a (streamed)' : 'unknown')} />
                <R label="Bit depth" value={currentTrackFull.bitsPerSample ? `${currentTrackFull.bitsPerSample}-bit` : (currentTrack?.streamUrl ? 'n/a (streamed)' : 'unknown')} />
                <R label="Channels" value={currentTrackFull.channels ? String(currentTrackFull.channels) : (currentTrack?.streamUrl ? 'n/a (streamed)' : 'unknown')} />
                <R label="File size" value={currentTrackFull.fileSize ? formatBytes(currentTrackFull.fileSize) : (currentTrack?.streamUrl ? 'n/a (streamed)' : 'unknown')} />
              </>
            )}
          </Section>

          <Section title="Playback">
            <R label="Queue length" value={String(queue.length)} />
            <R label="Queue index" value={String(queueIndex)} />
            <R label="Shuffle" value={shuffle ? 'on' : 'off'} />
            <R label="Repeat" value={repeat} />
            <R label="Volume" value={`${Math.round(volume * 100)}%`} />
            <R label="Speed" value={`${playbackSpeed.toFixed(2)}x`} />
            <R label="Crossfade" value={crossfadeEnabled ? `${crossfadeDuration}s` : 'off'} />
            <R label="Prefer OG version" value={preferOgVersion ? 'on' : 'off'} />
            <R label="Lyrics offset" value={`${lyricsOffset > 0 ? '+' : ''}${lyricsOffset.toFixed(1)}s`} />
            <R label="Audio output" value={audioOutput || 'default'} />
            <R label="Radio FM active" value={radioFmActive ? 'yes' : 'no'} />
          </Section>

          <Section title="Account">
            <R label="Logged in" value={account ? 'yes' : 'no'} />
            {account && <R label="User" value={account.display_name || account.discord_username} />}
            {account && <R label="Role" value={account.is_administrator ? 'administrator' : account.is_manager ? 'manager' : account.is_editor ? 'editor' : account.is_contributor ? 'contributor' : 'standard'} />}
            <R label="Playlists" value={String(playlists.length)} />
            <R label="Liked songs" value={String(likedTrackIds.length)} />
          </Section>

          <Section title="Storage">
            <R label="API cache" value={`${cache.count} entries · ${formatBytes(cache.bytes)}`} />
            <R label="localStorage" value={formatBytes(lsBytes)} />
            {mem && <R label="JS heap" value={`${formatBytes(mem.usedJSHeapSize)} / ${formatBytes(mem.totalJSHeapSize)}`} />}
          </Section>

          <Section title="Environment">
            <R label="Screen" value={`${window.screen.width}×${window.screen.height}`} />
            <R label="Viewport" value={`${window.innerWidth}×${window.innerHeight}`} />
            <R label="Pixel ratio" value={String(window.devicePixelRatio)} />
            <R label="Language" value={navigator.language} />
            <R label="User agent" value={navigator.userAgent} />
          </Section>
        </div>
      </div>
      )}
    </ModalOverlay>

    {/* Outside ModalOverlay's panel - that panel is overflow-hidden (for its
        rounded corners), which would clip this full-screen popup since a
        fixed-position element is still clipped by an ancestor's overflow
        despite being positioned relative to the viewport. */}
    {expanded && (
      <ValuePopup label={expanded.label} value={expanded.value} onClose={() => setExpanded(null)} />
    )}
    </>
  )
}

