import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Heart, ListMusic, LocateFixed, Music2, Pause, Play, Repeat, Repeat1, Search, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import { useVirtualWindow } from '../hooks/useVirtualWindow'
import { runHotkeyAction } from '../lib/hotkeys'
import { buildImageUrl } from '../lib/juicewrldApi'
import type { Track } from '../types'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import './WrldCoverFlow.css'

function CoverFlowClock(): JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <div className="cover-flow-clock">
      <p>{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
      <time dateTime={now.toISOString()}>{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s*[AP]M$/i, '')}</time>
    </div>
  )
}

const ROW_HEIGHT = 58

/** A queue-backed layout preset. Browsing covers doesn't replace the queue;
 * playing a cover jumps to its exact slot, including duplicate tracks. */
export default function WrldCoverFlow({ progress, menu }: { progress: ReactNode; menu: ReactNode }): JSX.Element {
  const { queue, queueIndex, currentTrack, currentTrackFull, playHistory, isPlaying, shuffle, repeat, volume } = useStore(useShallow(s => ({
    queue: s.queue, queueIndex: s.queueIndex, currentTrack: s.currentTrack,
    currentTrackFull: s.currentTrackFull, playHistory: s.playHistory,
    isPlaying: s.isPlaying, shuffle: s.shuffle, repeat: s.repeat, volume: s.volume,
  })))
  const liked = useStore(s => !!s.currentTrack && s.likedTrackIds.includes(s.currentTrack.id))
  const tracks = useMemo(() => queue.length ? queue : currentTrack
    ? [currentTrack, ...playHistory.filter(t => t.id !== currentTrack.id)]
    : playHistory, [queue, currentTrack, playHistory])
  const currentIndex = queue.length ? queueIndex : currentTrack ? 0 : -1
  const [selected, setSelected] = useState(Math.max(0, currentIndex))
  const selectedIndex = Math.max(0, Math.min(selected, tracks.length - 1))
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setSelected(Math.max(0, currentIndex)) }, [currentTrack?.id, currentIndex, queue])
  useEffect(() => { if (searchOpen) searchRef.current?.focus() }, [searchOpen])

  const rows = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return tracks.map((track, index) => ({ track, index })).filter(({ track }) =>
      !term || `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(term))
  }, [tracks, query])
  const windowed = useVirtualWindow(scrollRef, rowsRef, rows.length, ROW_HEIGHT)
  useEffect(() => {
    const row = rows.findIndex(item => item.index === selectedIndex)
    const el = scrollRef.current
    if (!el || row < 0) return
    const top = row * ROW_HEIGHT
    if (top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - (el.clientHeight - ROW_HEIGHT) / 2)
    }
  }, [selectedIndex, rows])

  const withArt = (track: Track): Track => currentTrackFull?.id === track.id && currentTrackFull.albumArt
    ? { ...track, imageUrl: buildImageUrl(currentTrackFull.albumArt) ?? track.imageUrl }
    : track
  const playAt = (index: number): void => {
    const track = tracks[index]
    if (!track) return
    const s = useStore.getState()
    if (index === currentIndex && track.id === currentTrack?.id) runHotkeyAction('play-pause')
    else if (queue.length) s.jumpToTrack(track, index)
    else s.playFromHistory(track)
    setSelected(index)
  }
  const browse = (direction: number): void => setSelected(Math.max(0, Math.min(tracks.length - 1, selectedIndex + direction)))
  const selectedTrack = tracks[selectedIndex]
  const coverStart = Math.max(0, selectedIndex - 3)

  return (
    <section className="wrld-cover-flow" aria-label="Cover Flow player">
      <div className="cover-flow-layout">
        <aside className="cover-flow-queue" aria-label="Playback queue">
          <div className="cover-flow-queue-heading">
            <ListMusic size={21} aria-hidden="true" />
            <div><h2>Continue playing</h2><p>{tracks.length ? `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'} in your queue` : 'Your next listen starts here'}</p></div>
            <button className="cover-flow-icon" aria-label={searchOpen ? 'Close queue search' : 'Search queue'} title="Search queue" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); setQuery('') }}>
              {searchOpen ? <X size={16} /> : <Search size={16} />}
            </button>
          </div>
          {searchOpen && <input ref={searchRef} className="cover-flow-search" type="search" aria-label="Search queue" placeholder="Find a song…" value={query} onChange={e => { setQuery(e.target.value); if (scrollRef.current) scrollRef.current.scrollTop = 0 }} />}
          <div className="cover-flow-queue-scroll" ref={scrollRef}>
            <div ref={rowsRef} className="cover-flow-rows" style={{ height: windowed.totalHeight }}>
              {rows.slice(windowed.start, windowed.end).map(({ track, index }, i) => (
                <button key={`${track.id}-${index}`} className={`cover-flow-row ${index === currentIndex ? 'is-playing' : ''} ${index === selectedIndex ? 'is-selected' : ''}`}
                  style={{ top: (windowed.start + i) * ROW_HEIGHT, height: ROW_HEIGHT }}
                  aria-label={`${index === currentIndex && isPlaying ? 'Pause' : 'Play'} ${track.title}`}
                  aria-current={index === currentIndex ? 'true' : undefined} onClick={() => playAt(index)}>
                  <AlbumArtThumbnail track={withArt(track)} size={40} className="cover-flow-row-art" eager />
                  <span className="cover-flow-row-copy"><strong>{track.title}</strong><span>{track.artist || track.album || 'Unknown artist'}</span></span>
                  {index === currentIndex && isPlaying && <span className="cover-flow-playing-dot" aria-hidden="true" />}
                </button>
              ))}
            </div>
            {!rows.length && <p className="cover-flow-queue-empty">{query ? 'No matching songs' : 'Play a song from your library or a playlist to fill this space.'}</p>}
          </div>
        </aside>

        <main className="cover-flow-stage">
          <CoverFlowClock />
          <div className="cover-flow-carousel" data-cover-flow-carousel role="region" aria-label="Album covers. Use left and right arrows to browse." tabIndex={0}
            onKeyDown={e => {
              if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); browse(e.key === 'ArrowLeft' ? -1 : 1) }
              else if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); playAt(selectedIndex) }
            }}>
            {selectedTrack ? tracks.slice(coverStart, selectedIndex + 4).map((track, i) => {
              const index = coverStart + i
              const offset = index - selectedIndex
              const distance = Math.abs(offset)
              return (
                <button key={`${track.id}-${index}`} className={`cover-flow-card ${offset === 0 ? 'is-front' : ''}`}
                  style={{ '--offset': offset, '--distance': distance, '--angle': `${offset === 0 ? 0 : offset < 0 ? 28 : -28}deg`, zIndex: 10 - distance } as CSSProperties}
                  onClick={() => offset === 0 ? playAt(index) : setSelected(index)}
                  aria-label={`${offset === 0 ? index === currentIndex && isPlaying ? 'Pause' : 'Play' : 'Show'} ${track.title} by ${track.artist || 'Unknown artist'}`}
                  aria-current={index === currentIndex ? 'true' : undefined} tabIndex={offset === 0 ? 0 : -1}>
                  <div className="cover-flow-card-art"><AlbumArtThumbnail track={withArt(track)} fill res={512} className="w-full h-full" eager /></div>
                  <div className="cover-flow-card-copy"><strong title={track.title}>{track.title}</strong><span>{track.artist || track.album || 'Unknown artist'}</span></div>
                </button>
              )
            }) : (
              <div className="cover-flow-empty"><Music2 size={42} strokeWidth={1} /><h2>A little space for your music.</h2><p>Choose a song to start your cover collection.</p><button onClick={() => useStore.getState().setActiveView('api-tracker')}>Browse songs</button></div>
            )}
          </div>

          <div className="cover-flow-browse" aria-label="Browse covers">
            <span aria-live="polite">{tracks.length > 0 && `${selectedIndex + 1} / ${tracks.length}`}</span>
            <button className="cover-flow-icon" onClick={() => browse(-1)} disabled={selectedIndex === 0} title="Previous cover" aria-label="Previous cover"><ChevronLeft size={18} /></button>
            <button className="cover-flow-icon" onClick={() => setSelected(Math.max(0, currentIndex))} disabled={!currentTrack} title="Show now playing" aria-label="Show now playing"><LocateFixed size={17} /></button>
            <button className="cover-flow-icon" onClick={() => browse(1)} disabled={selectedIndex >= tracks.length - 1} title="Next cover" aria-label="Next cover"><ChevronRight size={18} /></button>
          </div>

          <div className="cover-flow-dock" aria-label="Playback controls">
            <div className="cover-flow-transport">
              <button className="cover-flow-icon cover-flow-secondary" disabled={!currentTrack} aria-label="Shuffle" aria-pressed={shuffle} title="Shuffle" onClick={() => runHotkeyAction('shuffle')}><Shuffle size={16} /></button>
              <button className="cover-flow-icon" disabled={!currentTrack} aria-label="Previous track" title="Previous track" onClick={() => runHotkeyAction('previous')}><SkipBack size={19} fill="currentColor" /></button>
              <button className="cover-flow-icon cover-flow-play" disabled={!currentTrack} aria-label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause' : 'Play'} onClick={() => runHotkeyAction('play-pause')}>{isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</button>
              <button className="cover-flow-icon" disabled={!currentTrack} aria-label="Next track" title="Next track" onClick={() => runHotkeyAction('next')}><SkipForward size={19} fill="currentColor" /></button>
              <button className="cover-flow-icon cover-flow-secondary" disabled={!currentTrack} aria-label={`Repeat: ${repeat}`} aria-pressed={repeat !== 'none'} title={`Repeat: ${repeat}`} onClick={() => runHotkeyAction('loop')}>{repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}</button>
            </div>
            <div className="cover-flow-now-playing">
              {currentTrack && <AlbumArtThumbnail track={withArt(currentTrack)} size={40} className="cover-flow-dock-art" eager />}
              <div className="cover-flow-track-details">
                <div className="cover-flow-row-copy"><strong>{currentTrack?.title || 'Nothing playing'}</strong><span>{currentTrack?.artist || 'Choose something you love'}</span></div>
                <div className="cover-flow-progress">{progress}</div>
              </div>
            </div>
            <div className="cover-flow-dock-actions">
              <button className="cover-flow-icon" disabled={!currentTrack} aria-label={liked ? 'Unlike song' : 'Like song'} aria-pressed={liked} title={liked ? 'Unlike song' : 'Like song'} onClick={() => runHotkeyAction('like')}><Heart size={17} fill={liked ? 'currentColor' : 'none'} /></button>
              {menu}
              <button className="cover-flow-icon" aria-label={volume === 0 ? 'Unmute' : 'Mute'} title={volume === 0 ? 'Unmute' : 'Mute'} onClick={() => runHotkeyAction('mute')}>{volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
              <input className="cover-flow-volume" type="range" min={0} max={1} step={0.01} value={volume} aria-label="Volume" onChange={e => useStore.getState().setVolume(Number(e.target.value))} />
            </div>
          </div>
        </main>
      </div>
    </section>
  )
}
