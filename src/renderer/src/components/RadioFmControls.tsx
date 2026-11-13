import { useCallback, useEffect, useState } from 'react'
import { Search, SkipForward, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { getActiveRadioClient } from '../lib/radioSocketService'
import { useRadioSuggest, useRadioVoteCountdown } from '../hooks/useWrldCore'
import { SearchHelpButton } from './SearchHelpPopover'

// 999 FM's listener controls: the vote (skip or queue), suggesting the next
// song, up next and coming up. WRLD's FM panel (Radio tab) and the 999 FM
// widget in WRLD's Widgets layout both show it. Styled for WRLD's dark backdrop.

export default function RadioFmControls(): JSX.Element {
  const {
    radioFmVote, radioFmUpNext, radioFmQueuePreview, radioFmVoteDismissed, setRadioFmVoteDismissed,
  } = useStorePick('radioFmVote', 'radioFmUpNext', 'radioFmQueuePreview', 'radioFmVoteDismissed', 'setRadioFmVoteDismissed')
  const {
    suggestQuery, setSuggestQuery, suggestResults, suggestLoading,
    proposed, proposeError, handlePropose, dismissProposed,
  } = useRadioSuggest('Tune in to 999 FM first - proposals only count from listeners')
  const [voteError, setVoteError] = useState(false)
  const { myVote, setMyVote, localSecondsLeft } = useRadioVoteCountdown(
    radioFmVote?.active, radioFmVote?.seconds_left, () => setVoteError(false),
  )

  // Time the warning out like the propose error below it. The rising-edge reset
  // above only fires when a brand new ballot arrives, which can be a long way
  // off - long enough for "tune in to 999 FM" to still be sitting there after
  // the listener has done exactly that.
  useEffect(() => {
    if (!voteError) return
    const t = setTimeout(() => setVoteError(false), 4000)
    return () => clearTimeout(t)
  }, [voteError])

  // Highlight a choice only once the socket accepted it - the server discards
  // votes from a connection it hasn't seen listening:true on, which otherwise
  // looks identical to a counted vote.
  const castFmVote = useCallback((value: 'yes' | 'no'): void => {
    const sent = getActiveRadioClient()?.castVote(value) ?? false
    setMyVote(sent ? value : null)
    setVoteError(!sent)
  }, [setMyVote])

  return (
  <div className="flex-1 overflow-y-auto pb-8 px-4 md:px-6 flex flex-col gap-4 md:gap-5" style={{ scrollbarWidth: 'none' }}>
    {/* Vote */}
    {radioFmVote?.active && !radioFmVoteDismissed ? (
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-white/50 text-[11px] font-semibold uppercase tracking-widest">
            {radioFmVote.kind === 'skip' ? 'Vote to Skip' : 'Vote to Queue'}
          </p>
          <div className="flex items-center gap-2">
            {localSecondsLeft != null && (
              <span className={`text-xs tabular-nums font-mono transition-colors ${localSecondsLeft <= 5 ? 'text-red-400/70' : 'text-white/30'}`}>
                {localSecondsLeft}s
              </span>
            )}
            <button onClick={() => setRadioFmVoteDismissed(true)} className="text-white/20 hover:text-white/60 transition-colors">
              <X size={13} />
            </button>
          </div>
        </div>
        {radioFmVote.track && <p className="text-white/80 text-sm font-medium">{radioFmVote.track}</p>}
        <p className="text-white/30 text-xs">
          {radioFmVote.yes ?? 0} yes · {radioFmVote.no ?? 0} no
          {radioFmVote.votes_needed != null && <span> · need {radioFmVote.votes_needed}</span>}
        </p>
        {voteError && (
          <p className="text-red-400/80 text-xs">Vote didn't send - tune in to 999 FM and try again.</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => castFmVote('yes')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-all ${
              myVote === 'yes'
                ? 'bg-green-600/40 text-green-300 ring-1 ring-green-500/50'
                : 'bg-green-600/15 hover:bg-green-600/30 text-green-400'
            }`}>
            <ThumbsUp size={13} /> Yes
          </button>
          <button
            onClick={() => castFmVote('no')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-all ${
              myVote === 'no'
                ? 'bg-red-600/40 text-red-300 ring-1 ring-red-500/50'
                : 'bg-red-900/15 hover:bg-red-900/30 text-red-400'
            }`}>
            <ThumbsDown size={13} /> No
          </button>
        </div>
      </div>
    ) : (
      <button onClick={() => {
        setRadioFmVoteDismissed(false)
        setVoteError(!(getActiveRadioClient()?.proposeSkip() ?? false))
      }}
        className="flex items-center gap-2 text-sm text-white/30 hover:text-white/65 transition-colors self-start">
        <SkipForward size={14} /> Vote to skip
      </button>
    )}
    {voteError && !radioFmVote?.active && (
      <p className="text-red-400/80 text-xs">Tune in to 999 FM to start a vote.</p>
    )}

    {/* Suggest */}
    <div className="flex flex-col gap-2">
      <p className="text-white/40 text-[11px] font-semibold uppercase tracking-widest">Suggest next song</p>
      {proposed ? (
        <div className="flex items-center justify-between bg-green-900/20 border border-green-500/20 rounded-xl px-3 py-2">
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0 animate-pulse" />
            Proposed: <span className="text-green-300 font-medium">{proposed}</span>
          </div>
          <button onClick={dismissProposed} title="Dismiss"
            className="text-green-500/50 hover:text-green-400 transition-colors ml-2 shrink-0">
            <X size={13} />
          </button>
        </div>
      ) : (
        <>
          {proposeError && (
            <p className="text-red-400/80 text-xs pl-1">{proposeError}</p>
          )}
          {/* Same field:"value" syntax as the Tracker - see searchRadioLibrary. */}
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1 min-w-0">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
              <input
                type="text" value={suggestQuery}
                onChange={(e) => setSuggestQuery(e.target.value)}
                placeholder='Search, or producers:"Nick Mira"…'
                className="w-full bg-white/5 text-white/80 text-sm rounded-xl py-2 pl-8 pr-3 border border-white/10 focus:outline-none focus:border-white/25 transition-colors"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <SearchHelpButton
              className={(open) => `p-2 rounded-xl border transition-colors ${open ? 'bg-white/15 border-white/25 text-white/80' : 'bg-white/5 border-white/10 text-white/35 hover:text-white/70'}`}
            />
          </div>
          {suggestLoading && <p className="text-white/25 text-xs pl-1">Searching…</p>}
          {suggestResults.length > 0 && (
            <div className="flex flex-col -mx-1">
              {suggestResults.map(track => (
                <button key={track.id} onClick={() => handlePropose(track)}
                  className="text-left px-3 py-2 rounded-xl hover:bg-white/10 transition-colors group">
                  <p className="text-white/70 text-sm truncate group-hover:text-white/90 transition-colors" title={track.title}>
                    {track.title}
                  </p>
                  <p className="text-white/35 text-xs truncate">{track.artist || track.era}</p>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>

    {/* Up next */}
    {radioFmUpNext && (
      <div className="flex flex-col gap-2">
        <p className="text-white/40 text-[11px] font-semibold uppercase tracking-widest">Up next</p>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/80 text-sm font-medium truncate" title={radioFmUpNext.title}>{radioFmUpNext.title}</p>
          {radioFmUpNext.artist && <p className="text-white/40 text-xs mt-0.5">{radioFmUpNext.artist}</p>}
        </div>
      </div>
    )}

    {/* Queue preview */}
    {radioFmQueuePreview.length > 0 && (
      <div className="flex flex-col gap-2">
        <p className="text-white/40 text-[11px] font-semibold uppercase tracking-widest">Coming up</p>
        <div className="flex flex-col">
          {radioFmQueuePreview.map((title, i) => (
            <div key={i} className="flex items-center gap-3 px-1 py-1.5 rounded-lg">
              <span className="text-white/20 text-xs w-4 text-right shrink-0">{i + 1}</span>
              <p className="text-white/50 text-sm truncate" title={title}>{title}</p>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
  )
}
