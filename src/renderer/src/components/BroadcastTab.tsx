import { useState } from 'react'
import { Loader2, AlertCircle, Check, Megaphone } from 'lucide-react'
import { sendBroadcast, BROADCAST_LEVELS, BROADCAST_MAX_MESSAGE, BROADCAST_MAX_TITLE, type BroadcastLevel } from '../lib/broadcastApi'
import { errorMessage } from '../lib/format'

const LEVEL_STYLE: Record<BroadcastLevel, string> = {
  info: 'bg-accent/15 text-accent border-accent/30',
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  error: 'bg-red-500/15 text-red-400 border-red-500/30',
}

// Admin-only: pushes one message to everyone connected right now. Nothing is
// stored server-side, so people who are offline never see it - say so before
// the admin sends, and confirm before sending since it can't be recalled.
export default function BroadcastTab(): JSX.Element {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [level, setLevel] = useState<BroadcastLevel>('info')
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const trimmed = message.trim()

  const send = async (): Promise<void> => {
    setSending(true); setError(null); setSent(false)
    try {
      await sendBroadcast({ message: trimmed, title: title.trim() || undefined, level })
      setSent(true)
      setTitle(''); setMessage('')
    } catch (e) {
      setError(errorMessage(e, 'Failed to send broadcast'))
    } finally {
      setSending(false)
      setConfirming(false)
    }
  }

  const inputCls = 'w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-accent/50'

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-lg space-y-4">
        <div>
          <h2 className="text-text-primary text-base font-bold flex items-center gap-2"><Megaphone size={16} /> Broadcast a message</h2>
          <p className="text-text-muted text-xs mt-1.5 leading-relaxed">
            Shows as a banner for everyone using the app right now. It isn't saved, so people who are offline won't see it later.
          </p>
        </div>

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
      </div>
    </div>
  )
}
