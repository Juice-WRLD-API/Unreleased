import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, FileAudio, FileImage, ImagePlus, Link2, Link2Off, ListPlus, Loader2, Pause, Pencil, Play, Tag, Trash2, Upload, X } from 'lucide-react'
import {
  DONOR_ALLOWED_EXTENSIONS, deleteDonorFile, fetchDonorFileBlob, isImageFile, listDonorFiles,
  updateDonorFile, uploadDonorFile, validateDonorUpload,
} from '../lib/donorFilesApi'
import type { DonorFile, DonorQuota } from '../lib/donorFilesApi'
import { formatBytes } from '../lib/format'
import { isDonorAudio } from '../lib/donorPlayback'
import { useStore } from '../store/useStore'
import { canEditTags, readMp3Tags, writeMp3Tags } from '../lib/mp3Tags'
import type { Mp3Tags } from '../lib/mp3Tags'

const ACCEPT = DONOR_ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')

// Donor cloud storage: upload, rename, share by link, play, download, delete.
// Own-file downloads need the auth header, so playback/preview/download go
// through a fetched blob instead of pointing an element straight at the URL.
export default function DonorFiles(): JSX.Element {
  const [files, setFiles] = useState<DonorFile[] | null>(null)
  const [quota, setQuota] = useState<DonorQuota | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null)
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null)
  const [tagEdit, setTagEdit] = useState<{ id: string; tags: Mp3Tags | null; saving: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await listDonorFiles()
      setFiles(res.files)
      setQuota(res.quota)
      setError(null)
    } catch (err) {
      setError((err as Error).message || 'Could not load files')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Playlists resolve their entries against the store's copy of this list.
  const setDonorFiles = useStore((s) => s.setDonorFiles)
  const replaceDonorFileId = useStore((s) => s.replaceDonorFileId)
  const donorPlaylists = useStore((s) => s.donorPlaylists)
  const createDonorPlaylist = useStore((s) => s.createDonorPlaylist)
  const addToDonorPlaylist = useStore((s) => s.addToDonorPlaylist)
  const removeFromDonorPlaylist = useStore((s) => s.removeFromDonorPlaylist)
  const [playlistPicker, setPlaylistPicker] = useState<string | null>(null)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  useEffect(() => { if (files) setDonorFiles(files) }, [files, setDonorFiles])

  // Object URLs pin the whole blob in memory until revoked.
  useEffect(() => () => { if (playing) URL.revokeObjectURL(playing.url) }, [playing])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])

  const upload = async (picked: FileList | null): Promise<void> => {
    if (!picked || picked.length === 0) return
    setError(null)
    let currentQuota = quota
    for (const file of Array.from(picked)) {
      const problem = validateDonorUpload(file, currentQuota)
      if (problem) { setError(problem); continue }
      setUploading({ name: file.name, progress: 0 })
      try {
        const res = await uploadDonorFile(file, (p) => setUploading({ name: file.name, progress: p }))
        currentQuota = res.quota
        setQuota(res.quota)
        setFiles((prev) => [res.file, ...(prev ?? [])])
      } catch (err) {
        setError((err as Error).message || 'Upload failed')
      }
    }
    setUploading(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const patch = async (f: DonorFile, body: { filename?: string; is_shared?: boolean }): Promise<DonorFile | null> => {
    setBusy(f.file_id)
    try {
      const updated = await updateDonorFile(f.file_id, body)
      setFiles((prev) => prev?.map((x) => (x.file_id === f.file_id ? updated : x)) ?? prev)
      setError(null)
      return updated
    } catch (err) {
      setError((err as Error).message || 'Could not update file')
      return null
    } finally {
      setBusy(null)
    }
  }

  const commitRename = async (f: DonorFile): Promise<void> => {
    const draft = renaming?.draft.trim() ?? ''
    setRenaming(null)
    if (!draft || draft === f.filename) return
    await patch(f, { filename: draft })
  }

  const toggleShare = async (f: DonorFile): Promise<void> => {
    await patch(f, { is_shared: !f.is_shared })
  }

  const copyLink = async (f: DonorFile): Promise<void> => {
    try {
      await navigator.clipboard.writeText(f.share_url)
      setCopied(f.file_id)
      setTimeout(() => setCopied((c) => (c === f.file_id ? null : c)), 1500)
    } catch {
      setError('Could not copy the link')
    }
  }

  const remove = async (f: DonorFile): Promise<void> => {
    setBusy(f.file_id)
    try {
      const res = await deleteDonorFile(f.file_id)
      setQuota(res.quota)
      setFiles((prev) => prev?.filter((x) => x.file_id !== f.file_id) ?? prev)
      replaceDonorFileId(f.file_id, null)
      if (playing?.id === f.file_id) setPlaying(null)
      if (preview?.id === f.file_id) setPreview(null)
      setConfirmDelete(null)
    } catch (err) {
      setError((err as Error).message || 'Could not delete file')
    } finally {
      setBusy(null)
    }
  }

  const togglePlay = async (f: DonorFile): Promise<void> => {
    if (playing?.id === f.file_id) { setPlaying(null); return }
    setBusy(f.file_id)
    try {
      const blob = await fetchDonorFileBlob(f.file_id)
      setPlaying({ id: f.file_id, url: URL.createObjectURL(blob) })
      setError(null)
    } catch (err) {
      setError((err as Error).message || 'Could not play file')
    } finally {
      setBusy(null)
    }
  }

  const togglePreview = async (f: DonorFile): Promise<void> => {
    if (preview?.id === f.file_id) { setPreview(null); return }
    setBusy(f.file_id)
    try {
      const blob = await fetchDonorFileBlob(f.file_id)
      setPreview({ id: f.file_id, url: URL.createObjectURL(blob) })
      setError(null)
    } catch (err) {
      setError((err as Error).message || 'Could not load image')
    } finally {
      setBusy(null)
    }
  }

  const openTagEditor = async (f: DonorFile): Promise<void> => {
    if (tagEdit?.id === f.file_id) { setTagEdit(null); return }
    setTagEdit({ id: f.file_id, tags: null, saving: false })
    try {
      const tags = await readMp3Tags(await fetchDonorFileBlob(f.file_id))
      setTagEdit((cur) => (cur?.id === f.file_id ? { ...cur, tags } : cur))
    } catch (err) {
      setTagEdit(null)
      setError((err as Error).message || 'Could not read tags')
    }
  }

  // The API can't rewrite a stored file, so saving tags means uploading the
  // retagged copy and removing the original. That gives the file a new id and
  // share token; the old link stops working.
  const saveTags = async (f: DonorFile, tags: Mp3Tags): Promise<void> => {
    setTagEdit({ id: f.file_id, tags, saving: true })
    setError(null)
    setNotice(null)
    let original: Blob | null = null
    let deletedOld = false
    try {
      original = await fetchDonorFileBlob(f.file_id)
      const tagged = new File([await writeMp3Tags(original, tags)], f.filename, { type: 'audio/mpeg' })
      if (quota && quota.remaining < tagged.size) {
        // No room for both copies: free the original first (kept in memory to restore on failure).
        await deleteDonorFile(f.file_id)
        deletedOld = true
      }
      setUploading({ name: f.filename, progress: 0 })
      const up = await uploadDonorFile(tagged, (p) => setUploading({ name: f.filename, progress: p }))
      let newQuota = up.quota
      if (!deletedOld) {
        try {
          newQuota = (await deleteDonorFile(f.file_id)).quota
        } catch (err) {
          throw new Error(`Saved the new copy but could not remove the old one: ${(err as Error).message}`)
        }
      }
      let saved = up.file
      if (f.is_shared) saved = await updateDonorFile(saved.file_id, { is_shared: true }).catch(() => saved)
      setQuota(newQuota)
      setFiles((prev) => [saved, ...(prev ?? []).filter((x) => x.file_id !== f.file_id)])
      replaceDonorFileId(f.file_id, saved.file_id)
      if (playing?.id === f.file_id) setPlaying(null)
      setTagEdit(null)
      setNotice(f.is_shared ? 'Tags saved. This file has a new share link - the old one no longer works.' : 'Tags saved.')
    } catch (err) {
      const message = (err as Error).message
      if (deletedOld && original) {
        try {
          const restored = await uploadDonorFile(new File([original], f.filename, { type: 'audio/mpeg' }))
          setQuota(restored.quota)
          setFiles((prev) => [restored.file, ...(prev ?? []).filter((x) => x.file_id !== f.file_id)])
          replaceDonorFileId(f.file_id, restored.file.file_id)
          setError(`Could not save tags (${message}). The original file was restored.`)
        } catch {
          setError(`Could not save tags and the original could not be restored: ${message}. Re-upload it from your device.`)
          void load()
        }
        setTagEdit(null)
        return
      }
      setError(message || 'Could not save tags')
      setTagEdit({ id: f.file_id, tags, saving: false })
      void load()
    } finally {
      setUploading(null)
    }
  }

  const download = async (f: DonorFile): Promise<void> => {
    setBusy(f.file_id)
    try {
      const blob = await fetchDonorFileBlob(f.file_id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = f.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      setError((err as Error).message || 'Could not download file')
    } finally {
      setBusy(null)
    }
  }

  const pct = quota && quota.quota > 0 ? Math.min(100, (quota.used / quota.quota) * 100) : 0

  return (
    <div>
      {quota && (
        <div className="py-2">
          <div className="flex items-baseline justify-between text-[11px] text-text-muted mb-1">
            <span>{formatBytes(quota.used)} of {formatBytes(quota.quota)} used</span>
            <span>{formatBytes(quota.remaining)} free</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--surface-overlay)] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-400' : 'bg-accent'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => void upload(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={!!uploading}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-60 my-2"
      >
        {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
        {uploading ? `Uploading ${Math.round(uploading.progress * 100)}%` : 'Upload files'}
      </button>
      {uploading && <p className="text-text-muted text-[11px] truncate">{uploading.name}</p>}
      <p className="text-text-muted text-[11px] pb-1">
        Audio and images, up to 100 MB each. Files are private unless you turn on a share link.
      </p>
      {error && <p className="text-red-400 text-[11px] py-1">{error}</p>}
      {notice && <p className="text-accent text-[11px] py-1">{notice}</p>}

      {!files && !error && (
        <div className="flex items-center gap-2 py-3 text-text-muted text-xs"><Loader2 size={13} className="animate-spin" />Loading files…</div>
      )}
      {files && files.length === 0 && <p className="text-text-muted text-xs py-3">No files yet.</p>}

      {files?.map((f) => {
        const image = isImageFile(f)
        const Icon = image ? FileImage : FileAudio
        const isBusy = busy === f.file_id
        const isRenaming = renaming?.id === f.file_id
        return (
          <div key={f.file_id} className="py-3 border-b border-[var(--border)] last:border-b-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-[#475569]">
                <Icon size={13} className="text-white" strokeWidth={2.25} />
              </div>
              <div className="min-w-0 flex-1">
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renaming.draft}
                    maxLength={255}
                    onChange={(e) => setRenaming({ id: f.file_id, draft: e.target.value })}
                    onBlur={() => void commitRename(f)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(f)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    className="w-full bg-[var(--surface-overlay)] rounded px-1.5 py-0.5 text-sm text-text-primary focus:outline-none"
                  />
                ) : (
                  <p className="text-text-primary text-sm truncate">{f.filename}</p>
                )}
                <p className="text-text-muted text-[11px] truncate">
                  {formatBytes(f.size)} · {new Date(f.created_at).toLocaleDateString()}
                  {f.is_shared && <span className="ml-1.5 text-accent">· Shared</span>}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1 mt-2 pl-[34px]">
              {image ? (
                <IconBtn label={preview?.id === f.file_id ? 'Hide preview' : 'Preview'} disabled={isBusy} onClick={() => void togglePreview(f)}>
                  {isBusy ? <Loader2 size={13} className="animate-spin" /> : preview?.id === f.file_id ? <X size={13} /> : <FileImage size={13} />}
                </IconBtn>
              ) : (
                <IconBtn label={playing?.id === f.file_id ? 'Stop' : 'Play'} disabled={isBusy} onClick={() => void togglePlay(f)}>
                  {isBusy ? <Loader2 size={13} className="animate-spin" /> : playing?.id === f.file_id ? <Pause size={13} /> : <Play size={13} />}
                </IconBtn>
              )}
              <IconBtn label="Download" disabled={isBusy} onClick={() => void download(f)}><Download size={13} /></IconBtn>
              {isDonorAudio(f) && (
                <IconBtn label="Add to playlist" onClick={() => { setPlaylistPicker((c) => (c === f.file_id ? null : f.file_id)); setNewPlaylistName('') }}>
                  <ListPlus size={13} />
                </IconBtn>
              )}
              {!image && canEditTags(f.filename) && (
                <IconBtn label="Edit tags" disabled={isBusy || tagEdit?.saving} onClick={() => void openTagEditor(f)}><Tag size={13} /></IconBtn>
              )}
              <IconBtn label="Rename" disabled={isBusy} onClick={() => setRenaming({ id: f.file_id, draft: f.filename })}><Pencil size={13} /></IconBtn>
              <IconBtn label={f.is_shared ? 'Stop sharing' : 'Share link'} disabled={isBusy} onClick={() => void toggleShare(f)}>
                {f.is_shared ? <Link2Off size={13} /> : <Link2 size={13} />}
              </IconBtn>
              {f.is_shared && f.share_url && (
                <IconBtn label={copied === f.file_id ? 'Copied' : 'Copy link'} onClick={() => void copyLink(f)}>
                  {copied === f.file_id ? <Check size={13} /> : <Copy size={13} />}
                </IconBtn>
              )}
              {confirmDelete === f.file_id ? (
                <span className="inline-flex items-center gap-2 ml-1">
                  <button onClick={() => setConfirmDelete(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                  <button
                    onClick={() => void remove(f)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60"
                  >
                    {isBusy && <Loader2 size={11} className="animate-spin" />}Delete
                  </button>
                </span>
              ) : (
                <IconBtn label="Delete" danger disabled={isBusy} onClick={() => setConfirmDelete(f.file_id)}><Trash2 size={13} /></IconBtn>
              )}
            </div>

            {playlistPicker === f.file_id && (
              <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
                {donorPlaylists.length === 0 && <p className="text-text-muted text-[11px] px-1 pb-1">No donor playlists yet.</p>}
                {donorPlaylists.map((p) => {
                  const inList = p.fileIds.includes(f.file_id)
                  return (
                    <button
                      key={p.id}
                      onClick={() => (inList ? removeFromDonorPlaylist(p.id, f.file_id) : addToDonorPlaylist(p.id, f.file_id))}
                      className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-text-primary hover:bg-[var(--surface-overlay)]"
                    >
                      <span className="truncate">{p.name}</span>
                      {inList && <Check size={13} className="text-accent shrink-0" />}
                    </button>
                  )
                })}
                <div className="flex items-center gap-2 pt-1.5">
                  <input
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newPlaylistName.trim()) { createDonorPlaylist(newPlaylistName.trim(), [f.file_id]); setNewPlaylistName('') }
                    }}
                    placeholder="New playlist…"
                    className="flex-1 min-w-0 bg-[var(--surface-overlay)] rounded px-2 py-1 text-sm text-text-primary focus:outline-none"
                  />
                  <button
                    onClick={() => { if (newPlaylistName.trim()) { createDonorPlaylist(newPlaylistName.trim(), [f.file_id]); setNewPlaylistName('') } }}
                    disabled={!newPlaylistName.trim()}
                    className="rounded-lg bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
                  >Create</button>
                </div>
              </div>
            )}
            {tagEdit?.id === f.file_id && (
              tagEdit.tags
                ? <TagEditor file={f} initial={tagEdit.tags} saving={tagEdit.saving} onCancel={() => setTagEdit(null)} onSave={(t) => void saveTags(f, t)} />
                : <div className="flex items-center gap-2 pt-2 text-text-muted text-xs"><Loader2 size={13} className="animate-spin" />Reading tags…</div>
            )}
            {playing?.id === f.file_id && (
              <audio ref={audioRef} src={playing.url} controls autoPlay onEnded={() => setPlaying(null)} className="w-full h-8 mt-2" />
            )}
            {preview?.id === f.file_id && (
              <img src={preview.url} alt={f.filename} className="mt-2 max-h-56 rounded-lg object-contain" />
            )}
          </div>
        )
      })}
    </div>
  )
}

const TAG_FIELDS: { key: 'title' | 'artist' | 'album' | 'year' | 'genre'; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'year', label: 'Year' },
  { key: 'genre', label: 'Genre' },
]

