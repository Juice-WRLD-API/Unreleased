// Shared presentational bit for HomeView's desktop/mobile playlist rows -
// both already share their data via useHomeData; this is what's left.
import { ListMusic } from 'lucide-react'
import { ProgressiveCover } from '../components/ProgressiveCover'

// A playlist with no cover of its own falls back to a 2×2 mosaic of its first
// four tracks' art - same fallback PlaylistsView uses - before the plain icon.
export function PlaylistCoverThumb({ cover, mosaic, alt }: { cover: string | null; mosaic: string[] | null; alt: string }): JSX.Element {
  if (cover) return <ProgressiveCover src={cover} alt={alt} className="w-full h-full object-cover" />
  if (mosaic && mosaic.length >= 4) {
    return (
      <div className="grid grid-cols-2 w-full h-full" style={{ overflow: 'hidden' }}>
        {mosaic.slice(0, 4).map((url, i) => <ProgressiveCover key={i} src={url} alt="" className="w-full h-full object-cover" />)}
      </div>
    )
  }
  return <ListMusic size={26} className="text-text-muted" />
}
