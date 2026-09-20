import { useEffect, useLayoutEffect, useRef, useState, memo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Music, Radio, Search, SkipForward, ThumbsUp, ThumbsDown, X, ChevronDown, Play, Pause,
  SkipBack, SkipForward as SkipFwd, Shuffle, Repeat, Repeat1, Volume2, VolumeX,
  MoreHorizontal, Heart, ListMusic, Trash2, History, SlidersHorizontal,
  Mic2, Layers, Loader2, RefreshCw, Settings2, AlignLeft, AlignCenter, Share2,
} from 'lucide-react'
import ShareLyricsModal from './ShareLyricsModal'
import { useStore, useStorePick } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { getCurrentLineIndex, downloadSyncedLyrics, splitAdLibs, splitColorWords, ADLIB_OPACITY } from '../lib/lyrics'
import { formatDuration } from '../lib/format'
import { seekAudio, getAudioDuration, getAudioCurrentTime } from './Player'
import { apiFetch, getSongsByIds } from '../lib/juicewrldApi'
import { getActiveRadioClient } from '../lib/radioSocketService'
import { EFFECTS_SUPPORTED } from '../lib/audioEffects'
import { getVersionGroup } from '../lib/versionsApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import type { SyncedLyricLine, Track } from '../types'
import * as userApi from '../lib/userApi'
import { useCanEdit } from '../hooks/useChannelRoles'
import SongInfoModal from './SongInfoModal'
import CoverEditor from './CoverEditor'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { ProgressiveCover } from './ProgressiveCover'
import SongContextMenu from './SongContextMenu'
import { getSkin } from '../lib/skins'
import { Sheet, SheetItem, SheetDivider } from './mobile/Sheet'
import { useDragReorder } from './mobile/useDragReorder'
import { useLongPress } from './mobile/useLongPress'
import { useBackToClose } from '../hooks/useBackToClose'
import { useDragToDismiss } from '../hooks/useDragToDismiss'
import {
  useWrldArt, useArtTextContrast, useWrldLyricsSource, useWrldNowPlaying,
  usePlayVersion, useRadioSuggest, useRadioVoteCountdown,
} from '../hooks/useWrldCore'

/* ══════════════════════════════════════════════════════════════════════════════
   WRLD - the full-screen player, and since the mini bar now expands into it,
   the only "now playing" screen the app has.

   Built for a phone rather than folded down from the desktop two-column layout
   (big cover + lyrics side by side), which is gone: there is no room here to
   show artwork and lyrics at once, and every affordance that layout leaned on
   was pointer-only - a hover-revealed scrub knob, a version menu poking out of
   the cover's left edge, drag-to-reorder in the queue, right-click to download
   lyrics, an audio-output picker Android doesn't need.

   What it is instead: one column - cover, title, seek, transport - with the
   secondary surfaces (lyrics, queue, radio, versions) as chips under the
   controls that open full-height sheets. Everything below the presentation
   layer is unchanged: the FM socket, voting and song proposals, the version
   lookup, the rAF-driven synced-lyrics engine and the queue store actions are
   all the same code.
   ══════════════════════════════════════════════════════════════════════════════ */

