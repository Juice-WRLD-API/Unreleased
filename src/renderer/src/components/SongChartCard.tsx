import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Clapperboard, Copy, Heart, ListEnd, Music2, Play, Shuffle } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { listEras, eraLabel } from '../lib/eras'
import { chartRangePhrase, rankMovement, type ChartRange, type ChartSong, type ChartSort } from '../lib/songChartsApi'
import { statsSongToTrack, type StatsSong } from '../lib/statsCatalog'
import { CategoryBadge, eraSwatch } from '../lib/statisticsShared'
import { useSongChart } from '../hooks/useSongChart'
import { useContentMotion } from '../hooks/useContentMotion'
import { showAppToast } from '../lib/appToast'
import type { JWApiPlaysStats } from '../lib/juicewrldApi'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import ThemedSelect from './ThemedSelect'

// "Most played songs" on the Statistics tab: a chart for a time range (or by
// likes), filterable by era, with rank movement against the previous window
// and plays / minutes / listeners per song. Data: hooks/useSongChart.

const COLLAPSED_ROWS = 25

type Tab = { key: string; label: string; range: ChartRange; sort: ChartSort }
const TABS: Tab[] = [
  { key: '7d', label: 'Last 7 days', range: '7d', sort: 'plays' },
  { key: '30d', label: 'Last 30 days', range: '30d', sort: 'plays' },
  { key: 'all', label: 'All time', range: 'all', sort: 'plays' },
  { key: 'likes', label: 'Most liked', range: 'all', sort: 'likes' },
]

type Metric = { key: 'plays' | 'minutes' | 'listeners' | 'likes'; label: string }

const fmt = (n: number): string => n.toLocaleString()

function Movement({ value }: { value: number | 'new' | null }): JSX.Element | null {
  if (value === null) return null
  if (value === 'new') return <span className="text-[9px] font-bold tracking-wide text-accent">NEW</span>
  if (value === 0) return <span className="text-[11px] text-text-muted leading-none">–</span>
  const up = value > 0
  return (
    <span className={`flex items-center gap-0.5 text-[11px] tabular-nums leading-none ${up ? 'text-emerald-400' : 'text-rose-400'}`} title={`${up ? 'Up' : 'Down'} ${Math.abs(value)} since the previous period`}>
      {up ? <ArrowUp size={10} /> : <ArrowDown size={10} />}{Math.abs(value)}
    </span>
  )
}

function Chip({ children, title, onClick }: { children: React.ReactNode; title?: string; onClick?: () => void }): JSX.Element {
  const cls = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border border-[var(--border)] bg-surface-raised text-text-secondary shrink-0'
  return onClick
    ? <button type="button" title={title} onClick={(e) => { e.stopPropagation(); onClick() }} className={`${cls} hover:text-text-primary hover:border-accent transition-colors`}>{children}</button>
    : <span title={title} className={cls}>{children}</span>
}

