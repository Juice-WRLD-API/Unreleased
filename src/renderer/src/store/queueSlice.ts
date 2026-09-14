/**
 * queueSlice.ts - all queue and playback logic in one place.
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
import { apiFetch, songToTrack } from '../lib/juicewrldApi'
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

  // Lazy loading (non-radio mode)
  queueFilter: QueueFilter | null
  /** True while a background page fetch is in flight. */
  queueLoadingMore: boolean
  /** Where the current queue came from - used to activate radio on shuffle. */
  queueSource: 'tracker' | 'playlist' | null

  /**
   * Radio mode: enabled when the user clicks a track from the Tracker with
   * shuffle on. Uses /radio/random/ to fetch each next song - no pre-built
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
   * Does NOT activate radio mode - use `startRadio` for that.
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
   * `keepPlayState` - when true, leaves isPlaying as it already was instead
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
  _prefetchRadioTrack: () => void
  /** Asynchronously swaps `track` for the version the user actually wants -
   *  its group's preferred version, or its linked OG sibling when "prefer OG
   *  version" is on - once it becomes the current track. No-op when neither
   *  applies. */
  _maybeSwapToPreferredVersion: (track: Track) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fisher-Yates shuffle - returns a new array, does not mutate. */
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

const RADIO_HISTORY_LIMIT = 30

// Bumped whenever a new radio session starts. Prefetch callbacks and 3s error
// retries capture the value at their start and bail if it has moved on -
// otherwise stopping radio and quickly restarting it left the old session's
// retry loop alive alongside the new one, both racing to set radioNext.
let _radioSession = 0

/** Matches version labels like "OG", "OG File", "OG Quality" (not "Original Key",
 *  which is an unrelated field) - the community convention for the raw/leaked
 *  file as opposed to a snippet, CDQ rip, TV mix, etc. */
const isOgVersion = (meta: SongVersionMeta | null | undefined): boolean =>
  !!meta && /\bog\b/i.test(`${meta.version ?? ''} ${meta.versionTitle ?? ''}`)

/** Matches a member against a user's preferred version label ("v1", "TV Mix").
 *  Compares the per-song `version` field only - `versionTitle` is shared by
 *  every member of a group and so can't distinguish between them. */
const matchesVersionLabel = (meta: SongVersionMeta | null | undefined, label: string): boolean =>
  !!meta?.version && meta.version.trim().toLowerCase() === label.trim().toLowerCase()