function TagEditor({ file, initial, saving, onCancel, onSave }: {
  file: DonorFile
  initial: Mp3Tags
  saving: boolean
  onCancel: () => void
  onSave: (t: Mp3Tags) => void
}): JSX.Element {
  const [tags, setTags] = useState<Mp3Tags>(initial)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const coverInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!tags.cover) { setCoverUrl(null); return }
    const url = URL.createObjectURL(new Blob([tags.cover.data], { type: tags.cover.mime || 'image/jpeg' }))
    setCoverUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [tags.cover])

  const pickCover = async (f: File | undefined): Promise<void> => {
    if (!f || !f.type.startsWith('image/')) return
    const data = await f.arrayBuffer()
    setTags((t) => ({ ...t, cover: { mime: f.type, data } }))
  }

  return (
    <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <div className="w-20 h-20 rounded-lg bg-[var(--surface-overlay)] overflow-hidden flex items-center justify-center">
            {coverUrl ? <img src={coverUrl} alt="" className="w-full h-full object-cover" /> : <FileAudio size={22} className="text-text-muted" />}
          </div>
          <input ref={coverInput} type="file" accept="image/*" className="hidden" onChange={(e) => void pickCover(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => coverInput.current?.click()}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary"
          ><ImagePlus size={12} />{tags.cover ? 'Change' : 'Add cover'}</button>
          {tags.cover && (
            <button type="button" onClick={() => setTags((t) => ({ ...t, cover: null }))} className="block text-[11px] text-text-muted hover:text-red-400">Remove</button>
          )}
        </div>
        <div className="flex-1 min-w-0 grid grid-cols-1 gap-1.5">
          {TAG_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-[11px] text-text-muted">{label}</span>
              <input
                value={tags[key]}
                maxLength={key === 'year' ? 4 : 200}
                inputMode={key === 'year' ? 'numeric' : undefined}
                onChange={(e) => setTags((t) => ({ ...t, [key]: e.target.value }))}
                className="flex-1 min-w-0 bg-[var(--surface-overlay)] rounded px-2 py-1 text-sm text-text-primary focus:outline-none"
              />
            </label>
          ))}
        </div>
      </div>
      <p className="text-text-muted text-[11px] mt-2">
        Saves by re-uploading {file.filename} with the new tags, so it gets a new file ID
        {file.is_shared ? ' and a new share link (the old link stops working)' : ''}. Other embedded data such as lyrics is not kept.
      </p>
      <div className="flex items-center justify-end gap-2 mt-2">
        <button onClick={onCancel} disabled={saving} className="text-xs text-text-muted hover:text-text-primary disabled:opacity-50">Cancel</button>
        <button
          onClick={() => onSave(tags)}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-60"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}Save tags
        </button>
      </div>
    </div>
  )
}

function IconBtn({ label, onClick, disabled, danger, children }: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg p-1.5 text-text-secondary hover:bg-[var(--surface-overlay)] disabled:opacity-50 ${
        danger ? 'hover:text-red-400' : 'hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}
