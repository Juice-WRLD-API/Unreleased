import { useState } from 'react'
import { Check } from 'lucide-react'
import { useDonorFilePlaylists } from '../hooks/useDonorFilePlaylists'

// The inline "Add to playlist" panel under a row in My files. Public
// playlists are greyed out: they can't hold donor files.
export default function DonorPlaylistPicker({ fileId }: { fileId: string }): JSX.Element {
  const { playlists, inList, toggle, createWith } = useDonorFilePlaylists(fileId)
  const [name, setName] = useState('')
  const create = (): void => {
    if (!name.trim()) return
    void createWith(name.trim())
    setName('')
  }

  return (
    <div className="mt-2 ml-[56px] rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
      {playlists.length === 0 && <p className="text-text-muted text-[11px] px-1 pb-1">No playlists yet.</p>}
      {playlists.map((p) => {
        const has = inList(p.id)
        const blocked = p.is_public && !has
        return (
          <button
            key={p.id}
            onClick={() => toggle(p.id)}
            disabled={blocked}
            title={blocked ? "Public playlists can't hold your own files" : undefined}
            className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-text-primary hover:bg-[var(--surface-overlay)] disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span className="truncate">{p.name}</span>
            {has && <Check size={13} className="text-accent shrink-0" />}
          </button>
        )
      })}
      <div className="flex items-center gap-2 pt-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create() }}
          placeholder="New playlist…"
          className="flex-1 min-w-0 bg-[var(--surface-overlay)] rounded px-2 py-1 text-sm text-text-primary focus:outline-none"
        />
        <button
          onClick={create}
          disabled={!name.trim()}
          className="rounded-lg bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
        >Create</button>
      </div>
    </div>
  )
}
