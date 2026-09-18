// Shared state/logic for ReportsTab (song issue reports review). Desktop
// and mobile wrap this in their own JSX - keep behavior here, layout in them.
import { useEffect, useState } from 'react'
import * as reportsApi from '../lib/reportsApi'
import type { SongReportRow, SongReportStatus } from '../lib/reportsApi'
import { apiFetch } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'

export const REPORT_FILTERS: { id: SongReportStatus | ''; label: string }[] = [
  { id: 'pending',  label: 'Pending'  },
  { id: 'resolved', label: 'Resolved' },
  { id: '',         label: 'All'      },
]

export function useReportsTabState(reports: SongReportRow[], onChanged: () => void): {
  actionId: number | null
  notes: Record<number, string>
  setNotes: React.Dispatch<React.SetStateAction<Record<number, string>>>
  selected: SongReportRow | null
  setSelected: (r: SongReportRow | null) => void
  songLabel: (r: SongReportRow) => string
  doReview: (r: SongReportRow, newStatus: SongReportStatus) => Promise<void>
  r: SongReportRow | null
  rSong: JWApiSong | undefined
} {
  const [actionId, setActionId] = useState<number | null>(null)
  const [notes,    setNotes]    = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<SongReportRow | null>(null)

  useEffect(() => { setSelected(reports[0] ?? null) }, [reports])

  // Song names for rows that only carry an id - one bulk catalog fetch (the
  // same ?all=true mode compact view uses) instead of a request per report.
  const [songsById, setSongsById] = useState<Map<number, JWApiSong>>(new Map())
  useEffect(() => {
    apiFetch<JWApiSong[]>('/songs/', { all: 'true' })
      .then(songs => setSongsById(new Map(songs.map(s => [s.id, s]))))
      .catch(() => {})
  }, [])

  const songLabel = (r: SongReportRow): string => {
    if (r.song_name) return r.song_name
    const id = reportsApi.reportSongId(r)
    if (id == null) return r.public_id != null ? `Song #${r.public_id}` : 'Unknown song'
    return songsById.get(id)?.name ?? `Song id ${id}`
  }

  const doReview = async (r: SongReportRow, newStatus: SongReportStatus): Promise<void> => {
    setActionId(r.id)
    try {
      await reportsApi.reviewSongReport(r.id, { status: newStatus, review_notes: notes[r.id] ?? r.review_notes ?? '' })
      onChanged()
    } catch {} finally { setActionId(null) }
  }

  const r = selected
  const rSong = r ? (reportsApi.reportSongId(r) != null ? songsById.get(reportsApi.reportSongId(r)!) : undefined) : undefined

  return { actionId, notes, setNotes, selected, setSelected, songLabel, doReview, r, rSong }
}
