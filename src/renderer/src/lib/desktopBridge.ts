// The main window's side of Desktop (electron/desktop, Windows): it sends the Desktop settings and what's playing to
// the light round the screens and the desktop widgets, and does what they press or ask for with the app's own code -
// the same hotkey actions, store actions and API calls the app's buttons use. Only the main window runs this: it owns
// the audio and the queue. The widgets in the WRLD tab (components/WrldWidgets.tsx) hear and are answered by the same
// code, without the main process in between.
import { useStore, type AppStore } from '../store/useStore'
import { desktopApi, desktopWindowsSupported } from '../desktop/api'
import { watchPlayClock } from '../desktop/playClock'
import { listenToMeter } from '../desktop/meter'
import { followDeskViz } from '../desktop/deskViz'
import { albumColorsFor } from '../desktop/artColors'
import { timedFromLines, pacedFromText, type TimedLine } from '../desktop/lyrics/timing'
import { downloadSyncedLyrics, isLrcFormat, parseLrc } from './lyrics'
import { runHotkeyAction } from './hotkeys'
import { seekAudio, getAudioDuration } from '../components/Player'
import { apiFetch, buildImageUrl, getSongById, playlistCoverUrl, searchSongs, sizedCoverUrl, smallCoverUrl, songToTrack, type JWApiPaginatedResponse } from './juicewrldApi'
import * as userApi from './userApi'
import { playlistItemsToTracks } from './playlistItems'
import { listEras } from './eras'
import { libraryTrackToTrack } from './fileTypes'
import { fxInUse } from './audioEffects'
import { loadVersionEntries } from './songVersions'
import { memberVersionPrefs, prefLabel, versionPrefToggles } from './versionPrefs'
import { showAppToast } from './appToast'
import { copyText } from './clipboard'
import { trackShareUrl } from './platform'
import { addSongsInBackground } from './optimisticPlaylist'
import { toggleRadioFm } from '../hooks/useWrldCore'
import { downloadTrack } from '../components/SongContextMenu'
import type { DesktopPatch } from '../store/desktopSlice'
import { widgetMenu, type WidgetPart, type WidgetWhich } from '../desktop/widgetMenu'
import type { Track } from '../types'

/** The queue's songs either side of the one playing that the desktop is told of: the cards and the playlist. */
const BEFORE = 8
const AFTER = 60
/** Songs a list (liked, a playlist) is shown with at most. */
const LIST_LIMIT = 500
/** At most this often is the meter passed on. */
const METER_MS = 16
/** How long a one-off answer (a search, an era) waits at most to know its covers load. */
const COVER_WAIT_MS = 800

/** A song as the desktop's windows show it. */
export interface DesktopTrack {
  /** Its place's own key: the same song twice in a queue is two cards. */
  key: string
  id: string
  title: string
  artist: string
  album: string
  duration: number
  cover: string | null
  /** The whole track, to be played again from the desktop. */
  track: Track
}

// ---- covers ----

// The API's resize endpoint fails on some covers that are fine (in the app, ProgressiveCover steps past it), and a
// widget's <img> has nothing to fall back on. So a sized cover is tried here as well, and one that won't load goes
// out as the small one instead, which the API makes another way.
const coverChecks = new Map<string, Promise<boolean>>()
const brokenCovers = new Set<string>()
/** Told when covers turn out not to load, to send what they show again. */
const coverWatchers = new Set<() => void>()
let coverNotice = 0

function checkCover(url: string): Promise<boolean> {
  let check = coverChecks.get(url)
  if (!check) {
    check = new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(true)
      img.onerror = () => {
        brokenCovers.add(url)
        resolve(false)
        // A list's worth fail together: told once, after they have.
        if (!coverNotice) coverNotice = window.setTimeout(() => { coverNotice = 0; listsVersion++; coverWatchers.forEach((f) => f()) }, 300)
      }
      img.src = url
    })
    coverChecks.set(url, check)
  }
  return check
}