/** The version label this user wants to hear from `songId`'s group.
 *
 *  Preferences are stored per song, but a default version is really a property
 *  of the GROUP - so a default set on any member governs all of them, and
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
 *  returns a Track for it - or null when the current one is already right (or
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
  // Playback *modes* persist across restarts (the queue itself doesn't - it's
  // rebuilt from whatever the user plays next). radioMode deliberately stays
  // off on load even when shuffle was on: radio is started by toggling shuffle
  // from a tracker context, so it's a property of the live session, and
  // restoring it would resume fetching random songs nobody asked for.
  shuffle: ls.get<boolean>('shuffle') ?? false,
  repeat: ls.get<'none' | 'all' | 'one'>('repeat') ?? 'none',
  queueFilter: null,
  queueLoadingMore: false,
  queueSource: null,
  radioMode: false,
  radioNext: null,
  _radioWaiting: false,
  radioFilter: null,

  // ── Simple setters ─────────────────────────────────────────────────────────
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setProgress: (progress) => set({ progress }),
  setCurrentTime: (currentTime) => set({ currentTime }),

  // ── playTrack ──────────────────────────────────────────────────────────────
  playTrack: (track, context?, filter = null, source = null) => {
    const tracks: Track[] = context ?? (get().queue as Track[])
    let idx = tracks.findIndex((t: Track) => t.id === track.id)
    if (idx < 0) idx = 0

    const { shuffle } = get()
    let finalQueue = tracks
    if (shuffle && source !== 'tracker') {
      const played = tracks.slice(0, idx + 1)
      const upcoming = fisherYates(tracks.slice(idx + 1))
      finalQueue = [...played, ...upcoming]
    }

    set({
      queue: finalQueue,
      queueIndex: idx,
      currentTrack: track,
      currentTrackFull: null,
      isPlaying: true,
      queueFilter: filter,
      queueSource: source,
      radioMode: false,
      radioNext: null,
      _radioWaiting: false,
      radioFmActive: false,
      progress: 0,
      currentTime: 0,
    })
    if (filter?.hasMore) get()._loadMore()
    get()._maybeSwapToPreferredVersion(track)
  },

  // ── playCollection ─────────────────────────────────────────────────────────
  playCollection: (tracks, filter = null, source = null) => {
    if (tracks.length === 0) return
    if (get().shuffle && source !== 'tracker') {
      const shuffled = fisherYates(tracks)
      get().playTrack(shuffled[0], shuffled, filter, source)
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
    set({
      queue: [track],
      queueIndex: 0,
      currentTrack: track,
      currentTrackFull: null,
      isPlaying: opts?.keepPlayState ? get().isPlaying : true,
      queueFilter: null,
      queueLoadingMore: false,
      radioMode: true,
      radioFilter: filter,
      radioNext: null,
      _radioWaiting: false,
      radioFmActive: false,
      // Same reasoning as isPlaying above: when reusing the already-current
      // track (keepPlayState), the real <audio> element's position was never
      // actually touched (nothing here changes currentTrack.id, so the
      // load/seek effect never re-fires) - resetting these to 0 would just
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
    const { queue, queueIndex, shuffle, repeat, radioMode, radioNext } = get()

    // ── Radio mode ──────────────────────────────────────────────────────────
    if (radioMode) {
      if (!radioNext) {
        // Pre-fetch not ready yet - mark as waiting; _prefetchRadioTrack will
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
    set({ queueIndex: nextIdx, currentTrack: track, currentTrackFull: null, isPlaying: true, progress: 0, currentTime: 0 })
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
    set({ queueIndex: prevIdx, currentTrack: track, currentTrackFull: null, isPlaying: true, progress: 0, currentTime: 0 })
    get()._maybeSwapToPreferredVersion(track)
    return track
  },

  // ── jumpToTrack ───────────────────────────────────────────────────────────────
  jumpToTrack: (track, absoluteIndex) => {
    const { queue } = get()
    const idx = (absoluteIndex != null && queue[absoluteIndex]?.id === track.id)
      ? absoluteIndex
      : queue.findIndex((t: Track) => t.id === track.id)
    if (idx < 0) return
    set({ queueIndex: idx, currentTrack: track, currentTrackFull: null, isPlaying: true, progress: 0, currentTime: 0 })
    get()._maybeSwapToPreferredVersion(track)
  },

  // ── toggleShuffle ──────────────────────────────────────────────────────────
  toggleShuffle: () => {
    const { shuffle, queue, queueIndex, queueFilter, radioMode, currentTrack, queueSource } = get()
    const newShuffle = !shuffle
    // Written once up front so every branch below (including the radio-mode
    // early return) leaves storage agreeing with the resulting state.
    ls.set('shuffle', newShuffle)

    if (!newShuffle) {
      // Turning OFF: exit radio mode if active, resume linear playback
      set({ shuffle: false, radioMode: false, radioNext: null, _radioWaiting: false })
      return
    }

    if (radioMode) {
      // Already in radio mode - no change needed for toggling ON again
      return
    }

    // Turning ON: tracker context → radio mode; otherwise shuffle the queue
    if (queueSource === 'tracker' && currentTrack) {
      set({ shuffle: true })
      const rf = queueFilter
        ? { category: queueFilter.category, era: queueFilter.era, search: queueFilter.search, total: queueFilter.total }
        : null
      get().startRadio(currentTrack, rf, { keepPlayState: true })
      return
    }

    // Turning ON (playlist/files/non-tracker): shuffle the upcoming portion
    const played = queue.slice(0, queueIndex + 1)
    const upcoming = fisherYates(queue.slice(queueIndex + 1))
    set({ shuffle: true, queue: [...played, ...upcoming] })
  },

  // ── reshuffleQueue ─────────────────────────────────────────────────────────
  // Re-rolls a fresh random order for what's still upcoming, regardless of
  // whether shuffle was already on - unlike toggleShuffle, which only
  // randomizes on the OFF→ON transition and otherwise just flips shuffle off.
  reshuffleQueue: () => {
    const { currentTrack, queue, queueIndex, queueFilter, radioMode, queueSource } = get()
    if (!currentTrack) return
    ls.set('shuffle', true)

    if (radioMode) {
      // Already mid radio session - only re-roll the next-up prediction.
      // Reusing startRadio here (like the branch below does) would restart
      // the currently playing track from 0, force-resume it if paused, and
      // wipe this session's history - none of that belongs to "give me a
      // different next song." Bumping _radioSession invalidates any prefetch
      // already in flight so a stale response can't clobber this one.
      set({ shuffle: true, radioNext: null })
      _radioSession++
      get()._prefetchRadioTrack()
      return
    }

    if (queueSource === 'tracker' && currentTrack) {
      // Not in radio mode yet - same as toggleShuffle's tracker branch,
      // starting a fresh radio session from the current track.
      set({ shuffle: true })
      const rf = queueFilter
        ? { category: queueFilter.category, era: queueFilter.era, search: queueFilter.search, total: queueFilter.total }
        : null
      get().startRadio(currentTrack, rf, { keepPlayState: true })
      return
    }

    const played = queue.slice(0, queueIndex + 1)
    const upcoming = fisherYates(queue.slice(queueIndex + 1))
    set({ shuffle: true, queue: [...played, ...upcoming] })
  },

  // ── toggleRepeat ───────────────────────────────────────────────────────────
  toggleRepeat: () => {
    const order: Array<'none' | 'all' | 'one'> = ['none', 'all', 'one']
    const next = order[(order.indexOf(get().repeat) + 1) % 3]
    ls.set('repeat', next)
    set({ repeat: next })
  },

  // ── Queue editing ──────────────────────────────────────────────────────────
  addToQueue: (track) => set((s: QueueSlice) => ({ queue: [...s.queue, track] })),

  playNext: (track) =>
    set((s: QueueSlice) => {
      const after = s.queueIndex + 1
      return { queue: [...s.queue.slice(0, after), track, ...s.queue.slice(after)] }
    }),

  removeFromQueue: (index) =>
    set((s: QueueSlice) => {
      const next = s.queue.filter((_, i) => i !== index)
      const newIndex = index <= s.queueIndex ? Math.max(0, s.queueIndex - 1) : s.queueIndex
      return { queue: next, queueIndex: newIndex }
    }),

  clearQueue: () =>
    set((s: QueueSlice) => ({
      queue: s.currentTrack ? [s.currentTrack] : [],
      queueIndex: 0,
      radioMode: false,
      radioNext: null,
      _radioWaiting: false,
    })),

  reorderQueue: (fromIdx, toIdx) =>
    set((s: QueueSlice) => {
      const base = s.queueIndex + 1
      const upcoming = [...s.queue.slice(base)]
      const [moved] = upcoming.splice(fromIdx, 1)
      upcoming.splice(toIdx, 0, moved)
      return { queue: [...s.queue.slice(0, base), ...upcoming] }
    }),

  // ── Lazy loading (non-radio) ───────────────────────────────────────────────
  _loadMore: () => {
    const { queue, queueIndex, shuffle, queueFilter, queueLoadingMore, radioMode } = get()
    if (radioMode || !queueFilter?.hasMore || queueLoadingMore) return

    const upcomingCount = queue.length - queueIndex - 1
    const threshold = shuffle ? 40 : 15
    if (upcomingCount >= threshold) return

    set({ queueLoadingMore: true })
    apiFetch<JWApiPaginatedResponse>('/songs/', {
      searchall: queueFilter.search || undefined,
      category: queueFilter.category || undefined,
      era: queueFilter.era || undefined,
      page: queueFilter.page,
      page_size: 50,
    })
      .then((data) => {
        const newTracks = data.results.filter((s) => !!s.path).map(songToTrack)
        const { queue: q, queueIndex: qi, shuffle: isShuffle, queueFilter: qf } = get()
        if (!qf) return

        let nextQueue: Track[]
        if (isShuffle) {
          const played = q.slice(0, qi + 1)
          const upcoming = insertRandom(q.slice(qi + 1), newTracks)
          nextQueue = [...played, ...upcoming]
        } else {
          nextQueue = [...q, ...newTracks]
        }

        set({
          queue: nextQueue,
          queueLoadingMore: false,
          queueFilter: { ...qf, page: qf.page + 1, hasMore: data.next !== null },
        })
      })
      .catch(() => set({ queueLoadingMore: false }))
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
    // Nothing could possibly swap - no per-song default anywhere and the
    // global toggle off - so skip the version lookup rather than pay a
    // /versions/ round trip on every track change for the common case.
    if (!preferOg && !hasAnyDefaultVersion()) return
    resolveVersionSwap(track, preferOg)
      .then((swapped) => {
        if (!swapped) return
        const state = get()
        // Bail if the user has since moved on to a different track.
        if (state.currentTrack?.id !== track.id) return
        set({
          currentTrack: swapped,
          currentTrackFull: null,
          queue: state.queue.map((t: Track) => (t.id === track.id ? swapped : t)),
        })
      })
      .catch(() => {})
  },
})