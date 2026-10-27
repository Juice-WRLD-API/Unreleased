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
 *
 * Every non-radio shuffle goes through the same two steps - shuffleUpcoming
 * reorders, then _repickBySong re-chooses versions when the queue is a
 * one-row-per-song one (queueSongPool, set by Playlists' compact view). The
 * one-shot Shuffle buttons all call shufflePlay; the player's toggle,
 * reshuffleQueue and repeat-all's wrap reuse the same pieces, so they can't
 * drift apart.
 */

import type { StateCreator } from 'zustand'
import type { Track } from '../types'
import { apiFetch, getSongById, songToTrack } from '../lib/juicewrldApi'
import type { JWApiPaginatedResponse, JWApiSong } from '../lib/juicewrldApi'
import { getOwnVersionMeta, getVersionGroup } from '../lib/versionsApi'
import type { SongVersionMeta } from '../lib/versionsApi'
import { hasAnyDefaultVersion, hasAnyExcludedVersion } from '../lib/songPrefs'
import { groupPreferredVersions, groupExcludedVersions, isExcludedVersion, hasVersionLabelIn } from '../lib/versionPrefs'
import { groupPlaylistBySong, pickSongVersions } from '../lib/compactGroups'
import type { SongUnit } from '../lib/compactGroups'
import { ls } from '../lib/persist'
import { hasPlayableSessionEdit } from '../lib/sessionEditsApi'
import { trackIdToSongId } from '../lib/userApi'
import { resolveQueueContext } from './queueContext'
import { clearQueueSession, loadQueueSession, watchQueueSession } from './queuePersistence'

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
  /** Device-local: restore this queue and position, paused, on reopening. */
  rememberQueue: boolean
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
  /** Where the current queue came from - used to activate radio on shuffle. */
  queueSource: 'tracker' | 'playlist' | null
  /** Set when the queue is one row per SONG (Playlists' compact view): the
   *  playlist's full track list, versions and all. Any shuffle of such a
   *  queue keeps one track per song and re-picks each song's version by the
   *  user's prefer/exclude settings (see _repickBySong). Null otherwise. */
  queueSongPool: Track[] | null

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

  /**
   * Songs that were actually playing before the current one, newest first.
   * Unlike the queue's own played portion this survives the queue being
   * replaced (playing something from the Tracker, starting radio...), so it
   * reflects what the user listened to rather than where they are in the
   * current list. Saved with the queue when enabled; one entry per song (a
   * replay moves it to the front), capped at PLAY_HISTORY_LIMIT.
   */
  playHistory: Track[]

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Start playing `track` with a known context list.
   * `filter` enables lazy loading beyond the initial context.
   * Does NOT activate radio mode - use `startRadio` for that.
   */
  /**
   * Start playback. Omitting `context` means standalone playback; callers
   * representing a collection must pass its tracks explicitly.
   */
  playTrack: (track: Track, context?: Track[], filter?: QueueFilter | null, source?: 'tracker' | 'playlist' | null, opts?: PlayTrackOpts) => void

  /**
   * The one "Shuffle" button behaviour: plays `tracks` in a random order.
   * With `bySong`, each song gets one slot however many of its versions are
   * in `tracks`, and the version is picked by preference (pickGroupVersion) -
   * the queue then remembers `tracks` as its song pool so later reshuffles
   * keep working that way. Doesn't change the shuffle toggle itself.
   */
  shufflePlay: (tracks: Track[], opts?: { bySong?: boolean; filter?: QueueFilter | null; source?: 'tracker' | 'playlist' | null }) => Promise<void>

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
  /**
   * The empty-queue toast's "Play radio": turn on the tracker's random radio
   * (unfiltered /radio/random/) from the current song and move straight on to
   * a random one. The current song stays behind it as history.
   */
  startRandomRadio: () => void

  /** Advance to the next track. Returns the track, or null if playback stops. */
  nextTrack: () => Track | null

  /** Move one position back in the queue. Restart semantics belong to Player. */
  prevTrack: () => Track | null

  /**
   * Jump to a specific track in the queue without touching radioMode,
   * the queue itself, or the lazy-load filter. Used when clicking queue
   * rows (history or upcoming). `absoluteIndex` disambiguates queues that
   * contain the same track twice; falls back to first id match.
   */
  jumpToTrack: (track: Track, absoluteIndex?: number) => void

  /**
   * Replay a song from `playHistory`. Jumps to it if it's still in the
   * current queue; otherwise slots it in right after the current track and
   * plays it, leaving the rest of the queue (and radio mode) untouched.
   */
  playFromHistory: (track: Track) => void
  /** "Change version": swaps `from` for `to` in place in the queue (the
   *  current row when `from` is playing) and plays it, keeping the rest of the
   *  queue and its order. Falls back to a standalone play when `from` isn't
   *  queued. A deliberate pick, so no preferred-version swap afterwards. */
  changeVersion: (from: Track, to: Track) => void

  toggleShuffle: () => void
  reshuffleQueue: () => void
  toggleRepeat: () => void

  setIsPlaying: (playing: boolean) => void
  setProgress: (progress: number) => void
  setCurrentTime: (time: number) => void
  setRememberQueue: (enabled: boolean) => void

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
  /** Song-pool queues only: re-picks the version of every upcoming song (see
   *  queueSongPool). Run after each shuffle of such a queue. */
  _repickBySong: () => Promise<void>
}