/** A cover drawn at `size`: the API's sized one unless it's known not to load, then the small one. */
function coverAt(url: string | null | undefined, size: number): string | null {
  const sized = sizedCoverUrl(url, size)
  const small = smallCoverUrl(url)
  if (!sized || sized === small) return sized ?? null
  if (brokenCovers.has(sized)) return small ?? null
  void checkCover(sized)
  return sized
}

const coverOf = (track: Track, size = 1024): string | null => coverAt(track.imageUrl, size)

/** `f` called whenever covers turn out not to load, so what was sent for them can be sent again; returns the stop. */
export function watchCovers(f: () => void): () => void {
  coverWatchers.add(f)
  return () => { coverWatchers.delete(f) }
}

/** A moment's wait at most to know these covers load, so a one-off answer goes out with ones that do. */
async function coversChecked(urls: (string | null)[]): Promise<void> {
  const checks = urls.flatMap((url) => { const check = url ? coverChecks.get(url) : undefined; return check ? [check] : [] })
  if (checks.length) await Promise.race([Promise.all(checks), new Promise((resolve) => setTimeout(resolve, COVER_WAIT_MS))])
}

function desktopTrack(track: Track, key: string): DesktopTrack {
  return { key, id: track.id, title: track.title, artist: track.artist || track.album || '', album: track.album || '', duration: track.duration || 0, cover: coverOf(track), track }
}

// ---- what's playing ----

/** The cover the desktop's light and widgets take their colors from; WRLD's Edge light takes them from it too. */
export function nowCover(s: AppStore): string | null {
  return nowTrack(s)?.cover ?? null
}

function nowTrack(s: AppStore): { id: string; title: string; artist: string; album: string; duration: number; cover: string | null } | null {
  if (s.radioFmActive && s.radioFmNowPlaying) {
    const r = s.radioFmNowPlaying
    return { id: `fm:${r.title}:${r.artist}`, title: r.title, artist: r.artist, album: r.album || '', duration: (r.duration_ms || 0) / 1000,
      cover: s.radioFmMatchedSong?.imageUrl ? buildImageUrl(s.radioFmMatchedSong.imageUrl) ?? null : r.image_url || null }
  }
  const t = s.currentTrack
  if (!t) return null
  const full = s.currentTrackFull?.id === t.id ? s.currentTrackFull : null
  const art = full?.albumArt ? buildImageUrl(full.albumArt) ?? full.albumArt : null
  return { id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration || 0, cover: coverOf(t) ?? art ?? null }
}

/** Anything in the equalizer away from neutral, as the app's EQ button reckons it (components/Player.tsx). */
const eqInUse = (s: AppStore): boolean => s.eqEnabled || s.playbackSpeed !== 1 || s.eqBalance !== 0 || s.eqMono || s.eqBoost !== 1
  || s.skipSilence || s.reverbEnabled || fxInUse(s.audioFx, s.eqEnabled)

/** The song the player's ⋯ menu is about: the one playing, or 999 FM's (which has no file of ours to save). */
function menuSong(s: AppStore): { songId: number | null; track: Track | null } {
  if (s.radioFmActive) return { songId: s.radioFmNowPlaying?.song_id ?? s.radioFmMatchedSong?.songId ?? null, track: null }
  const track = s.currentTrack
  return { songId: track ? userApi.trackIdToSongId(track.id) : null, track }
}

/** What the ⋯ menu offers for it, as the app's song menu would (components/SongContextMenu). */
function songMenu(s: AppStore): { title: string; info: boolean; link: boolean; download: boolean; edit: boolean; lyrics: boolean; playlists: { id: number; name: string }[] | null } | null {
  const { songId, track } = menuSong(s)
  const title = nowTrack(s)?.title
  if (!title || (songId == null && !track)) return null
  const has = songId != null && songId > 0
  const editor = userApi.isChannelEditor(s.account, s.channels.find((c) => c.is_primary)?.slug, true)
  return {
    title, info: has, link: has, edit: has && editor, lyrics: !!rawLyrics(s)?.trim(),
    download: !!track?.path && !(songId == null && track.id.startsWith('local-')),
    // Signed in, an API song can go on a playlist.
    playlists: has && s.account ? s.playlists.map((p) => ({ id: p.id, name: p.name })) : null,
  }
}

