/**
 * queueSlice.ts — all queue and playback logic in one place.
 *
 * Responsibilities:
 *  - Queue state (tracks, index, shuffle, repeat)
 *  - Playback state (currentTrack, isPlaying, progress, currentTime)
 *  - Lazy loading (background page fetching, triggered by nextTrack)
 *  - Shuffle with random insertion so newly fetched tracks land at random
 *    positions in the upcoming list instead of piling up at the end
 *  - Radio mode: when shuffle is active from the Tracker, uses /radio/random/
 *    instead of a pre-built queue. Queue stays empty (only history is kept).
 */

import type { StateCreator } from 'zustand'
import type { Track } from '../types'
import { apiFetch, loadAllSongs, songToTrack } from '../lib/juicewrldApi'
import type { JWApiPaginatedResponse, JWApiSong } from '../lib/juicewrldApi'
import { getOwnVersionMeta, getVersionGroup } from '../lib/versionsApi'
import type { SongVersionMeta } from '../lib/versionsApi'
import { peekSongPref, hasAnyDefaultVersion } from '../lib/songPrefs'
import { ls } from '../lib/persist'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueueFilter {
  /** Empty string = no filter (full catalog). */
  category: string
  era: string
  search: string
  /** Lyrics-tab query; mutually exclusive with search in current callers. */
  lyrics?: string
  /** Next page number to fetch. */
  page: number
  hasMore: boolean
  total: number
}

interface RadioResponse {
  title: string
  path: string
  song: JWApiSong
  size: number
  hash: string
}

export interface QueueSlice {
  // Playback
  queue: Track[]
  queueIndex: number
  currentTrack: Track | null
  isPlaying: boolean
  progress: number
  currentTime: number
  shuffle: boolean
  repeat: 'none' | 'all' | 'one'

  /**
   * The queue's tracks in their un-shuffled, source order — the reference used
   * to put the upcoming portion back when shuffle is switched off. Kept as a
   * separate list rather than derived from `queue`, since `queue` may have been
   * shuffled any number of times since. Null in radio mode (no real queue).
   */
  queueOriginal: Track[] | null

  // Lazy loading (non-radio mode)
  queueFilter: QueueFilter | null
  /** True while a background page fetch is in flight. */
  queueLoadingMore: boolean
  /** True while Tracker shuffle is fetching its complete filtered pool. */
  queueMaterializing: boolean
  /** Next was requested before the complete shuffle pool was ready. */
  queueAdvanceWaiting: boolean
  /** User-visible failure from full-pool shuffle preparation. */
  queueMaterializeError: string | null
  /** Manual immediate-next occurrences that survive full-pool materialization. */
  queueManualNextIds: string[]
  /** Manual tail occurrences that survive full-pool materialization. */
  queueManualTailIds: string[]
  /** Natural catalog occurrences explicitly removed before materialization. */
  queueRemovedCatalogIds: string[]
  /** Where the current queue came from — used to activate radio on shuffle. */
  queueSource: 'tracker' | 'playlist' | null

  /**
   * Radio mode: enabled when the user clicks a track from the Tracker with
   * shuffle on. Uses /radio/random/ to fetch each next song — no pre-built
   * queue. History of played tracks is kept in `queue` (capped at 30).
   */
  radioMode: boolean
  /** Pre-fetched next radio track, null while the fetch is in flight. */
  radioNext: Track | null
  /** True when nextTrack() was called but radioNext wasn't ready yet. */
  _radioWaiting: boolean
  radioFilter: { category: string; era: string; search: string; total: number } | null

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Start playing `track` with a known context list.
   * `filter` enables lazy loading beyond the initial context.
   * Does NOT activate radio mode — use `startRadio` for that.
   */
  playTrack: (track: Track, context?: Track[], filter?: QueueFilter | null, source?: 'tracker' | 'playlist' | null) => void

  /**
   * Play a whole collection without a specific starting track (hero Play
   * buttons, context-menu Play). With shuffle on, starts from a random
   * track; otherwise starts from the first.
   */
  playCollection: (tracks: Track[], filter?: QueueFilter | null, source?: 'tracker' | 'playlist' | null) => void

  /**
   * Start radio mode. The queue is seeded with `track` only;
   * subsequent songs come from /radio/random/ one at a time.
   *
   * `keepPlayState` — when true, leaves isPlaying as it already was instead
   * of forcing it on. Use this for "activate radio as a side effect of some
   * other toggle" call sites (turning shuffle on); leave it unset for an
   * explicit "play this track" action, where forcing playback on is correct.
   */
  startRadio: (track: Track, filter?: { category: string; era: string; search: string; total: number } | null, opts?: { keepPlayState?: boolean }) => void
  /** Exit radio mode, keep current track playing. */
  stopRadio: () => void

  /** Advance to the next track. Returns the track, or null if playback stops. */
  nextTrack: () => Track | null

  /** Go back one track (or restart if >3 s in). */
  prevTrack: () => Track | null

  /**
   * Jump to a specific track in the queue without touching radioMode,
   * the queue itself, or the lazy-load filter. Used when clicking queue
   * rows (history or upcoming). `absoluteIndex` disambiguates queues that
   * contain the same track twice; falls back to first id match.
   */
  jumpToTrack: (track: Track, absoluteIndex?: number) => void

  toggleShuffle: () => void
  reshuffleQueue: () => void
  toggleRepeat: () => void

  setIsPlaying: (playing: boolean) => void
  setProgress: (progress: number) => void
  setCurrentTime: (time: number) => void

  // Queue editing
  addToQueue: (track: Track) => void
  playNext: (track: Track) => void
  removeFromQueue: (absoluteIndex: number) => void
  clearQueue: () => void
  reorderQueue: (fromIdx: number, toIdx: number) => void

