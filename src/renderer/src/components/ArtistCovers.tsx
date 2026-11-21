import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Trash2, Upload } from 'lucide-react'
import {
  artistCoverSources, deleteArtistCover, getArtistFolder, uploadArtistCover,
  type ArtistCover, type ArtistFolder,
} from '../lib/artistCoversApi'
import { COVER_ART_TYPES, checkCoverArtFile } from '../lib/coverArtApi'
import { errorMessage, formatBytes } from '../lib/format'
import { relativeTime } from './adminShared'
import { FallbackImg } from './ProgressiveCover'

// Settings > Account > Your uploads, for artists: their own folder in Files
// (Cover Arts/<folder>/ in the community channel). Uploads go in at once, with
// no review; removing one sends it to the comp archive, so it asks first.
export default function ArtistCovers(): JSX.Element {
  const [folder, setFolder] = useState<ArtistFolder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setFolder(await getArtistFolder())
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not load your folder'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const upload = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    setUploading({ done: 0, total: files.length })
    const problems: string[] = []
    for (const [i, file] of files.entries()) {
      const check = await checkCoverArtFile(file)
      if (typeof check === 'string') {
        problems.push(`${file.name}: ${check}`)
      } else {
        try {
          const added = await uploadArtistCover(file)
          setFolder((prev) => prev && { ...prev, files: [...prev.files.filter((f) => f.name !== added.name), added] })
        } catch (err) {
          problems.push(`${file.name}: ${errorMessage(err, 'upload failed')}`)
        }
      }
      setUploading({ done: i + 1, total: files.length })
    }
    setUploading(null)
    setError(problems.length ? problems.join('\n') : null)
  }

  const remove = async (cover: ArtistCover): Promise<void> => {
    setBusy(cover.name)
    try {
      await deleteArtistCover(cover.name)
      setFolder((prev) => prev && { ...prev, files: prev.files.filter((f) => f.name !== cover.name) })
      setConfirming(null)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not remove it'))
    } finally {
      setBusy(null)
    }
  }

  if (!folder) {
    return error
      ? <p className="text-red-400 text-[11px] py-2 whitespace-pre-line">{error}</p>
      : <div className="flex items-center gap-2 py-3 text-text-muted text-xs"><Loader2 size={13} className="animate-spin" />Loading your folder…</div>
  }

  const full = folder.files.length >= folder.max_files
  return (
    <div className="py-2">
      <div className="flex items-center gap-2 mb-3">
        <p className="min-w-0 flex-1 text-text-muted text-[11px] truncate" title={`${folder.channel}:${folder.path}`}>
          {folder.path} · {folder.files.length} cover{folder.files.length === 1 ? '' : 's'}
        </p>
        <button onClick={() => input.current?.click()} disabled={!!uploading || full}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {uploading ? `Uploading ${uploading.done}/${uploading.total}` : 'Upload'}
        </button>
        <input ref={input} type="file" multiple accept={COVER_ART_TYPES.join(',')} className="hidden"
          onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; void upload(files) }} />
      </div>
      {folder.files.length === 0 && (
        <p className="text-text-muted text-xs pb-2">
          Your folder is empty. Covers you upload show up in Files right away, named after the file.
        </p>
      )}
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(110px,1fr))]">
        {folder.files.map((f) => (
          <div key={f.path} className="min-w-0">
            <div className="relative aspect-square rounded-lg overflow-hidden bg-[var(--fill)]">
              <FallbackImg sources={artistCoverSources(f)} alt={f.name} className="w-full h-full object-cover" lazy />
            </div>
            <p className="mt-1 text-text-primary text-xs truncate" title={f.name}>{f.name}</p>
            <div className="flex items-center gap-1 text-[10px] text-text-muted">
              <span className="truncate flex-1">{formatBytes(f.size)} · {relativeTime(f.updated_at)}</span>
              {confirming === f.name ? (
                <>
                  <button onClick={() => setConfirming(null)} className="hover:text-text-primary">Keep</button>
                  <button onClick={() => void remove(f)} disabled={busy === f.name}
                    className="inline-flex items-center gap-0.5 font-semibold text-red-400 hover:text-red-300 disabled:opacity-60">
                    {busy === f.name && <Loader2 size={10} className="animate-spin" />} Remove
                  </button>
                </>
              ) : (
                <button onClick={() => setConfirming(f.name)} aria-label={`Remove ${f.name}`} title="Remove from your folder"
                  className="hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
              )}
            </div>
          </div>
        ))}
      </div>
      {full && <p className="text-text-muted text-[11px] pt-2">Your folder is full ({folder.max_files} covers). Remove some to upload more.</p>}
      {error && <p className="text-red-400 text-[11px] pt-2 whitespace-pre-line">{error}</p>}
    </div>
  )
}