const loadedVersions = new Map<number, { songId: number; label: string | null; version: string | null }[]>()

/** The song's other versions that can be played, as WRLD's version notch lists them (hooks/useSongVersions). */
async function versionsOf(songId: number): Promise<{ songId: number; label: string | null; version: string | null }[]> {
  const entries = await loadVersionEntries(songId).catch(() => [])
  const versions = entries.filter((e) => e.playable).map(({ song, meta }) => ({ songId: song.id, label: prefLabel(meta) ?? meta.versionTitle, version: prefLabel(meta) }))
  loadedVersions.set(songId, versions)
  return versions
}

function queueWindow(s: AppStore): { from: number; current: number; items: DesktopTrack[] } {
  // 999 FM has no queue of ours: the card is the song on the air.
  if (s.radioFmActive) {
    const t = nowTrack(s)
    if (!t) return { from: 0, current: -1, items: [] }
    const track = { id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration, imageUrl: t.cover ?? undefined } as unknown as Track
    return { from: 0, current: 0, items: [{ key: `${t.id}#0`, id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration, cover: t.cover, track }] }
  }
  if (!s.queue.length) return s.currentTrack ? { from: 0, current: 0, items: [desktopTrack(s.currentTrack, `${s.currentTrack.id}#0`)] } : { from: 0, current: -1, items: [] }
  const from = Math.max(0, s.queueIndex - BEFORE)
  const items = s.queue.slice(from, s.queueIndex + AFTER + 1).map((t, i) => desktopTrack(t, `${t.id}#${from + i}`))
  return { from, current: s.queueIndex, items }
}

/** The song's lyrics as the app has them: LRC when they're timed, plain text when not. */
function rawLyrics(s: AppStore): string | null {
  return s.radioFmActive
    ? (s.radioFmMatchedSong?.syncedLyrics || s.radioFmMatchedSong?.lyrics || null)
    : (s.currentTrackFull && s.currentTrackFull.id === s.currentTrack?.id ? s.currentTrackFull.syncedLyrics || s.currentTrackFull.lyrics : null)
}

let lyricsFor: { raw: string | null; offset: number; duration: number } | null = null
let lyricsMade: { id: string; lines: TimedLine[] } | null = null
/** The song's lyrics timed word by word, shifted by the lyrics offset; paced over the song when they aren't timed. */
function nowLyrics(s: AppStore): { id: string; lines: TimedLine[] } | null {
  const raw = rawLyrics(s)
  const id = nowTrack(s)?.id ?? ''
  const duration = s.radioFmActive ? (s.radioFmNowPlaying?.duration_ms || 0) / 1000 : s.currentTrack?.duration || 0
  if (lyricsFor && lyricsFor.raw === raw && lyricsFor.offset === s.lyricsOffset && lyricsFor.duration === duration && lyricsMade?.id === id) return lyricsMade
  lyricsFor = { raw, offset: s.lyricsOffset, duration }
  if (!raw?.trim()) { lyricsMade = null; return null }
  const timed = isLrcFormat(raw) ? timedFromLines(parseLrc(raw), s.lyricsOffset) : pacedFromText(raw, duration)
  lyricsMade = timed.lines.length ? { id, lines: timed.lines } : null
  return lyricsMade
}

// ---- the lists ----

const listCache = new Map<string, Track[]>()

async function listTracks(id: string): Promise<Track[]> {
  const s = useStore.getState()
  if (id === 'queue') return s.queue.length ? s.queue.slice(s.queueIndex) : s.currentTrack ? [s.currentTrack] : []
  const cached = listCache.get(id)
  if (cached) return cached
  let tracks: Track[] = []
  if (id === 'liked') {
    const api = s.account ? await userApi.getFavorites().then((f) => f.map((e) => userApi.liteSongToTrack(e.song))).catch(() => []) : []
    const liked = new Set(s.likedTrackIds)
    const local = s.libraryTracks.filter((t) => liked.has(t.id)).map(libraryTrackToTrack)
    tracks = [...api, ...local]
  } else if (id.startsWith('playlist:')) {
    const detail = await userApi.getPlaylist(Number(id.slice('playlist:'.length))).catch(() => null)
    tracks = detail ? playlistItemsToTracks(detail.items).filter((t) => t.path) : []
  }
  tracks = tracks.slice(0, LIST_LIMIT)
  listCache.set(id, tracks)
  return tracks
}