  // Internal
  _loadMore: () => void
  _materializeTrackerShuffle: (excludedRootId?: string) => void
  _prefetchRadioTrack: () => void
  /** Asynchronously swaps `track` for the version the user actually wants —
   *  its group's preferred version, or its linked OG sibling when "prefer OG
   *  version" is on — once it becomes the current track. No-op when neither
   *  applies. */
  _maybeSwapToPreferredVersion: (track: Track) => Promise<Track | null>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fisher-Yates shuffle — returns a new array, does not mutate. */
export function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Insert `items` at uniformly-random positions within `base`.
 * Returns a new array; does not mutate inputs.
 */
function insertRandom<T>(base: T[], items: T[]): T[] {
  const result = [...base]
  for (const item of items) {
    result.splice(Math.floor(Math.random() * (result.length + 1)), 0, item)
  }
  return result
}

/** Remove one source occurrence for every matching timeline occurrence. */
function withoutOccurrences(source: Track[], consumed: Track[]): Track[] {
  const counts = new Map<string, number>()
  for (const track of consumed) counts.set(track.id, (counts.get(track.id) ?? 0) + 1)
  return source.filter((track) => {
    const count = counts.get(track.id) ?? 0
    if (count === 0) return true
    counts.set(track.id, count - 1)
    return false
  })
}

/** Select queue occurrences represented by an id multiset, preserving order. */
function matchingOccurrences(source: Track[], ids: string[]): Track[] {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return source.filter((track) => {
    const count = counts.get(track.id) ?? 0
    if (count === 0) return false
    counts.set(track.id, count - 1)
    return true
  })
}

function removeOneId(ids: string[], id: string): string[] {
  const index = ids.indexOf(id)
  if (index < 0) return ids
  return [...ids.slice(0, index), ...ids.slice(index + 1)]
}

const RADIO_HISTORY_LIMIT = 30

// Bumped whenever a new radio session starts. Prefetch callbacks and 3s error
// retries capture the value at their start and bail if it has moved on —
// otherwise stopping radio and quickly restarting it left the old session's
// retry loop alive alongside the new one, both racing to set radioNext.
let _radioSession = 0

// Bumped whenever the active queue context is replaced or cleared. Lazy page
// responses capture this value and may only append while it still matches;
// otherwise an old Tracker query can leak rows into a newer queue.
let _queueLoadSession = 0

/** Matches version labels like "OG", "OG File", "OG Quality" (not "Original Key",
 *  which is an unrelated field) — the community convention for the raw/leaked
 *  file as opposed to a snippet, CDQ rip, TV mix, etc. */
const isOgVersion = (meta: SongVersionMeta | null | undefined): boolean =>
  !!meta && /\bog\b/i.test(`${meta.version ?? ''} ${meta.versionTitle ?? ''}`)

/** Matches a member against a user's preferred version label ("v1", "TV Mix").
 *  Compares the per-song `version` field only — `versionTitle` is shared by
 *  every member of a group and so can't distinguish between them. */
const matchesVersionLabel = (meta: SongVersionMeta | null | undefined, label: string): boolean =>
  !!meta?.version && meta.version.trim().toLowerCase() === label.trim().toLowerCase()

/** The version label this user wants to hear from `songId`'s group.
 *
 *  Preferences are stored per song, but a default version is really a property
 *  of the GROUP — so a default set on any member governs all of them, and
 *  playing a sibling (or a compact-view group row, which can start from
 *  whichever member it likes) honours it. The song's own row wins when several
 *  members disagree. */
function groupDefaultVersion(songId: number, group: SongVersionMeta[]): string | null {
  const own = peekSongPref(songId)?.default_version
  if (own) return own
  for (const member of group) {
    const label = peekSongPref(member.songId)?.default_version
    if (label) return label
  }
  return null
}

const apiSongId = (track: Track): number | null => {
  if (!track.id.startsWith('jw-')) return null
  const songId = Number(track.id.slice(3))
  return Number.isFinite(songId) ? songId : null
}

/** Given an API-sourced track, works out which song should actually play and
 *  returns a Track for it — or null when the current one is already right (or
 *  there's nothing to swap to).
 *
 *  A per-song default version is explicit intent about this exact group, so it
 *  wins over the global prefer-OG toggle. If a default is set but no member
 *  carries that label, nothing is swapped: quietly falling back to OG would
 *  play something the user didn't ask for. */
async function resolveVersionSwap(track: Track, preferOg: boolean): Promise<Track | null> {
  const songId = apiSongId(track)
  if (songId == null) return null

  const [own, group] = await Promise.all([getOwnVersionMeta(songId), getVersionGroup(songId)])

  const wanted = groupDefaultVersion(songId, group)
  if (wanted) {
    if (matchesVersionLabel(own, wanted)) return null
    const target = group.find(m => matchesVersionLabel(m, wanted))
    if (!target) return null
    return songToTrack(await apiFetch<JWApiSong>(`/songs/${target.songId}/`))
  }

  if (!preferOg || isOgVersion(own)) return null
  const ogSibling = group.find(isOgVersion)
  if (!ogSibling) return null
  return songToTrack(await apiFetch<JWApiSong>(`/songs/${ogSibling.songId}/`))
}

// ─── Slice factory ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createQueueSlice: StateCreator<any, [], [], QueueSlice> = (set, get) => ({
  // ── Initial state ──────────────────────────────────────────────────────────
  queue: [],
  queueIndex: -1,
  currentTrack: null,
  isPlaying: false,
  progress: 0,
  currentTime: 0,
  // Playback *modes* persist across restarts (the queue itself doesn't — it's
  // rebuilt from whatever the user plays next). radioMode deliberately stays
  // off on load even when shuffle was on: radio is started by toggling shuffle
  // from a tracker context, so it's a property of the live session, and
  // restoring it would resume fetching random songs nobody asked for.
  shuffle: ls.get<boolean>('shuffle') ?? false,
  repeat: ls.get<'none' | 'all' | 'one'>('repeat') ?? 'none',
  queueOriginal: null,
  queueFilter: null,
  queueLoadingMore: false,
  queueMaterializing: false,
  queueAdvanceWaiting: false,
  queueMaterializeError: null,
  queueManualNextIds: [],
  queueManualTailIds: [],
  queueRemovedCatalogIds: [],
  queueSource: null,
  radioMode: false,
  radioNext: null,
  _radioWaiting: false,
  radioFilter: null,

