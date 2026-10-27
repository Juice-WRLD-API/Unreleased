import { useEffect, useRef, useState } from 'react'
import { SkipForward, ThumbsUp, ThumbsDown, X, Radio } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { getActiveRadioClient } from '../lib/radioSocketService'

// App-wide 999 FM vote popup. The WRLD view has its own inline vote panel, but
// a skip/queue vote is time-limited and listeners aren't always looking at that
// page - this floats over every other view so people actually see when it's
// time to vote. Suppressed on the WRLD view itself to avoid a double control.
export default function RadioVotePopup(): JSX.Element | null {
  const {
    radioFmActive, radioFmVote, activeView,
    radioFmVoteDismissed, setRadioFmVoteDismissed,
  } = useStorePick('radioFmActive', 'radioFmVote', 'activeView', 'radioFmVoteDismissed', 'setRadioFmVoteDismissed')

  const [myVote, setMyVote] = useState<'yes' | 'no' | null>(null)
  const [voteError, setVoteError] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wasActiveRef = useRef(false)

  // Rising edge of `active` = a brand new vote just started. Clear the local
  // Yes/No selection then, but not on every repeated broadcast of the same
  // ongoing vote (which would keep un-highlighting it). Dismissal itself is
  // reset centrally in RadioFmPlayer so it stays shared.
  useEffect(() => {
    const isActive = !!radioFmVote?.active
    if (isActive && !wasActiveRef.current) {
      setMyVote(null)
      setVoteError(false)
    }
    wasActiveRef.current = isActive
  }, [radioFmVote?.active])

  // Time the warning out the way the WRLD panel times out its propose error.
  // The rising-edge reset above only fires when a brand new ballot arrives,
  // which can be a long way off - long enough for a stale "didn't send" to sit
  // under a vote the listener has since cast successfully.
  useEffect(() => {
    if (!voteError) return
    const t = setTimeout(() => setVoteError(false), 4000)
    return () => clearTimeout(t)
  }, [voteError])

  // Tick the countdown locally, once per second, independent of how often the
  // server rebroadcasts metadata (created once per vote, only re-synced after).
  useEffect(() => {
    if (!radioFmVote?.active || radioFmVote.seconds_left == null) {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
      setSecondsLeft(null)
      return
    }
    setSecondsLeft(radioFmVote.seconds_left)
    if (!countdownRef.current) {
      countdownRef.current = setInterval(() => {
        setSecondsLeft(s => (s != null && s > 0) ? s - 1 : 0)
      }, 1000)
    }
  }, [radioFmVote?.active, radioFmVote?.seconds_left])

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current) }, [])

  // Only surface for tuned-in listeners, when a vote is live and undismissed,
  // and not on the WRLD view (its inline panel already covers this).
  if (!radioFmActive || !radioFmVote?.active || radioFmVoteDismissed || activeView === 'wrld') return null

  const isSkip = radioFmVote.kind === 'skip'
  // The server silently drops votes from a socket it hasn't seen listening:true
  // on, so only highlight a choice the socket actually accepted.
  const cast = (value: 'yes' | 'no'): void => {
    const sent = getActiveRadioClient()?.castVote(value) ?? false
    setMyVote(sent ? value : null)
    setVoteError(!sent)
  }

  return (
    <div
      className="fixed z-[60] bottom-24 right-4 w-[calc(100vw-2rem)] max-w-xs
        bg-black/85 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl
        p-4 flex flex-col gap-3 animate-[voteIn_0.25s_ease-out]"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <style>{`@keyframes voteIn{from{opacity:0;transform:translateY(12px) scale(0.96)}to{opacity:1;transform:none}}`}</style>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-red-600/25 flex items-center justify-center shrink-0">
            {isSkip ? <SkipForward size={12} className="text-red-400" /> : <Radio size={12} className="text-red-400" />}
          </span>
          <p className="text-white/60 text-[11px] font-semibold uppercase tracking-widest">
            {isSkip ? '999 FM · Vote to Skip' : '999 FM · Vote to Queue'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {secondsLeft != null && (
            <span className={`text-xs tabular-nums font-mono transition-colors ${secondsLeft <= 5 ? 'text-red-400' : 'text-white/35'}`}>
              {secondsLeft}s
            </span>
          )}
          <button onClick={() => setRadioFmVoteDismissed(true)} className="text-white/25 hover:text-white/70 transition-colors" title="Dismiss">
            <X size={14} />
          </button>
        </div>
      </div>

      {radioFmVote.track && <p className="text-white/85 text-sm font-medium truncate" title={radioFmVote.track}>{radioFmVote.track}</p>}

      <p className="text-white/35 text-xs">
        {radioFmVote.yes ?? 0} yes · {radioFmVote.no ?? 0} no
        {radioFmVote.votes_needed != null && <span> · need {radioFmVote.votes_needed}</span>}
      </p>

      {voteError && (
        <p className="text-red-400 text-xs">Vote didn't send - tune in to 999 FM and try again.</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => cast('yes')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-all ${
            myVote === 'yes'
              ? 'bg-green-600/40 text-green-300 ring-1 ring-green-500/50'
              : 'bg-green-600/15 hover:bg-green-600/30 text-green-400'
          }`}>
          <ThumbsUp size={13} /> Yes
        </button>
        <button
          onClick={() => cast('no')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-all ${
            myVote === 'no'
              ? 'bg-red-600/40 text-red-300 ring-1 ring-red-500/50'
              : 'bg-red-900/15 hover:bg-red-900/30 text-red-400'
          }`}>
          <ThumbsDown size={13} /> No
        </button>
      </div>
    </div>
  )
}
