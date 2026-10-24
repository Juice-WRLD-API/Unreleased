import { useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, Play } from 'lucide-react'
import { Tile } from './Tile'
import ThemedDatePicker from './ThemedDatePicker'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { MotionDisclosure } from './MotionDisclosure'
import { useContentMotion } from '../hooks/useContentMotion'
import { useOnThisDay } from '../hooks/useOnThisDay'
import { useStorePick } from '../store/useStore'
import { songToTrack, type JWApiSong } from '../lib/juicewrldApi'
import { DAY_EVENT_LABELS, dayHeadline, dayNote, dayQueue, hasAudio, yearsSince, type DayEntry } from '../lib/onThisDay'
import type { Track } from '../types'

// Home's "On this day": what was recorded, previewed, surfaced or released on
// today's date in past years (lib/onThisDay), newest year first. Play queues
// the whole day oldest-first, and a song clicked on its own plays from its
// place in that queue. The date in the header looks at any other day.

// Rows shown before "Show all": a typical day has about 14, the busiest 90.
const COLLAPSED = 8
// Width a row asks for and the gap between rows in a year (gap-x-4).
const ROW_WIDTH = 190
const ROW_GAP = 16

const isSession = (s: JWApiSong): boolean => s.category === 'recording_session'

function versionsNote(songs: JWApiSong[]): string {
  const sessions = songs.filter(isSession).length
  const versions = songs.length - sessions
  return [
    versions > 1 ? `${versions} versions` : '',
    sessions ? (sessions > 1 ? `${sessions} sessions` : 'session') : '',
  ].filter(Boolean).join(' + ')
}