  // ── Simple setters ─────────────────────────────────────────────────────────
  // Any explicit play/pause command supersedes a deferred Next request that
  // is waiting for full shuffle materialization.
  setIsPlaying: (isPlaying) => set({ isPlaying, queueAdvanceWaiting: false, _radioWaiting: false }),
  setProgress: (progress) => set({ progress }),
  setCurrentTime: (currentTime) => set({ currentTime }),

  // ── playTrack ──────────────────────────────────────────────────────────────
  playTrack: (track, context?, filter = null, source = null) => {
    let tracks: Track[] = context ?? (get().queue as Track[])
    let idx = tracks.findIndex((t: Track) => t.id === track.id)
    if (idx < 0) {
      // Several Tracker surfaces (lyrics, calendar, producers, compact
      // groups) play independently fetched results while the Songs tab owns
      // the visible context. Keep the requested song in both the shuffled
      // queue and queueOriginal even when those datasets do not overlap.
      if (source === 'tracker') tracks = [track, ...tracks]
      idx = 0
    }

    const { shuffle } = get()
    let finalQueue = tracks
    let originalQueue = tracks
    const needsFullTrackerShuffle = source === 'tracker' && shuffle && !!filter?.hasMore
    if (source === 'tracker') {
      // An explicit Tracker row click starts a new timeline. Source rows above
      // the click were not played and must never appear as fabricated history.
      // Shuffle still considers the entire supplied context by rotating it
      // around the selection before randomizing the remaining pool.
      const selectedFirst = [track, ...tracks.slice(idx + 1), ...tracks.slice(0, idx)]
      originalQueue = shuffle ? selectedFirst : tracks.slice(idx)
      finalQueue = shuffle
        ? needsFullTrackerShuffle ? [track] : [track, ...fisherYates(selectedFirst.slice(1))]
        : originalQueue
      idx = 0
    } else if (shuffle) {
      // Preserve established playlist/file semantics; this PR changes Tracker
      // shuffle only.
      const played = tracks.slice(0, idx + 1)
      const upcoming = fisherYates(tracks.slice(idx + 1))
      finalQueue = [...played, ...upcoming]
    }

    _queueLoadSession++
    const queueSession = _queueLoadSession
    set({
      queue: finalQueue,
      // `tracks` is the context as the view listed it, before the shuffle
      // above — exactly what turning shuffle back off should restore to.
      queueOriginal: originalQueue,
      queueIndex: idx,
      currentTrack: track,
      currentTrackFull: null,
      isPlaying: true,
      queueFilter: filter,
      queueLoadingMore: false,
      queueMaterializing: needsFullTrackerShuffle,
      queueAdvanceWaiting: false,
      queueMaterializeError: null,
      queueManualNextIds: [],
      queueManualTailIds: [],
      queueRemovedCatalogIds: [],
      queueSource: source,
      radioMode: false,
      radioNext: null,
      _radioWaiting: false,
      radioFmActive: false,
      progress: 0,
      currentTime: 0,
    })
    const preferenceCheck = get()._maybeSwapToPreferredVersion(track)
    if (needsFullTrackerShuffle) {
      preferenceCheck.finally(() => {
        if (_queueLoadSession === queueSession) get()._materializeTrackerShuffle(track.id)
      })
    } else if (filter?.hasMore) get()._loadMore()
  },

  // ── playCollection ─────────────────────────────────────────────────────────
  playCollection: (tracks, filter = null, source = null) => {
    if (tracks.length === 0) return
    if (get().shuffle) {
      const shuffled = fisherYates(tracks)
      if (source === 'tracker') {
        // Pick a random start, but pass the source list itself so playTrack can
        // preserve queueOriginal and build one canonical shuffled queue.
        get().playTrack(shuffled[0], tracks, filter, source)
      } else {
        get().playTrack(shuffled[0], shuffled, filter, source)
        set({ queueOriginal: tracks })
      }
    } else {
      get().playTrack(tracks[0], tracks, filter, source)
    }
  },

  // ── stopRadio ──────────────────────────────────────────────────────────────
  stopRadio: () => {
    set({ radioMode: false, radioNext: null, _radioWaiting: false })
  },

  // ── startRadio ─────────────────────────────────────────────────────────────
  startRadio: (track, filter = null, opts) => {
    _radioSession++
    _queueLoadSession++
    set({
      queue: [track],
      queueOriginal: null,
      queueIndex: 0,
      currentTrack: track,
      currentTrackFull: null,
      isPlaying: opts?.keepPlayState ? get().isPlaying : true,
      queueFilter: null,
      queueLoadingMore: false,
      queueMaterializing: false,
      queueAdvanceWaiting: false,
      queueMaterializeError: null,
      queueManualNextIds: [],
      queueManualTailIds: [],
      queueRemovedCatalogIds: [],
      radioMode: true,
      radioFilter: filter,
      radioNext: null,
      _radioWaiting: false,
      radioFmActive: false,
      // Same reasoning as isPlaying above: when reusing the already-current
      // track (keepPlayState), the real <audio> element's position was never
      // actually touched (nothing here changes currentTrack.id, so the
      // load/seek effect never re-fires) — resetting these to 0 would just
      // make the displayed time lie about where playback really is, most
      // visibly while paused (no 'timeupdate' event ever arrives to correct
      // it back).
      progress: opts?.keepPlayState ? get().progress : 0,
      currentTime: opts?.keepPlayState ? get().currentTime : 0,
    })
    get()._prefetchRadioTrack()
    get()._maybeSwapToPreferredVersion(track)
  },