export interface PlayTrackOpts {
  /** Marks the queue as one row per song - see QueueSlice.queueSongPool. */
  songPool?: Track[]
  /** `context` is already in its final shuffled order (shufflePlay) - don't
   *  shuffle it again even if the shuffle toggle is on. */
  preshuffled?: boolean
  /** The app chose `track` (first of a collection or shuffle), not the user -
   *  so it's subject to the preferred-version swap. A track the user picked
   *  plays as the exact version they clicked. */
  autoPick?: boolean
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

/** The current track and everything before it stay put; what's upcoming is
 *  reordered. The single reorder step behind every non-radio shuffle. */
function shuffleUpcoming(queue: Track[], queueIndex: number): Track[] {
  return [...queue.slice(0, queueIndex + 1), ...fisherYates(queue.slice(queueIndex + 1))]
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
// How long one radio pick may take (request plus preferred-version lookup)
// before _prefetchRadioTrack gives up on it and asks again.
const RADIO_PREFETCH_TIMEOUT_MS = 15000
const PLAY_HISTORY_LIMIT = 100

// Set while a currentTrack change is the same song under a new identity (a
// preferred-version swap, a moved local file being re-keyed) rather than the
// user moving on - the playHistory subscriber skips those.
let _suppressPlayHistory = false

/** Run `fn` (which swaps currentTrack for a stand-in of the same song)
 *  without the outgoing track being recorded in playHistory. */
export function withoutPlayHistory(fn: () => void): void {
  _suppressPlayHistory = true
  try { fn() } finally { _suppressPlayHistory = false }
}

// Bumped whenever a new radio session starts. Prefetch callbacks and 3s error
// retries capture the value at their start and bail if it has moved on -
// otherwise stopping radio and quickly restarting it left the old session's
// retry loop alive alongside the new one, both racing to set radioNext.
let _radioSession = 0

// Bumped whenever the active queue is replaced or cleared. A lazy page response
// captures it and may only append while it still matches; otherwise an old
// Tracker query leaks rows into a newer queue.
let _queueLoadSession = 0

/** Matches version labels like "OG", "OG File", "OG Quality" (not "Original Key",
 *  which is an unrelated field) - the community convention for the raw/leaked
 *  file as opposed to a snippet, CDQ rip, TV mix, etc. */
const isOgVersion = (meta: SongVersionMeta | null | undefined): boolean =>
  !!meta && /\bog\b/i.test(`${meta.version ?? ''} ${meta.versionTitle ?? ''}`)

const apiSongId = (track: Track): number | null => trackIdToSongId(track.id)

/** Drops session members with no session edit - nothing to swap to there.
 *  Only checked for the members actually in the running, since a miss isn't
 *  cached and would otherwise re-search on every track change. */
async function playableMembers(members: SongVersionMeta[]): Promise<SongVersionMeta[]> {
  const ok = await Promise.all(members.map(m => (m.isSession ? hasPlayableSessionEdit(m.songId) : true)))
  return members.filter((_, i) => ok[i])
}

/** Given an API-sourced track, works out which song should actually play and
 *  returns a Track for it - or null when the current one is already right (or
 *  there's nothing to swap to).
 *
 *  Preferred versions are explicit intent about this exact group, so they win
 *  over the global prefer-OG toggle. Playing a preferred version keeps it;
 *  playing any other member swaps to a preferred one, picked at random when
 *  several are starred. If labels are preferred but no member carries them,
 *  nothing is swapped: quietly falling back to OG would play something the
 *  user didn't ask for. */
async function resolveVersionSwap(track: Track, preferOg: boolean): Promise<Track | null> {
  const songId = apiSongId(track)
  if (songId == null) return null

  const [own, group] = await Promise.all([getOwnVersionMeta(songId), getVersionGroup(songId)])
  const excluded = groupExcludedVersions(songId, group)

  const preferred = groupPreferredVersions(songId, group)
  if (preferred.size > 0) {
    if (hasVersionLabelIn(own, preferred)) return null
    const targets = await playableMembers(group.filter(m => hasVersionLabelIn(m, preferred)))
    if (targets.length === 0) return null
    const target = targets[Math.floor(Math.random() * targets.length)]
    return songToTrack(await getSongById(target.songId))
  }

  // The picked version itself is off-limits (e.g. radio landed on a
  // compacted rip the user excluded) - move to a sibling that isn't, same as
  // compact view's shuffle-play would. A preferred OG sibling wins when that
  // toggle is on and it isn't itself excluded; otherwise take the first
  // playable, non-excluded member. Nothing to do if every sibling is
  // excluded too - better to keep playing something than nothing.
  if (isExcludedVersion(own, excluded)) {
    const preferredOg = preferOg ? group.find(m => isOgVersion(m) && !isExcludedVersion(m, excluded)) : undefined
    const fallback = preferredOg ?? (await playableMembers(group.filter(m => m.songId !== songId && !isExcludedVersion(m, excluded))))[0]
    if (!fallback) return null
    return songToTrack(await getSongById(fallback.songId))
  }

  if (!preferOg || isOgVersion(own)) return null
  const ogSibling = group.find(m => isOgVersion(m) && !isExcludedVersion(m, excluded))
  if (!ogSibling) return null
  return songToTrack(await getSongById(ogSibling.songId))
}

/** resolveVersionSwap, skipped outright when nothing could possibly swap - no
 *  per-song default, no exclusions, and the global toggle off - rather than
 *  pay a /versions/ round trip on every track change for the common case. */
function preferredVersionOf(track: Track, preferOg: boolean): Promise<Track | null> {
  if (!preferOg && !hasAnyDefaultVersion() && !hasAnyExcludedVersion()) return Promise.resolve(null)
  return resolveVersionSwap(track, preferOg)
}

// ─── Slice factory ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createQueueSlice: StateCreator<any, [], [], QueueSlice> = (set, get, api) => {
  const isFloat = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('float')
  const rememberQueue = ls.get<boolean>('rememberQueue') === true
  const restored = rememberQueue && !isFloat ? loadQueueSession() : null
  // Moving within the queue can land back on the song that's already playing
  // (a one-song repeat-all queue, skipping back at index 0). Clearing its
  // FullTrack there made the cover/backdrop drop to the bare imageUrl and the
  // lyrics vanish for a frame until Player rebuilt it - a visible flash.
  const fullFor = (track: Track): unknown => (get().currentTrack?.id === track.id ? get().currentTrackFull : null)

  // Every path that changes the playing song (queue actions, Player's
  // crossfade advance, terminal `stop`...) goes through set(), so one
  // subscriber catches them all instead of each call site remembering to.
  api.subscribe((state: QueueSlice, prev: QueueSlice) => {
    const outgoing = prev.currentTrack
    if (!outgoing || outgoing.id === state.currentTrack?.id || _suppressPlayHistory) return
    const rest = state.playHistory.filter((t) => t.id !== outgoing.id)
    set({ playHistory: [outgoing, ...rest].slice(0, PLAY_HISTORY_LIMIT) })
  })

  // Resolve the up-next row's preferred version ahead of time, so when the
  // queue reaches it (nextTrack or Player's crossfade advance) it starts as
  // that version - swapping only once it's playing meant the queued one was
  // audible for a second first. Keyed on the up-next row changing, so the
  // replacement itself just re-checks once and stops.
  api.subscribe((state: QueueSlice, prev: QueueSlice) => {
    if (state.radioMode) return
    const i = state.queueIndex + 1
    const next = state.queue[i]
    if (!next || next.id === prev.queue[prev.queueIndex + 1]?.id) return
    preferredVersionOf(next, get().preferOgVersion)
      .then((swapped) => {
        if (!swapped) return
        const now: QueueSlice = get()
        if (now.queue[i]?.id !== next.id || now.queueIndex + 1 !== i) return
        set({
          queue: now.queue.map((t, j) => (j === i ? swapped : t)),
          queueOriginal: now.queueOriginal?.map((t) => (t.id === next.id ? swapped : t)) ?? null,
        })
      })
      .catch(() => {})
  })

  if (!isFloat && typeof window !== 'undefined') {
    if (!rememberQueue) clearQueueSession()
    watchQueueSession(api)
    // Continue any pending page/radio preparation after the store is created.
    // Playback itself stays paused until the user presses Play or Next.
    if (restored) queueMicrotask(() => {
      if (get().queue !== restored.queue) return
      if (get().radioMode && !get().radioNext) get()._prefetchRadioTrack()
      else get()._loadMore()
    })
  }

  return {
  // ── Initial state ──────────────────────────────────────────────────────────
  queue: [],
  queueIndex: -1,
  currentTrack: null,
  isPlaying: false,
  progress: 0,
  currentTime: 0,
  rememberQueue,
  // Modes persist independently of the optional saved queue.
  shuffle: ls.get<boolean>('shuffle') ?? false,
  repeat: ls.get<'none' | 'all' | 'one'>('repeat') ?? 'none',
  queueOriginal: null,
  queueFilter: null,
  queueLoadingMore: false,
  queueSource: null,
  queueSongPool: null,
  radioMode: false,
  radioNext: null,
  _radioWaiting: false,
  radioFilter: null,
  playHistory: [],
  ...restored,

  // ── Simple setters ─────────────────────────────────────────────────────────
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setProgress: (progress) => set({ progress }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setRememberQueue: (enabled) => {
    ls.set('rememberQueue', enabled)
    if (!enabled) clearQueueSession()
    set({ rememberQueue: enabled })
  },

  // ── playTrack ──────────────────────────────────────────────────────────────
  playTrack: (track, context?, filter = null, source = null, opts = {}) => {
    // Without an explicit context this is a standalone play request, not a
    // request to graft the song onto whatever queue happened to be active.
    // Always keep currentTrack aligned with queue[queueIndex], including when
    // a malformed/partial context does not contain the requested track.
    const { tracks, index: idx } = resolveQueueContext(track, context)

    const reshuffle = get().shuffle && source !== 'tracker' && !opts.preshuffled
    let finalQueue = reshuffle ? shuffleUpcoming(tracks, idx) : tracks
    let originalQueue = tracks
    let startIdx = idx
    if (source === 'tracker') {
      // An explicit Tracker row click starts a new timeline at that row: the
      // rows above it were never played and must not show up as history.
      // Shuffle rotates the context around the selection, then randomizes the
      // rest, so every row of the list is still in the pool.
      const selectedFirst = [tracks[idx], ...tracks.slice(idx + 1), ...tracks.slice(0, idx)]
      originalQueue = get().shuffle ? selectedFirst : tracks.slice(idx)
      finalQueue = get().shuffle && !opts.preshuffled
        ? [selectedFirst[0], ...fisherYates(selectedFirst.slice(1))]
        : originalQueue
      startIdx = 0
    }

    _queueLoadSession++
    set({
      queue: finalQueue,
      // The context as the view listed it, before the shuffle above - exactly
      // what turning shuffle back off should restore to.
      queueOriginal: originalQueue,
      queueLoadingMore: false,
      queueIndex: startIdx,
      currentTrack: track,
      currentTrackFull: null,
      isPlaying: true,
      queueFilter: filter,
      queueSource: source,
      queueSongPool: opts.songPool ?? null,
      radioMode: false,
      radioNext: null,
      _radioWaiting: false,
      radioFmActive: false,
      progress: 0,
      currentTime: 0,
    })
    if (filter?.hasMore) get()._loadMore()
    if (opts.autoPick) get()._maybeSwapToPreferredVersion(track)
    if (reshuffle) void get()._repickBySong()
  },

  // ── shufflePlay ────────────────────────────────────────────────────────────
  shufflePlay: async (tracks, { bySong = false, filter = null, source = null } = {}) => {
    if (tracks.length === 0) return
    // playTrack only ever sees the pre-shuffled list, so each branch hands it
    // the real source order afterwards - otherwise switching shuffle off would
    // "restore" to this shuffle.
    if (!bySong) {
      const shuffled = fisherYates(tracks)
      get().playTrack(shuffled[0], shuffled, filter, source, { preshuffled: true, autoPick: true })
      set({ queueOriginal: tracks })
      return
    }
    // One pick per song, in playlist order - that order is what turning
    // shuffle off restores to.
    const units = await groupPlaylistBySong<Track>(tracks, t => apiSongId(t) ?? -1)
    const picks = await pickSongVersions(units)
    const shuffled = fisherYates(picks)
    if (!shuffled.length) return
    get().playTrack(shuffled[0], shuffled, filter, source, { preshuffled: true, songPool: tracks, autoPick: true })
    set({ queueOriginal: picks })
  },

  // ── playCollection ─────────────────────────────────────────────────────────
  playCollection: (tracks, filter = null, source = null) => {
    if (tracks.length === 0) return
    if (get().shuffle) {
      void get().shufflePlay(tracks, { filter, source })
    } else {
      get().playTrack(tracks[0], tracks, filter, source, { autoPick: true })
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
      queueSongPool: null,
      queue: [track],
      queueOriginal: null,
      queueIndex: 0,
      currentTrack: track,
      // Radio from the song already playing (keepPlayState, the queue-ended
      // toast) keeps its FullTrack, or the cover/lyrics flash out.
      currentTrackFull: fullFor(track),
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

  // ── startRandomRadio ───────────────────────────────────────────────────────
  startRandomRadio: () => {
    const { currentTrack } = get()
    if (!currentTrack) return
    // Radio is what shuffle-on means for tracker playback (toggleShuffle's
    // tracker branch), so the shuffle button reads as on and turns it back off.
    ls.set('shuffle', true)
    set({ shuffle: true })
    get().startRadio(currentTrack, null, { keepPlayState: true })
    // The prefetch was only just started, so this marks radio as waiting and
    // _prefetchRadioTrack plays the random song as soon as it arrives.
    get().nextTrack()
  },

  // ── nextTrack ──────────────────────────────────────────────────────────────
  nextTrack: () => {
    const { queue, queueIndex, shuffle, repeat, radioMode, radioNext } = get()

    // ── Radio mode ──────────────────────────────────────────────────────────
    if (radioMode) {
      // After stepping back through history, replay forward through it before
      // consuming the pre-fetched radio track.
      if (queueIndex < queue.length - 1) {
        const track = queue[queueIndex + 1]
        set({ queueIndex: queueIndex + 1, currentTrack: track, currentTrackFull: fullFor(track), isPlaying: true, progress: 0, currentTime: 0 })
        get()._maybeSwapToPreferredVersion(track)
        return track
      }
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
          const reshuffled = shuffleUpcoming(queue, -1)
          const first = reshuffled[0]
          set({ queue: reshuffled, queueIndex: 0, currentTrack: first, currentTrackFull: fullFor(first), isPlaying: true, progress: 0, currentTime: 0 })
          get()._loadMore()
          get()._maybeSwapToPreferredVersion(first)
          void get()._repickBySong()
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
    set({ queueIndex: nextIdx, currentTrack: track, currentTrackFull: fullFor(track), isPlaying: true, progress: 0, currentTime: 0 })
    get()._loadMore()
    get()._maybeSwapToPreferredVersion(track)
    return track
  },

  // ── prevTrack ──────────────────────────────────────────────────────────────
  prevTrack: () => {
    const { queue, queueIndex } = get()
    if (queue.length === 0) return null

    const prevIdx = Math.max(0, queueIndex - 1)
    const track = queue[prevIdx]
    set({ queueIndex: prevIdx, currentTrack: track, currentTrackFull: fullFor(track), isPlaying: true, progress: 0, currentTime: 0 })
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
    // A row the user clicked - plays as that exact version, no preferred swap.
    set({ queueIndex: idx, currentTrack: track, currentTrackFull: fullFor(track), isPlaying: true, progress: 0, currentTime: 0 })
    get()._loadMore()
  },

  // ── playFromHistory ─────────────────────────────────────────────────────────
  playFromHistory: (track) => {
    const idx = get().queue.findIndex((t: Track) => t.id === track.id)
    if (idx >= 0) { get().jumpToTrack(track, idx); return }
    // playNext keeps queueOriginal in step, so turning shuffle off later
    // still finds this track.
    get().playNext(track)
    get().jumpToTrack(track, get().queueIndex + 1)
  },

  // ── changeVersion ───────────────────────────────────────────────────────────
  changeVersion: (from, to) => {
    const { queue, queueIndex, currentTrack } = get()
    const idx = currentTrack?.id === from.id && queue[queueIndex]?.id === from.id
      ? queueIndex
      : queue.findIndex((t: Track) => t.id === from.id)
    if (idx < 0) {
      // The playing song isn't in the queue (e.g. radio): swap just what's
      // playing and leave the queue untouched.
      if (currentTrack?.id === from.id) {
        set({ currentTrack: to, currentTrackFull: null, isPlaying: true, progress: 0, currentTime: 0 })
        get()._loadMore()
        return
      }
      get().playTrack(to, [to])
      return
    }
    set({
      queue: queue.map((t: Track, i: number) => (i === idx ? to : t)),
      queueOriginal: get().queueOriginal?.map((t: Track) => (t.id === from.id ? to : t)) ?? null,
      queueIndex: idx,
      currentTrack: to,
      currentTrackFull: null,
      isPlaying: true,
      progress: 0,
      currentTime: 0,
    })
    get()._loadMore()
  },

  // ── toggleShuffle ──────────────────────────────────────────────────────────
  toggleShuffle: () => {
    const { shuffle, queue, queueIndex, radioMode, currentTrack, queueOriginal } = get()
    const newShuffle = !shuffle
    // Written once up front so every branch below (including the radio-mode
    // early return) leaves storage agreeing with the resulting state.
    ls.set('shuffle', newShuffle)

    if (!newShuffle) {
      // Turning OFF: exit radio mode if active, resume linear playback.
      //
      // The queue goes back to being the source list itself, with the playing
      // track located in it — so what's up next is whatever follows it in the
      // playlist, and Previous plays what precedes it there. The shuffled
      // play history is deliberately dropped: once shuffle is off, "the song
      // before this one" means the playlist's, not the random one that
      // happened to play. Radio has no source list to go back to (its queue is
      // only history), so it just stops.
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
      // Already in radio mode - no change needed for toggling ON again
      return
    }

    // Turning ON: shuffle the upcoming portion. A Tracker queue holds the
    // whole list it was started from, so it shuffles like any other source
    // instead of switching to one-song-lookahead radio.
    set({ shuffle: true, queue: shuffleUpcoming(queue, queueIndex) })
    void get()._repickBySong()
    get()._loadMore()
  },

  // ── reshuffleQueue ─────────────────────────────────────────────────────────
  // Re-rolls a fresh random order for what's still upcoming, regardless of
  // whether shuffle was already on - unlike toggleShuffle, which only
  // randomizes on the OFF→ON transition and otherwise just flips shuffle off.
  reshuffleQueue: () => {
    const { currentTrack, queue, queueIndex, radioMode } = get()
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

    set({ shuffle: true, queue: shuffleUpcoming(queue, queueIndex) })
    void get()._repickBySong()
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
      queue: [...s.queue, track],
      queueOriginal: s.queueOriginal ? [...s.queueOriginal, track] : null,
    })),

  playNext: (track) =>
    set((s: QueueSlice) => {
      const after = s.queueIndex + 1
      // Positioned relative to the current track in *each* list: the shuffled
      // queue and the source order disagree about where that track sits.
      const cur = s.queue[s.queueIndex]
      const oAfter = s.queueOriginal && cur
        ? s.queueOriginal.findIndex((t) => t.id === cur.id) + 1
        : 0
      return {
        queue: [...s.queue.slice(0, after), track, ...s.queue.slice(after)],
        queueOriginal: s.queueOriginal && oAfter > 0
          ? [...s.queueOriginal.slice(0, oAfter), track, ...s.queueOriginal.slice(oAfter)]
          : s.queueOriginal,
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
      let dropped = false
      return {
        queue: next,
        queueIndex: newIndex,
        queueOriginal: s.queueOriginal && removed
          ? s.queueOriginal.filter((t) => {
              if (dropped || t.id !== removed.id) return true
              dropped = true
              return false
            })
          : s.queueOriginal,
      }
    }),

  clearQueue: () => {
    _queueLoadSession++
    set((s: QueueSlice) => ({
      queueLoadingMore: false,
      queue: s.currentTrack ? [s.currentTrack] : [],
      queueOriginal: s.currentTrack ? [s.currentTrack] : null,
      queueIndex: s.currentTrack ? 0 : -1,
      queueFilter: null,
      queueSource: null,
      queueSongPool: null,
      radioMode: false,
      radioNext: null,
      radioFilter: null,
      _radioWaiting: false,
    }))
  },

  reorderQueue: (fromIdx, toIdx) =>
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
      return { queue: next, queueOriginal: s.shuffle ? s.queueOriginal : next }
    }),

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
      category: queueFilter.category || undefined,
      era: queueFilter.era || undefined,
      page: queueFilter.page,
      page_size: 50,
    })
      .then((data) => {
        if (session !== _queueLoadSession) return
        const { queue: q, queueIndex: qi, shuffle: isShuffle, queueFilter: qf, queueOriginal: qo } = get()
        if (!qf) { set({ queueLoadingMore: false }); return }
        const existingIds = new Set([...q, ...(qo ?? [])].map((t: Track) => t.id))
        const newTracks = data.results
          .filter((s) => !!s.path)
          .map(songToTrack)
          .filter((t) => !existingIds.has(t.id))

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
          // A page arrives in source order, so it extends the reference order
          // as-is even when the copies going into `queue` were scattered
          // randomly through the upcoming tracks above.
          queueOriginal: qo ? [...qo, ...newTracks] : null,
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

    // A request that never settles (one sent just as the connection dropped
    // can hang for minutes) left radioNext empty, so radio stopped at the end
    // of the song waiting on it. Past the timeout, abandon this attempt - the
    // session bump turns anything it still delivers into a no-op - and start
    // a fresh one.
    const ctrl = new AbortController()
    const timeout = setTimeout(() => {
      if (!live()) return
      _radioSession++
      ctrl.abort()
      get()._prefetchRadioTrack()
    }, RADIO_PREFETCH_TIMEOUT_MS)

    const handleTrack = async (picked: Track): Promise<void> => {
      // Resolved before it's queued, so a preferred version starts as itself
      // instead of the picked one playing for a moment and then switching.
      const track = (await preferredVersionOf(picked, get().preferOgVersion).catch(() => null)) ?? picked
      if (!live()) return
      clearTimeout(timeout)
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
      if (!live()) return
      clearTimeout(timeout)
      setTimeout(() => { if (live()) get()._prefetchRadioTrack() }, 3000)
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
      }, ctrl.signal)
        .then((data) => {
          if (!live()) return
          const playable = data.results.filter((s: JWApiSong) => !!s.path)
          if (playable.length === 0) { handleError(); return }
          void handleTrack(songToTrack(playable[Math.floor(Math.random() * playable.length)]))
        })
        .catch(handleError)
    } else {
      apiFetch<RadioResponse>('/radio/random/', {}, ctrl.signal)
        .then((data) => handleTrack(songToTrack(data.song)))
        .catch(handleError)
    }
  },

