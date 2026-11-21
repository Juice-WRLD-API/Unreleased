import { useEffect, useRef, useState } from 'react'
import { Check, Clock, Loader2, Palette, XCircle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { getMyApplication, submitApplication, type EditorApplication } from '../lib/userApi'
import { errorMessage } from '../lib/format'
import { relativeTime } from './adminShared'

const MIN_MOTIVATION = 20

// Settings > Account > Your uploads, for everyone who isn't an artist yet:
// apply for a folder of your own under Cover Arts/. An administrator reviews it
// in Admin > Applications (or the terminal: approve app <id>).
export default function ArtistApply(): JSX.Element {
  const account = useStore((s) => s.account)
  const loadAccount = useStore((s) => s.loadAccount)
  const [application, setApplication] = useState<EditorApplication | null | undefined>(undefined)
  const [motivation, setMotivation] = useState('')
  const [portfolio, setPortfolio] = useState('')
  const [folder, setFolder] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refreshed = useRef(false)

  useEffect(() => {
    let live = true
    getMyApplication('artist')
      .then((r) => { if (live) setApplication(r.application) })
      .catch(() => { if (live) setApplication(null) })
    return () => { live = false }
  }, [])

  // Approved since the account was last loaded: fetch it again so the folder
  // shows up in place of this form.
  useEffect(() => {
    if (application?.status === 'approved' && !refreshed.current) {
      refreshed.current = true
      void loadAccount()
    }
  }, [application, loadAccount])

  const submit = async (): Promise<void> => {
    if (motivation.trim().length < MIN_MOTIVATION || sending) return
    setSending(true)
    setError(null)
    try {
      const made = await submitApplication({
        application_type: 'artist',
        motivation: motivation.trim(),
        portfolio: portfolio.trim(),
        artist_folder: folder.trim(),
      })
      setApplication(made)
    } catch (err) {
      setError(errorMessage(err, 'Could not send your application'))
    } finally {
      setSending(false)
    }
  }

  if (application === undefined) {
    return <div className="flex items-center gap-2 py-3 text-text-muted text-xs"><Loader2 size={13} className="animate-spin" />Loading…</div>
  }

  if (application?.status === 'pending') {
    return (
      <div className="flex items-start gap-2.5 py-3">
        <Clock size={15} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0">
          <p className="text-text-primary text-sm font-medium">Your artist application is waiting for review</p>
          <p className="text-text-muted text-xs mt-0.5">
            Sent {relativeTime(application.created_at)}
            {application.artist_folder ? ` · folder "${application.artist_folder}"` : ''}
          </p>
        </div>
      </div>
    )
  }

  if (application?.status === 'approved') {
    return (
      <div className="flex items-center gap-2 py-3 text-text-secondary text-sm">
        <Check size={15} className="text-emerald-400" />
        Approved. Loading your folder…
      </div>
    )
  }

  const fieldClass = 'w-full rounded-xl bg-[var(--fill)] px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50'
  const short = motivation.trim().length < MIN_MOTIVATION
  return (
    <div className="py-3 space-y-3">
      <div className="flex items-start gap-2.5">
        <Palette size={15} className="mt-0.5 shrink-0 text-accent" />
        <p className="text-text-secondary text-xs leading-relaxed">
          Artists get a folder of their own in Files (Cover Arts) and upload covers there straight away, with no review.
          Apply here and an administrator will look at your work.
        </p>
      </div>
      {application?.status === 'rejected' && (
        <div className="rounded-xl bg-red-500/10 px-3 py-2.5">
          <p className="text-red-400 text-xs font-semibold flex items-center gap-1.5"><XCircle size={13} />Your last application wasn't approved</p>
          {application.review_notes && <p className="text-text-muted text-xs italic mt-1">"{application.review_notes}"</p>}
        </div>
      )}
      <textarea value={motivation} onChange={(e) => setMotivation(e.target.value)} rows={3}
        placeholder="What kind of covers do you make, and why do you want a folder? (at least 20 characters)"
        aria-label="Why you want to be an artist" className={`${fieldClass} resize-none`} />
      <textarea value={portfolio} onChange={(e) => setPortfolio(e.target.value)} rows={2}
        placeholder="Links to your work (optional)" aria-label="Links to your work" className={`${fieldClass} resize-none`} />
      <input value={folder} onChange={(e) => setFolder(e.target.value)} maxLength={120}
        placeholder={`Folder name (optional, defaults to ${account?.display_name || account?.discord_username || 'your name'})`}
        aria-label="Folder name" className={fieldClass} />
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        {short && motivation.length > 0 && (
          <span className="text-text-muted text-[11px]">{MIN_MOTIVATION - motivation.trim().length} more characters</span>
        )}
        <button onClick={() => void submit()} disabled={sending || short}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {sending && <Loader2 size={12} className="animate-spin" />}
          Apply to be an artist
        </button>
      </div>
    </div>
  )
}