  // ── nextTrack ──────────────────────────────────────────────────────────────
  nextTrack: () => {
    const {
      queue, queueIndex, shuffle, repeat, radioMode, radioNext,
      queueMaterializing, queueManualNextIds, queueManualTailIds,
    } = get()

    // ── Radio mode ──────────────────────────────────────────────────────────
    if (radioMode) {
      if (!radioNext) {
        // Pre-fetch not ready yet — mark as waiting; _prefetchRadioTrack will
        // auto-play when the fetch completes.
        set({ isPlaying: false, _radioWaiting: true })
        return null
      }
      // Advance to the pre-fetched track (roll history, cap at limit)
      const newQueue = [...queue.slice(-(RADIO_HISTORY_LIMIT - 1)), radioNext]
      set({
        queue: newQueue,
        queueIndex: newQueue.length - 1,
        currentTrack: radioNext,
        currentTrackFull: null,
        isPlaying: true,
        radioNext: null,
        _radioWaiting: false,
        progress: 0,
        currentTime: 0,
      })
      get()._prefetchRadioTrack()
      get()._maybeSwapToPreferredVersion(radioNext)
      return radioNext
    }

    if (queue.length === 0) return null

    // ── Standard queue ──────────────────────────────────────────────────────
    let nextIdx: number

    if (repeat === 'one') {
      nextIdx = queueIndex
    } else if (shuffle) {
      nextIdx = queueIndex + 1
      if (nextIdx >= queue.length) {
        if (queueMaterializing) {
          set({ isPlaying: false, queueAdvanceWaiting: true })
          return null
        }
        if (repeat === 'all') {
          const reshuffled = fisherYates(queue)
          const first = reshuffled[0]
          set({ queue: reshuffled, queueIndex: 0, currentTrack: first, currentTrackFull: null, isPlaying: true, progress: 0, currentTime: 0 })
          get()._loadMore()
          get()._maybeSwapToPreferredVersion(first)
          return first
        } else {
          set({ isPlaying: false }); return null
        }
      }
    } else {
      nextIdx = queueIndex + 1
      if (nextIdx >= queue.length) {
        if (repeat === 'all') nextIdx = 0
        else { set({ isPlaying: false }); return null }
      }
    }

    const track = queue[nextIdx]
    const tailStart = queue.length - queueManualTailIds.length
    set({
      queueIndex: nextIdx,
      currentTrack: track,
      currentTrackFull: null,
      isPlaying: true,
      progress: 0,
      currentTime: 0,
      // A Play Next occurrence stops being pending as soon as it is consumed,
      // regardless of whether full-catalog materialization has started yet.
      queueManualNextIds: nextIdx > queueIndex && queueManualNextIds.length > 0
        ? removeOneId(queueManualNextIds, track.id)
        : queueManualNextIds,
      queueManualTailIds: queueManualTailIds.length > 0 && nextIdx !== queueIndex && nextIdx >= tailStart
        ? removeOneId(queueManualTailIds, track.id)
        : queueManualTailIds,
    })
    get()._loadMore()
    get()._maybeSwapToPreferredVersion(track)
    return track
  },

  // ── prevTrack ──────────────────────────────────────────────────────────────
  prevTrack: () => {
    const { queue, queueIndex, currentTime, radioMode } = get()
    if (queue.length === 0) return null

    // In radio mode, only allow restarting the current track
    if (radioMode) {
      set({ currentTime: 0, progress: 0 })
      return get().currentTrack
    }

    if (currentTime > 3) {
      set({ currentTime: 0, progress: 0 })
      return get().currentTrack
    }

    const prevIdx = Math.max(0, queueIndex - 1)
    const track = queue[prevIdx]
    set({ queueIndex: prevIdx, currentTrack: track, currentTrackFull: null, isPlaying: true, progress: 0, currentTime: 0, queueAdvanceWaiting: false, _radioWaiting: false })
    get()._maybeSwapToPreferredVersion(track)
    return track
  },

  // ── jumpToTrack ───────────────────────────────────────────────────────────────
  jumpToTrack: (track, absoluteIndex) => {
    const { queue, queueIndex, queueManualNextIds, queueManualTailIds } = get()
    const idx = (absoluteIndex != null && queue[absoluteIndex]?.id === track.id)
      ? absoluteIndex
      : queue.findIndex((t: Track) => t.id === track.id)
    if (idx < 0) return
    let pendingNext = queueManualNextIds
    if (idx > queueIndex && pendingNext.length > 0) {
      pendingNext = [...pendingNext]
      const consumedThrough = Math.min(idx, queueIndex + queueManualNextIds.length)
      for (let i = queueIndex + 1; i <= consumedThrough; i++) {
        pendingNext = removeOneId(pendingNext, queue[i].id)
      }
    }
    let pendingTail = queueManualTailIds
    if (idx > queueIndex && pendingTail.length > 0) {
      pendingTail = [...pendingTail]
      const tailStart = queue.length - queueManualTailIds.length
      for (let i = Math.max(queueIndex + 1, tailStart); i <= idx; i++) {
        pendingTail = removeOneId(pendingTail, queue[i].id)
      }
    }
    set({ queueIndex: idx, currentTrack: track, currentTrackFull: null, isPlaying: true, progress: 0, currentTime: 0, queueAdvanceWaiting: false, _radioWaiting: false, queueManualNextIds: pendingNext, queueManualTailIds: pendingTail })
    get()._loadMore()
    get()._maybeSwapToPreferredVersion(track)
  },

