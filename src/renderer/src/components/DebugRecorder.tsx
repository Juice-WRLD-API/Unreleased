// UI for lib/debugRecorder: the Settings button that starts/stops a recording,
// and a floating pill shown everywhere while one is running - the user leaves
// Settings to reproduce the bug, so the way to stop has to follow them.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Circle, Square } from 'lucide-react'
import {
  isDebugRecording, debugRecordingStartedAt, debugRecordingCount,
  subscribeDebugRecorder, startDebugRecording, stopAndDownloadDebugRecording,
} from '../lib/debugRecorder'

export function useDebugRecorder(): { recording: boolean; elapsed: number; count: number } {
  const [recording, setRecording] = useState(isDebugRecording)
  const [, tick] = useState(0)
  // Listeners fire on every captured entry; only the on/off flip re-renders.
  useEffect(() => subscribeDebugRecorder(() => setRecording(isDebugRecording())), [])
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [recording])
  return {
    recording,
    elapsed: recording ? Math.max(0, Math.floor((Date.now() - debugRecordingStartedAt()) / 1000)) : 0,
    count: recording ? debugRecordingCount() : 0,
  }
}

export function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function toggleDebugRecording(): void {
  if (isDebugRecording()) stopAndDownloadDebugRecording()
  else startDebugRecording()
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
  const { recording, elapsed, count } = useDebugRecorder()
  if (!recording) return null
  return createPortal(
    <button
      onClick={toggleDebugRecording}
      title="Stop recording and save the debug log"
      className="fixed left-1/2 -translate-x-1/2 z-[190] flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-full border border-red-500/40 bg-surface shadow-2xl text-xs text-text-primary hover:bg-[var(--surface-overlay)] transition-colors"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
    >
      <span className="relative flex w-2.5 h-2.5">
        <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-60" />
        <span className="relative w-2.5 h-2.5 rounded-full bg-red-500" />
      </span>
      <span className="font-medium">Recording debug log</span>
      <span className="tabular-nums text-text-muted">{formatElapsed(elapsed)} · {count} events</span>
      <span className="flex items-center gap-1 text-red-400 font-medium"><Square size={10} className="fill-current" /> Stop &amp; save</span>
    </button>,
    document.body,
  )
}
