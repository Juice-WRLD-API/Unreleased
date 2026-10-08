import { useState } from 'react'
import * as reportsApi from '../lib/reportsApi'
import type { SongReportRow, SongReportStatus } from '../lib/reportsApi'
import { useStrictModeSafeEffect } from './useStrictModeSafeEffect'

// Wraps reportsApi.listSongReports for EditorProfileView.desktop.tsx/
// .mobile.tsx's own Reports tab (editor/admin accounts reviewing reports
// alongside their own proposals). NOT used by AdminPage's standalone Reports
// tab - that data comes from useAdminQueue, which fetches it as part of its
// own per-tab load() cycle.
export function useReportsQueue(enabled: boolean, refreshKey: number) {
  const [status, setStatus] = useState<SongReportStatus | ''>('pending')
  const [reports, setReports] = useState<SongReportRow[]>([])
  const [loading, setLoading] = useState(false)

  useStrictModeSafeEffect((isCancelled) => {
    if (!enabled) return
    setLoading(true)
    reportsApi.listSongReports(status || undefined)
      .then((data) => { if (!isCancelled()) setReports(data) })
      .catch(() => {})
      .finally(() => { if (!isCancelled()) setLoading(false) })
  }, [enabled, status, refreshKey])

  return { reports, status, setStatus, loading }
}