  // ── Per-song re-pick ───────────────────────────────────────────────────────
  _repickBySong: async () => {
    const { queue, queueIndex, queueSongPool }: { queue: Track[]; queueIndex: number; queueSongPool: Track[] | null } = get()
    if (!queueSongPool || queueIndex + 1 >= queue.length) return
    const units = await groupPlaylistBySong<Track>(queueSongPool, t => apiSongId(t) ?? -1)
    // Keyed by every version's song id, not just the pool's - an earlier pick
    // may be a preferred version from outside the playlist.
    const unitBySong = new Map<number, SongUnit<Track>>()
    for (const u of units) {
      for (const v of u.versions) unitBySong.set(v.songId, u)
      for (const { item } of u.items) {
        const id = apiSongId(item)
        if (id != null) unitBySong.set(id, u)
      }
    }
    // Anything not from the pool (added to the queue by hand) stays as is.
    const upcoming = queue.slice(queueIndex + 1).map((t: Track): SongUnit<Track> => {
      const id = apiSongId(t)
      return (id != null ? unitBySong.get(id) : undefined) ?? { groupId: null, items: [{ item: t, meta: null }], versions: [] }
    })
    const picks = await pickSongVersions(upcoming)
    // The queue moved on while this was fetching - its result no longer fits.
    const now = get()
    if (now.queue !== queue || now.queueIndex !== queueIndex) return
    // Mirror the swaps into queueOriginal so turning shuffle off still finds
    // (and keeps) the versions that were picked.
    const swapped = new Map<string, Track>()
    queue.slice(queueIndex + 1).forEach((t: Track, i: number) => { if (picks[i] && picks[i].id !== t.id) swapped.set(t.id, picks[i]) })
    set({
      queue: [...queue.slice(0, queueIndex + 1), ...picks],
      queueOriginal: now.queueOriginal?.map((t: Track) => swapped.get(t.id) ?? t) ?? null,
    })
  },

  // ── Preferred-version swap ─────────────────────────────────────────────────
  _maybeSwapToPreferredVersion: (track) => {
    preferredVersionOf(track, get().preferOgVersion)
      .then((swapped) => {
        if (!swapped) return
        const state = get()
        // Bail if the user has since moved on to a different track.
        if (state.currentTrack?.id !== track.id) return
        withoutPlayHistory(() => set({
          currentTrack: swapped,
          currentTrackFull: null,
          queue: state.queue.map((t: Track) => (t.id === track.id ? swapped : t)),
          // Same substitution in the source order, or turning shuffle off
          // couldn't find the now-playing track there and would leave the
          // queue shuffled.
          queueOriginal: state.queueOriginal?.map((t: Track) => (t.id === track.id ? swapped : t)) ?? null,
        }))
      })
      .catch(() => {})
  },
  }
}