// 2000 is a leap year, so Feb 29 has a label too.
const dateLabel = (month: number, day: number): string =>
  new Date(2000, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

interface Row { year: number; entry: DayEntry }

export default function OnThisDayTile({ onContextMenu, span }: {
  onContextMenu: (track: Track, e: React.MouseEvent) => void
  span: string
}): JSX.Element {
  const otd = useOnThisDay()
  const { playTrack, playCollection, setInfoSongId } = useStorePick('playTrack', 'playCollection', 'setInfoSongId')
  const [now] = useState(() => new Date())
  const key = `${otd.month}-${otd.day}`
  // Keyed by day, so picking another one starts collapsed again.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const expanded = expandedKey === key
  const bodyRef = useRef<HTMLDivElement>(null)
  useContentMotion(bodyRef, otd.years ? key : 'loading')

  const years = otd.years
  const rows: Row[] = useMemo(() => (years ?? []).flatMap((y) => y.entries.map((entry) => ({ year: y.year, entry }))), [years])
  const queue = useMemo(() => (years ? dayQueue(years).map(songToTrack) : []), [years])
  const headline = years ? dayHeadline(years, otd.isToday, now) : null
  const note = dayNote(otd.month, otd.day)

  const open = (entry: DayEntry): void => {
    const song = entry.songs[0]
    if (!hasAudio(song)) { setInfoSongId(song.id); return }
    const track = queue.find((t) => t.id === `jw-${song.id}`) ?? songToTrack(song)
    playTrack(track, queue.includes(track) ? queue : undefined)
  }

  const renderRow = ({ entry }: Row): JSX.Element => {
    const song = entry.songs[0]
    const playable = hasAudio(song)
    const track = songToTrack(song)
    const sub = [DAY_EVENT_LABELS[entry.kind], song.era?.name, versionsNote(entry.songs), playable ? '' : 'no audio'].filter(Boolean).join(' · ')
    return (
      <button
        key={`${entry.kind}-${song.id}`}
        onClick={() => open(entry)}
        onContextMenu={(e) => { if (!playable) return; e.preventDefault(); onContextMenu(track, e) }}
        title={[...entry.songs.map((s) => s.name), ...entry.labels.filter((l) => l !== DAY_EVENT_LABELS[entry.kind])].join('\n')}
        className="group flex items-center gap-2.5 min-w-0 rounded-lg p-1.5 -m-1.5 text-left hover:bg-[var(--surface-raised)] transition-colors"
      >
        <span className="relative w-9 h-9 shrink-0 rounded-md overflow-hidden bg-surface-raised">
          <AlbumArtThumbnail track={track} fill className="w-full h-full object-cover" />
          {playable && (
            <span className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Play size={12} className="text-white ml-0.5" fill="currentColor" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-xs leading-snug truncate transition-colors ${playable ? 'text-text-primary group-hover:text-accent' : 'text-text-muted'}`}>{entry.title}</span>
          <span className="block text-text-muted text-[11px] truncate mt-0.5">{sub}</span>
        </span>
      </button>
    )
  }

  // Rows grouped under their year. Each group is only as wide as its rows, so
  // years with a song or two sit side by side instead of each taking a line.
  // `continues` is the year the rows before these ended on: the hidden half of
  // a split year doesn't repeat its heading.
  const renderYears = (list: Row[], continues: number | null): JSX.Element => {
    const groups: Row[][] = []
    for (const row of list) {
      const last = groups[groups.length - 1]
      if (last && last[0].year === row.year) last.push(row)
      else groups.push([row])
    }
    return (
      <div className={`flex flex-wrap gap-x-8 gap-y-3 ${continues === null ? '' : 'mt-3'}`}>
        {groups.map((group, i) => (
          <div
            key={group[0].year}
            className="min-w-0 max-w-full"
            style={{ flex: `0 1 ${group.length * ROW_WIDTH + (group.length - 1) * ROW_GAP}px` }}
          >
            {i === 0 && continues === group[0].year ? null : (
              <p className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-2">
                <span className="text-text-secondary">{group[0].year}</span> · {yearsSince(group[0].year, otd.isToday, now)}
              </p>
            )}
            <div className="grid gap-x-4 gap-y-2.5 grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
              {group.map(renderRow)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const shown = rows.slice(0, COLLAPSED)
  const hidden = rows.slice(COLLAPSED)

  return (
    <Tile
      title="On this day"
      icon={<CalendarDays size={15} />}
      span={span}
      controls={
        <>
          <ThemedDatePicker
            value={otd.value}
            onChange={otd.pick}
            clearable={false}
            title="Look at another day"
            className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-text-muted text-xs font-semibold hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors shrink-0"
          >
            {otd.isToday ? 'Today' : dateLabel(otd.month, otd.day)}
            <ChevronDown size={13} />
          </ThemedDatePicker>
          <button
            onClick={() => playCollection(queue)}
            disabled={queue.length === 0}
            title={queue.length ? `Play ${queue.length} song${queue.length === 1 ? '' : 's'} from this day, oldest first` : 'Nothing from this day has audio'}
            className="flex items-center gap-1 h-7 px-3 rounded-full bg-accent text-black text-xs font-bold hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 transition shrink-0"
          >
            <Play size={11} fill="currentColor" />Play
          </button>
        </>
      }
    >
      <div ref={bodyRef}>
        {note && <p className="text-text-muted text-xs mb-1">{note}</p>}
        {!years ? (
          <p className="text-text-muted text-xs">{otd.failed ? 'Couldn’t load the catalogue. Check your connection and come back to Home.' : 'Looking through the catalogue…'}</p>
        ) : rows.length === 0 ? (
          <p className="text-text-muted text-xs">Nothing in the catalogue is dated to {dateLabel(otd.month, otd.day)} yet.</p>
        ) : (
          <>
            {headline && <p className="text-text-primary text-sm leading-snug mb-3">{headline}</p>}
            {renderYears(shown, null)}
            {hidden.length > 0 && (
              <>
                <MotionDisclosure open={expanded}>
                  {renderYears(hidden, shown[shown.length - 1].year)}
                </MotionDisclosure>
                <button
                  onClick={() => setExpandedKey(expanded ? null : key)}
                  className="mt-3 text-text-muted text-xs font-semibold hover:text-text-primary transition-colors"
                >
                  {expanded ? 'Show less' : `Show all ${rows.length}`}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </Tile>
  )
}