function shelf(): { id: string; name: string; count: number; covers: string[] }[] {
  const s = useStore.getState()
  const covers = (tracks: Track[]): string[] => tracks.map((t) => coverOf(t, 120)).filter((c): c is string => !!c).slice(0, 4)
  const queue = s.queue.length ? s.queue.slice(s.queueIndex) : s.currentTrack ? [s.currentTrack] : []
  return [
    { id: 'queue', name: 'Queue', count: queue.length, covers: covers(queue) },
    { id: 'liked', name: 'Liked Songs', count: s.likedTrackIds.length, covers: covers(listCache.get('liked') ?? []) },
    ...s.playlists.map((p) => ({ id: `playlist:${p.id}`, name: p.name, count: p.track_count, covers: [playlistCoverUrl(p)].filter((c): c is string => !!c) })),
  ]
}

function listName(id: string): string {
  if (id === 'queue') return 'Queue'
  if (id === 'liked') return 'Liked Songs'
  const p = useStore.getState().playlists.find((x) => `playlist:${x.id}` === id)
  return p?.name ?? 'Playlist'
}

// ---- search and the eras ----

async function search(query: string): Promise<{ songs: DesktopTrack[]; eras: { name: string; cover: string | null; count: number }[] }> {
  const songs = (await searchSongs(query, 30)).filter((s) => !!s.path).map(songToTrack)
  await coversChecked(songs.map((t) => coverOf(t)))
  const eras = new Map<string, { name: string; cover: string | null; count: number }>()
  for (const t of songs) {
    if (!t.era) continue
    const era = eras.get(t.era) ?? { name: t.era, cover: coverOf(t), count: 0 }
    era.count++
    eras.set(t.era, era)
  }
  return { songs: songs.map((t, i) => desktopTrack(t, `s:${t.id}#${i}`)), eras: [...eras.values()] }
}

async function era(name: string): Promise<{ name: string; about: string; cover: string | null; songs: DesktopTrack[] } | null> {
  const data = await apiFetch<JWApiPaginatedResponse>('/songs/', { era: name, page_size: 100 }).catch(() => null)
  if (!data) return null
  const tracks = data.results.filter((s) => !!s.path).map(songToTrack)
  const info = listEras().find((e) => e.name === name)
  await coversChecked([tracks[0] ? coverOf(tracks[0], 600) : null, ...tracks.map((t) => coverOf(t))])
  return {
    name,
    about: [info?.time_frame, info?.description].filter(Boolean).join(' · '),
    cover: tracks[0] ? coverOf(tracks[0], 600) : null,
    songs: tracks.map((t, i) => desktopTrack(t, `e:${t.id}#${i}`)),
  }
}

// ---- presses from the desktop ----

const isTrack = (v: unknown): v is Track => !!v && typeof v === 'object' && typeof (v as Track).id === 'string' && typeof (v as Track).title === 'string'

/** Fired on window to open WRLD's lyric share card. */
export const SHARE_LYRICS_EVENT = 'wrld:share-lyrics'

