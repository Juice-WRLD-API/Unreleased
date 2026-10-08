import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ImageIcon, Music2, RotateCcw, FolderSearch } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { resolvePrefCoverUrl, smallCoverUrl } from '../lib/juicewrldApi'
import { loadEraFullNames, eraFullName, listEras } from '../lib/eras'
import FilePickerModal from './FilePickerModal'

// Lets a user replace the API's shared placeholder cover for an entire era -
// every unreleased song in that era picks it up (see lib/eraCovers and
// applyPrefToTrack's precedence). Released songs and songs with their own
// personal cover are untouched, so this only ever fills a gap.
export default function EraCoversSection(): JSX.Element {
  const { eraCovers, setEraCoverOverride } = useStore(
    useShallow((s) => ({ eraCovers: s.eraCovers, setEraCoverOverride: s.setEraCoverOverride }))
  )

  const [expanded, setExpanded] = useState(false)
  const [eraNames, setEraNames] = useState<string[]>(() => listEras().map((e) => e.name))
  useEffect(() => {
    if (!expanded || eraNames.length > 0) return
    loadEraFullNames().then(() => setEraNames(listEras().map((e) => e.name))).catch(() => {})
  }, [expanded, eraNames.length])

  const [openEra, setOpenEra] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [browseEra, setBrowseEra] = useState<string | null>(null)

  const overrideCount = useMemo(() => Object.keys(eraCovers).length, [eraCovers])

  const apply = (era: string, raw: string | null): void => {
    setEraCoverOverride(era, raw)
    setOpenEra(null)
    setDraft('')
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-raised px-4 py-3.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className="text-sm text-text-primary flex-1">Era covers</span>
        {overrideCount > 0 && (
          <span className="text-[10px] text-accent bg-accent/10 rounded-full px-2 py-0.5">
            {overrideCount} customized
          </span>
        )}
        {expanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
      </button>
      <p className="text-text-muted text-xs mt-1">
        Replace the shared cover an era's unreleased songs show by default. Released songs, and any song
        you've personalized yourself, are never affected.
      </p>

      {expanded && (
        <div className="mt-3 space-y-1.5">
          {eraNames.length === 0 && (
            <p className="text-text-muted text-xs py-2">Loading eras…</p>
          )}
          {eraNames.map((era) => {
            const raw = eraCovers[era]
            const url = resolvePrefCoverUrl(raw)
            const full = eraFullName(era)
            return (
              <div key={era} className="rounded-lg border border-[var(--border)] px-2.5 py-2">
                <div className="flex items-center gap-2.5">
                  <div className="shrink-0 w-9 h-9 rounded-md overflow-hidden bg-surface-overlay flex items-center justify-center">
                    {url ? (
                      <img key={url} src={smallCoverUrl(url)} alt="" className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <Music2 size={15} className="text-text-muted opacity-30" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">{era}</p>
                    {full && <p className="text-[10px] text-text-muted truncate">{full}</p>}
                  </div>
                  <button
                    onClick={() => { setOpenEra(openEra === era ? null : era); setDraft('') }}
                    className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary px-2 py-1 rounded-md border border-[var(--border)] hover:bg-surface transition-colors"
                  >
                    <ImageIcon size={11} /> {raw ? 'Change' : 'Choose'}
                  </button>
                  {raw && (
                    <button
                      onClick={() => apply(era, null)}
                      className="text-text-muted hover:text-red-400 transition-colors"
                      title="Use the API's default cover for this era"
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                </div>

                {openEra === era && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) apply(era, draft.trim()) }}
                      placeholder="https://…  or  Covers/image.jpg"
                      className="flex-1 min-w-0 bg-surface-overlay border border-[var(--border)] rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
                    />
                    <button
                      onClick={() => draft.trim() && apply(era, draft.trim())}
                      disabled={!draft.trim()}
                      className="shrink-0 px-2.5 py-1.5 rounded-md bg-accent/15 text-accent text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Use
                    </button>
                    <button
                      onClick={() => setBrowseEra(era)}
                      className="shrink-0 flex items-center gap-1 text-[11px] text-accent hover:text-accent/80 px-2 py-1.5 transition-colors"
                    >
                      <FolderSearch size={12} /> Browse
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {browseEra && (
        <FilePickerModal
          songTitle={eraFullName(browseEra) ?? browseEra}
          onClose={() => setBrowseEra(null)}
          onSelect={(path) => { const era = browseEra; setBrowseEra(null); if (era) apply(era, path) }}
        />
      )}
    </div>
  )
}