function ChartRow({ song, full, metrics, barMetric, max, movement, onPlay, onContextMenu, onOpenEra }: {
  song: ChartSong
  full?: StatsSong
  metrics: Metric[]
  barMetric: Metric['key']
  max: number
  movement: number | 'new' | null
  onPlay: (song: ChartSong) => void
  onContextMenu: (id: number, cover: StatsSong | undefined, e: React.MouseEvent) => void
  onOpenEra: (era: string) => void
}): JSX.Element {
  const playable = full ? !!full.path : song.has_audio
  const producers = song.producers.replace(/\s+/g, ' ').trim()
  return (
    <div
      onClick={playable ? () => onPlay(song) : undefined}
      onContextMenu={(e) => onContextMenu(song.id, full, e)}
      className={`group grid grid-cols-[2.75rem_minmax(0,1fr)_auto] lg:grid-cols-[2.75rem_minmax(0,1fr)_9rem_auto] items-center gap-3 px-3 py-2 rounded-lg transition-colors ${playable ? 'cursor-pointer hover:bg-surface-raised' : 'opacity-55'}`}
      title={playable ? undefined : 'No audio for this song'}
    >
      <div className="flex flex-col items-center gap-1">
        <span className="text-text-primary text-base font-semibold tabular-nums leading-none">{song.rank}</span>
        <Movement value={movement} />
      </div>

      <div className="flex items-center gap-3 min-w-0">
        <span className="relative w-10 h-10 rounded-md overflow-hidden bg-surface-raised flex items-center justify-center shrink-0">
          {full
            ? <AlbumArtThumbnail track={statsSongToTrack(full)} size={40} className="rounded-md" />
            : <Music2 size={15} className="text-text-muted" />}
          {playable && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity">
              <Play size={15} className="text-white" fill="currentColor" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-text-primary text-sm font-medium truncate" title={song.name}>{song.name}</p>
          <div className="flex items-center gap-1.5 mt-1 min-w-0 overflow-hidden">
            <CategoryBadge category={song.category} />
            {song.era_name && (
              <Chip title={`${eraLabel(song.era_name, true)} - open in Tracker`} onClick={() => onOpenEra(song.era_name)}>
                <span className="w-2 h-2 rounded-full ring-1 ring-white/25" style={{ backgroundColor: eraSwatch(song.era_name) }} />
                {song.era_name}
              </Chip>
            )}
            {song.snippet_count > 0 && (
              <Chip><Clapperboard size={10} />{song.snippet_count} {song.snippet_count === 1 ? 'snippet' : 'snippets'}</Chip>
            )}
            {song.version_count > 0 && (
              <Chip><Copy size={10} />{song.version_count + 1} versions</Chip>
            )}
            {producers && <span className="text-text-muted text-[11px] truncate min-w-0" title={`Produced by ${producers}`}>prod. {producers}</span>}
          </div>
        </div>
      </div>

      <div className="hidden lg:block h-1.5 rounded-full bg-surface-raised overflow-hidden">
        <div
          className="h-full rounded-full bg-text-muted group-hover:bg-accent transition-colors"
          style={{ width: `${max > 0 ? Math.max(2, (song[barMetric] / max) * 100) : 0}%` }}
        />
      </div>

      <div className="flex items-center">
        {metrics.map((m, i) => (
          <span
            key={m.key}
            className={`w-16 md:w-20 text-right tabular-nums text-sm ${i === 0 ? 'text-text-primary font-medium' : 'hidden md:block text-text-muted'}`}
          >{fmt(song[m.key])}</span>
        ))}
      </div>
    </div>
  )
}

export default function SongChartCard({ playStats, onOpenEra, onContextMenu }: {
  playStats: JWApiPlaysStats | null
  onOpenEra: (era: string) => void
  onContextMenu: (id: number, cover: StatsSong | undefined, e: React.MouseEvent) => void
}): JSX.Element | null {
  const { playTrack, shufflePlay, addToQueue } = useStorePick('playTrack', 'shufflePlay', 'addToQueue')
  const { range, setRange, sort, setSort, era, setEra, chart, songs, tracks, legacy, loading, refreshing } = useSongChart(playStats)
  const [expanded, setExpanded] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  useContentMotion(listRef, `${range}|${sort}|${era}`, !refreshing && !loading)

  const activeTab = TABS.find((t) => t.range === range && t.sort === sort)?.key ?? '7d'
  const tabs = legacy ? TABS.filter((t) => t.key === 'all') : TABS

  const metrics: Metric[] = sort === 'likes'
    ? [{ key: 'likes', label: 'Likes' }, { key: 'plays', label: 'Plays' }, { key: 'listeners', label: 'Listeners' }]
    : legacy
      ? [{ key: 'plays', label: 'Plays' }, { key: 'minutes', label: 'Minutes' }]
      : [{ key: 'plays', label: 'Plays' }, { key: 'minutes', label: 'Minutes' }, { key: 'listeners', label: 'Listeners' }]
  const barMetric = metrics[0].key
  const rows = chart?.songs ?? []
  const max = rows.reduce((m, s) => Math.max(m, s[barMetric]), 0)
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)

  const eraOptions = useMemo(
    () => [{ value: '', label: 'All eras' }, ...listEras().map((e) => ({ value: e.name, label: eraLabel(e.name, true) }))],
    // listEras fills in as eras load; a new chart is a fine moment to re-read it.
    [chart],
  )

  const playFrom = (song: ChartSong): void => {
    const full = songs.get(song.id)
    if (!full?.path) return
    const track = statsSongToTrack(full)
    playTrack(tracks.find((t) => t.id === track.id) ?? track, tracks)
  }

  if (!loading && !chart) return null
  const totals = chart?.totals
  const eraPhrase = era ? ` from ${eraLabel(era, true)}` : ''

  return (
    <section className="rounded-xl border border-[var(--border)] bg-surface-overlay/40">
      <div className="flex items-center gap-3 flex-wrap px-4 pt-3 pb-2 border-b border-[var(--border)]">
        <h2 className="sr-only">Most played songs</h2>
        <div role="tablist" className="flex items-center flex-wrap gap-1 flex-1 min-w-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              onClick={() => { setRange(t.range); setSort(t.sort); setExpanded(false) }}
              className={`relative px-2.5 py-2 text-sm whitespace-nowrap transition-colors ${activeTab === t.key ? 'text-text-primary font-medium' : 'text-text-muted hover:text-text-primary'}`}
            >
              {t.label}
              {activeTab === t.key && <span className="absolute left-2.5 right-2.5 -bottom-[9px] h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </div>
        {totals && sort === 'plays' && (
          <p
            className="hidden xl:block text-xs text-text-muted tabular-nums whitespace-nowrap"
            title={`${fmt(totals.plays)} plays and ${fmt(totals.minutes)} minutes${legacy ? '' : ` by ${fmt(totals.listeners)} listeners`} across ${fmt(totals.songs)} songs${eraPhrase} ${legacy ? 'in the top 50 of all time' : chartRangePhrase(range)}`}
          >
            <b className="text-text-primary font-medium">{fmt(totals.plays)}</b> plays · <b className="text-text-primary font-medium">{fmt(totals.minutes)}</b> min
            {!legacy && <> · <b className="text-text-primary font-medium">{fmt(totals.listeners)}</b> listeners</>}
            {' '}· <b className="text-text-primary font-medium">{fmt(totals.songs)}</b> songs
          </p>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <ThemedSelect
            value={era}
            onChange={(v) => { setEra(v); setExpanded(false) }}
            options={eraOptions}
            title="Filter by era"
            className="w-40 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-surface-raised text-sm text-text-primary"
          />
          <button
            onClick={() => tracks.length && playTrack(tracks[0], tracks)}
            disabled={tracks.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          ><Play size={13} fill="currentColor" /> Play</button>
          <button
            onClick={() => void shufflePlay(tracks)}
            disabled={tracks.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-raised text-text-primary text-sm font-medium hover:bg-surface-raised disabled:opacity-50 transition-colors"
          ><Shuffle size={13} /> Shuffle</button>
          <button
            onClick={() => { tracks.forEach((t) => addToQueue(t)); showAppToast(`Added ${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'} to the queue`) }}
            disabled={tracks.length === 0}
            aria-label="Add all to queue"
            title="Add all to queue"
            className="p-2 rounded-lg bg-surface-raised text-text-primary hover:bg-surface-raised disabled:opacity-50 transition-colors"
          ><ListEnd size={15} /></button>
        </div>
      </div>

      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] lg:grid-cols-[2.75rem_minmax(0,1fr)_9rem_auto] items-center gap-3 mx-2 px-3 py-2 border-b border-[var(--border)] text-[11px] font-medium text-text-muted">
        <span className="text-center">#</span>
        <span>Song</span>
        <span className="hidden lg:block" />
        <div className="flex items-center">
          {metrics.map((m, i) => (
            <span key={m.key} className={`w-16 md:w-20 text-right ${i === 0 ? '' : 'hidden md:block'}`}>
              {m.key === 'likes' ? <span className="inline-flex items-center gap-1"><Heart size={10} />{m.label}</span> : m.label}
            </span>
          ))}
        </div>
      </div>

      <div ref={listRef} className={`px-2 pb-2 pt-1 transition-opacity duration-300 ${refreshing ? 'opacity-60' : ''}`}>
        {loading ? (
          Array.from({ length: 8 }, (_, i) => <div key={i} className="h-14 my-0.5 rounded-lg bg-surface-raised animate-pulse" />)
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-text-muted">
            {sort === 'likes' ? 'No liked songs' : 'No plays'}{eraPhrase}{sort === 'likes' ? '' : ` ${chartRangePhrase(range)}`}.
          </p>
        ) : (
          shown.map((song) => (
            <ChartRow
              key={song.id}
              song={song}
              full={songs.get(song.id)}
              metrics={metrics}
              barMetric={barMetric}
              max={max}
              movement={rankMovement(song, range, sort)}
              onPlay={playFrom}
              onContextMenu={onContextMenu}
              onOpenEra={onOpenEra}
            />
          ))
        )}
        {rows.length > COLLAPSED_ROWS && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full mt-1 py-2 rounded-lg text-xs font-medium text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors"
          >{expanded ? 'Show fewer' : `Show all ${rows.length}`}</button>
        )}
      </div>
    </section>
  )
}
