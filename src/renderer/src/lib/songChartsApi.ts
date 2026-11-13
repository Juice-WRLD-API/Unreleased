// Song charts: GET /plays/top-songs/ (backend docs/12-feedback-and-reports.md).
// The Statistics tab's "Most played songs" table and the terminal `charts`
// command read it. An older server doesn't have the endpoint; callers fall
// back to /plays/stats/'s all-time top_songs then.
import { apiFetch, type JWApiSong } from './juicewrldApi'

export type ChartRange = '7d' | '30d' | 'all'
export type ChartSort = 'plays' | 'likes'

export const CHART_RANGES: ChartRange[] = ['7d', '30d', 'all']

export interface ChartSong {
  id: number
  public_id: number | null
  name: string
  era_name: string
  category: JWApiSong['category']
  image_url: string | null
  length: string
  producers: string
  has_audio: boolean
  snippet_count: number
  version_count: number
  plays: number
  /** Estimated: plays x the song's listed length. */
  minutes: number
  /** Distinct listeners in the range. */
  listeners: number
  likes: number
  rank: number
  /** Rank in the window before this one; null when it wasn't charted then,
   *  and always null for all time and the likes chart. */
  previous_rank: number | null
}

export interface SongChart {
  range: ChartRange
  days: number | null
  sort: ChartSort
  era: string | null
  since: string | null
  totals: { plays: number; minutes: number; listeners: number; songs: number }
  songs: ChartSong[]
}

export interface SongChartQuery {
  range?: ChartRange
  sort?: ChartSort
  era?: string | null
  limit?: number
}

export function fetchSongChart(query: SongChartQuery = {}, signal?: AbortSignal): Promise<SongChart> {
  return apiFetch<SongChart>('/plays/top-songs/', {
    range: query.range ?? '7d',
    sort: query.sort ?? 'plays',
    era: query.era || undefined,
    limit: query.limit,
  }, signal)
}

/** How a chart's range reads in a sentence ("in the last 7 days"). */
export function chartRangePhrase(range: ChartRange): string {
  return range === '7d' ? 'in the last 7 days' : range === '30d' ? 'in the last 30 days' : 'of all time'
}

/** Rank change since the previous window: positive is up. Null when there is
 *  nothing to compare (all time, likes), 'new' when it wasn't charted before. */
export function rankMovement(song: Pick<ChartSong, 'rank' | 'previous_rank'>, range: ChartRange, sort: ChartSort): number | 'new' | null {
  if (range === 'all' || sort === 'likes') return null
  if (song.previous_rank == null) return 'new'
  return song.previous_rank - song.rank
}
