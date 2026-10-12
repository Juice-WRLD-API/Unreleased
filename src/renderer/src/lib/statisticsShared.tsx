import { Play, Radio, Music2, MoreVertical } from 'lucide-react'
import { CATEGORY_LABELS, CATEGORY_COLORS, type JWApiTopSong, type JWApiRecentPlay } from './juicewrldApi'
import { statsSongToTrack, type StatsSong } from './statsCatalog'
import { relativeTime } from '../components/adminShared'
import { AlbumArtThumbnail } from '../components/AlbumArtThumbnail'

// Presentational pieces shared by StatisticsView.desktop/.mobile - split out
// so the two layouts can't drift on how a row or a bar actually renders, only
// on how they're arranged on the page. See StatisticsView.tsx for the split
// rationale and hooks/useStatisticsData for the data these are fed from.

export const CATEGORY_ORDER: (keyof import('./juicewrldApi').JWApiStats['category_stats'])[] = [
  'released', 'unreleased', 'unsurfaced', 'recording_session',
]

// Both top_songs and recent_plays render their full data (up to 50 rows, the
// API's own cap) inside a fixed-height scroll area sized to ~15 rows - same
// visible count, same max-height, so the two sit at equal height side by side
// instead of one stopping short or growing to chase the other's content.
// Desktop-only: the mobile layout lets these lists run the length of the page
// instead, same as every other rail on the mobile Home screen.
export const LIST_MAX_HEIGHT_DESKTOP = 'max-h-[420px] md:max-h-[720px]'

// ─── Era timeline ───────────────────────────────────────────────────────────
// time_frame is free text, not two structured date fields, e.g.
// "October 17th 2018 - March 8th 2019", "October 2024 - Present", or just
// "2017 - December 22nd 2017". This parses it defensively: any era that
// fails to parse, has only a single date (no " - "), or is wrapped in "(...)"
// (a placeholder/duplicate entry, not a real dated era) is left off the
// timeline rather than crashing or distorting the scale. `now` also clamps a
// bad far-future end date (the live data has had at least one) so one bad
// row can't blow out the whole axis.
const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

interface ParsedDatePart { date: Date; exact: boolean }

// Accepts "Month Dayth[,] Year" (exact day), "Month Year" or bare "Year"
// (no day given - callers decide how to fill that in).
function parseDatePart(s: string): ParsedDatePart | null {
  const raw = s.trim()
  const full = raw.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)
  if (full) {
    const month = MONTHS[full[1].toLowerCase()]
    if (month === undefined) return null
    return { date: new Date(Number(full[3]), month, Number(full[2])), exact: true }
  }
  const monthYear = raw.match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (monthYear) {
    const month = MONTHS[monthYear[1].toLowerCase()]
    if (month === undefined) return null
    // No day given - assume the 1st of the month.
    return { date: new Date(Number(monthYear[2]), month, 1), exact: false }
  }
  const yearOnly = raw.match(/^(\d{4})$/)
  if (yearOnly) return { date: new Date(Number(yearOnly[1]), 0, 1), exact: false }
  return null
}

export function parseTimeFrame(timeFrame: string | undefined, now: Date): { start: Date; end: Date } | null {
  const raw = timeFrame?.trim()
  if (!raw) return null
  // Entirely parenthesized ("(March 2022-March 2022)") marks a placeholder/
  // duplicate entry, not a real dated era.
  if (/^\(.*\)$/.test(raw)) return null
  // Start and end are separated by " - ", though the live data isn't always
  // consistent about the spacing around the dash - split on the dash itself
  // and trim each side rather than requiring exact spacing.
  const dashIndex = raw.indexOf('-')
  if (dashIndex === -1) return null // single date, no range - not a span to plot
  const startRaw = raw.slice(0, dashIndex).trim()
  const endRaw = raw.slice(dashIndex + 1).trim()
  const startParsed = parseDatePart(startRaw)
  if (!startParsed) return null
  let end: Date
  if (endRaw.toLowerCase() === 'present') {
    end = now
  } else {
    const endParsed = parseDatePart(endRaw)
    if (!endParsed) return null
    // An end with no explicit day covers the whole month - push to its last
    // day so a single-month range still gets a sliver of width instead of
    // collapsing to zero. An exact end date is used as-is.
    end = endParsed.exact
      ? endParsed.date
      : new Date(endParsed.date.getFullYear(), endParsed.date.getMonth() + 1, 0)
  }
  const clampedEnd = end > now ? now : end
  return clampedEnd > startParsed.date ? { start: startParsed.date, end: clampedEnd } : null
}