/** A press on a widget - on the desktop or in the WRLD tab - done as the app's own buttons do it. */
export async function runDesktopCommand(cmd: string, arg: unknown): Promise<void> {
  const s = useStore.getState()
  switch (cmd) {
    case 'toggle': runHotkeyAction('play-pause'); break
    case 'next': runHotkeyAction('next'); break
    case 'previous': runHotkeyAction('previous'); break
    case 'repeat': runHotkeyAction('loop'); break
    case 'shuffle': runHotkeyAction('shuffle'); break
    case 'like': runHotkeyAction('like'); break
    // From the lyrics' menu: the words alone, without the timing; or the timed ones as an .lrc file.
    case 'copy-lyrics': {
      const raw = rawLyrics(s)
      if (!raw?.trim()) break
      const text = isLrcFormat(raw) ? parseLrc(raw).map((l) => l.text).join('\n') : raw.trim()
      // The clipboard by the app's own hand: on the desktop the main window hasn't the focus a page's copy needs.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const el = (window as any).electron
      try {
        if (el?.copyTextToClipboard) await el.copyTextToClipboard(text)
        else await navigator.clipboard.writeText(text)
        showAppToast('Lyrics copied', { tone: 'info' })
      } catch { showAppToast("Couldn't copy the lyrics", { tone: 'error' }) }
      break
    }
    // WRLD's lyric share card, opened by the tab (the widgets' stand-in for the hidden song menu's row).
    case 'share-lyrics': window.dispatchEvent(new Event(SHARE_LYRICS_EVENT)); break
    case 'download-lyrics': {
      const raw = rawLyrics(s)
      const track = nowTrack(s)
      if (raw && isLrcFormat(raw)) downloadSyncedLyrics(track?.title || 'lyrics', track?.artist ?? '', raw)
      break
    }
    // The equalizer from a widget on the desktop: its own window, since the main one is likely hidden behind (the
    // WRLD tab's widgets open the app's own, beside the button). On the web there's only the app's.
    case 'equalizer': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const el = (window as any).electron
      if (el?.toggleFloatWindow) void el.toggleFloatWindow('equalizer')
      else s.toggleEqPanel()
      break
    }
    case 'seek': {
      const fraction = Number(arg)
      const duration = getAudioDuration()
      if (Number.isFinite(fraction) && duration > 0) seekAudio(Math.min(Math.max(fraction, 0), 1) * duration)
      break
    }
    // A line of the lyrics picked: the song from where it's sung, in seconds.
    case 'seek-to': {
      const seconds = Number(arg)
      if (Number.isFinite(seconds)) seekAudio(Math.max(seconds, 0))
      break
    }
    case 'volume': {
      const v = Number(arg)
      if (Number.isFinite(v)) s.setVolume(Math.min(Math.max(v, 0), 1))
      break
    }
    // A card or a row of the queue: the song at that place in it.
    case 'jump': {
      const index = Number(arg)
      if (!Number.isInteger(index)) break
      if (index === s.queueIndex || (!s.queue.length && index === 0)) { runHotkeyAction('play-pause'); break }
      const track = s.queue[index]
      if (track) s.jumpToTrack(track, index)
      break
    }
    case 'play-track': {
      const { track, context } = (arg ?? {}) as { track?: unknown; context?: unknown }
      if (!isTrack(track)) break
      const list = Array.isArray(context) ? context.filter(isTrack) : [track]
      s.playTrack(track, list.length ? list : [track])
      break
    }
    case 'fm': toggleRadioFm(); break
    // A word from the desktop itself (the desk not cleared, an app on every display).
    case 'notice': if (typeof arg === 'string') showAppToast(arg, { tone: 'info' }); break
    // The ⋯ menu's rows that open the app: song info and the editor (the main process brings the window forward).
    case 'song-info': {
      const { songId } = menuSong(s)
      if (songId != null) s.setInfoSongId(songId)
      break
    }
    case 'edit-song': {
      const { songId } = menuSong(s)
      if (songId != null) s.openSongEditor(songId)
      break
    }
    case 'download-song': {
      const { songId, track } = menuSong(s)
      if (track?.path) downloadTrack(track, songId)
      break
    }
    case 'prefer-version':
    case 'exclude-version': {
      const anchor = s.currentTrack && !s.radioFmActive ? userApi.trackIdToSongId(s.currentTrack.id) : null
      if (anchor == null || !Number.isInteger(arg)) break
      const versions = loadedVersions.get(anchor) ?? await versionsOf(anchor)
      const current = useStore.getState()
      if (current.currentTrack?.id !== s.currentTrack?.id || current.radioFmActive) break
      const member = versions.find(v => v.songId === arg)
      if (!member?.version) break
      const members = [{ songId: anchor, version: null }, ...versions]
      const toggles = versionPrefToggles(members, current.songPrefs, {
        setDefault: current.setSongDefaultVersion, setExcluded: current.setSongExcludedVersions,
      })
      if (cmd === 'prefer-version') toggles.togglePreferred(member)
      else toggles.toggleExcluded(member)
      break
    }
    // Swap the version in place, keeping the queue.
    case 'play-version': {
      const songId = Number(arg)
      if (!Number.isInteger(songId)) break
      try {
        const track = songToTrack(await getSongById(songId))
        const { currentTrack } = useStore.getState()
        if (currentTrack) s.changeVersion(currentTrack, track)
        else s.playTrack(track, [track])
      } catch { showAppToast("Couldn't switch to that version") }
      break
    }
    case 'play-next': if (isTrack(arg)) s.playNext(arg); break
    case 'add-to-queue': if (isTrack(arg)) s.addToQueue(arg); break
    // A list's row (or its Play): played from there, the list after it.
    case 'play-list': {
      const { id, index = 0, shuffle = false } = (arg ?? {}) as { id?: string; index?: number; shuffle?: boolean }
      if (typeof id !== 'string') break
      if (id === 'queue') { void runDesktopCommand('jump', s.queueIndex + Number(index)); break }
      const tracks = await listTracks(id)
      const track = tracks[Math.min(Math.max(Number(index) || 0, 0), tracks.length - 1)]
      if (!track) break
      if (shuffle !== s.shuffle) s.toggleShuffle()
      s.playTrack(track, tracks)
      break
    }
    case 'play-era': {
      const { name, shuffle = false } = (arg ?? {}) as { name?: string; shuffle?: boolean }
      if (typeof name !== 'string') break
      const found = await era(name)
      const tracks = found?.songs.map((t) => t.track) ?? []
      if (!tracks.length) break
      if (shuffle !== s.shuffle) s.toggleShuffle()
      s.playTrack(shuffle ? tracks[Math.floor(Math.random() * tracks.length)] : tracks[0], tracks)
      break
    }
    // A setting changed on the desktop itself: the player made small, the card folded, the playlist's list.
    case 'set': {
      const patch = arg as DesktopPatch
      if (patch && typeof patch === 'object') s.setDesktop(patch)
      break
    }
    case 'open-settings':
      s.setSettingsTab('desktop')
      s.setShowSettings(true)
      break
    default: break
  }
}