  // ── toggleShuffle ──────────────────────────────────────────────────────────
  toggleShuffle: () => {
    const {
      shuffle, queue, queueIndex, radioMode, currentTrack, queueOriginal, queueSource,
      queueFilter, queueManualNextIds, queueManualTailIds, queueAdvanceWaiting,
    } = get()
    const newShuffle = !shuffle
    // Written once up front so every branch below (including the radio-mode
    // early return) leaves storage agreeing with the resulting state.
    ls.set('shuffle', newShuffle)

    if (!newShuffle) {
      // Preserve the active Tracker timeline verbatim and restore only source
      // entries that have not already been traversed. Queue-panel labels call
      // this prefix "Earlier in queue" because an explicit forward jump can
      // bypass positions without literally playing them.
      if (!radioMode && queueSource === 'tracker' && queueOriginal && currentTrack) {
        _queueLoadSession++
        const timeline = queue.slice(0, queueIndex + 1)
        const remaining = withoutOccurrences(queueOriginal, timeline)
        set({
          shuffle: false,
          queue: [...timeline, ...remaining],
          // Keep occurrence indices aligned in linear mode. Queue editing can
          // then remove the exact duplicate row the user selected.
          queueOriginal: [...timeline, ...remaining],
          queueIndex: timeline.length - 1,
          radioMode: false,
          radioNext: null,
          _radioWaiting: false,
          queueMaterializing: false,
          queueAdvanceWaiting: false,
          queueLoadingMore: false,
        })
        if (queueAdvanceWaiting && timeline.length + remaining.length > timeline.length) get().nextTrack()
        return
      }

      const idx = queueOriginal && currentTrack
        ? queueOriginal.findIndex((t: Track) => t.id === currentTrack.id)
        : -1
      const restored = (!radioMode && queueOriginal && idx >= 0)
        ? { queue: [...queueOriginal], queueIndex: idx }
        : {}
      set({ shuffle: false, radioMode: false, radioNext: null, _radioWaiting: false, ...restored })
      return
    }

    if (radioMode) {
      // Already in radio mode — no change needed for toggling ON again
      return
    }

    if (queueSource === 'tracker' && queueFilter?.hasMore) {
      _queueLoadSession++
      const timeline = queue.slice(0, queueIndex + 1)
      const upcoming = queue.slice(queueIndex + 1)
      const pinnedNext = matchingOccurrences(upcoming, queueManualNextIds)
      set({
        shuffle: true,
        queue: [...timeline, ...pinnedNext],
        queueMaterializing: true,
        queueAdvanceWaiting: false,
        queueMaterializeError: null,
        queueLoadingMore: true,
      })
      get()._materializeTrackerShuffle()
      return
    }

    // Turning ON: preserve actual playback history/current and randomize only
    // the future. Tracker now uses this same materialized queue as every other
    // source instead of switching to one-song-lookahead radio mode.
    const played = queue.slice(0, queueIndex + 1)
    const upcoming = fisherYates(queue.slice(queueIndex + 1))
    set({ shuffle: true, queue: [...played, ...upcoming] })
    get()._loadMore()
  },

  // ── reshuffleQueue ─────────────────────────────────────────────────────────
  // Re-rolls a fresh random order for what's still upcoming, regardless of
  // whether shuffle was already on — unlike toggleShuffle, which only
  // randomizes on the OFF→ON transition and otherwise just flips shuffle off.
  reshuffleQueue: () => {
    const {
      currentTrack, queue, queueIndex, radioMode, queueSource, queueFilter,
      queueManualNextIds, queueManualTailIds, queueMaterializing,
    } = get()
    if (!currentTrack) return
    ls.set('shuffle', true)

    if (radioMode) {
      // Already mid radio session — only re-roll the next-up prediction.
      // Reusing startRadio here (like the branch below does) would restart
      // the currently playing track from 0, force-resume it if paused, and
      // wipe this session's history — none of that belongs to "give me a
      // different next song." Bumping _radioSession invalidates any prefetch
      // already in flight so a stale response can't clobber this one.
      set({ shuffle: true, radioNext: null })
      _radioSession++
      get()._prefetchRadioTrack()
      return
    }


    if (queueMaterializing) return

    if (queueSource === 'tracker' && queueFilter?.hasMore) {
      _queueLoadSession++
      const timeline = queue.slice(0, queueIndex + 1)
      const upcoming = queue.slice(queueIndex + 1)
      const pinnedNext = matchingOccurrences(upcoming, queueManualNextIds)
      set({
        shuffle: true,
        queue: [...timeline, ...pinnedNext],
        queueMaterializing: true,
        queueAdvanceWaiting: false,
        queueMaterializeError: null,
        queueLoadingMore: true,
      })
      get()._materializeTrackerShuffle()
      return
    }

    const played = queue.slice(0, queueIndex + 1)
    const upcoming = fisherYates(queue.slice(queueIndex + 1))
    set({ shuffle: true, queue: [...played, ...upcoming] })
    get()._loadMore()
  },

  // ── toggleRepeat ───────────────────────────────────────────────────────────
  toggleRepeat: () => {
    const order: Array<'none' | 'all' | 'one'> = ['none', 'all', 'one']
    const next = order[(order.indexOf(get().repeat) + 1) % 3]
    ls.set('repeat', next)
    set({ repeat: next })
  },

  // ── Queue editing ──────────────────────────────────────────────────────────
  // Each of these mirrors its edit into queueOriginal, so that switching
  // shuffle off later restores a list the user still recognises — with their
  // hand-queued tracks in it and their removals honoured — instead of the
  // pristine playlist the session happened to start from.
  addToQueue: (track) =>
    set((s: QueueSlice) => ({
      // During full-pool preparation the final tail does not exist yet. Keep
      // the entry in the source reference/provenance and reveal it only after
      // the randomized pool so it cannot masquerade as immediate-next.
      queue: s.queueMaterializing ? s.queue : [...s.queue, track],
      queueOriginal: s.queueOriginal ? [...s.queueOriginal, track] : null,
      queueManualTailIds: [...s.queueManualTailIds, track.id],
    })),