export const monthYearLabel = (d: Date): string => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })

// Golden-angle hue steps give N well-spread, non-repeating colors without a
// hand-picked palette — needed here since the era count is open-ended (34
// today, whatever the API adds later).
const eraColorForIndex = (i: number): string => `hsl(${Math.round((i * 137.508) % 360)}, 62%, 52%)`

// Hand-picked colors for specific eras (keyed by the API's abbreviated
// `name`, matching TimelineRow.key), overriding the generated golden-angle
// hue above. Add entries here to recolor a particular era in the timeline.
const ERA_COLOR_OVERRIDES: Record<string, string> = {
  WOD: '#b2ff59',
  'GB&GR': '#0a92fa',
  POST: '#525252',
  DRFL: '#f07229',
  OUT: '#9122f2',
  ND: '#2e0101',
  bdm: '#171717',
  afflictions: '#000000',
  'HIH 999': '#ad0037',
  'jw 999': '#d93434',
}

const eraColor = (i: number, key: string): string => ERA_COLOR_OVERRIDES[key] ?? eraColorForIndex(i)

export interface TimelineRow { key: string; label: string; count: number; start: Date; end: Date }

export function EraTimeline({ rows, start, end, onSelect }: {
  rows: TimelineRow[]
  start: Date
  end: Date
  onSelect: (eraName: string) => void
}): JSX.Element {
  const totalCount = rows.reduce((sum, r) => sum + r.count, 1)
  return (
    <div>
      <div className="flex h-8 rounded-lg overflow-hidden">
        {rows.map((r, i) => {
          // Width is proportional to song count, not calendar duration - a
          // sparsely-covered era stays a sliver next to a heavily-covered
          // one even if it spanned years, and vice versa. That deliberately
          // gives up a linear time axis in exchange for showing where the
          // catalog actually is.
          const shareOfSpan = (r.count / totalCount) * 100
          return (
            <button
              key={r.key}
              onClick={() => onSelect(r.key)}
              // flexGrow proportional to song count (not a % width) so tiny
              // segments still get their minWidth floor without the row's
              // total overflowing past 100% — flexbox reflows the rest to
              // make room instead.
              className="h-full flex items-center justify-center overflow-hidden shrink-0 transition-[filter] hover:brightness-110"
              style={{ flexGrow: r.count, flexBasis: 0, minWidth: '6px', backgroundColor: eraColor(i, r.key) }}
              title={`${r.label} — ${monthYearLabel(r.start)} to ${monthYearLabel(r.end)} — ${r.count.toLocaleString()} songs — view in Tracker`}
            >
              {shareOfSpan > 3 && (
                <span className="text-[10px] font-semibold text-white truncate px-1" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                  {r.key}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-text-muted mt-1.5">
        <span>{monthYearLabel(start)}</span>
        <span>Present</span>
      </div>
    </div>
  )
}

export function CategoryCard({ label, songCount, catalogTotal, playCount, playsTotal, colorClass }: {
  label: string
  songCount: number
  catalogTotal: number
  playCount: number
  playsTotal: number
  colorClass: string
}): JSX.Element {
  const songPct = catalogTotal > 0 ? Math.round((songCount / catalogTotal) * 100) : 0
  const playPct = playsTotal > 0 ? Math.round((playCount / playsTotal) * 100) : 0
  return (
    <div className={`rounded-xl border px-3 sm:px-4 py-3.5 text-center min-w-0 overflow-hidden ${colorClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest opacity-80 mb-1.5 truncate">{label}</p>
      <div className="flex flex-col sm:flex-row sm:items-end justify-center gap-2 sm:gap-4">
        <div className="min-w-0">
          <p className="text-xl sm:text-2xl font-bold tabular-nums truncate">{songCount.toLocaleString()}</p>
          <p className="text-xs opacity-70 mt-0.5">{songPct}% of catalog</p>
        </div>
        <div className="min-w-0 pt-2 sm:pt-0 sm:pl-4 border-t sm:border-t-0 sm:border-l border-current/15">
          <p className="text-xl sm:text-2xl font-bold tabular-nums truncate">{playCount.toLocaleString()}</p>
          <p className="text-xs opacity-70 mt-0.5">{playPct}% of plays</p>
        </div>
      </div>
    </div>
  )
}

export function Bar({ label, count, max }: { label: string; count: number; max: number }): JSX.Element {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-text-primary text-xs font-medium truncate flex-1 min-w-0" title={label}>{label}</span>
        <span className="text-text-muted text-[10px] tabular-nums shrink-0">{count.toLocaleString()}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${max > 0 ? Math.max(2, (count / max) * 100) : 0}%` }}
        />
      </div>
    </div>
  )
}

export function CategoryBadge({ category }: { category: string }): JSX.Element {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide border shrink-0 ${CATEGORY_COLORS[category] ?? 'text-text-muted bg-surface-raised border-[var(--border)]'}`}>
      {CATEGORY_LABELS[category] ?? category}
    </span>
  )
}

function RowThumb({ cover, fallback }: { cover?: StatsSong; fallback: React.ReactNode }): JSX.Element {
  return (
    <span className="relative w-8 h-8 rounded-md overflow-hidden bg-surface-raised flex items-center justify-center shrink-0">
      {cover ? (
        <>
          <AlbumArtThumbnail track={statsSongToTrack(cover)} size={32} className="rounded-md" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <Play size={14} className="text-white" fill="currentColor" />
          </span>
        </>
      ) : fallback}
    </span>
  )
}

export function TopSongRow({ song, cover, rank, max, onPlay, onContextMenu, isMobile }: {
  song: JWApiTopSong
  cover?: StatsSong
  rank: number
  max: number
  onPlay: (id: number) => void
  onContextMenu: (id: number, cover: StatsSong | undefined, e: React.MouseEvent) => void
  isMobile: boolean
}): JSX.Element {
  return (
    <div
      onClick={() => onPlay(song.id)}
      onContextMenu={(e) => onContextMenu(song.id, cover, e)}
      className="group w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-raised active:bg-surface-raised transition-colors text-left cursor-pointer"
    >
      <span className="w-5 text-text-muted text-xs tabular-nums text-right shrink-0">{rank}</span>
      <RowThumb
        cover={cover}
        fallback={
          <>
            <Music2 size={14} className="text-text-muted group-hover:opacity-0 transition-opacity" />
            <Play size={14} className="text-text-primary absolute opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor" />
          </>
        }
      />
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-sm font-medium truncate" title={song.name}>{song.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          {song.era_name && <span className="text-text-muted text-[11px] truncate min-w-0">{song.era_name}</span>}
          <CategoryBadge category={song.category} />
        </div>
      </div>
      <div className="w-24 shrink-0 hidden sm:block">
        <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${max > 0 ? Math.max(2, (song.play_count / max) * 100) : 0}%` }}
          />
        </div>
      </div>
      <span className="text-text-muted text-xs tabular-nums shrink-0 min-w-10 text-right">
        {song.play_count.toLocaleString()}
      </span>
      {isMobile && (
        <button
          onClick={(e) => { e.stopPropagation(); onContextMenu(song.id, cover, e) }}
          className="w-9 h-9 -mr-1.5 shrink-0 flex items-center justify-center text-text-muted active:text-accent"
          aria-label="More options"
        ><MoreVertical size={16} /></button>
      )}
    </div>
  )
}

export function RecentPlayRow({ play, cover, onPlay, onContextMenu, isMobile }: {
  play: JWApiRecentPlay
  cover?: StatsSong
  onPlay: (id: number) => void
  onContextMenu: (id: number, cover: StatsSong | undefined, e: React.MouseEvent) => void
  isMobile: boolean
}): JSX.Element {
  return (
    <div
      onClick={() => onPlay(play.song_id)}
      onContextMenu={(e) => onContextMenu(play.song_id, cover, e)}
      className="group w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-raised active:bg-surface-raised transition-colors text-left cursor-pointer"
    >
      <RowThumb
        cover={cover}
        fallback={play.source === 'radio'
          ? <Radio size={13} className="text-text-muted" />
          : <Music2 size={13} className="text-text-muted" />}
      />
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-sm font-medium truncate" title={play.title}>{play.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          {play.era_name && <span className="text-text-muted text-[11px] truncate min-w-0">{play.era_name}</span>}
          <CategoryBadge category={play.category} />
        </div>
      </div>
      <span
        className="text-text-muted text-[11px] tabular-nums shrink-0"
        title={new Date(play.played_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
      >
        {relativeTime(play.played_at)}
      </span>
      {isMobile && (
        <button
          onClick={(e) => { e.stopPropagation(); onContextMenu(play.song_id, cover, e) }}
          className="w-9 h-9 -mr-1.5 shrink-0 flex items-center justify-center text-text-muted active:text-accent"
          aria-label="More options"
        ><MoreVertical size={16} /></button>
      )}
    </div>
  )
}
