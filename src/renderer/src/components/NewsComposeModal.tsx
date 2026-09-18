import { useState, useRef } from 'react'
import { ModalOverlay, LockToggle } from './Modal'
import { X, ImagePlus, Paperclip, Trash2, Star, FileText } from 'lucide-react'
import { compressImageFile } from '../lib/userApi'
import Markdown from './Markdown'
import {
  createNewsItem, updateNewsItem, uploadAttachment, isImageAttachment, MAX_ATTACHMENT_BYTES,
  type NewsItem, type NewsChannel, type NewsAttachment,
} from '../lib/newsApi'
import { errorMessage } from '../lib/format'

// An attachment row in the composer: either one already hosted on the post
// (kept as-is) or a freshly-picked local file (uploaded on publish).
type PendingAtt =
  | { kind: 'existing'; att: NewsAttachment }
  | { kind: 'new'; file: File }

function attName(a: PendingAtt): string { return a.kind === 'existing' ? a.att.name : a.file.name }
function attSize(a: PendingAtt): number { return a.kind === 'existing' ? a.att.size : a.file.size }
function attIsImage(a: PendingAtt): boolean {
  return a.kind === 'existing' ? isImageAttachment(a.att) : a.file.type.startsWith('image/')
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface Props {
  channels: NewsChannel[]
  // Pre-selected channel for a new post (ignored when editing).
  initialChannel?: string
  // When set, the modal edits this post instead of creating a new one.
  editing?: NewsItem | null
  onClose: () => void
  onSaved: (item: NewsItem) => void
}

export default function NewsComposeModal({ channels, initialChannel, editing, onClose, onSaved }: Props): JSX.Element {
  const [title, setTitle] = useState(editing?.title ?? '')
  const [channel, setChannel] = useState(editing?.channel ?? initialChannel ?? channels[0]?.id ?? '')
  const [category, setCategory] = useState(editing?.category ?? '')
  const [summary, setSummary] = useState(editing?.summary ?? '')
  const [body, setBody] = useState(editing?.body ?? '')
  const [featured, setFeatured] = useState(editing?.featured ?? false)
  const [bodyPreview, setBodyPreview] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(editing?.image_url ?? null)
  // Existing attachments are kept as-is; newly picked files are held locally and
  // uploaded on publish (see save).
  const [attachments, setAttachments] = useState<PendingAtt[]>(
    editing?.attachments.map((att) => ({ kind: 'existing' as const, att })) ?? [],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const pickImage = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      setImageUrl(await compressImageFile(file, 1280, 400))
    } catch {
      setError('Could not read that image')
    }
  }

  const pickFiles = (files: FileList | null): void => {
    if (!files || files.length === 0) return
    setError(null)
    const picked = Array.from(files)
    const tooBig = picked.find((f) => f.size > MAX_ATTACHMENT_BYTES)
    if (tooBig) {
      setError(`"${tooBig.name}" is larger than ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB`)
      return
    }
    setAttachments((prev) => [...prev, ...picked.map((file) => ({ kind: 'new' as const, file }))])
  }

  const removeAttachment = (i: number): void => setAttachments((prev) => prev.filter((_, idx) => idx !== i))

  const canSave = title.trim() && channel && !saving

  const save = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      // Upload any newly-picked files first, then reference the hosted results.
      const resolved: NewsAttachment[] = await Promise.all(
        attachments.map((a) => (a.kind === 'existing' ? a.att : uploadAttachment(a.file))),
      )
      const payload = {
        title: title.trim(),
        channel,
        category: category.trim() || null,
        summary: summary.trim(),
        body,
        featured,
        image_url: imageUrl,
        attachments: resolved,
      }
      const saved = editing
        ? await updateNewsItem(editing.id, payload)
        : await createNewsItem(payload)
      onSaved(saved)
    } catch (err) {
      setError(errorMessage(err, 'Failed to save'))
      setSaving(false)
    }
  }

  const label = 'block text-xs font-semibold text-text-muted mb-1'
  const field = 'w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors'

  return (
    <ModalOverlay
      onClose={onClose}
      zIndexClassName="z-[170]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-lg max-h-[92svh]"
      minWidth={420} minHeight={420}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
      <div className="bg-surface w-full h-full flex flex-col overflow-hidden">
        <div
          className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-surface cursor-grab active:cursor-grabbing"
          onMouseDown={onHandleMouseDown}
        >
          <h2 className="flex items-center gap-2 text-text-primary text-sm font-semibold">
            <FileText size={15} className="text-accent" /> {editing ? 'Edit post' : 'New post'}
          </h2>
          <div className="flex items-center gap-1">
            {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
            <button onClick={onClose} disabled={saving} className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-50">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {/* Lead image */}
          <div>
            <span className={label}>Cover image</span>
            <input ref={imageInput} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
            {imageUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-[var(--border)]">
                <img src={imageUrl} alt="" className="w-full aspect-[16/7] object-cover" />
                <button
                  onClick={() => { setImageUrl(null); if (imageInput.current) imageInput.current.value = '' }}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
                  title="Remove image"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => imageInput.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-6 rounded-xl border border-dashed border-[var(--border)] text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors text-sm"
              >
                <ImagePlus size={16} /> Add cover image
              </button>
            )}
          </div>

          <div>
            <label className={label}>Title</label>
            <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's the news?" maxLength={200} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Channel</label>
              <select className={field} value={channel} onChange={(e) => setChannel(e.target.value)}>
                {channels.length === 0 && <option value="">No channels</option>}
                {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Tag <span className="text-text-muted/60 font-normal">(optional)</span></label>
              <input className={field} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Release" maxLength={40} />
            </div>
          </div>

          <div>
            <label className={label}>Summary <span className="text-text-muted/60 font-normal">(optional)</span></label>
            <textarea className={`${field} resize-none`} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One or two lines shown in the feed" maxLength={280} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className={`${label} mb-0`}>Body</span>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-text-muted/70">Markdown supported</span>
                <div className="flex rounded-md overflow-hidden border border-[var(--border)]">
                  {(['write', 'preview'] as const).map((mode) => {
                    const active = (mode === 'preview') === bodyPreview
                    return (
                      <button
                        key={mode}
                        onClick={() => setBodyPreview(mode === 'preview')}
                        className={`px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'}`}
                      >
                        {mode}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            {bodyPreview ? (
              <div className="w-full min-h-[120px] bg-[var(--surface-raised)] border border-[var(--border)] rounded-lg px-3 py-2">
                {body.trim()
                  ? <Markdown>{body}</Markdown>
                  : <p className="text-sm text-text-muted">Nothing to preview yet.</p>}
              </div>
            ) : (
              <textarea className={`${field} resize-y min-h-[120px] font-mono`} rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Full post… **bold**, _italic_, [links](https://…), lists, > quotes" />
            )}
          </div>

          {/* Attachments */}
          <div>
            <span className={label}>Attachments</span>
            <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { pickFiles(e.target.files); if (fileInput.current) fileInput.current.value = '' }} />
            {attachments.length > 0 && (
              <ul className="space-y-1.5 mb-2">
                {attachments.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
                    {attIsImage(a) ? <ImagePlus size={14} className="text-text-muted shrink-0" /> : <Paperclip size={14} className="text-text-muted shrink-0" />}
                    <span className="text-xs text-text-primary truncate flex-1">{attName(a)}</span>
                    {a.kind === 'new' && <span className="text-[10px] text-accent shrink-0 uppercase tracking-wide">new</span>}
                    <span className="text-[10px] text-text-muted shrink-0">{humanSize(attSize(a))}</span>
                    <button onClick={() => removeAttachment(i)} disabled={saving} className="text-text-muted hover:text-red-400 transition-colors shrink-0 disabled:opacity-40" title="Remove">
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-2 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              <Paperclip size={14} /> Attach files
            </button>
          </div>

          {/* Featured */}
          <button
            onClick={() => setFeatured((f) => !f)}
            className={`flex items-center gap-2 text-sm transition-colors ${featured ? 'text-accent' : 'text-text-muted hover:text-text-primary'}`}
          >
            <Star size={15} className={featured ? 'fill-current' : ''} />
            Feature this post at the top of the feed
          </button>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)] bg-surface">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Publish'}
          </button>
        </div>
      </div>
      )}
    </ModalOverlay>
  )
}