  playNext: (track) =>
    set((s: QueueSlice) => {
      const after = s.queueIndex + 1
      // Positioned relative to the current track in *each* list: the shuffled
      // queue and the source order disagree about where that track sits.
      const cur = s.queue[s.queueIndex]
      const oAfter = !s.shuffle
        ? after
        : s.queueOriginal && cur
          ? s.queueOriginal.findIndex((t) => t.id === cur.id) + 1
          : 0
      return {
        queue: [...s.queue.slice(0, after), track, ...s.queue.slice(after)],
        queueOriginal: s.queueOriginal && oAfter > 0
          ? [...s.queueOriginal.slice(0, oAfter), track, ...s.queueOriginal.slice(oAfter)]
          : s.queueOriginal,
        queueManualNextIds: [...s.queueManualNextIds, track.id],
      }
    }),

  removeFromQueue: (index) =>
    set((s: QueueSlice) => {
      const next = s.queue.filter((_, i) => i !== index)
      const newIndex = index <= s.queueIndex ? Math.max(0, s.queueIndex - 1) : s.queueIndex
      // Matched by id — the two lists are ordered differently, so the index
      // doesn't carry across. A duplicated track loses its first copy, which
      // is indistinguishable from the removed one anyway.
      const removed = s.queue[index]
      const nextCount = s.queueManualNextIds.length
      const tailCount = s.queueManualTailIds.length
      // Placement is occurrence-sensitive. The same song may have one copy
      // pinned next and another explicitly appended to the tail; removing the
      // tail copy must not consume the Play Next marker (or vice versa).
      let removedNext = !!removed && index > s.queueIndex && index <= s.queueIndex + nextCount &&
        s.queueManualNextIds.includes(removed.id)
      let removedTail = !!removed && !s.queueMaterializing && tailCount > 0 && index >= s.queue.length - tailCount
      if (removedTail) removedNext = false
      let nextOriginal = s.queueOriginal
      if (nextOriginal && removed) {
        if (!s.shuffle && nextOriginal[index]?.id === removed.id) {
          // In linear mode both lists have identical occurrence order, so the
          // clicked absolute index is the only correct answer for duplicates.
          nextOriginal = nextOriginal.filter((_, i) => i !== index)
        } else {
          const dropIndex = removedTail
            ? nextOriginal.map((t) => t.id).lastIndexOf(removed.id)
            : nextOriginal.findIndex((t) => t.id === removed.id)
          if (dropIndex >= 0) nextOriginal = nextOriginal.filter((_, i) => i !== dropIndex)
        }
      }
      return {
        queue: next,
        queueIndex: newIndex,
        queueManualNextIds: removed && removedNext
          ? removeOneId(s.queueManualNextIds, removed.id)
          : s.queueManualNextIds,
        queueManualTailIds: removed && removedTail
          ? removeOneId(s.queueManualTailIds, removed.id)
          : s.queueManualTailIds,
        queueRemovedCatalogIds: removed && !removedNext && !removedTail &&
          s.queueSource === 'tracker' && !!s.queueFilter?.hasMore
          ? [...s.queueRemovedCatalogIds, removed.id]
          : s.queueRemovedCatalogIds,
        queueOriginal: nextOriginal,
      }
    }),

  clearQueue: () => {
    _queueLoadSession++
    set((s: QueueSlice) => ({
      queue: s.currentTrack ? [s.currentTrack] : [],
      queueOriginal: s.currentTrack ? [s.currentTrack] : null,
      queueIndex: 0,
      queueFilter: null,
      queueLoadingMore: false,
      queueMaterializing: false,
      queueAdvanceWaiting: false,
      queueMaterializeError: null,
      queueManualNextIds: [],
      queueManualTailIds: [],
      queueRemovedCatalogIds: [],
      queueSource: null,
      radioMode: false,
      radioNext: null,
      _radioWaiting: false,
    }))
  },

  reorderQueue: (fromIdx, toIdx) => {
    const before = get()
    // Positional manual entries must keep their Play Next/tail guarantees.
    // Refuse the ambiguous edge-case drag until those entries are consumed;
    // ordinary Tracker queues remain reorderable and continue lazy-loading.
    if (
      before.queueMaterializing || before.queueManualNextIds.length > 0 ||
      before.queueManualTailIds.length > 0
    ) return
    set((s: QueueSlice) => {
      const base = s.queueIndex + 1
      const upcoming = [...s.queue.slice(base)]
      const [moved] = upcoming.splice(fromIdx, 1)
      upcoming.splice(toIdx, 0, moved)
      const next = [...s.queue.slice(0, base), ...upcoming]
      // With shuffle off the two lists are the same order, so a drag is really
      // an edit to the source order and has to stick. While shuffled they've
      // diverged and these indices mean nothing in the source list — the drag
      // is just a tweak to this shuffle, discarded when it ends.
      return {
        queue: next,
        queueOriginal: s.shuffle ? s.queueOriginal : next,
      }
    })
  },

