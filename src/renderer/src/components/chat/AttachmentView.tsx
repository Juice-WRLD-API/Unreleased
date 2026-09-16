import { useEffect, useState } from 'react'
import { Download, FileText, Loader2, Lock, ShieldAlert } from 'lucide-react'
import { chatAttachmentUrl, type ChatAttachment } from '../../lib/chatApi'
import { useChatStore } from '../../store/chatStore'
import MediaLightbox, { type LightboxItem } from '../MediaLightbox'
import { formatBytes } from './ui'

type Kind = 'image' | 'video' | 'audio' | 'file'

function kindOf(mime: string, name: string): Kind {
  const m = mime.toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus', 'aac'].includes(ext)) return 'audio'
  return 'file'
}

interface Resolved {
  url: string
  downloadUrl: string
  name: string
  mime: string
  kind: Kind
}

function useResolved(att: ChatAttachment, conversationId: number | null, encrypted: boolean): { data: Resolved | null; error: string | null } {
  const meId = useChatStore((s) => s.meId)
  const [data, setData] = useState<Resolved | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (att.id < 0) return
    if (!encrypted || !conversationId) {
      setData({
        url: chatAttachmentUrl(att.id),
        downloadUrl: chatAttachmentUrl(att.id, { download: true }),
        name: att.name,
        mime: att.mime,
        kind: kindOf(att.mime, att.name),
      })
      return
    }
    if (!meId) return
    let objectUrl: string | null = null
    let cancelled = false
    setError(null)
    import('../../lib/chatE2E')
      .then((m) => m.decryptAttachment(meId, conversationId, att))
      .then((dec) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(dec.blob)
        setData({ url: objectUrl, downloadUrl: objectUrl, name: dec.name, mime: dec.mime, kind: kindOf(dec.mime, dec.name) })
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message === 'missing-key' ? 'Waiting for key' : 'Could not decrypt')
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // Keyed on the attachment's identity, not the object: store updates rebuild
    // message objects, and re-running would re-download and re-decrypt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [att.id, att.nonce, att.key_version, att.encrypted_name, conversationId, encrypted, meId])

  return { data, error }
}

function FileCard({ name, size, href, encrypted, busy, error }: {
  name: string
  size: number
  href?: string
  encrypted?: boolean
  busy?: boolean
  error?: string | null
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5">
      <span className="w-9 h-9 rounded-lg bg-accent/15 text-accent flex items-center justify-center shrink-0">
        {error ? <ShieldAlert size={17} className="text-text-muted" /> : busy ? <Loader2 size={17} className="animate-spin" /> : <FileText size={17} />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1 text-sm text-text-primary truncate">
          {encrypted && <Lock size={11} className="text-text-muted shrink-0" />}
          <span className="truncate">{name}</span>
        </span>
        <span className="block text-[11px] text-text-muted">{error ?? formatBytes(size)}</span>
      </span>
      {href && (
        <a href={href} download={name} target="_blank" rel="noopener noreferrer" title="Download" className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
          <Download size={16} />
        </a>
      )}
    </div>
  )
}

function Attachment({ att, conversationId, encrypted, onOpenMedia }: {
  att: ChatAttachment
  conversationId: number | null
  encrypted: boolean
  onOpenMedia: (item: LightboxItem) => void
}): JSX.Element {
  const { data, error } = useResolved(att, conversationId, encrypted)

  if (att.id < 0) return <FileCard name={att.name} size={att.size} busy />
  if (!data) return <FileCard name={encrypted ? 'Encrypted file' : att.name} size={att.size} encrypted={encrypted} busy={!error} error={error} />

  if (data.kind === 'image') {
    return (
      <button onClick={() => onOpenMedia({ url: data.url, type: 'image', name: data.name })} className="block rounded-xl overflow-hidden border border-[var(--border)] bg-surface-raised max-w-[min(420px,100%)] hover:brightness-110 transition">
        <img src={data.url} alt={data.name} loading="lazy" className="block max-h-80 w-auto object-contain" />
      </button>
    )
  }
  if (data.kind === 'video') {
    return (
      <video src={data.url} controls preload="metadata" className="block rounded-xl border border-[var(--border)] max-h-80 max-w-[min(480px,100%)] bg-black" />
    )
  }
  if (data.kind === 'audio') {
    return (
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-1 text-text-primary truncate">
            {encrypted && <Lock size={11} className="text-text-muted shrink-0" />}
            <span className="truncate">{data.name}</span>
          </span>
          <a href={data.downloadUrl} download={data.name} className="text-text-muted hover:text-text-primary shrink-0" title="Download"><Download size={15} /></a>
        </div>
        <audio src={data.url} controls preload="none" className="w-full h-9" />
      </div>
    )
  }
  return <FileCard name={data.name} size={att.size} href={data.downloadUrl} encrypted={encrypted} />
}

export default function AttachmentList({ attachments, conversationId, encrypted }: {
  attachments: ChatAttachment[]
  conversationId: number | null
  encrypted: boolean
}): JSX.Element | null {
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null)
  if (attachments.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {attachments.map((att) => (
        <Attachment
          key={att.id}
          att={att}
          conversationId={conversationId}
          encrypted={encrypted}
          onOpenMedia={(item) => setLightbox({ items: [item], index: 0 })}
        />
      ))}
      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNav={(index) => setLightbox((l) => (l ? { ...l, index } : l))}
        />
      )}
    </div>
  )
}
