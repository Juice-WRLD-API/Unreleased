import type { RadioLiveState, RadioVote } from './radioLive'
import { showAppToast } from './appToast'

// Tells a tuned-in listener how a 999 FM vote ended. The station never says:
// the vote just goes inactive. So the outcome is read from what follows. A
// vote passed if its last tally reached the votes needed, or if, within a few
// seconds of it ending, a skip vote's song changed or a queue vote's song
// showed up in the queue. Otherwise it failed. A song that happens to end on
// its own right then reads as a passed skip; that's the one guess this makes.
// Fed every station frame by RadioFmPlayer, the one place metadata lands.

/** How long after a vote ends its effect may take to show. */
const SETTLE_MS = 4000

interface Ended { vote: RadioVote; title: string | null }

/** The newest frame of the vote that's on now. */
let live: Ended | null = null
/** A vote that ended undecided, waiting for its effect to show. */
let waiting: (Ended & { timer: ReturnType<typeof setTimeout> }) | null = null

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase()

function reachedCount(vote: RadioVote): boolean {
  return vote.votes_needed != null && (vote.yes ?? 0) >= vote.votes_needed
}

function showedEffect(ended: Ended, state: RadioLiveState): boolean {
  if (ended.vote.kind === 'skip') {
    const now = state.now_playing?.title ?? null
    return !!ended.title && !!now && norm(now) !== norm(ended.title)
  }
  const track = norm(ended.vote.track)
  if (!track) return false
  return norm(state.up_next?.title) === track || (state.queue_preview ?? []).some((t) => norm(t) === track)
}

function report(vote: RadioVote, passed: boolean): void {
  const tally = `${vote.yes ?? 0} yes · ${vote.no ?? 0} no`
  const song = vote.track ? `“${vote.track}”` : 'the song'
  const text = vote.kind === 'skip'
    ? passed ? `999 FM: skip passed (${tally})` : `999 FM: skip vote failed (${tally}${vote.votes_needed != null ? `, needed ${vote.votes_needed}` : ''})`
    : passed ? `999 FM: ${song} is queued (${tally})` : `999 FM: vote to queue ${song} failed (${tally})`
  showAppToast(text, { tone: 'info' })
}

function settle(passed: boolean): void {
  if (!waiting) return
  clearTimeout(waiting.timer)
  const { vote } = waiting
  waiting = null
  report(vote, passed)
}

/** One station frame. `announce`: whether this listener should hear the outcome (tuned in). */
export function noteRadioFrame(state: RadioLiveState, announce: boolean): void {
  if (waiting && showedEffect(waiting, state)) settle(true)
  const vote = state.vote
  if (vote?.active) {
    live = { vote, title: state.now_playing?.title ?? null }
    return
  }
  if (!live) return
  const ended = live
  live = null
  if (!announce) return
  if (waiting) settle(false)
  if (reachedCount(ended.vote) || showedEffect(ended, state)) {
    report(ended.vote, true)
    return
  }
  waiting = { ...ended, timer: setTimeout(() => settle(false), SETTLE_MS) }
}
