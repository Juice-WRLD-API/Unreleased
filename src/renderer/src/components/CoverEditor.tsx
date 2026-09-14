import { useEffect, useMemo, useState } from 'react'
import { Check, ImageIcon, FolderSearch, Loader2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import {
  JWApiSong, resolvePrefCoverUrl, apiFetch, buildStreamUrl, smallCoverUrl,
  parseBrowseEntries, cleanTitleForSearch, filterSearchResults, JWApiBrowseResponse,
} from '../lib/juicewrldApi'
import { getMediaType } from '../lib/fileTypes'
import FilePickerModal from './FilePickerModal'

export interface CoverVersionEntry { song: JWApiSong }

// The cover-picking half of Personalize's "Custom cover" section - grid of
// this song's own/sibling covers, an inline title search, a file browser, and
// a paste-URL fallback. Extracted out of SongPrefsSection so WRLD's cover
// long-press sheet can offer the exact same picker without the rest of
// Personalize (name/default-version/playcount) around it.
export default function CoverEditor({
  songId, apiTitle, ownImageRaw, versions = [], altTitles = [], onPicked,
}: {
  songId: number
  apiTitle: string
  ownImageRaw: string | null
  versions?: CoverVersionEntry[]
  altTitles?: string[]
  /** Called after a cover is applied - sheet-style callers use this to close. */
  onPicked?: () => void
}): JSX.Element {
  const setSongCover = useStore(s => s.setSongCover)
  const pref = useStore(s => s.songPrefs[songId])

  const [coverDraft, setCoverDraft] = useState('')
  const [browseOpen, setBrowseOpen] = useState(false)

  const coverChoices = useMemo(() => {
    const out: { raw: string; url: string; title: string }[] = []
    const seen = new Set<string>()
    const push = (raw: string | null | undefined, title: string): void => {
      if (!raw) return
      const url = resolvePrefCoverUrl(raw)
      if (!url || seen.has(url)) return
      seen.add(url)
      out.push({ raw, url, title })
    }
    push(ownImageRaw, apiTitle)
    for (const v of versions) push(v.song.image_url, v.song.name)
    return out
  }, [ownImageRaw, versions, apiTitle])

  // Same title(+alt names) search FilePickerModal seeds itself with, but run
  // inline so likely covers show up here without opening the full browser.
  // null = not fetched yet, so switching songs re-triggers it.
  const [searchedCovers, setSearchedCovers] = useState<{ path: string; url: string }[] | null>(null)
  const [searchedLoading, setSearchedLoading] = useState(false)
  useEffect(() => { setSearchedCovers(null) }, [songId])
  useEffect(() => {
    if (searchedCovers != null) return
    const queries = [apiTitle, ...versions.map((v) => v.song.name)]
      .map(cleanTitleForSearch)
      .filter((q, i, arr) => q && arr.indexOf(q) === i)
    if (queries.length === 0) { setSearchedCovers([]); return }
    let cancelled = false
    setSearchedLoading(true)
    const seenUrls = new Set(coverChoices.map((c) => c.url))
    Promise.all(queries.map((q) =>
      apiFetch<JWApiBrowseResponse>('/files/browse/', { search: q })
        .then((data) => filterSearchResults(parseBrowseEntries(data), q))
        .catch(() => [])
    )).then((lists) => {
      if (cancelled) return
      const seenPaths = new Set<string>()
      const out: { path: string; url: string }[] = []
      for (const list of lists) {
        for (const e of list) {
          if (e.type !== 'file' || getMediaType(e.name) !== 'image' || seenPaths.has(e.path)) continue
          seenPaths.add(e.path)
          const url = buildStreamUrl(e.path)
          if (seenUrls.has(url)) continue
          out.push({ path: e.path, url })
        }
      }
      setSearchedCovers(out)
    }).finally(() => { if (!cancelled) setSearchedLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchedCovers, apiTitle, versions])

  const coverDraftPreview = resolvePrefCoverUrl(coverDraft.trim())

  const applyCover = (raw: string | null): void => {
    setSongCover(songId, raw)
    setCoverDraft('')
    onPicked?.()
  }

  return (
    <div className="space-y-2.5">
      {coverChoices.length > 0 && (
        <>
          <p className="text-[10px] text-text-muted">From this song's versions</p>
          <div className="grid grid-cols-5 gap-1.5">
            {coverChoices.map((c) => {
              const active = pref?.cover_url === c.raw
              return (
                <button
                  key={c.url}
                  onClick={() => applyCover(c.raw)}
                  title={c.title}
                  className={`relative aspect-square rounded-md overflow-hidden bg-surface-overlay border transition-colors ${active ? 'border-accent' : 'border-transparent hover:border-[var(--border)]'}`}
                >
                  <img src={smallCoverUrl(c.url)} alt={c.title} className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} />
                  {active && (
                    <span className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                      <Check size={10} className="text-white" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}

      {searchedLoading ? (
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted py-1">
          <Loader2 size={11} className="animate-spin" /> Searching API files for "{apiTitle}"…
        </div>
      ) : searchedCovers && searchedCovers.length > 0 && (
        <>
          <p className="text-[10px] text-text-muted">Found in API files</p>
          <div className="grid grid-cols-5 gap-1.5">
            {searchedCovers.map((c) => {
              const active = pref?.cover_url === c.url
              return (
                <button
                  key={c.url}
                  onClick={() => applyCover(c.url)}
                  title={c.path}
                  className={`relative aspect-square rounded-md overflow-hidden bg-surface-overlay border transition-colors ${active ? 'border-accent' : 'border-transparent hover:border-[var(--border)]'}`}
                >
                  <img src={smallCoverUrl(c.url)} alt="" className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} />
                  {active && (
                    <span className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                      <Check size={10} className="text-white" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] text-text-muted">Or paste an image URL / storage path</p>
          <button
            onClick={() => setBrowseOpen(true)}
            className="flex items-center gap-1 text-[10px] font-medium text-accent hover:text-accent/80 transition-colors"
          >
            <FolderSearch size={11} /> Browse API files
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="shrink-0 w-8 h-8 rounded-md overflow-hidden bg-surface-overlay flex items-center justify-center">
            {coverDraftPreview ? (
              <img key={coverDraftPreview} src={smallCoverUrl(coverDraftPreview)} alt="" className="w-full h-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
            ) : (
              <ImageIcon size={12} className="text-text-muted opacity-40" />
            )}
          </div>
          <input
            value={coverDraft}
            onChange={(e) => setCoverDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && coverDraft.trim()) applyCover(coverDraft.trim()) }}
            placeholder="https://…  or  Covers/song.jpg"
            className="flex-1 min-w-0 bg-surface-overlay border border-[var(--border)] rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
          />
          <button
            onClick={() => coverDraft.trim() && applyCover(coverDraft.trim())}
            disabled={!coverDraft.trim()}
            className="shrink-0 px-2.5 py-1.5 rounded-md bg-accent/15 text-accent text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Use
          </button>
        </div>
      </div>

      {browseOpen && (
        <FilePickerModal
          songTitle={apiTitle}
          altTitles={altTitles}
          onClose={() => setBrowseOpen(false)}
          onSelect={(path) => { setBrowseOpen(false); applyCover(path) }}
        />
      )}
    </div>
  )
}