/** A widget's question (search, an era, the lists, a list), answered with null when there's no answer. */
export async function answerDesktopRequest(kind: string, arg: unknown): Promise<unknown> {
  switch (kind) {
    case 'search': return typeof arg === 'string' && arg.trim() ? search(arg.trim()) : { songs: [], eras: [] }
    case 'era': return typeof arg === 'string' ? era(arg) : null
    case 'lists': return shelf()
    case 'song-menu': return songMenu(useStore.getState())
    // The ⋯ menu's quick rows, answered with whether they worked: the widget shows them done at once and takes it back
    // if not.
    case 'copy-link': {
      const { songId } = menuSong(useStore.getState())
      if (songId == null) return false
      return copyText(trackShareUrl(songId)).then(() => true, () => false)
    }
    case 'add-to-playlist': {
      const { songId } = menuSong(useStore.getState())
      const playlistId = Number(arg)
      if (songId == null || !Number.isInteger(playlistId)) return false
      return (await addSongsInBackground(playlistId, [songId])).length === 0
    }
    case 'list': {
      if (typeof arg !== 'string') return null
      const tracks = await listTracks(arg)
      return { id: arg, name: listName(arg), rows: tracks.map((t, i) => desktopTrack(t, `${t.id}#${i}`)) }
    }
    // A widget on the desktop right-clicked: its menu, for the main process to show.
    case 'widget-menu': {
      const { which, isClear, part } = (arg ?? {}) as { which?: string; isClear?: boolean; part?: string }
      if (which !== 'player' && which !== 'playlist' && which !== 'clock') return null
      return widgetMenuOf(which, 'desktop', !!isClear, part === 'lyrics' ? part : undefined)
    }
    default: return null
  }
}

