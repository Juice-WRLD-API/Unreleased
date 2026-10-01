import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertCircle, Check, Megaphone, X } from 'lucide-react'
import { ModalOverlay, LockToggle } from './Modal'
import { sendBroadcast, fetchBroadcastHistory, BROADCAST_LEVELS, BROADCAST_MAX_MESSAGE, BROADCAST_MAX_TITLE, type BroadcastLevel, type BroadcastMessage } from '../lib/broadcastApi'
import { errorMessage } from '../lib/format'
import { relativeTime } from './adminShared'

export const LEVEL_STYLE: Record<BroadcastLevel, string> = {
  info: 'bg-accent/15 text-accent border-accent/30',
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  error: 'bg-red-500/15 text-red-400 border-red-500/30',
}

// Admin-only popup: pushes one message to everyone connected right now. People
// who are offline pick it up from the server's 24h catch-up list when they next
// connect, and it can't be recalled - so confirm before sending. Past
// broadcasts are listed underneath.
export default function BroadcastModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [level, setLevel] = useState<BroadcastLevel>('info')
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [history, setHistory] = useState<BroadcastMessage[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const loadHistory = useCallback(async (): Promise<void> => {
    try {
      setHistory((await fetchBroadcastHistory(20)).results)
      setHistoryError(null)
    } catch (e) {
      setHistoryError(errorMessage(e, 'Failed to load history'))
    }
  }, [])
  useEffect(() => { void loadHistory() }, [loadHistory])

  const trimmed = message.trim()

  const send = async (): Promise<void> => {
    setSending(true); setError(null); setSent(false)
    try {
      await sendBroadcast({ message: trimmed, title: title.trim() || undefined, level })
      setSent(true)
      setTitle(''); setMessage('')
      void loadHistory()
    } catch (e) {
      setError(errorMessage(e, 'Failed to send broadcast'))
    } finally {
      setSending(false)
      setConfirming(false)
    }
  }

  const inputCls = 'w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-accent/50'

  return (
    <ModalOverlay
      onClose={onClose}
      zIndexClassName="z-[170]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md max-h-[92svh]"
      minWidth={360} minHeight={380}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
      <div className="bg-surface w-full h-full overflow-y-auto">
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-surface z-10 cursor-grab active:cursor-grabbing"
          onMouseDown={onHandleMouseDown}
        >
          <h2 className="flex items-center gap-2 text-text-primary text-sm font-semibold">
            <Megaphone size={15} className="text-accent" /> Broadcast a message
          </h2>
          <div className="flex items-center gap-1">
            {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
            <button onClick={onClose} title="Close" disabled={sending} className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-50">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">

        <p className="text-text-muted text-xs leading-relaxed">
          Shows as a banner for everyone using the app right now. People who are offline will see it when they next connect, if that's within 24 hours.
        </p>

        <label className="block">
          <span className="block text-xs font-semibold text-text-muted mb-1.5">Title <span className="font-normal">(optional)</span></span>
          <input type="text" value={title} maxLength={BROADCAST_MAX_TITLE} onChange={(e) => { setTitle(e.target.value); setConfirming(false) }}
            placeholder="Maintenance" className={inputCls} />
        </label>

        <label className="block">
          <span className="flex items-center justify-between text-xs font-semibold text-text-muted mb-1.5">
            Message
            <span className={`font-normal tabular-nums ${message.length >= BROADCAST_MAX_MESSAGE ? 'text-red-400' : ''}`}>{message.length}/{BROADCAST_MAX_MESSAGE}</span>
          </span>
          <textarea value={message} maxLength={BROADCAST_MAX_MESSAGE} rows={4} onChange={(e) => { setMessage(e.target.value); setConfirming(false) }}
            placeholder="Server restarting in 5 minutes" className={`${inputCls} resize-none`} />
        </label>

        <div>
          <span className="block text-xs font-semibold text-text-muted mb-1.5">Level</span>
          <div className="flex flex-wrap gap-1.5">
            {BROADCAST_LEVELS.map((l) => (
              <button key={l} type="button" onClick={() => { setLevel(l); setConfirming(false) }}
                className={`px-3 py-1 rounded-lg border text-xs font-semibold capitalize transition-colors ${
                  level === l ? LEVEL_STYLE[l] : 'border-[var(--border)] text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                }`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}
        {sent && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
            <Check size={13} className="shrink-0 mt-0.5" /> Broadcast sent to everyone connected.
          </div>
        )}

        {confirming ? (
          <div className="flex items-center gap-2">
            <button onClick={send} disabled={sending}
              className="flex-1 py-2.5 rounded-xl bg-accent text-[var(--bg)] text-sm font-semibold hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40">
              {sending && <Loader2 size={14} className="animate-spin" />} Send to everyone
            </button>
            <button onClick={() => setConfirming(false)} disabled={sending}
              className="px-4 py-2.5 rounded-xl border border-[var(--border)] text-text-muted text-sm font-semibold hover:text-text-primary hover:bg-surface-overlay transition-colors">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => { setSent(false); setConfirming(true) }} disabled={!trimmed}
            className="w-full py-2.5 rounded-xl bg-accent text-[var(--bg)] text-sm font-semibold hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40">
            <Megaphone size={14} /> Broadcast
          </button>
        )}

        <div className="pt-2 border-t border-[var(--border)]">
          <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted/70 mb-2">Recent broadcasts</p>
          {historyError ? (
            <p className="text-xs text-red-400">{historyError}</p>
          ) : history === null ? (
            <Loader2 size={14} className="animate-spin text-text-muted" />
          ) : history.length === 0 ? (
            <p className="text-xs text-text-muted">Nothing sent yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {history.map((b) => (
                <li key={b.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
                  <div className="flex items-center gap-2 text-[10px] text-text-muted">
                    <span className={`px-1.5 py-px rounded border font-semibold capitalize ${LEVEL_STYLE[b.level] ?? LEVEL_STYLE.info}`}>{b.level}</span>
                    <span className="truncate">{b.sender}</span>
                    <span className="ml-auto shrink-0">{relativeTime(b.sent_at)}</span>
                  </div>
                  {b.title && <p className="text-xs font-semibold text-text-primary mt-1 break-words">{b.title}</p>}
                  <p className="text-xs text-text-secondary mt-0.5 break-words whitespace-pre-wrap">{b.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        </div>
      </div>
      )}
    </ModalOverlay>
  )
}
