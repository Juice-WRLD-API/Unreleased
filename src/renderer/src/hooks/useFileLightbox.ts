// Media lightbox state for ApiFilesView.desktop.tsx and .mobile.tsx -
// identical gallery-building logic in both: while searching, the clicked
// entry can live in a folder other than the one currently browsed, so the
// gallery is built from the search results rather than the browsed folder.
import { useState } from 'react'
import { buildStreamUrl, JWApiFileEntry } from '../lib/juicewrldApi'
import { getMediaType } from '../lib/fileTypes'
import { LightboxItem } from '../components/MediaLightbox'

export function useFileLightbox(opts: {
  entries: JWApiFileEntry[]
  searchResults: JWApiFileEntry[]
  isSearching: boolean
  activeChannel: string
}): {
  lightboxItems: LightboxItem[]
  lightboxIndex: number
  setLightboxIndex: (i: number) => void
  openLightbox: (entry: JWApiFileEntry) => void
} {
  const { entries, searchResults, isSearching, activeChannel } = opts
  const [lightboxItems, setLightboxItems] = useState<LightboxItem[]>([])
  const [lightboxIndex, setLightboxIndex] = useState(-1)

  const openLightbox = (entry: JWApiFileEntry): void => {
    const mediaEntries = (isSearching ? searchResults : entries).filter((e) => {
      const mt = getMediaType(e.name)
      return e.type === 'file' && (mt === 'image' || mt === 'video')
    })
    const items: LightboxItem[] = mediaEntries.map((e) => ({
      url: buildStreamUrl(e.path, activeChannel),
      type: getMediaType(e.name) as 'image' | 'video',
      name: e.name,
    }))
    const idx = mediaEntries.findIndex((e) => e.path === entry.path)
    setLightboxItems(items)
    setLightboxIndex(idx >= 0 ? idx : 0)
  }

  return { lightboxItems, lightboxIndex, setLightboxIndex, openLightbox }
}