  // ── Full Tracker shuffle materialization ──────────────────────────────────
  _materializeTrackerShuffle: (excludedRootId) => {
    const initial = get()
    const filter = initial.queueFilter as QueueFilter | null
    const root = (initial.queueOriginal?.[0] ?? initial.currentTrack) as Track | null
    if (
      !root || !filter?.hasMore || !initial.shuffle ||
      initial.queueSource !== 'tracker'
    ) return

    const session = _queueLoadSession
    const fallbackOriginal = [...(initial.queueOriginal ?? [root])]
    const replacedSourceIds = new Set<string>()
    if (excludedRootId) replacedSourceIds.add(excludedRootId)
    set({ queueMaterializing: true, queueLoadingMore: true, queueMaterializeError: null })

    // Version preference lookups and the all-songs request are both async.
    // Re-check the live current entry before committing so a toggle, a queued
    // Next, or a media-key advance cannot race materialization and leave both
    // the original and preferred sibling in the generated queue.
    const syncLivePreference = async (): Promise<boolean> => {
      while (session === _queueLoadSession) {
        if (session !== _queueLoadSession) return false
        const beforeState = get()
        const before = beforeState.currentTrack as Track | null
        const beforeIndex = beforeState.queueIndex
        if (!before) return true
        const swapped = await get()._maybeSwapToPreferredVersion(before)
        if (swapped && swapped.id !== before.id) replacedSourceIds.add(before.id)
        if (session !== _queueLoadSession) return false
        const afterState = get()
        const after = afterState.currentTrack as Track | null
        if (!after) return true
        // A concurrent lookup may have performed the swap first, in which
        // case this call correctly returns null. Inspect the same queue slot:
        // unlike currentTrack alone, it distinguishes that replacement from
        // ordinary Previous/Next navigation during the await.
        if (afterState.queue[beforeIndex]?.id !== before.id) replacedSourceIds.add(before.id)
        if (after.id === before.id || after.id === swapped?.id) return true
        // The user advanced while the lookup was in flight. Coordinate the
        // newly-current entry too before allowing the full queue to commit.
      }
      return false
    }

    const unfiltered = !filter.search && !filter.lyrics && !filter.category && !filter.era
    const loadPool = () => unfiltered
      ? loadAllSongs()
      : apiFetch<JWApiSong[]>('/songs/', {
          all: 'true',
          searchall: filter.search || undefined,
          lyrics: filter.lyrics || undefined,
          category: filter.category || undefined,
          era: filter.era || undefined,
          omit: 'lyrics,synced_lyrics,groupbuy_info',
        })

    Promise.resolve()
      .then(async () => {
        // The pool request doesn't depend on the preference lookups, so run
        // them side by side instead of making the fetch wait behind them.
        const pool = loadPool()
        pool.catch(() => {})
        if (!await syncLivePreference()) return null
        const songs = await pool
        if (!await syncLivePreference()) return null
        return songs
      })
      .then((songs) => {
        if (!songs) return
        if (session !== _queueLoadSession) return
        const state = get()
        if (!state.shuffle || state.queueSource !== 'tracker') return

        const unique = new Map<string, Track>()
        for (const song of songs) {
          if (!song.path) continue
          const candidate = songToTrack(song)
          if (!unique.has(candidate.id)) unique.set(candidate.id, candidate)
        }
        for (const id of replacedSourceIds) unique.delete(id)
        for (const id of state.queueRemovedCatalogIds) unique.delete(id)
        const canonical = [...unique.values()]

        // While the full pool was loading, the active queue contained only
        // real history/current plus explicit manual entries. Preserve those
        // exact occurrences, then randomize every remaining eligible song.
        const timeline = state.queue.slice(0, state.queueIndex + 1)
        const liveUpcoming = state.queue.slice(state.queueIndex + 1)
        const pinnedNext = matchingOccurrences(liveUpcoming, state.queueManualNextIds)
        const pinnedTail = matchingOccurrences(state.queueOriginal ?? [], state.queueManualTailIds)
        // Manual entries are intentional extra occurrences. Only actual
        // timeline positions consume the catalog's natural occurrence.
        const remaining = withoutOccurrences(canonical, timeline)
        const waiting = state.queueAdvanceWaiting
        set({
          queue: [...timeline, ...pinnedNext, ...fisherYates(remaining), ...pinnedTail],
          queueOriginal: [...timeline, ...pinnedNext, ...remaining, ...pinnedTail],
          queueFilter: null,
          queueLoadingMore: false,
          queueMaterializing: false,
          queueAdvanceWaiting: false,
          queueMaterializeError: null,
          queueManualNextIds: [],
          queueManualTailIds: [],
          queueRemovedCatalogIds: [],
        })
        if (waiting) get().nextTrack()
      }, () => {
        // onRejected of the same .then: only pool/preference failures land
        // here, never an error thrown while committing a successful pool.
        if (session !== _queueLoadSession) return
        const state = get()
        if (state.queueSource !== 'tracker') return

        const timeline = state.queue.slice(0, state.queueIndex + 1)
        const liveUpcoming = state.queue.slice(state.queueIndex + 1)
        const pinnedNext = matchingOccurrences(liveUpcoming, state.queueManualNextIds)
        const pinnedTail = matchingOccurrences(state.queueOriginal ?? [], state.queueManualTailIds)
        // Unlike a freshly fetched canonical catalog, fallbackOriginal already
        // contains the manual entries. Consume them before explicitly placing
        // them or an API failure would duplicate every pinned occurrence.
        const remaining = withoutOccurrences(
          state.queueOriginal ?? fallbackOriginal,
          [...timeline, ...pinnedNext, ...pinnedTail],
        )
        const waiting = state.queueAdvanceWaiting
        const linear = [...timeline, ...pinnedNext, ...remaining, ...pinnedTail]
        ls.set('shuffle', false)
        set({
          shuffle: false,
          queue: linear,
          queueOriginal: linear,
          queueIndex: timeline.length - 1,
          queueLoadingMore: false,
          queueMaterializing: false,
          queueAdvanceWaiting: false,
          queueMaterializeError: 'Could not prepare the complete shuffle. Continuing in order.',
        })
        if (waiting && linear.length > timeline.length) get().nextTrack()
      })
  },