export default function WrldView(): JSX.Element {
  const {
    currentTrack, currentTrackFull, account, theme, previousView, setActiveView,
    radioFmActive, setRadioFmActive, radioFmIsLive, radioFmNowPlaying,
    radioFmVote, radioFmUpNext, radioFmQueuePreview,
    radioFmMatchedSong,
    playTrack,
    isPlaying, setIsPlaying,
    shuffle, repeat, toggleShuffle, toggleRepeat,
    nextTrack, prevTrack,
    showQueue, setShowQueue,
    toggleEqPanel, eqFxActive,
  } = useStore(useShallow(s => ({
    currentTrack: s.currentTrack,
    currentTrackFull: s.currentTrackFull,
    account: s.account,
    theme: s.theme,
    previousView: s.previousView,
    setActiveView: s.setActiveView,
    radioFmActive: s.radioFmActive,
    setRadioFmActive: s.setRadioFmActive,
    radioFmIsLive: s.radioFmIsLive,
    radioFmNowPlaying: s.radioFmNowPlaying,
    radioFmVote: s.radioFmVote,
    radioFmUpNext: s.radioFmUpNext,
    radioFmQueuePreview: s.radioFmQueuePreview,
    radioFmMatchedSong: s.radioFmMatchedSong,
    playTrack: s.playTrack,
    isPlaying: s.isPlaying,
    setIsPlaying: s.setIsPlaying,
    shuffle: s.shuffle,
    repeat: s.repeat,
    toggleShuffle: s.toggleShuffle,
    toggleRepeat: s.toggleRepeat,
    nextTrack: s.nextTrack,
    prevTrack: s.prevTrack,
    showQueue: s.showQueue,
    setShowQueue: s.setShowQueue,
    toggleEqPanel: s.toggleEqPanel,
    // Same "anything non-neutral" indicator as the player bar's EQ button.
    eqFxActive: s.eqEnabled || s.playbackSpeed !== 1 || s.eqBalance !== 0 || s.eqMono || s.eqBoost !== 1 || s.skipSilence || s.reverbEnabled,
  })))

  // Skins beyond the classic pair mean `theme === 'dark'` no longer covers
  // "is this a dark look" - Ocean, Mocha, etc. need the dark treatment too.
  const isDarkSkin = getSkin(theme).dark

  const [sheet, setSheet] = useState<'radio' | 'versions' | null>(null)
  const [lyricsOpen, setLyricsOpen] = useState(false)

  // iOS's installed-PWA safe-area sliver at the very top of the screen isn't
  // always actually covered by .app-shell - see the html.wrld-active rule in
  // index.css for the full story. Toggled here (not derived from CSS alone)
  // since it has to track exactly how long this component is mounted.
  useEffect(() => {
    document.documentElement.classList.add('wrld-active')
    return () => document.documentElement.classList.remove('wrld-active')
  }, [])

  const { artSrc, artError, setArtError, coverSongId } = useWrldArt(
    radioFmActive, radioFmMatchedSong, radioFmNowPlaying, currentTrackFull, currentTrack,
  )

  // ── 999 FM: voting ──
  const [voteDismissed, setVoteDismissed] = useState(false)
  const { myVote, setMyVote, localSecondsLeft } = useRadioVoteCountdown(
    radioFmVote?.active, radioFmVote?.seconds_left, () => setVoteDismissed(false),
  )

  // ── 999 FM: proposing the next song ──
  const {
    suggestQuery, setSuggestQuery, suggestResults, suggestLoading,
    proposed, proposeError, handlePropose, dismissProposed,
  } = useRadioSuggest('Not connected to 999 FM - try again in a moment')

  // Sibling versions of the currently playing song (v1/v2/TV Mix/etc, linked
  // via juicewrldapi's /versions/ table - see versionsApi.ts). On desktop these
  // hung off a notch on the cover's edge; here they're a chip under the
  // transport that opens a picker sheet.
  const [songVersions, setSongVersions] = useState<{ songId: number; label: string | null }[]>([])
  useEffect(() => {
    if (radioFmActive || !currentTrack?.id) { setSongVersions([]); return }
    const numericId = parseInt(currentTrack.id.replace('jw-', ''), 10)
    if (isNaN(numericId)) { setSongVersions([]); return }
    let cancelled = false
    getVersionGroup(numericId).then(async metas => {
      if (cancelled) return
      // A version linked in the /versions/ table isn't necessarily playable -
      // recording-session songs (and some unsurfaced ones) have no `path`,
      // same gate used for bulk queue/playlist adds elsewhere in the app.
      const songs = await getSongsByIds(metas.map(m => m.songId)).catch(() => [])
      const byId = new Map(songs.map(s => [s.id, s]))
      const withPaths = metas.map(m => {
        const song = byId.get(m.songId)
        return song?.path ? m : null
      })
      if (cancelled) return
      setSongVersions(
        withPaths
          .filter((m): m is NonNullable<typeof m> => !!m)
          .map(m => ({ songId: m.songId, label: m.version ?? m.versionTitle }))
      )
    })
    return () => { cancelled = true }
  }, [currentTrack?.id, radioFmActive])

  const handlePlayVersion = usePlayVersion(playTrack)

  // Long-press the cover for a quick "Change cover" sheet - the same picker
  // Personalize's "Custom cover" section offers (see CoverEditor), just
  // reached directly instead of via Song info. Stream metadata's song_id is
  // sometimes missing on FM; fall back to RadioFmPlayer's title-search match,
  // same as SongMenu does.
  const [showCoverPicker, setShowCoverPicker] = useState(false)
  const [coverPickerSong, setCoverPickerSong] = useState<JWApiSong | null>(null)
  const openCoverPicker = (): void => {
    if (coverSongId == null) return
    setCoverPickerSong(null)
    setShowCoverPicker(true)
    apiFetch<JWApiSong>(`/songs/${coverSongId}/`)
      .then(song => setCoverPickerSong(song))
      .catch(() => setShowCoverPicker(false))
  }
  const coverPress = useLongPress({ onTap: () => {}, onLongPress: openCoverPicker })

  // Everything on this page sits on the blurred cover, so text colour has to
  // follow the artwork's brightness rather than the theme.
  const textIsDark = useArtTextContrast(artSrc, artError, isDarkSkin, radioFmActive, null)

  const { rawLyrics, isSynced, isEditor, syncedLines } = useWrldLyricsSource(
    radioFmActive, radioFmMatchedSong, currentTrackFull, account,
  )

  const txtPri   = textIsDark ? 'rgba(0,0,0,0.85)'  : 'rgba(255,255,255,1)'
  const txtSec   = textIsDark ? 'rgba(0,0,0,0.5)'   : 'rgba(255,255,255,0.5)'
  const txtTer   = textIsDark ? 'rgba(0,0,0,0.35)'  : 'rgba(255,255,255,0.3)'
  const txtFaint = textIsDark ? 'rgba(0,0,0,0.22)'  : 'rgba(255,255,255,0.2)'
  // Unplayed part of the progress/volume troughs. It used to be a hardcoded
  // white wash, which is invisible on a light surface - now it follows the
  // same polarity as the text.
  const trackBg  = textIsDark ? 'rgba(0,0,0,0.15)'  : 'rgba(255,255,255,0.2)'

  const { displayTitle, displayArtist, displayAlbum, fmDisabled, noTrack, toggleFm } = useWrldNowPlaying(
    radioFmActive, radioFmIsLive, radioFmNowPlaying, currentTrack, setRadioFmActive, setIsPlaying,
  )

  // The chevron collapses the player back to wherever you came from - the same
  // gesture as any full-screen player. `previousView` can point back at this
  // page (a reload lands here), hence the fallback.
  const collapse = (): void => setActiveView(previousView && previousView !== 'wrld' ? previousView : 'api-tracker')

  // Cover size - measured, not CSS-derived (see the comment by coverRowRef's
  // use below for why). Biggest square that fits the row, capped at 420px.
  const coverRowRef = useRef<HTMLDivElement>(null)
  const [coverSize, setCoverSize] = useState(280)
  useLayoutEffect(() => {
    const el = coverRowRef.current
    if (!el) return
    const measure = (): void => {
      const r = el.getBoundingClientRect()
      setCoverSize(Math.max(0, Math.min(r.width, r.height, 420)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Swipe-down-to-dismiss, same as the chevron - only armed from the header/
  // cover area so it doesn't fight the progress bar or volume slider's own
  // drag handling. Touch events keep targeting the element the touch started
  // on even once the finger moves past its bounds, so this stays live for
  // the whole gesture.
  //
  // `elRef` + `applyStyle` write the transform/border-radius straight to the
  // wrapper's DOM node on every touchmove instead of through setState - this
  // component's subtree (blurred cover backdrop, lyrics, queue, everything)
  // is large enough that re-rendering it on every finger move was visibly
  // janky. `dragging` still comes through state (only flips at drag
  // start/end, so it's cheap) to drive the transition below.
  const dragWrapRef = useRef<HTMLDivElement>(null)
  const { dragging, handlers: dragHandlers } = useDragToDismiss(collapse, {
    elRef: dragWrapRef,
    applyStyle: (el, dy) => {
      el.style.transform = dy ? `translateY(${dy}px)` : ''
      el.style.borderRadius = dy ? `${Math.min(dy, 32)}px` : '0px'
    },
  })

  const voteActive = !!radioFmVote?.active && !voteDismissed

  // App.tsx skips its usual safe-area-inset-top padding for this view
  // specifically, so WRLD's backdrop can paint full-bleed under the status
  // bar - which means WRLD has to pad its own header down to compensate
  // instead (every other view gets that inset for free from the shell).
  // Always true: mobile's nav bar is bottom-only now (see BottomNav), so the
  // shell always reserves this inset itself.
  const ownsTopInset = true

  return (
    <div
      // Transform lives here, on the whole sheet (backdrop included) - not
      // just the inner content - so dragging down actually reveals whatever
      // App.tsx is rendering behind this overlay (see bgView there), Spotify-
      // curtain style, instead of leaving the opaque backdrop covering it
      // while only the text/controls slide.
      //
      // `isolate`: ArtBackdrop's noise-texture layer uses mix-blend-overlay,
      // which blends with whatever is painted behind it in the same stacking
      // context. bgView stays mounted directly behind this overlay now (for
      // that same curtain reveal) - without a boundary here, that blend
      // reaches past this whole view into bgView underneath, visible as a
      // faint colour/tint bleeding through the top of the screen (nav
      // bars, accent-tinted rows, etc. from whatever page is still mounted
      // there). LyricsScreen already isolates itself for the identical
      // reason; the main page never needed to until bgView started
      // persisting behind it.
      ref={dragWrapRef}
      className="relative flex-1 h-full w-full overflow-hidden flex flex-col isolate"
      style={{
        transition: dragging ? 'none' : 'transform 0.25s ease-out, border-radius 0.25s ease-out',
      }}
    >
      <ArtBackdrop
        artSrc={artSrc} artError={artError} isDarkSkin={isDarkSkin}
        radioFmActive={radioFmActive} onError={() => setArtError(true)}
      />

      <div className="relative z-10 flex flex-col h-full min-h-0">
        {/* Drag arms only over the header/cover area - not the whole sheet -
            so it doesn't fight the progress bar, volume slider, or (below)
            the transport controls' own touch handling. `touch-none` stops
            the browser from also treating this gesture as a page scroll,
            which otherwise animates the mobile browser's own chrome (URL
            bar) in and out - visible as the rest of the app appearing to
            "nudge" vertically while dragging. */}
        <div className="flex-1 min-h-0 flex flex-col touch-none" {...dragHandlers}>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          className="shrink-0 flex items-center gap-1 px-2"
          style={{ paddingTop: ownsTopInset ? 'max(0.25rem, var(--top-inset))' : '0.25rem' }}
        >
          {/* Three equal flex-1 columns, not a fixed-width button flanking a
              flex-1 middle - the right side can hold one or two 44px icon
              buttons (FmLikeButton self-hides sometimes) while the left only
              ever has one, so a fixed-width left button made the "centered"
              middle actually sit off-center by half that imbalance. Equal
              columns keep the pill centered regardless of how many icons the
              other two hold. */}
          <div className="flex-1 flex justify-start">
            <button
              onClick={collapse}
              aria-label="Collapse player"
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-white/10"
              style={{ color: txtPri }}
            ><ChevronDown size={22} /></button>
          </div>

          <div className="flex-1 flex justify-center min-w-0">
            <FmPill active={radioFmActive} live={radioFmIsLive} disabled={fmDisabled} onClick={toggleFm} light={textIsDark} />
          </div>

          <div className="flex-1 flex justify-end items-center gap-1">
            <FmLikeButton light={textIsDark} />
            <SongMenu light={textIsDark} />
          </div>
        </div>

        {/* ── Cover ──────────────────────────────────────────────────────── */}
        {/* CSS-only attempts (width-driven, height-driven, stretch+aspect-
            ratio) all broke on real iOS Safari - either clipped to a
            rectangle or, worse, left width at min-content while height
            stretched to the row's full height (a tall thin pill). Measuring
            the row and setting an explicit equal width/height is the only
            approach that's actually correct everywhere. */}
        <div className="flex-1 min-h-0 flex flex-col items-center px-8 py-2 gap-2">
          <div ref={coverRowRef} className="flex-1 min-h-0 w-full flex items-center justify-center">
            <div
              className="rounded-3xl overflow-hidden shadow-[0_28px_70px_rgba(0,0,0,0.65)] transition-transform duration-500 ease-out touch-none"
              style={{
                width: coverSize, height: coverSize,
                transform: isPlaying || radioFmActive ? 'scale(1)' : 'scale(0.92)',
                // Without this, iOS Safari's own long-press-on-<img> callout
                // (Save to Photos / Copy / etc) wins the gesture before our
                // long-press timer ever fires - this property is inherited,
                // so it reaches the <img> ProgressiveCover renders below.
                WebkitTouchCallout: 'none',
                WebkitUserSelect: 'none',
              }}
              {...(coverSongId != null ? coverPress : {})}
            >
              {artSrc && !artError ? (
                <ProgressiveCover src={artSrc} alt="Album art" className="w-full h-full object-cover" onError={() => setArtError(true)} />
              ) : radioFmActive ? (
                <div className="w-full h-full bg-gradient-to-br from-red-900/60 to-black flex flex-col items-center justify-center gap-3">
                  <Radio className="text-red-400 opacity-70 w-14 h-14" />
                  <span className="text-red-300/70 text-xl font-bold tracking-widest">999 FM</span>
                </div>
              ) : (
                <div className="w-full h-full bg-white/10 flex items-center justify-center">
                  <Music className="text-white/20 w-14 h-14" />
                </div>
              )}
            </div>
          </div>
          {/* Fixed-height slot even when empty, so the cover above doesn't
              jump vertically switching between a track with synced lyrics and
              one without. */}
          <div className="h-6 w-full shrink-0 flex items-center justify-center">
            <MiniLyricLine
              rawLyrics={rawLyrics} isSynced={isSynced} syncedLines={syncedLines}
              onOpen={() => setLyricsOpen(true)}
              txtSec={txtSec}
            />
          </div>
        </div>
        </div>

        {/* ── Controls ───────────────────────────────────────────────────── */}
        <div
          className="shrink-0 px-6 flex flex-col gap-2.5"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
        >
          {/* Title block */}
          <div className="min-w-0">
            <p className="font-bold text-base leading-tight truncate" style={{ color: txtPri }}>
              {displayTitle || (radioFmActive ? 'Tuning in…' : 'Not playing')}
            </p>
            <p className="text-xs mt-0.5 truncate" style={{ color: txtSec }}>
              {[displayArtist, displayAlbum].filter(Boolean).join(' · ') || ' '}
            </p>
          </div>

          {radioFmActive ? <FmProgressBar txtPri={txtPri} txtTer={txtTer} trackBg={trackBg} /> : <ProgressBar txtPri={txtPri} txtTer={txtTer} trackBg={trackBg} />}

          {/* Transport. 999 FM is a live stream - there is nothing local to
              play, pause or seek, so that mode gets the vote card (or its
              two entry points) in the same slot instead. */}
          {radioFmActive ? (
            voteActive ? (
              <VoteCard
                vote={radioFmVote!}
                secondsLeft={localSecondsLeft}
                myVote={myVote}
                onVote={(v) => { setMyVote(v); getActiveRadioClient()?.castVote(v) }}
                onDismiss={() => setVoteDismissed(true)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setVoteDismissed(false); getActiveRadioClient()?.proposeSkip() }}
                  className="flex-1 h-11 rounded-full bg-white/10 text-white text-sm font-semibold flex items-center justify-center gap-2 active:bg-white/20"
                ><SkipForward size={16} /> Vote to skip</button>
                <button
                  onClick={() => setSheet('radio')}
                  className="flex-1 h-11 rounded-full bg-white/10 text-white text-sm font-semibold flex items-center justify-center gap-2 active:bg-white/20"
                ><Search size={16} /> Suggest</button>
              </div>
            )
          ) : (
            <div className={`flex items-center justify-between transition-opacity ${noTrack ? 'opacity-35 pointer-events-none' : ''}`}>
              <button
                onClick={toggleShuffle}
                disabled={noTrack}
                aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
                aria-pressed={shuffle}
                className="w-10 h-10 flex items-center justify-center rounded-full active:bg-white/10"
                style={{ color: shuffle ? txtPri : txtTer, opacity: shuffle ? 1 : 0.7 }}
              ><Shuffle size={17} /></button>
              <button
                onClick={() => prevTrack()}
                disabled={noTrack}
                aria-label="Previous"
                className="w-12 h-12 flex items-center justify-center rounded-full active:bg-white/10"
                style={{ color: txtPri }}
              ><SkipBack size={24} fill="currentColor" /></button>
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                disabled={noTrack}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="w-14 h-14 rounded-full flex items-center justify-center shadow-xl active:scale-95 transition-transform"
                style={{ background: txtPri, color: textIsDark ? 'white' : 'black' }}
              >
                {isPlaying
                  ? <Pause size={24} fill="currentColor" />
                  : <Play size={24} fill="currentColor" className="ml-1" />}
              </button>
              <button
                onClick={() => nextTrack()}
                disabled={noTrack}
                aria-label="Next"
                className="w-12 h-12 flex items-center justify-center rounded-full active:bg-white/10"
                style={{ color: txtPri }}
              ><SkipFwd size={24} fill="currentColor" /></button>
              <button
                onClick={toggleRepeat}
                disabled={noTrack}
                aria-label={repeat === 'none' ? 'No repeat' : repeat === 'all' ? 'Repeat all' : 'Repeat one'}
                className="w-10 h-10 flex items-center justify-center rounded-full active:bg-white/10"
                style={{ color: repeat !== 'none' ? txtPri : txtTer, opacity: repeat !== 'none' ? 1 : 0.7 }}
              >{repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}</button>
            </div>
          )}

          <VolumeRow txtPri={txtPri} txtTer={txtTer} trackBg={trackBg} />

          {/* Everything that used to occupy a second column now hangs off
              these - each opens a sheet over the player rather than replacing
              it, so what's playing never leaves the screen. */}
          <div className="flex items-center justify-center gap-2">
            <ActionChip icon={Mic2} label="Lyrics" onClick={() => setLyricsOpen(true)} light={textIsDark} />
            {radioFmActive
              ? <ActionChip icon={Radio} label="Radio" onClick={() => setSheet('radio')} light={textIsDark} />
              : <ActionChip icon={ListMusic} label="Queue" onClick={() => setShowQueue(true)} light={textIsDark} />}
            {!radioFmActive && songVersions.length > 0 && (
              <ActionChip icon={Layers} label="Versions" onClick={() => setSheet('versions')} light={textIsDark} />
            )}
            {EFFECTS_SUPPORTED && (
              <ActionChip icon={SlidersHorizontal} label="EQ" onClick={toggleEqPanel} active={eqFxActive} light={textIsDark} />
            )}
          </div>
        </div>
      </div>

      {/* ── Lyrics, full screen ──────────────────────────────────────────── */}
      {lyricsOpen && (
        <LyricsScreen
          onClose={() => setLyricsOpen(false)}
          title={displayTitle}
          artist={displayArtist}
          rawLyrics={rawLyrics}
          isSynced={isSynced}
          syncedLines={syncedLines}
          radioFmActive={radioFmActive}
          currentTrack={currentTrack}
          isEditor={isEditor}
          txtPri={txtPri} txtSec={txtSec} txtTer={txtTer} txtFaint={txtFaint}
          textIsDark={textIsDark}
          artSrc={artSrc} artError={artError} isDarkSkin={isDarkSkin}
        />
      )}

      {/* ── Queue ────────────────────────────────────────────────────────── */}
      {showQueue && !radioFmActive && <QueueSheet onClose={() => setShowQueue(false)} />}

      {/* ── 999 FM panel ─────────────────────────────────────────────────── */}
      {sheet === 'radio' && (
        <Sheet onClose={() => setSheet(null)} title="999 FM">
          <div className="px-5 pb-2 flex flex-col gap-4">
            {/* Suggest */}
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Suggest next song</p>
              {proposed ? (
                <div className="flex items-center justify-between gap-2 bg-green-900/20 border border-green-500/20 rounded-xl px-3 py-2.5">
                  <p className="text-green-400 text-sm min-w-0 truncate">
                    Proposed: <span className="text-green-300 font-medium">{proposed}</span>
                  </p>
                  <button
                    onClick={dismissProposed}
                    className="shrink-0 w-8 h-8 flex items-center justify-center text-green-500/70"
                    aria-label="Dismiss"
                  ><X size={15} /></button>
                </div>
              ) : (
                <>
                  {proposeError && <p className="text-red-400/90 text-xs">{proposeError}</p>}
                  <div className="relative flex items-center">
                    <Search size={16} className="absolute left-3.5 text-text-muted pointer-events-none" />
                    <input
                      type="search"
                      value={suggestQuery}
                      onChange={(e) => setSuggestQuery(e.target.value)}
                      placeholder="Search songs"
                      enterKeyHint="search"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className="w-full h-11 bg-surface-overlay rounded-full pl-10 pr-4 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 [&::-webkit-search-cancel-button]:hidden"
                    />
                  </div>
                  {suggestLoading && (
                    <p className="flex items-center gap-2 text-text-muted text-xs"><Loader2 size={13} className="animate-spin" /> Searching…</p>
                  )}
                  {suggestResults.map(track => (
                    <button
                      key={track.id}
                      onClick={() => handlePropose(track)}
                      className="text-left -mx-2 px-2 py-2 rounded-xl active:bg-surface-overlay"
                    >
                      <p className="text-text-primary text-[15px] truncate">{track.title}</p>
                      <p className="text-text-muted text-xs truncate mt-0.5">{track.artist}</p>
                    </button>
                  ))}
                </>
              )}
            </div>

            {radioFmUpNext && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Up next</p>
                <div className="bg-surface-overlay rounded-xl px-4 py-3">
                  <p className="text-text-primary text-[15px] truncate">{radioFmUpNext.title}</p>
                  {radioFmUpNext.artist && <p className="text-text-muted text-xs truncate mt-0.5">{radioFmUpNext.artist}</p>}
                </div>
              </div>
            )}

            {radioFmQueuePreview.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Coming up</p>
                {radioFmQueuePreview.map((title, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5">
                    <span className="w-4 shrink-0 text-right text-text-muted text-xs tabular-nums">{i + 1}</span>
                    <p className="text-text-secondary text-sm truncate">{title}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <SheetDivider />
          <SheetItem
            icon={SkipForward}
            label="Vote to skip this song"
            onClick={() => { setVoteDismissed(false); getActiveRadioClient()?.proposeSkip(); setSheet(null) }}
          />
        </Sheet>
      )}

      {/* ── Other versions ───────────────────────────────────────────────── */}
      {sheet === 'versions' && (
        <Sheet onClose={() => setSheet(null)} title="Other versions">
          {songVersions.map((v, i) => (
            <SheetItem
              key={v.songId}
              icon={Layers}
              label={v.label ?? `Version ${i + 1}`}
              onClick={() => { setSheet(null); void handlePlayVersion(v.songId) }}
            />
          ))}
        </Sheet>
      )}

      {/* ── Cover long-press → Change cover ─────────────────────────────── */}
      {showCoverPicker && (
        <Sheet onClose={() => setShowCoverPicker(false)} title="Change cover">
          <div className="px-5 pb-4">
            {coverPickerSong ? (
              <CoverEditor
                songId={coverPickerSong.id}
                apiTitle={coverPickerSong.name}
                ownImageRaw={coverPickerSong.image_url}
                altTitles={(coverPickerSong.track_titles ?? []).filter(t => t && t !== coverPickerSong.name)}
                onPicked={() => setShowCoverPicker(false)}
              />
            ) : (
              <div className="flex items-center justify-center gap-2 text-text-muted text-xs py-6">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            )}
          </div>
        </Sheet>
      )}
    </div>
  )
}

// ─── chrome ───────────────────────────────────────────────────────────────────

/** The cover, blurred into a wash of its own colours. Every text colour on
 *  this page is picked against it (see textIsDark), so any surface that covers
 *  the page - the lyrics screen - has to repaint it rather than sit on an
 *  opaque theme colour, or a dark cover under a light skin puts white text on
 *  a white background. */
function ArtBackdrop({ artSrc, artError, isDarkSkin, radioFmActive, onError, extraDim }: {
  artSrc: string | null
  artError: boolean
  isDarkSkin: boolean
  radioFmActive: boolean
  onError?: () => void
  /** The base gradient below leaves the vertical middle fully transparent
   *  (`via-transparent`), which is fine for the main WRLD page but leaves the
   *  lyrics screen's text sitting directly on the raw blurred cover with no
   *  extra darkening where the lines actually are - busy art underneath can
   *  fight the faded past/future lines for legibility. LyricsScreen opts into
   *  a flat wash over the whole backdrop to fix that without touching the
   *  main page's look. */
  extraDim?: boolean
}): JSX.Element {
  return (
    // bg-black: a guaranteed opaque base underneath every layer below. The
    // stack above it (blurred cover, gradients with a `via-transparent`
    // middle, the noise texture) was never meant to be fully opaque on its
    // own - each layer assumes something solid sits behind it - which is
    // fine on the main WRLD page (nothing behind it but the app shell) but
    // left the portaled lyrics screen showing whatever page was still
    // mounted behind it through the transparent middle. The blurred cover
    // still paints on top of this exactly as before, so it still reads as
    // "matches the cover" - this only guarantees there's always something
    // solid under it.
    <div className="absolute inset-0 overflow-hidden bg-black">
      {artSrc && !artError ? (
        // The full-res cover, not the ~128px `small=1` degraded variant - see
        // the resolution note below, this is a separate problem from that one.
        //
        // The img is laid out at HALF the container's size (width/height:50%,
        // recentred) and blurred at HALF the radius, then blown back up with
        // `transform: scale(2.4)` - 2x to restore full size, further scaled by
        // the same 1.2 "zoom in" the old single-element version used, so
        // 2 * 1.2 = 2.4. `filter` rasterizes at the element's actual layout
        // size, before transform ever runs, so this computes the Gaussian
        // blur over a quarter of the pixels a full-size element would need -
        // both cheaper AND less likely to trip a renderer's "blur radius is
        // large relative to layer size" fallback, which on a software
        // rasterizer (a GPU-less emulator, notably) approximates by
        // downsampling first and produces exactly the hard-edged blocky
        // patches this was reported against. transform's own upscale is a
        // separate, always-smooth bilinear step, so the visible result is
        // softer even though the source blur radius is smaller.
        <img src={artSrc} alt=""
          className="absolute object-cover"
          style={{
            width: '50%', height: '50%', left: '50%', top: '50%',
            transform: 'translate(-50%, -50%) scale(2.4)',
            filter: `blur(30px) brightness(${isDarkSkin ? 0.22 : 0.45}) saturate(${isDarkSkin ? 2.4 : 1.8})`,
          }}
          onError={onError}
        />
      ) : (
        <div className={`absolute inset-0 ${radioFmActive ? 'bg-gradient-to-br from-red-950/60 to-black' : 'bg-gradient-to-br from-gray-200 to-gray-100 dark:from-gray-900 dark:to-black'}`} />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/20 dark:from-black/40 dark:via-transparent dark:to-black/70" />
      {extraDim && <div className="absolute inset-0 bg-black/35" />}
      {/* A near-black diagonal gradient (or a 60px blur pushed to very low
          brightness) has almost no per-pixel colour variation, which is
          exactly what triggers 8-bit banding on phone panels - flat
          rings/patches instead of a smooth wash. A faint noise texture breaks
          the flat bands up; at 3% opacity it isn't visible as texture, only
          as the absence of banding. */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  )
}

// ─── header bits ──────────────────────────────────────────────────────────────

/** The 999 FM switch. Live/off/on is carried by colour and the pulse, since
 *  there's no room for a status line next to it. */
function FmPill({ active, live, disabled, onClick, light }: {
  active: boolean
  live: boolean | null
  disabled: boolean
  onClick: () => void
  light: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`h-9 px-4 rounded-full flex items-center gap-2 text-[13px] font-semibold transition-colors disabled:opacity-40 ${
        active && live ? 'bg-red-600/85 text-white'
          : active ? 'bg-white/15 text-white/70'
          : 'bg-white/10 active:bg-white/20'
      }`}
      style={!active ? { color: light ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)' } : undefined}
    >
      <Radio size={15} className={active && live ? 'animate-pulse' : ''} />
      {active && live ? '999 FM · LIVE' : live === false ? '999 FM · OFF' : '999 FM'}
    </button>
  )
}

/** One of the surfaces hanging off the bottom of the player. */
function ActionChip({ icon: Icon, label, onClick, active, light }: {
  icon: typeof Radio
  label: string
  onClick: () => void
  active?: boolean
  light: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="h-9 px-3 rounded-full flex items-center gap-1.5 text-xs font-medium bg-white/10 active:bg-white/20 transition-colors"
      style={{ color: active ? 'var(--accent)' : (light ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.8)') }}
    >
      <Icon size={15} /> {label}
    </button>
  )
}

// ─── 999 FM vote ──────────────────────────────────────────────────────────────

function VoteCard({ vote, secondsLeft, myVote, onVote, onDismiss }: {
  vote: NonNullable<ReturnType<typeof useStore.getState>['radioFmVote']>
  secondsLeft: number | null
  myVote: 'yes' | 'no' | null
  onVote: (v: 'yes' | 'no') => void
  onDismiss: () => void
}): JSX.Element {
  return (
    <div className="bg-white/10 rounded-2xl p-3.5 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-white/60 text-[11px] font-semibold uppercase tracking-wider">
          {vote.kind === 'skip' ? 'Vote to skip' : 'Vote to queue'}
        </p>
        <div className="flex items-center gap-1">
          {secondsLeft != null && (
            <span className={`text-xs tabular-nums font-semibold ${secondsLeft <= 5 ? 'text-red-400' : 'text-white/40'}`}>
              {secondsLeft}s
            </span>
          )}
          <button onClick={onDismiss} className="w-8 h-8 flex items-center justify-center text-white/40" aria-label="Dismiss vote">
            <X size={15} />
          </button>
        </div>
      </div>
      {vote.track && <p className="text-white/90 text-sm font-medium truncate">{vote.track}</p>}
      <p className="text-white/40 text-xs">
        {vote.yes ?? 0} yes · {vote.no ?? 0} no
        {vote.votes_needed != null && <span> · need {vote.votes_needed}</span>}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onVote('yes')}
          className={`flex-1 h-11 flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors ${
            myVote === 'yes' ? 'bg-green-600/45 text-green-200 ring-1 ring-green-400/50' : 'bg-green-600/20 text-green-300 active:bg-green-600/35'
          }`}
        ><ThumbsUp size={15} /> Yes</button>
        <button
          onClick={() => onVote('no')}
          className={`flex-1 h-11 flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors ${
            myVote === 'no' ? 'bg-red-600/45 text-red-200 ring-1 ring-red-400/50' : 'bg-red-900/25 text-red-300 active:bg-red-900/40'
          }`}
        ><ThumbsDown size={15} /> No</button>
      </div>
    </div>
  )
}

// ─── like / menu ──────────────────────────────────────────────────────────────

// One-tap "like" for the 999 FM now-playing track. FM is server-driven and
// only hands us title/artist, so the likeable target is the resolved song id
// (stream metadata's song_id, or RadioFmPlayer's title-search fallback match).
// Reuses the same `jw-<id>` track id / toggleLike path as every other API song,
// so it lands in Liked Songs identically. Self-hides off FM or until the
// broadcast resolves to a known song.
const FmLikeButton = memo(function FmLikeButton({ light }: { light: boolean }): JSX.Element {
  const { radioFmActive, radioFmNowPlaying, radioFmMatchedSong, currentTrack, likedTrackIds, toggleLike } = useStore(useShallow(s => ({
    radioFmActive: s.radioFmActive,
    radioFmNowPlaying: s.radioFmNowPlaying,
    radioFmMatchedSong: s.radioFmMatchedSong,
    currentTrack: s.currentTrack,
    likedTrackIds: s.likedTrackIds,
    toggleLike: s.toggleLike,
  })))

  // Off FM this used to render nothing at all, which meant the one screen
  // dedicated to the current song had no like button on it.
  const fmSongId = radioFmActive ? (radioFmNowPlaying?.song_id ?? radioFmMatchedSong?.songId ?? null) : null
  const targetId = radioFmActive ? (fmSongId != null ? `jw-${fmSongId}` : null) : (currentTrack?.id ?? null)
  if (!targetId) return <></>

  const liked = likedTrackIds.includes(targetId)
  return (
    <button
      onClick={() => toggleLike(targetId)}
      aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
      aria-pressed={liked}
      className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-white/10 transition-colors"
      style={{ color: liked ? 'var(--accent)' : (light ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.7)') }}
    >
      <Heart size={20} fill={liked ? 'currentColor' : 'none'} />
    </button>
  )
})

// "···" for the current track. SongContextMenu is the app-wide one and already
// comes up as a bottom sheet on a phone, so the x/y it takes are ignored here.
const SongMenu = memo(function SongMenu({ light }: { light: boolean }): JSX.Element {
  const { currentTrack, radioFmActive, radioFmNowPlaying, radioFmMatchedSong, likedTrackIds, toggleLike, setActiveView, setPendingEditorSongId } = useStore(useShallow(s => ({
    currentTrack: s.currentTrack,
    radioFmActive: s.radioFmActive,
    radioFmNowPlaying: s.radioFmNowPlaying,
    radioFmMatchedSong: s.radioFmMatchedSong,
    likedTrackIds: s.likedTrackIds,
    toggleLike: s.toggleLike,
    setActiveView: s.setActiveView,
    setPendingEditorSongId: s.setPendingEditorSongId,
  })))
  const canEdit = useCanEdit()

  const [open, setOpen] = useState(false)
  const [showSongInfo, setShowSongInfo] = useState(false)
  const [songInfoData, setSongInfoData] = useState<JWApiSong | null>(null)

  const currentSongId = !radioFmActive && currentTrack ? userApi.trackIdToSongId(currentTrack.id) : null
  // Stream metadata's song_id is sometimes missing; RadioFmPlayer's title-search
  // fallback resolves the actual song separately, so fall back to that match.
  const fmSongId = radioFmActive ? (radioFmNowPlaying?.song_id ?? radioFmMatchedSong?.songId ?? null) : null
  const hasTarget = radioFmActive ? fmSongId != null : !!currentTrack

  const openInfo = (songId: number): void => {
    setOpen(false)
    setSongInfoData(null)
    setShowSongInfo(true)
    apiFetch<JWApiSong>(`/songs/${songId}/`)
      .then(song => setSongInfoData(song))
      .catch(() => setShowSongInfo(false))
  }

  if (!hasTarget) return <></>

  return (
    <>
      <button
        // Stop the touch from reaching SongContextMenu's document-level
        // outside-press listener - otherwise pressing this while the menu is
        // open closes it and then reopens it, so it never appears to toggle.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(v => !v)}
        aria-label="More options"
        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-white/10 transition-colors"
        style={{ color: light ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.7)' }}
      >
        <MoreHorizontal size={20} />
      </button>

      {/* FM radio is server-driven - Play/Play next/Add to queue/version
          switching don't make sense mid-broadcast, so those are left off,
          but Song info and Add to playlist still apply to the now-playing
          track. Synthesize a minimal Track since FM only gives us title/
          artist/album, not a full local/API track object. */}
      {open && radioFmActive && fmSongId != null && createPortal(
        <SongContextMenu
          state={{
            track: {
              id: `fm-${fmSongId}`,
              path: '',
              title: radioFmNowPlaying?.title ?? '',
              artist: radioFmNowPlaying?.artist ?? '',
              album: radioFmNowPlaying?.album ?? '',
              albumArtist: '',
              year: null,
              trackNumber: null,
              duration: 0,
              genre: '',
              hasAlbumArt: false,
            },
            songId: fmSongId,
            x: 0,
            y: 0,
          }}
          onClose={() => setOpen(false)}
          canEdit={canEdit}
          onInfo={() => openInfo(fmSongId)}
          liked={likedTrackIds.includes(`jw-${fmSongId}`)}
          onToggleLike={() => toggleLike(`jw-${fmSongId}`)}
          disableChangeVersion
        />,
        document.body
      )}

      {open && !radioFmActive && currentTrack && createPortal(
        <SongContextMenu
          state={{ track: currentTrack, songId: currentSongId, x: 0, y: 0 }}
          onClose={() => setOpen(false)}
          canEdit={canEdit}
          onInfo={() => currentSongId != null && openInfo(currentSongId)}
          liked={likedTrackIds.includes(currentTrack.id)}
          onToggleLike={() => toggleLike(currentTrack.id)}
        />,
        document.body
      )}

      {showSongInfo && createPortal(
        <SongInfoModal
          song={songInfoData}
          onClose={() => { setShowSongInfo(false); setSongInfoData(null) }}
          onEdit={canEdit ? (songId) => {
            setShowSongInfo(false); setSongInfoData(null)
            setPendingEditorSongId(songId)
            setActiveView('editor')
          } : undefined}
        />,
        document.body
      )}
    </>
  )
})

// ─── queue ────────────────────────────────────────────────────────────────────

const MAX_HISTORY_SHOWN = 10

// Full-height sheet rather than the desktop side panel. Drag-to-reorder is
// gone - there's no HTML5 drag on touch - replaced by an explicit reorder mode
// with up/down buttons, the same pattern the Playlists tab uses.
function QueueSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const { queue, queueIndex, currentTrack, isPlaying, shuffle, radioMode, playTrack, jumpToTrack, removeFromQueue, clearQueue, reorderQueue, reshuffleQueue } = useStore(useShallow(s => ({
    queue: s.queue,
    queueIndex: s.queueIndex,
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    shuffle: s.shuffle,
    radioMode: s.radioMode,
    playTrack: s.playTrack,
    jumpToTrack: s.jumpToTrack,
    removeFromQueue: s.removeFromQueue,
    clearQueue: s.clearQueue,
    reorderQueue: s.reorderQueue,
    reshuffleQueue: s.reshuffleQueue,
  })))

  const history = queue.slice(0, queueIndex) // played tracks, oldest first
  const upcoming = queue.slice(queueIndex + 1)
  const [historyOpen, setHistoryOpen] = useState(false)
  // reorderQueue's (from, to) are indices within `upcoming` itself - see its
  // definition in queueSlice.ts - which is exactly what useDragReorder tracks.
  // Started by a press-and-hold directly on the row (QueueRow's own
  // long-press timer calls drag.startFrom) rather than a separate "Reorder"
  // mode + dedicated grip handle - one gesture instead of a mode switch.
  const drag = useDragReorder(upcoming.length, reorderQueue)
  const [search, setSearch] = useState('')

  const query = search.trim().toLowerCase()
  const matchesQuery = (track: Track): boolean =>
    !query || track.title.toLowerCase().includes(query) || track.artist.toLowerCase().includes(query)
  // Pair each track with its original absolute index so onPlay/onRemove keep
  // working correctly after filtering shrinks the array.
  const upcomingIndexed = upcoming.map((track, i) => ({ track, i }))
  const filteredUpcoming = query ? upcomingIndexed.filter(({ track }) => matchesQuery(track)) : upcomingIndexed

  return (
    <Sheet
      onClose={onClose}
      title="Playing next"
      header={
        <div className="flex items-center gap-2 px-5 pt-2">
          {shuffle && upcoming.length > 0 && (
            <button
              onClick={reshuffleQueue}
              className="h-8 px-3 rounded-full text-xs font-semibold bg-surface-overlay text-text-secondary flex items-center gap-1.5"
            ><RefreshCw size={13} /> Reshuffle</button>
          )}
          {upcoming.length > 0 && (
            <button
              onClick={clearQueue}
              className="h-8 px-3 rounded-full text-xs font-semibold bg-surface-overlay text-red-400 flex items-center gap-1.5"
            ><Trash2 size={13} /> Clear</button>
          )}
        </div>
      }
    >
      {/* History - during radio the queue holds *only* played history, so
          without this the sheet looks empty in radio mode. */}
      {history.length > 0 && (
        <>
          <button
            onClick={() => setHistoryOpen(o => !o)}
            className="w-full flex items-center gap-2 px-5 py-2.5 text-text-muted"
          >
            <History size={14} />
            <span className="text-[11px] font-semibold uppercase tracking-wider flex-1 text-left">History · {history.length}</span>
            <ChevronDown size={15} className={`transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
          </button>
          {historyOpen && (() => {
            // Displayed newest-first, so reversed index i maps back to
            // absolute queue position history.length - 1 - i.
            const reversedIndexed = [...history].reverse().map((track, i) => ({ track, i }))
            const filtered = query ? reversedIndexed.filter(({ track }) => matchesQuery(track)) : reversedIndexed
            const shown = query ? filtered : filtered.slice(0, MAX_HISTORY_SHOWN)
            return (
              <div className="opacity-70">
                {shown.map(({ track, i }) => (
                  <QueueRow
                    key={`hist-${track.id}-${i}`}
                    track={track}
                    onPlay={() => radioMode ? jumpToTrack(track) : playTrack(track)}
                  />
                ))}
                {!query && filtered.length > MAX_HISTORY_SHOWN && (
                  <p className="text-text-muted text-xs text-center py-1.5">+{filtered.length - MAX_HISTORY_SHOWN} older</p>
                )}
                {query && shown.length === 0 && (
                  <p className="text-text-muted text-xs text-center py-1.5">No matches</p>
                )}
              </div>
            )
          })()}
          <SheetDivider />
        </>
      )}

      {queue.length > 0 && (
        <div className="px-5 pt-2 pb-1">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-overlay focus-within:ring-1 focus-within:ring-accent/50 transition-shadow">
            <Search size={13} className="text-text-muted shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search queue"
              className="flex-1 min-w-0 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-text-muted transition-colors shrink-0">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {!query && (currentTrack ? (
        <>
          <p className="px-5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Now playing</p>
          <QueueRow track={currentTrack} active playing={isPlaying} />
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-12">
          <ListMusic size={28} className="text-text-muted" />
          <p className="text-text-muted text-sm">Queue is empty</p>
        </div>
      ))}

      {filteredUpcoming.length > 0 ? (
        <>
          <SheetDivider />
          <p className="px-5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            {query ? 'Results' : shuffle ? 'Shuffle' : 'Up next'} · {filteredUpcoming.length}
          </p>
          {filteredUpcoming.map(({ track, i }) => (
            <QueueRow
              key={`${track.id}-${queueIndex + 1 + i}`}
              track={track}
              dragging={drag.dragIndex === i}
              anyDragging={drag.dragIndex !== null}
              rowStyle={drag.rowStyle(i)}
              onDragStart={query ? undefined : (clientY, rowEl) => drag.startFrom(i, clientY, rowEl)}
              onPlay={() => playTrack(track, queue.slice(queueIndex + 1 + i))}
              onRemove={() => removeFromQueue(queueIndex + 1 + i)}
            />
          ))}
        </>
      ) : query ? (
        <p className="text-text-muted text-xs text-center py-5">No matches</p>
      ) : currentTrack ? (
        <p className="text-text-muted text-xs text-center py-5">Nothing up next</p>
      ) : null}
    </Sheet>
  )
}

// A press held on the row for LONG_PRESS_MS (without moving past the slop)
// starts a reorder drag - no separate "Reorder" mode toggle or dedicated grip
// handle. A deliberate leftward swipe removes the track instead, revealing a
// red backdrop as it goes. Both gestures start from the same touchstart, so
// the first real movement has to arbitrate: mostly-horizontal commits to the
// swipe, mostly-vertical (or none at all, within the hold) leaves the
// long-press timer running for reorder, and unmistakable vertical movement
// before the timer fires cancels it outright so the list still scrolls.
const QUEUE_LONG_PRESS_MS = 420
const QUEUE_AXIS_SLOP = 10
const QUEUE_SWIPE_REVEAL = 72
const QUEUE_SWIPE_THRESHOLD = 56

function QueueRow({ track, active, playing, dragging, anyDragging, rowStyle, onDragStart, onPlay, onRemove }: {
  track: Track
  active?: boolean
  playing?: boolean
  dragging?: boolean
  /** True while ANY row in the list is mid-drag - suppresses tap-to-play on
   *  every row while one is reordering, since the drag's live reflow can
   *  shift a different row under the finger by the time it lifts. */
  anyDragging?: boolean
  rowStyle?: React.CSSProperties
  onDragStart?: (clientY: number, rowEl: HTMLElement | null) => void
  onPlay?: () => void
  onRemove?: () => void
}): JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const originRef = useRef<{ x: number; y: number } | null>(null)
  const axisRef = useRef<'swipe' | 'scroll' | 'reorder' | null>(null)
  const suppressClickRef = useRef(false)
  const [dragX, setDragX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const [removing, setRemoving] = useState(false)

  const cancelPress = (): void => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }
  const handleTouchStart = (e: React.TouchEvent): void => {
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    originRef.current = { x: t.clientX, y: t.clientY }
    axisRef.current = null
    if (onDragStart) {
      timerRef.current = setTimeout(() => {
        axisRef.current = 'reorder'
        suppressClickRef.current = true
        onDragStart(t.clientY, rowRef.current)
      }, QUEUE_LONG_PRESS_MS)
    }
  }
  const handleTouchMove = (e: React.TouchEvent): void => {
    const origin = originRef.current
    if (!origin) return
    const t = e.touches[0]
    const dx = t.clientX - origin.x
    const dy = t.clientY - origin.y
    if (!axisRef.current) {
      if (Math.abs(dx) < QUEUE_AXIS_SLOP && Math.abs(dy) < QUEUE_AXIS_SLOP) return
      // Any deliberate movement before the long-press timer fires means this
      // wasn't a hold - cancel it either way, then decide swipe vs. scroll.
      cancelPress()
      if (onRemove && Math.abs(dx) > Math.abs(dy)) {
        axisRef.current = 'swipe'
        setSwiping(true)
      } else {
        axisRef.current = 'scroll'
      }
    }
    if (axisRef.current !== 'swipe') return
    e.preventDefault()
    const raw = Math.min(dx, 0)
    setDragX(raw < -QUEUE_SWIPE_REVEAL ? -QUEUE_SWIPE_REVEAL + (raw + QUEUE_SWIPE_REVEAL) / 4 : raw)
  }
  const handleTouchEnd = (): void => {
    cancelPress()
    if (axisRef.current === 'swipe') {
      if (dragX < -QUEUE_SWIPE_THRESHOLD && onRemove) {
        suppressClickRef.current = true
        setRemoving(true)
        setDragX(-window.innerWidth)
        window.setTimeout(onRemove, 180)
      } else {
        setDragX(0)
      }
    }
    setSwiping(false)
    originRef.current = null
    axisRef.current = null
  }

  return (
    <div ref={rowRef} data-drag-row style={rowStyle} className="relative overflow-hidden">
      {onRemove && (
        <div
          className="absolute inset-0 bg-red-500 flex items-center justify-end pr-6 pointer-events-none"
          style={{ opacity: dragX < 0 ? Math.min(1, -dragX / QUEUE_SWIPE_THRESHOLD) : 0 }}
        >
          <Trash2 size={16} className="text-white" />
        </div>
      )}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className={`flex items-center gap-3 px-5 py-2 transition-colors ${
          active ? 'bg-accent/10' : dragging ? 'bg-white/10 shadow-xl rounded-xl' : onPlay ? 'active:bg-surface-overlay' : ''
        }`}
        style={{
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          transition: swiping ? 'none' : 'transform 0.2s ease-out, opacity 0.2s ease-out',
          opacity: removing ? 0 : 1,
          background: dragX ? 'var(--surface)' : undefined,
        }}
        onClick={() => {
          if (suppressClickRef.current) { suppressClickRef.current = false; return }
          if (!anyDragging && onPlay && !active) onPlay()
        }}
      >
        <div className="w-11 h-11 rounded-lg shrink-0 overflow-hidden bg-surface-overlay">
          <AlbumArtThumbnail track={track} size={44} fill className="w-full h-full" shimmer={false} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[15px] truncate leading-snug ${active ? 'text-accent font-semibold' : 'text-text-primary'}`}>{track.title}</p>
          <p className="text-text-muted text-xs truncate mt-0.5">{track.artist}</p>
        </div>
        {playing ? (
          <span className="flex gap-[3px] items-end h-3.5 shrink-0">
            {[0, 1, 2].map(i => (
              <span key={i} className="w-[3px] h-full rounded-full bg-accent eq-bar" style={{ animationDelay: `${i * 0.18}s` }} />
            ))}
          </span>
        ) : (
          <>
            <span className="text-text-muted text-[11px] tabular-nums shrink-0">
              {track.duration ? formatDuration(track.duration) : ''}
            </span>
            {onRemove && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove() }}
                aria-label="Remove from queue"
                className="w-10 h-11 -mr-2 shrink-0 flex items-center justify-center text-text-muted active:text-red-400"
              ><X size={17} /></button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── transport widgets ────────────────────────────────────────────────────────
// Each keeps its own store subscription so a ticking clock, a volume drag or a
// pause doesn't re-render the whole page (and with it the cover and lyrics).

/** Volume. The knob is always drawn - a hover-only one is invisible on touch,
 *  and there's no other cue that the line is draggable. */
const VolumeRow = memo(function VolumeRow({ txtPri, txtTer, trackBg }: { txtPri: string; txtTer: string; trackBg: string }): JSX.Element {
  const { volume, setVolume } = useStorePick('volume', 'setVolume')
  const barRef = useRef<HTMLDivElement>(null)
  // Remember the level before muting so unmuting restores it, instead of
  // jumping to a hardcoded one (mirrors the Player bar's toggleMute).
  const prevVolumeRef = useRef(volume || 0.8)
  useEffect(() => { if (volume > 0) prevVolumeRef.current = volume }, [volume])

  const setFrom = (clientX: number): void => {
    const bar = barRef.current
    if (!bar) return
    const r = bar.getBoundingClientRect()
    setVolume(Math.max(0, Math.min(1, (clientX - r.left) / r.width)))
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => setVolume(volume === 0 ? (prevVolumeRef.current || 0.8) : 0)}
        aria-label={volume === 0 ? 'Unmute' : 'Mute'}
        className="w-9 h-9 -ml-1.5 shrink-0 flex items-center justify-center"
        style={{ color: txtTer }}
      >{volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
      <div
        ref={barRef}
        // touch-none, or the browser claims the drag as a scroll and the
        // slider never sees it.
        className="relative flex-1 h-6 flex items-center touch-none"
        onTouchStart={(e) => setFrom(e.touches[0].clientX)}
        onTouchMove={(e) => setFrom(e.touches[0].clientX)}
      >
        <div className="w-full h-1.5 rounded-full" style={{ background: trackBg }}>
          <div className="h-full rounded-full" style={{ width: `${volume * 100}%`, background: txtTer }} />
        </div>
        <div
          className="absolute w-3.5 h-3.5 rounded-full shadow pointer-events-none"
          style={{ left: `${volume * 100}%`, transform: 'translateX(-50%)', background: txtPri }}
        />
      </div>
    </div>
  )
})

// Read-only bar for 999FM - it's a live stream, so no scrubbing, but
// elapsed/duration are still known (from the radio WS) and ticked locally
// between updates the same way the bottom Player bar does.
const FmProgressBar = memo(function FmProgressBar({ txtPri, txtTer, trackBg }: { txtPri: string; txtTer: string; trackBg: string }): JSX.Element {
  const radioFmNowPlaying = useStore(s => s.radioFmNowPlaying)
  const [elapsedMs, setElapsedMs] = useState(0)
  const baseRef = useRef<{ elapsed: number; at: number }>({ elapsed: 0, at: 0 })

  useEffect(() => {
    if (!radioFmNowPlaying?.elapsed_ms) { setElapsedMs(0); return }
    baseRef.current = { elapsed: radioFmNowPlaying.elapsed_ms, at: Date.now() }
    setElapsedMs(radioFmNowPlaying.elapsed_ms)
    const t = setInterval(() => {
      const { elapsed, at } = baseRef.current
      setElapsedMs(elapsed + (Date.now() - at))
    }, 500)
    return () => clearInterval(t)
  }, [radioFmNowPlaying])

  const durationMs = radioFmNowPlaying?.duration_ms ?? 0
  const pct = durationMs > 0 ? Math.min(100, (elapsedMs / durationMs) * 100) : 0

  return (
    <div className="w-full flex flex-col gap-1.5 select-none">
      <div className="relative h-1.5 rounded-full" style={{ background: trackBg }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: txtPri }} />
      </div>
      <div className="flex justify-between">
        <span className="text-[11px] tabular-nums" style={{ color: txtTer }}>{formatDuration(elapsedMs / 1000)}</span>
        <span className="text-[11px] tabular-nums" style={{ color: txtTer }}>{durationMs > 0 ? formatDuration(durationMs / 1000) : '-∞'}</span>
      </div>
    </div>
  )
})

const ProgressBar = memo(function ProgressBar({ txtPri, txtTer, trackBg }: { txtPri: string; txtTer: string; trackBg: string }): JSX.Element {
  const { progress, currentTime } = useStore(useShallow(s => ({ progress: s.progress, currentTime: s.currentTime })))
  const barRef = useRef<HTMLDivElement>(null)
  // Buffer the scrub position visually while dragging - only call seekAudio
  // on release, since seeking on every move makes playback glitch/stutter.
  const [dragPct, setDragPct] = useState<number | null>(null)

  const pctFromClientX = useCallback((clientX: number): number | null => {
    const bar = barRef.current
    if (!bar) return null
    const rect = bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  const duration    = getAudioDuration()
  const displayTime = dragPct !== null && duration > 0 ? dragPct * duration : currentTime
  const remaining   = duration > 0 ? duration - displayTime : 0
  const pct         = Math.min(100, (dragPct !== null ? dragPct : (progress || 0)) * 100)

  return (
    <div className="w-full flex flex-col gap-1.5 select-none">
      <div
        ref={barRef}
        // The hit area is 24px tall so it's grabbable; only the inner 6px
        // paints. touch-none stops the browser claiming the drag as a scroll,
        // which is what used to make seeking do nothing here.
        className="relative h-6 flex items-center touch-none"
        onTouchStart={e => {
          const startPct = pctFromClientX(e.touches[0].clientX)
          if (startPct !== null) setDragPct(startPct)
          const onMove = (ev: TouchEvent): void => {
            const p = pctFromClientX(ev.touches[0].clientX)
            if (p !== null) setDragPct(p)
          }
          const onEnd = (ev: TouchEvent): void => {
            const p = pctFromClientX(ev.changedTouches[0]?.clientX ?? 0)
            const dur = getAudioDuration()
            if (p !== null && dur > 0) seekAudio(p * dur)
            setDragPct(null)
            document.removeEventListener('touchmove', onMove)
            document.removeEventListener('touchend', onEnd)
          }
          document.addEventListener('touchmove', onMove, { passive: true })
          document.addEventListener('touchend', onEnd)
        }}
      >
        <div className="w-full h-1.5 rounded-full" style={{ background: trackBg }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: txtPri }} />
        </div>
        <div
          className="absolute w-3.5 h-3.5 rounded-full shadow pointer-events-none transition-transform"
          style={{ left: `${pct}%`, transform: `translateX(-50%) scale(${dragPct !== null ? 1.35 : 1})`, background: txtPri }}
        />
      </div>
      <div className="flex justify-between">
        <span className="text-[11px] tabular-nums" style={{ color: txtTer }}>{formatDuration(displayTime)}</span>
        <span className="text-[11px] tabular-nums" style={{ color: txtTer }}>{duration > 0 ? `-${formatDuration(remaining)}` : '-∞'}</span>
      </div>
    </div>
  )
})

// ─── lyrics ───────────────────────────────────────────────────────────────────

/** Lyrics get the whole screen: at a readable size a phone fits about six
 *  lines, so sharing the page with the cover left room for neither. Playback
 *  stays reachable through the strip pinned at the bottom. */
function LyricsScreen({
  onClose, title, artist, rawLyrics, isSynced, syncedLines,
  radioFmActive, currentTrack, isEditor, txtPri, txtSec, txtTer, txtFaint,
  textIsDark, artSrc, artError, isDarkSkin,
}: {
  onClose: () => void
  title?: string
  artist?: string
  textIsDark: boolean
  artSrc: string | null
  artError: boolean
  isDarkSkin: boolean
} & Omit<LyricsPanelProps, 'padded'>): JSX.Element {
  const { isPlaying, setIsPlaying, nextTrack, prevTrack } = useStore(useShallow(s => ({
    isPlaying: s.isPlaying,
    setIsPlaying: s.setIsPlaying,
    nextTrack: s.nextTrack,
    prevTrack: s.prevTrack,
  })))
  useBackToClose(onClose)
  const [showLyricsSettings, setShowLyricsSettings] = useState(false)
  const [showShareLyrics, setShowShareLyrics] = useState(false)

  return createPortal(
    // isolate: ArtBackdrop's noise-texture layer uses mix-blend-overlay,
    // which blends with whatever's painted behind it in the same stacking
    // context - without a boundary here, that reaches past this portal into
    // the still-mounted page behind it (this overlay sits on top of it, not
    // in place of it) and visibly ghosts that page's content through. Seen
    // as faint text from the Tracker list bleeding through the lyrics
    // screen's backdrop, reading as "the background is transparent".
    <div className="fixed inset-0 z-[70] flex flex-col animate-sheet-in isolate">
      {/* Repaints the page's own backdrop instead of an opaque theme colour -
          the text colours below were picked against the artwork, not against
          --surface. */}
      <ArtBackdrop artSrc={artSrc} artError={artError} isDarkSkin={isDarkSkin} radioFmActive={radioFmActive} extraDim />

      <div
        className="relative shrink-0 flex items-center gap-1 px-2"
        style={{ paddingTop: 'max(0.25rem, var(--top-inset))' }}
      >
        <button
          onClick={onClose}
          aria-label="Close lyrics"
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-white/10"
          style={{ color: txtPri }}
        ><ChevronDown size={22} /></button>
        <div className="flex-1 min-w-0 text-center">
          <p className="text-[13px] font-semibold truncate" style={{ color: txtPri }}>{title || 'Lyrics'}</p>
          {artist && <p className="text-[11px] truncate" style={{ color: txtTer }}>{artist}</p>}
        </div>
        {rawLyrics && (
          <button
            onClick={() => setShowShareLyrics(true)}
            aria-label="Share lyrics"
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-white/10"
            style={{ color: txtTer }}
          ><Share2 size={18} /></button>
        )}
        {/* Lyric display settings (size, alignment, blur, colors, sync
            offset) shown right here as a sheet instead of sending the user
            off to Settings - they're mid-song, tucking away to a different
            screen just to nudge the text size would lose the moment. */}
        <button
          onClick={() => setShowLyricsSettings(true)}
          aria-label="Lyrics display settings"
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-white/10"
          style={{ color: txtTer }}
        ><Settings2 size={19} /></button>
      </div>

      <LyricsPanel
        padded
        rawLyrics={rawLyrics}
        isSynced={isSynced}
        syncedLines={syncedLines}
        radioFmActive={radioFmActive}
        currentTrack={currentTrack}
        isEditor={isEditor}
        txtPri={txtPri} txtSec={txtSec} txtTer={txtTer} txtFaint={txtFaint}
      />

      {showLyricsSettings && <LyricsSettingsSheet onClose={() => setShowLyricsSettings(false)} />}
      {showShareLyrics && (
        <ShareLyricsModal
          title={title || 'Lyrics'}
          artist={artist || ''}
          imageUrl={artSrc}
          rawLyrics={rawLyrics}
          onClose={() => setShowShareLyrics(false)}
        />
      )}

      {!radioFmActive && (
        <div
          className="relative shrink-0 px-6 pt-1 flex items-center justify-center gap-8"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button onClick={() => prevTrack()} aria-label="Previous" className="w-12 h-12 flex items-center justify-center" style={{ color: txtPri }}>
            <SkipBack size={24} fill="currentColor" />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-transform"
            style={{ background: txtPri, color: textIsDark ? 'white' : 'black' }}
          >
            {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-0.5" />}
          </button>
          <button onClick={() => nextTrack()} aria-label="Next" className="w-12 h-12 flex items-center justify-center" style={{ color: txtPri }}>
            <SkipFwd size={24} fill="currentColor" />
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}

// ─── lyrics display settings ─────────────────────────────────────────────────

const LYRICS_TEXT_SIZES: { label: string; value: number }[] = [
  { label: 'Small', value: 0.85 },
  { label: 'Default', value: 1 },
  { label: 'Large', value: 1.2 },
  { label: 'Huge', value: 1.4 },
]

const LYRICS_ACTIVE_PRESETS = ['#ffffff', '#1db954', '#a78bfa', '#60a5fa', '#f472b6', '#facc15']
const LYRICS_INACTIVE_PRESETS = ['#9ca3af', '#6b7280', '#94a3b8', '#c4b5fd', '#7dd3fc', '#fda4af']

// One row of color swatches - "Auto" (null) defers to the surface's own
// text colors, otherwise a preset or a custom pick via the native color input.
function LyricColorRow({ label, presets, value, fallback, onChange }: {
  label: string
  presets: string[]
  value: string | null
  fallback: string
  onChange: (color: string | null) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-text-muted text-xs w-full">{label}</span>
      <button
        onClick={() => onChange(null)}
        className={`h-8 px-2.5 rounded-lg text-[11px] font-semibold border transition-colors ${
          value === null
            ? 'bg-accent/15 text-accent border-[var(--accent)]'
            : 'text-text-muted border-[var(--border)] active:bg-[var(--surface-raised)]'
        }`}
      >
        Auto
      </button>
      {presets.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className="w-8 h-8 rounded-full border border-[var(--border)] shrink-0"
          style={{ backgroundColor: c, outline: value?.toLowerCase() === c ? `2px solid ${c}` : 'none', outlineOffset: '2px' }}
          title={c}
        />
      ))}
      <input
        type="color"
        value={value ?? fallback}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded-full border border-[var(--border)] shrink-0 bg-transparent p-0"
      />
    </div>
  )
}

/** The lyric-display controls (text size, alignment, blur, colors, sync
 *  offset) shown right in the full lyrics screen - this used to mean leaving
 *  the song to dig through Settings just to nudge the text size, which is
 *  exactly the wrong moment to lose the lyrics view. */
function LyricsSettingsSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const {
    lyricsScale, setLyricsScale,
    lyricsAlign, setLyricsAlign,
    lyricsBlur, setLyricsBlur,
    lyricsBlurAmount, setLyricsBlurAmount,
    lyricsColorActive, setLyricsColorActive,
    lyricsColorInactive, setLyricsColorInactive,
    lyricsOffset, setLyricsOffset,
  } = useStorePick(
    'lyricsScale', 'setLyricsScale', 'lyricsAlign', 'setLyricsAlign',
    'lyricsBlur', 'setLyricsBlur', 'lyricsBlurAmount', 'setLyricsBlurAmount',
    'lyricsColorActive', 'setLyricsColorActive', 'lyricsColorInactive', 'setLyricsColorInactive',
    'lyricsOffset', 'setLyricsOffset',
  )

  return (
    <Sheet onClose={onClose} title="Lyrics display">
      <div className="px-5 pb-2 flex flex-col gap-5">
        <div>
          <p className="text-text-secondary text-xs mb-2">Text size</p>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--surface-highest)]">
            {LYRICS_TEXT_SIZES.map(({ label, value }) => {
              const active = lyricsScale === value
              return (
                <button
                  key={value}
                  onClick={() => setLyricsScale(value)}
                  aria-pressed={active}
                  className={`flex-1 min-w-0 h-9 rounded-lg text-[13px] font-medium transition-colors ${
                    active ? 'bg-accent text-white' : 'text-text-secondary active:bg-[var(--surface-overlay)]'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <p className="text-text-secondary text-xs mb-2">Alignment</p>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--surface-highest)]">
            {[
              { value: 'left' as const, label: 'Left', icon: AlignLeft },
              { value: 'center' as const, label: 'Center', icon: AlignCenter },
            ].map(({ value, label, icon: Icon }) => {
              const active = lyricsAlign === value
              return (
                <button
                  key={value}
                  onClick={() => setLyricsAlign(value)}
                  aria-pressed={active}
                  className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] font-medium transition-colors ${
                    active ? 'bg-accent text-white' : 'text-text-secondary active:bg-[var(--surface-overlay)]'
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-text-primary text-sm">Blur inactive lines</p>
            <button
              onClick={() => setLyricsBlur(!lyricsBlur)}
              aria-pressed={lyricsBlur}
              className={`flex items-center shrink-0 w-11 h-6 p-0.5 rounded-full transition-colors ${
                lyricsBlur ? 'bg-accent justify-end' : 'bg-[var(--surface-highest)] justify-start'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white" />
            </button>
          </div>
          {lyricsBlur && (
            <div className="flex items-center gap-2 mt-2">
              <input
                type="range" min={0.25} max={4} step={0.25}
                value={lyricsBlurAmount}
                onChange={(e) => setLyricsBlurAmount(parseFloat(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="text-text-muted text-xs tabular-nums w-8 text-right">{lyricsBlurAmount}×</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-text-secondary text-xs -mb-1">Colors</p>
          <LyricColorRow
            label="Current line"
            presets={LYRICS_ACTIVE_PRESETS}
            value={lyricsColorActive}
            fallback="#ffffff"
            onChange={setLyricsColorActive}
          />
          <LyricColorRow
            label="Other lines"
            presets={LYRICS_INACTIVE_PRESETS}
            value={lyricsColorInactive}
            fallback="#9ca3af"
            onChange={setLyricsColorInactive}
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-text-primary text-sm">Sync offset</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLyricsOffset(Math.round((lyricsOffset - 0.1) * 10) / 10)}
              className="w-8 h-8 rounded-full bg-[var(--surface-highest)] text-text-primary text-base font-medium active:bg-[var(--surface-overlay)]"
            >−</button>
            <span className="text-text-primary text-sm tabular-nums w-14 text-center">
              {lyricsOffset > 0 ? '+' : ''}{lyricsOffset.toFixed(1)}s
            </span>
            <button
              onClick={() => setLyricsOffset(Math.round((lyricsOffset + 0.1) * 10) / 10)}
              className="w-8 h-8 rounded-full bg-[var(--surface-highest)] text-text-primary text-base font-medium active:bg-[var(--surface-overlay)]"
            >+</button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

interface LyricsPanelProps {
  rawLyrics: string | null
  isSynced: boolean
  syncedLines: SyncedLyricLine[]
  padded?: boolean
  radioFmActive: boolean
  currentTrack: Track | null
  isEditor: boolean | null | undefined
  txtPri: string; txtSec: string; txtTer: string; txtFaint: string
}

// Tracks which synced line is current, against the LIVE audio.currentTime via
// requestAnimationFrame rather than the Zustand-stored value (which only
// updates on the native 'timeupdate' event, ~4x/sec - that throttling is what
// made the active line snap every ~250ms instead of transitioning smoothly).
// Shared by the full lyrics screen and the mini line under the cover art, so
// both agree on exactly which line is "now" without a second rAF loop.
function useActiveSyncedLine(isSynced: boolean, syncedLines: SyncedLyricLine[]): number {
  const lyricsOffset = useStore(s => s.lyricsOffset)
  // Lazily computed from the live audio position (not just -1) so a remount
  // doesn't momentarily render with no active line before the next rAf tick
  // corrects it - for the lyrics screen that was a visible "jump to the top,
  // then glide back down" flash.
  const [idx, setIdx] = useState(() =>
    isSynced && syncedLines.length > 0
      ? getCurrentLineIndex(syncedLines, getAudioCurrentTime() - lyricsOffset)
      : -1
  )
  const idxRef = useRef(idx)

  useEffect(() => {
    if (!isSynced || syncedLines.length === 0) {
      setIdx(-1)
      idxRef.current = -1
      return
    }
    let raf = 0
    const tick = (): void => {
      const i = getCurrentLineIndex(syncedLines, getAudioCurrentTime() - lyricsOffset)
      if (i !== idxRef.current) {
        idxRef.current = i
        setIdx(i)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isSynced, syncedLines, lyricsOffset])

  return idx
}

/** The Spotify-style snippet under the cover art: just the current synced
 *  line, tap to open the full lyrics screen. Self-contained (own rAF via
 *  useActiveSyncedLine) so the per-line tick doesn't re-render the rest of
 *  the page. Renders nothing during an instrumental gap or when there's no
 *  synced lyrics at all - unsynced plain-text lyrics have no "current line"
 *  concept to show here. */
const MiniLyricLine = memo(function MiniLyricLine({
  rawLyrics, isSynced, syncedLines, onOpen, txtSec,
}: {
  rawLyrics: string | null
  isSynced: boolean
  syncedLines: SyncedLyricLine[]
  onOpen: () => void
  txtSec: string
}): JSX.Element | null {
  const currentLineIdx = useActiveSyncedLine(isSynced, syncedLines)
  if (!rawLyrics || !isSynced || syncedLines.length === 0) return null
  const text = currentLineIdx >= 0 ? syncedLines[currentLineIdx].text?.trim() : ''
  if (!text) return null
  return (
    <button
      onClick={onOpen}
      aria-label="Open lyrics"
      className="max-w-full px-4 active:opacity-60 transition-opacity"
    >
      {/* Keying on the line index restarts the fade-in each time the active
          line changes, reading as a soft crossfade rather than a hard swap. */}
      <p key={currentLineIdx} className="text-[15px] font-semibold text-center truncate animate-lyric-line-in" style={{ color: txtSec }}>
        {text}
      </p>
    </button>
  )
})

const LyricsPanel = memo(function LyricsPanel({
  rawLyrics, isSynced, syncedLines, padded,
  radioFmActive, currentTrack, isEditor,
  txtPri, txtSec, txtTer,
}: LyricsPanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const linesRef    = useRef<HTMLDivElement>(null)
  const activeRef   = useRef<HTMLDivElement>(null)
  const { lyricsScale, lyricsAlign, lyricsBlur, lyricsBlurAmount, lyricsColorActive, lyricsColorInactive } = useStorePick(
    'lyricsScale', 'lyricsAlign', 'lyricsBlur', 'lyricsBlurAmount', 'lyricsColorActive', 'lyricsColorInactive')

  const currentLineIdx = useActiveSyncedLine(isSynced, syncedLines)

  // Center the active line by translating the whole lyric column rather than
  // using native `scrollIntoView({behavior:'smooth'})`. Native smooth-scroll
  // steps in discrete chunks and visibly fights the active line's font-size
  // reflow, which read as a choppy, low-fps animation. A GPU-composited
  // transform with a CSS transition glides at the display's full refresh rate.
  const [translateY, setTranslateY] = useState(0)
  const [vpHalf, setVpHalf] = useState(0)

  // Manual-scroll override - the lyric column isn't a native scroll container
  // (its position is driven by a `transform`, not `scrollTop`), so a plain
  // touch drag would otherwise do nothing. When the user scrolls manually we
  // take over `translateY` here and stop auto-centering the active line until
  // they opt back in via the "Resume" button.
  const [autoFollow, setAutoFollow] = useState(true)
  const [manualTranslateY, setManualTranslateY] = useState(0)
  const dragRef = useRef<{ startY: number; startTranslate: number } | null>(null)

  const clampTranslate = (v: number): number => {
    const vp = viewportRef.current
    const lines = linesRef.current
    if (!vp || !lines) return Math.max(v, 0)
    const max = Math.max(0, lines.scrollHeight - vp.clientHeight)
    return Math.min(Math.max(v, 0), max)
  }

  // Press-and-hold the lyrics to download the .lrc - the touch equivalent of
  // desktop's right-click menu. Only offered for synced lyrics, since plain
  // text has no timestamps worth exporting. Cancelled by any real scroll drag
  // so it doesn't fire mid-swipe, and it swallows the click that would
  // otherwise land on release and seek to whatever line was under the thumb.
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const clearLongPressTimer = (): void => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleTouchStart = (e: React.TouchEvent): void => {
    if (!isSynced || syncedLines.length === 0) return
    dragRef.current = { startY: e.touches[0].clientY, startTranslate: autoFollow ? translateY : manualTranslateY }
    longPressFiredRef.current = false
    if (rawLyrics) {
      longPressTimerRef.current = window.setTimeout(() => {
        longPressFiredRef.current = true
        navigator.vibrate?.(10)
        downloadSyncedLyrics(currentTrack?.title ?? 'lyrics', currentTrack?.artist ?? '', rawLyrics)
      }, 550)
    }
  }

  const handleTouchMove = (e: React.TouchEvent): void => {
    if (!dragRef.current) return
    const dy = dragRef.current.startY - e.touches[0].clientY
    if (Math.abs(dy) > 10) clearLongPressTimer()
    setManualTranslateY(clampTranslate(dragRef.current.startTranslate + dy))
    if (autoFollow) setAutoFollow(false)
  }

  const handleTouchEnd = (): void => { dragRef.current = null; clearLongPressTimer() }

  useLayoutEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const measure = (): void => setVpHalf(vp.clientHeight / 2)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [isSynced, syncedLines.length])

  useLayoutEffect(() => {
    if (currentLineIdx < 0) { setTranslateY(0); return }
    const active = activeRef.current
    if (!active) return
    // offsetTop is relative to linesRef (position: relative), unaffected by the
    // transform - so this stays correct mid-animation. lyricsScale is a dep
    // because changing the text size reflows every line's offsetTop.
    setTranslateY(active.offsetTop + active.offsetHeight / 2 - vpHalf)
  }, [currentLineIdx, vpHalf, lyricsScale])

  if (!rawLyrics) {
    return (
      <div className="relative flex-1 flex flex-col items-center justify-center gap-3 px-8">
        {!radioFmActive && !currentTrack
          ? <p className="text-sm text-center" style={{ color: txtTer }}>No track playing</p>
          : radioFmActive
            ? <p className="text-sm text-center" style={{ color: txtTer }}>No lyrics found for this track</p>
            : <>
                <div className="text-5xl opacity-10">♪</div>
                <p className="text-sm text-center" style={{ color: txtTer }}>No lyrics available</p>
                {isEditor && <p className="text-xs text-center" style={{ color: txtTer }}>Open the editor to add lyrics</p>}
              </>
        }
      </div>
    )
  }

  if (isSynced && syncedLines.length > 0) {
    // Edge fade is done with a mask on the lines themselves, not an opaque
    // overlay - painting flat bands on top added darkness confined to this
    // panel's box, creating a visible "aura" rectangle. A mask fades the text
    // to transparent, letting the page's own background show through.
    const edgeMask = 'linear-gradient(to bottom, transparent, black 80px, black calc(100% - 80px), transparent)'
    const displayTranslateY = autoFollow ? translateY : manualTranslateY
    return (
      <div
        ref={viewportRef}
        className="relative flex-1 min-h-0 overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mask lives on this static wrapper, not the translating element
            below - a mask-image sharing a compositing layer with an animated
            transform can show a thin colour-fringed seam at the mask's edge
            during GPU compositing (visible here as a faint stray line while
            the lines were sliding). Keeping the mask on a layer that never
            moves avoids that. */}
        <div className="relative w-full h-full" style={{ WebkitMaskImage: edgeMask, maskImage: edgeMask }}>
        <div
          ref={linesRef}
          className={`relative flex flex-col ${padded ? 'gap-5 px-7' : 'gap-4 px-5'}`}
          style={{
            transform: `translateY(${-displayTranslateY}px)`,
            transition: autoFollow ? 'transform 0.6s cubic-bezier(0.22,1,0.36,1)' : 'none',
            willChange: 'transform',
          }}
        >
          {/* Half-viewport spacers so the first and last lines can sit at center. */}
          <div style={{ height: vpHalf }} />
          {syncedLines.map((line, i) => {
            if (!line.text) return <div key={i} className="h-3" />
            const isActive = i === currentLineIdx
            const isPast   = i < currentLineIdx
            const dist     = Math.abs(i - currentLineIdx)
            // The active line grows via `transform: scale()`, not a literal
            // font-size change. font-size is a layout property - animating it
            // keeps reflowing this line's box (and shifting every line below
            // it) for the whole 0.4s, which raced the translateY centering
            // calculation above: that math runs once off the pre-growth
            // offsetTop/offsetHeight, so the line kept growing for a few more
            // frames after the scroll settled, reading as a sudden late pop.
            // A transform never affects layout/offsetHeight, so the centering
            // stays correct for the whole transition with no second jump.
            const baseFontSize = `${(padded ? 1.4 : 1.15) * lyricsScale}rem`
            const scale = isActive ? (padded ? 1.25 : 1.217) : 1
            return (
              <div
                key={i}
                ref={isActive ? activeRef : undefined}
                onClick={() => { if (longPressFiredRef.current) return; seekAudio(line.time) }}
                className={`select-none ${lyricsAlign === 'center' ? 'origin-center mx-auto text-center' : 'origin-left'}`}
                style={{
                  // scale() is purely visual and doesn't reflow layout, so a
                  // line already near the container's full width would have
                  // its right edge pushed past the viewport once scaled up,
                  // and get clipped by this panel's overflow-hidden. Capping
                  // each line's own width leaves enough headroom that even the
                  // largest growth still fits.
                  maxWidth:   padded ? '84%' : '82%',
                  fontFamily: 'var(--font-lyrics)',
                  fontSize:   baseFontSize,
                  // Bold weight is the active line's style only - not
                  // animated. Most fonts here aren't variable fonts, so
                  // `font-weight` can't interpolate between steps like
                  // 400→800; the browser snaps partway through the
                  // transition, reading as the text suddenly going bold once
                  // the (truly smooth) scale/opacity/colour animation appears
                  // to settle.
                  fontWeight: isActive ? 800 : 500,
                  lineHeight: 1.25,
                  color:      isActive ? (lyricsColorActive ?? txtPri) : (lyricsColorInactive ?? txtSec),
                  opacity:    isActive ? 1 : dist === 1 ? 0.55 : dist === 2 ? 0.35 : 0.2,
                  filter:     (!isActive && !isPast && dist >= 2 && lyricsBlur) ? `blur(${(0.6 * lyricsBlurAmount).toFixed(2)}px)` : 'none',
                  transform:  `scale(${scale})`,
                  transition: 'opacity 0.4s cubic-bezier(0.4,0,0.2,1), color 0.4s cubic-bezier(0.4,0,0.2,1), transform 0.4s cubic-bezier(0.4,0,0.2,1), filter 0.4s cubic-bezier(0.4,0,0.2,1)',
                  textShadow: isActive ? '0 0 30px rgba(255,255,255,0.12)' : 'none',
                }}
              >
                {splitAdLibs(line.text).map((seg, si) => (
                  <span key={si} style={seg.adLib ? { opacity: ADLIB_OPACITY } : undefined}>
                    {splitColorWords(seg.text).map((cseg, ci) => (
                      cseg.color
                        ? <span key={ci} style={{ color: cseg.color }}>{cseg.text}</span>
                        : cseg.text
                    ))}
                  </span>
                ))}
              </div>
            )
          })}
          <div style={{ height: vpHalf }} />
        </div>
        </div>

        {!autoFollow && (
          <button
            onClick={() => setAutoFollow(true)}
            className="absolute left-1/2 -translate-x-1/2 bottom-4 z-10 flex items-center gap-1.5 px-4 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white/85 text-[13px] font-medium"
          >
            <ChevronDown size={14} />
            Resume
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`relative flex-1 min-h-0 overflow-y-auto ${padded ? 'py-8 px-7' : 'py-4 px-5'}`} style={{ scrollbarWidth: 'none' }}>
      <pre
        className="text-sm leading-7 whitespace-pre-wrap"
        style={{
          color: lyricsColorInactive ?? txtSec,
          fontFamily: 'var(--font-lyrics)',
          textAlign: lyricsAlign,
          // Only override the base size when the user actually changed it;
          // unitless line-height keeps spacing proportional.
          ...(lyricsScale !== 1 ? { fontSize: `${0.875 * lyricsScale}rem`, lineHeight: 1.9 } : {}),
        }}
      >{splitAdLibs(rawLyrics).map((seg, si) => (
        <span key={si} style={seg.adLib ? { opacity: ADLIB_OPACITY } : undefined}>{seg.text}</span>
      ))}</pre>
    </div>
  )
})
