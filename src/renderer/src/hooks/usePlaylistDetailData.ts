// Shared playlist-detail + cover loading for PlaylistsView desktop/mobile.
// Identical fetch/cache logic in both - only the surrounding JSX differs.
import { useCallback, useEffect, useRef, useState } from 'react'
import * as userApi from '../lib/userApi'
import type { PlaylistDetail } from '../lib/userApi'

export type CoverData = { cover_image?: string | null; cover_image_url?: string | null }

export function usePlaylistDetailData(selectedId: number | null, isSharedView: boolean): {
  detail: PlaylistDetail | null
  setDetail: React.Dispatch<React.SetStateAction<PlaylistDetail | null>>
  loadingDetail: boolean
  coverData: CoverData | null
  setCoverData: React.Dispatch<React.SetStateAction<CoverData | null>>
  coverLoading: boolean
  coverImgError: boolean
  setCoverImgError: React.Dispatch<React.SetStateAction<boolean>>
  loadDetail: (id: number, shared?: boolean) => Promise<void>
} {
  const [detail, setDetail] = useState<PlaylistDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [coverData, setCoverData] = useState<CoverData | null>(null)
  const [coverLoading, setCoverLoading] = useState(false)
  const [coverImgError, setCoverImgError] = useState(false)

  // Race-condition guard: each loadDetail call gets a generation ID; stale responses are discarded
  const loadGen = useRef(0)

  const loadDetail = useCallback(async (id: number, shared = false) => {
    const gen = ++loadGen.current
    // A cached cover renders immediately (no null/spinner flash) instead of
    // waiting on a network round trip for a playlist we've already opened.
    const cached = userApi.peekPlaylistCover(id)
    if (cached) {
      setCoverImgError(false)
      setCoverData({ cover_image: cached.cover_image, cover_image_url: cached.cover_image_url })
      setCoverLoading(false)
    } else {
      setCoverData(null)
      setCoverLoading(true)
    }
    // A cached detail (tracks + metadata) renders instantly too - then we
    // still refetch in the background to pick up changes made elsewhere,
    // swapping in the fresh result without ever showing a loading spinner.
    const cachedDetail = userApi.peekPlaylistDetail(id)
    if (cachedDetail) {
      setDetail(cachedDetail)
      setLoadingDetail(false)
    } else {
      setLoadingDetail(true)
    }
    try {
      const result = shared ? await userApi.getPublicPlaylist(id) : await userApi.getPlaylist(id)
      if (gen !== loadGen.current) return
      setDetail(result)
      setLoadingDetail(false)
      if (!cached) {
        // Load cover separately so tracks render immediately
        const coverFetch = shared ? userApi.getPublicPlaylistCover(id) : userApi.getPlaylistCover(id)
        coverFetch.then(c => {
          if (gen !== loadGen.current) return
          setCoverImgError(false)
          setCoverData({ cover_image: c.cover_image, cover_image_url: c.cover_image_url })
          setCoverLoading(false)
        }).catch(() => { if (gen === loadGen.current) setCoverLoading(false) })
      }
    } catch {
      if (gen === loadGen.current && !cachedDetail) setDetail(null)
    } finally {
      if (gen === loadGen.current) setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    if (selectedId != null) loadDetail(selectedId, isSharedView)
    else setDetail(null)
  }, [selectedId, loadDetail, isSharedView])

  return { detail, setDetail, loadingDetail, coverData, setCoverData, coverLoading, coverImgError, setCoverImgError, loadDetail }
}

export function usePlaylistCoverEditing(
  selectedId: number | null,
  refreshPlaylists: () => Promise<void>,
  setCoverData: React.Dispatch<React.SetStateAction<CoverData | null>>,
  setCoverImgError: React.Dispatch<React.SetStateAction<boolean>>,
  setCovers: React.Dispatch<React.SetStateAction<Record<number, string | null>>>,
): {
  coverUploading: boolean
  handleCoverUpload: (file: File) => Promise<void>
  handleRemoveCover: () => Promise<void>
} {
  const [coverUploading, setCoverUploading] = useState(false)

  const handleCoverUpload = useCallback(async (file: File) => {
    if (!selectedId || coverUploading) return
    setCoverUploading(true)
    try {
      const result = await userApi.uploadPlaylistCover(selectedId, file)
      setCoverImgError(false)
      setCoverData({ cover_image: result.cover_image, cover_image_url: result.cover_image_url })
      setCovers(prev => ({ ...prev, [selectedId]: result.cover_image_url ?? result.cover_image ?? null }))
      await refreshPlaylists()
    } catch {}
    setCoverUploading(false)
  }, [selectedId, coverUploading, refreshPlaylists, setCoverData, setCoverImgError, setCovers])

  const handleRemoveCover = useCallback(async () => {
    if (!selectedId) return
    setCoverData(null) // optimistic clear
    setCovers(prev => ({ ...prev, [selectedId]: null }))
    try {
      await userApi.removePlaylistCover(selectedId)
      await refreshPlaylists()
    } catch {
      // restore on failure by re-fetching
      const c = await userApi.getPlaylistCover(selectedId).catch(() => null)
      if (c) setCoverData({ cover_image: c.cover_image, cover_image_url: c.cover_image_url })
    }
  }, [selectedId, refreshPlaylists, setCoverData, setCovers])

  return { coverUploading, handleCoverUpload, handleRemoveCover }
}