  // ── Lazy loading (non-radio) ───────────────────────────────────────────────
  _loadMore: () => {
    const { queue, queueIndex, shuffle, queueFilter, queueLoadingMore, radioMode } = get()
    if (radioMode || !queueFilter?.hasMore || queueLoadingMore) return

    const upcomingCount = queue.length - queueIndex - 1
    const threshold = shuffle ? 40 : 15
    if (upcomingCount >= threshold) return

    const session = _queueLoadSession
    set({ queueLoadingMore: true })
    apiFetch<JWApiPaginatedResponse>('/songs/', {
      searchall: queueFilter.search || undefined,
      lyrics: queueFilter.lyrics || undefined,
      category: queueFilter.category || undefined,
      era: queueFilter.era || undefined,
      page: queueFilter.page,
      page_size: 50,
    })
      .then((data) => {
        if (session !== _queueLoadSession) return
        const {
          queue: q, queueIndex: qi, shuffle: isShuffle, queueFilter: qf,
          queueOriginal: qo, queueManualTailIds: tailIds,
        } = get()
        if (!qf) { set({ queueLoadingMore: false }); return }
        const existingIds = new Set([...q, ...(qo ?? [])].map((track) => track.id))
        const newTracks = data.results
          .filter((song) => !!song.path)
          .map(songToTrack)
          .filter((track) => !existingIds.has(track.id))

        let nextQueue: Track[]
        const tailCount = tailIds.length
        const queueTail = tailCount > 0 ? q.slice(-tailCount) : []
        const queueBodyEnd = tailCount > 0 ? q.length - tailCount : q.length
        if (isShuffle) {
          const played = q.slice(0, qi + 1)
          const existingUpcoming = q.slice(qi + 1, queueBodyEnd)
          // Once a next song is visible (or explicitly inserted with Play
          // Next), a background page must not overtake it. Randomize new rows
          // only behind that stable immediate-next entry.
          const upcoming = existingUpcoming.length > 0
            ? [existingUpcoming[0], ...insertRandom(existingUpcoming.slice(1), newTracks)]
            : fisherYates(newTracks)
          nextQueue = [...played, ...upcoming, ...queueTail]
        } else {
          nextQueue = [...q.slice(0, queueBodyEnd), ...newTracks, ...queueTail]
        }

        const originalTail = qo && tailCount > 0 ? qo.slice(-tailCount) : []
        const originalBodyEnd = qo && tailCount > 0 ? qo.length - tailCount : (qo?.length ?? 0)

        set({
          queue: nextQueue,
          // A page arrives in source order, so it extends the reference order
          // as-is even when the copies going into `queue` were scattered
          // randomly through the upcoming tracks above.
          queueOriginal: qo ? [...qo.slice(0, originalBodyEnd), ...newTracks, ...originalTail] : null,
          queueLoadingMore: false,
          queueFilter: { ...qf, page: qf.page + 1, hasMore: data.next !== null },
        })
      })
      .catch(() => { if (session === _queueLoadSession) set({ queueLoadingMore: false }) })
  },

  // ── Radio pre-fetch ────────────────────────────────────────────────────────────
  _prefetchRadioTrack: () => {
    const { radioFilter } = get()
    const session = _radioSession
    const live = (): boolean => get().radioMode && session === _radioSession

    const handleTrack = (track: Track): void => {
      if (!live()) return
      const wasWaiting = get()._radioWaiting
      set({ radioNext: track, _radioWaiting: false })
      if (wasWaiting) {
        const { queue } = get()
        const newQueue = [...queue.slice(-(RADIO_HISTORY_LIMIT - 1)), track]
        set({ queue: newQueue, queueIndex: newQueue.length - 1, currentTrack: track, currentTrackFull: null, isPlaying: true, radioNext: null, progress: 0, currentTime: 0 })
        get()._prefetchRadioTrack()
        get()._maybeSwapToPreferredVersion(track)
      }
    }

    const handleError = (): void => {
      if (live()) setTimeout(() => { if (live()) get()._prefetchRadioTrack() }, 3000)
    }

    if (radioFilter && (radioFilter.category || radioFilter.era || radioFilter.search)) {
      const pageSize = 50
      const totalPages = Math.max(1, Math.ceil(radioFilter.total / pageSize))
      const randomPage = Math.floor(Math.random() * totalPages) + 1
      apiFetch<JWApiPaginatedResponse>('/songs/', {
        searchall: radioFilter.search || undefined,
        category: radioFilter.category || undefined,
        era: radioFilter.era || undefined,
        page: randomPage,
        page_size: pageSize,
      })
        .then((data) => {
          if (!live()) return
          const playable = data.results.filter((s: JWApiSong) => !!s.path)
          if (playable.length === 0) { handleError(); return }
          handleTrack(songToTrack(playable[Math.floor(Math.random() * playable.length)]))
        })
        .catch(handleError)
    } else {
      apiFetch<RadioResponse>('/radio/random/')
        .then((data) => handleTrack(songToTrack(data.song)))
        .catch(handleError)
    }
  },

  // ── Preferred-version swap ─────────────────────────────────────────────────
  _maybeSwapToPreferredVersion: (track) => {
    const preferOg = get().preferOgVersion
    // Nothing could possibly swap — no per-song default anywhere and the
    // global toggle off — so skip the version lookup rather than pay a
    // /versions/ round trip on every track change for the common case.
    if (!preferOg && !hasAnyDefaultVersion()) return Promise.resolve(null)
    return resolveVersionSwap(track, preferOg)
      .then((swapped) => {
        if (!swapped) return null
        const state = get()
        // Bail if the user has since moved on to a different track.
        if (state.currentTrack?.id !== track.id) return null
        set({
          currentTrack: swapped,
          currentTrackFull: null,
          queue: state.queue.map((t: Track) => (t.id === track.id ? swapped : t)),
          // Same substitution in the source order, or turning shuffle off
          // couldn't find the now-playing track there and would leave the
          // queue shuffled.
          queueOriginal: state.queueOriginal?.map((t: Track) => (t.id === track.id ? swapped : t)) ?? null,
        })
        return swapped
      })
      .catch(() => null)
  },
})
