// UI for lib/debugRecorder: the Settings button that starts/stops a recording,
// and a floating pill shown everywhere while one is running - the user leaves
// Settings to reproduce the bug, so the way to stop has to follow them. Saved
// logs open in DebugLogViewer (the "View" toast after saving, or "Open log").
import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Circle, FolderOpen, Square } from 'lucide-react'
import {
  isDebugRecording, isDebugRecordingAnonymous, debugRecordingStartedAt, debugRecordingCount,
  subscribeDebugRecorder, startDebugRecording, stopAndDownloadDebugRecording,
  getDebugAnonymousPref, setDebugAnonymousPref,
} from '../lib/debugRecorder'
import { openDebugLogBlob, openDebugLogFile } from '../lib/debugLog'
import { showAppToast } from '../lib/appToast'
import { Toggle } from './SettingsRow'

export function useDebugRecorder(): { recording: boolean; anonymous: boolean; anonymousPref: boolean; elapsed: number; count: number } {
  const [recording, setRecording] = useState(isDebugRecording)
  const [anonymous, setAnonymous] = useState(isDebugRecordingAnonymous)
  const [anonymousPref, setAnonymousPref] = useState(getDebugAnonymousPref)
  const [, tick] = useState(0)
  // Listeners fire on every captured entry; only the on/off flips re-render.
  useEffect(() => subscribeDebugRecorder(() => {
    setRecording(isDebugRecording())
    setAnonymous(isDebugRecordingAnonymous())
    setAnonymousPref(getDebugAnonymousPref())
  }), [])
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [recording])
  return {
    recording,
    anonymous,
    anonymousPref,
    elapsed: recording ? Math.max(0, Math.floor((Date.now() - debugRecordingStartedAt()) / 1000)) : 0,
    count: recording ? debugRecordingCount() : 0,
  }
}

// Settings' "Anonymous" switch. Applies to the next recording, so it's locked
// while one runs and shows the mode that recording started with.
export function DebugAnonymousToggle(): JSX.Element {
  const { recording, anonymous, anonymousPref } = useDebugRecorder()
  return (
    <Toggle
      on={recording ? anonymous : anonymousPref}
      onClick={() => setDebugAnonymousPref(!anonymousPref)}
      locked={recording}
      lockedReason="Stop the current recording to change this"
    />
  )
}

export function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function toggleDebugRecording(): void {
  if (!isDebugRecording()) { startDebugRecording(); return }
  const { blob, filename, count } = stopAndDownloadDebugRecording()
  showAppToast(`Debug log saved (${count} events)`, {
    tone: 'info',
    action: { label: 'View', onClick: () => { void openDebugLogBlob(blob, filename) } },
  })
}

// Settings' "Open log" - shows a saved debug log file in DebugLogViewer.
export function DebugLogOpenButton(): JSX.Element {
  const open = (): void => {
    openDebugLogFile().catch((err) => showAppToast(`Couldn’t open that debug log: ${err instanceof Error ? err.message : String(err)}`))
  }
  return (
    <button
      onClick={open}
      title="View a saved debug log file"
      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-[var(--surface-overlay)] text-text-secondary hover:text-text-primary border border-[var(--border)]"
    >
      <FolderOpen size={12} /> Open log
    </button>
  )
}

export function DebugRecordButton({ size = 'sm' }: { size?: 'sm' | 'lg' }): JSX.Element {
  const { recording, elapsed } = useDebugRecorder()
  const pad = size === 'lg' ? 'px-3 h-9' : 'px-3 py-1.5'
  return (
    <button
      onClick={toggleDebugRecording}
      className={`shrink-0 flex items-center gap-1.5 ${pad} rounded-lg text-xs font-medium transition-colors ${
        recording
          ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
          : 'bg-[var(--surface-overlay)] text-text-secondary hover:text-text-primary border border-[var(--border)]'
      }`}
    >
      {recording
        ? <><Square size={11} className="fill-current" /> Stop &amp; save <span className="tabular-nums opacity-80">{formatElapsed(elapsed)}</span></>
        : <><Circle size={11} className="fill-current text-red-400" /> Start recording</>}
    </button>
  )
}

export default function DebugRecordingPill(): JSX.Element | null {
  const { recording, anonymous, elapsed, count } = useDebugRecorder()
  if (!recording) return null
  return createPortal(
    <button
      onClick={toggleDebugRecording}
      title="Stop recording and save the debug log"
      className="fixed left-1/2 -translate-x-1/2 z-[190] flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-full border border-red-500/40 bg-surface shadow-2xl text-xs text-text-primary hover:bg-[var(--surface-overlay)] transition-colors"
      // Sits over the titlebar drag strip, and an app-region rect swallows
      // clicks regardless of stacking - so the whole pill opts out.
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)', WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      <span className="relative flex w-2.5 h-2.5">
        <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-60" />
        <span className="relative w-2.5 h-2.5 rounded-full bg-red-500" />
      </span>
      <span className="font-medium">Recording debug log{anonymous ? ' (anonymous)' : ''}</span>
      <span className="tabular-nums text-text-muted">{formatElapsed(elapsed)} · {count} events</span>
      <span className="flex items-center gap-1 text-red-400 font-medium"><Square size={10} className="fill-current" /> Stop &amp; save</span>
    </button>,
    document.body,
  )
}