/** A widget's right-click menu, with what's this app's to know: the playlists, whether the desktop has widgets, the
 *  lyrics there are (for the player's lyrics, `part`). */
export function widgetMenuOf(which: WidgetWhich, where: 'desktop' | 'tab', isClear = false, part?: WidgetPart): ReturnType<typeof widgetMenu> {
  const s = useStore.getState()
  const raw = rawLyrics(s)
  return widgetMenu(which, s.desktop, {
    where, isClear, part, desktopToo: desktopWindowsSupported(),
    playlists: s.playlists.map((p) => ({ id: String(p.id), name: p.name })),
    lyrics: { has: !!raw?.trim(), timed: !!raw && isLrcFormat(raw) },
  })
}

// ---- what's playing, told ----

/** Goes up each time the playlists or the liked songs change, or covers in them turn out not to load: a widget showing
 *  a list asks for it again. */
let listsVersion = 0
let listsWatched = false
function watchLists(): void {
  if (listsWatched) return
  listsWatched = true
  useStore.subscribe((s, p) => {
    if (s.playlists === p.playlists && s.likedTrackIds === p.likedTrackIds) return
    listCache.clear()
    listsVersion++
  })
}

/** Tells `send` what's playing - all of it at first, then a patch of what changed each time something does - until
 *  stopped: for the desktop's windows, and for the widgets in the WRLD tab. */
export function watchDesktopState(send: (patch: Record<string, unknown>) => void): () => void {
  watchLists()
  let stopped = false

  // Each key sent only when it changed: the same object as last time is the same (the lyrics are kept), and anything
  // else is compared by what it says.
  const sent = new Map<string, string>()
  const sentRefs = new Map<string, unknown>()
  const push = (values: Record<string, unknown>): void => {
    if (stopped) return
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'object' && value !== null && sentRefs.get(key) === value) continue
      sentRefs.set(key, value)
      const json = JSON.stringify(value ?? null)
      if (sent.get(key) === json) continue
      sent.set(key, json)
      patch[key] = value ?? null
    }
    if (Object.keys(patch).length) send(patch)
  }

  let colorsFor: string | null | undefined
  let versionsFor: number | null | undefined
  let versions: Awaited<ReturnType<typeof versionsOf>> = []
  const sendVersionPrefs = (): void => {
    const members = versionsFor == null ? [] : [{ songId: versionsFor, version: null }, ...versions]
    const { preferred, excluded } = memberVersionPrefs(members, useStore.getState().songPrefs)
    push({ versionPrefs: { preferred: [...preferred], excluded: [...excluded] } })
  }
  const sendState = (): void => {
    const s = useStore.getState()
    const track = nowTrack(s)
    push({
      playing: s.radioFmActive ? true : s.isPlaying,
      track,
      liked: !!s.currentTrack && !s.radioFmActive && s.likedTrackIds.includes(s.currentTrack.id),
      canLike: !!s.currentTrack && !s.radioFmActive,
      volume: s.volume,
      repeat: s.repeat,
      shuffle: s.shuffle,
      eq: eqInUse(s),
      fm: s.radioFmActive,
      fmLive: s.radioFmIsLive,
      cards: queueWindow(s),
      lyrics: nowLyrics(s),
      lyricTune: { size: s.lyricsScale, active: s.lyricsColorActive, inactive: s.lyricsColorInactive },
      listsVersion,
    })
    if (track?.cover !== colorsFor) {
      const cover = track?.cover ?? null
      colorsFor = cover
      void albumColorsFor(cover).then((colors) => { if (colorsFor === cover) push({ colors }) })
    }
    // The last song's versions go at once; the new one's follow when they're known.
    const songId = !s.radioFmActive && s.currentTrack ? userApi.trackIdToSongId(s.currentTrack.id) : null
    if (songId !== versionsFor) {
      versionsFor = songId
      versions = []
      push({ versions })
      if (songId != null) void versionsOf(songId).then((loaded) => {
        if (versionsFor === songId) { versions = loaded; push({ versions }); sendVersionPrefs() }
      })
    }
    sendVersionPrefs()
  }

  // Changes made together (a track change sets several keys) go out together - on a microtask, not a timer: the main
  // window is often hidden while the widgets are in use, and a hidden page's timers are held back.
  let scheduled = false
  const later = (): void => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; sendState() })
  }

  sendState()
  const stopCovers = watchCovers(later)
  const stopClock = watchPlayClock((clock) => push({ clock }))
  const unsubscribe = useStore.subscribe((s, p) => {
    if (s.songPrefs !== p.songPrefs || s.currentTrack !== p.currentTrack || s.currentTrackFull !== p.currentTrackFull || s.isPlaying !== p.isPlaying || s.queue !== p.queue
      || s.queueIndex !== p.queueIndex || s.likedTrackIds !== p.likedTrackIds || s.volume !== p.volume || s.repeat !== p.repeat
      || s.shuffle !== p.shuffle || s.lyricsOffset !== p.lyricsOffset || s.radioFmActive !== p.radioFmActive || s.radioFmNowPlaying !== p.radioFmNowPlaying
      || s.radioFmMatchedSong !== p.radioFmMatchedSong || s.playlists !== p.playlists || s.radioFmIsLive !== p.radioFmIsLive
      || s.eqEnabled !== p.eqEnabled || s.playbackSpeed !== p.playbackSpeed || s.eqBalance !== p.eqBalance || s.eqMono !== p.eqMono
      || s.eqBoost !== p.eqBoost || s.skipSilence !== p.skipSilence || s.reverbEnabled !== p.reverbEnabled || s.audioFx !== p.audioFx
      || s.lyricsScale !== p.lyricsScale || s.lyricsColorActive !== p.lyricsColorActive || s.lyricsColorInactive !== p.lyricsColorInactive) later()
  })
  return () => { stopped = true; stopCovers(); stopClock(); unsubscribe() }
}

// ---- the bridge ----

export function initDesktopBridge(): void {
  const api = desktopApi()
  if (!api || !desktopWindowsSupported()) return

  let lastSettings: AppStore['desktop'] | null = null
  const sendSettings = (): void => {
    const d = useStore.getState().desktop
    if (d === lastSettings) return
    lastSettings = d
    api.setSettings(d)
  }
  sendSettings()
  watchDesktopState((patch) => api.setState(patch))
  useStore.subscribe((s, p) => { if (s.desktop !== p.desktop) sendSettings() })

  // The light and the player's glow hear the music: passed on only while one of them is there to.
  let stopMeter: (() => void) | null = null
  let meterAt = 0
  const followMeter = (): void => {
    const d = useStore.getState().desktop
    const wanted = d.light.isOn || d.player.isOn
    if (wanted && !stopMeter) {
      stopMeter = listenToMeter((m) => {
        const now = performance.now()
        if (now - meterAt < METER_MS) return
        meterAt = now
        api.meter(m)
      })
    } else if (!wanted && stopMeter) {
      stopMeter()
      stopMeter = null
    }
  }
  followMeter()
  useStore.subscribe((s, p) => { if (s.desktop !== p.desktop) followMeter() })
  // WRLD's visualizer behind the widgets while the desk is clear.
  followDeskViz(api, nowCover)

  api.onCommand((cmd, arg) => { void runDesktopCommand(cmd, arg).catch((e) => console.warn('[desktop] command failed', cmd, e)) })
  api.onRequest((id, kind, arg) => {
    void answerDesktopRequest(kind, arg).then((value) => api.reply(id, value ?? null), (e) => { console.warn('[desktop] request failed', kind, e); api.reply(id, null) })
  })
  api.onPlace((which, place) => {
    if (!['player', 'playlist', 'clock'].includes(which) || !place || typeof place !== 'object') return
    useStore.getState().setDesktop({ [which]: { place } })
  })
}
