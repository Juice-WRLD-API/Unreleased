import { useEffect, useMemo, useState } from 'react'
import { getMyCompProposals } from '../lib/userApi'
import type { CompFileProposal } from '../lib/userApi'
import type { JWApiFileEntry } from '../lib/juicewrldApi'
import { COMP_UPLOADS_CHANGED } from '../lib/compUploads'

// The contributor's own still-pending comp proposals, projected onto the Files
// listing: things they proposed adding show up as "ghost" rows in the folder
// they'd land in, and existing rows a pending proposal would change (replace,
// delete, move away) get a pending marker. Shared by ApiFilesView desktop and
// mobile.

export interface PendingGhost {
  name: string
  path: string
  type: 'file' | 'directory'
  /** The proposal this ghost stands for. For an implied parent folder (an
   *  upload into a folder that doesn't exist yet) it's the first proposal
   *  found under that folder. */
  proposal: CompFileProposal
  /** How many pending proposals land at or under this path. */
  count: number
}

const norm = (p: string): string => p.replace(/^\/+|\/+$/g, '')

/** Path a pending proposal would create, and whether it's a folder - null for
 *  change types that add nothing new (replace, delete, delete_folder). */
function createdPath(p: CompFileProposal): { path: string; dir: boolean } | null {
  switch (p.change_type) {
    case 'upload': return { path: norm(p.file_path), dir: false }
    case 'create_folder': return { path: norm(p.file_path), dir: true }
    case 'move': return p.destination_path ? { path: norm(p.destination_path), dir: false } : null
    case 'rename_folder':
    case 'move_folder': return p.destination_path ? { path: norm(p.destination_path), dir: true } : null
    default: return null
  }
}

export function pendingChangeLabel(p: CompFileProposal): string {
  switch (p.change_type) {
    case 'replace': return 'Replacement pending'
    case 'delete':
    case 'delete_folder': return 'Deletion pending'
    case 'move':
    case 'move_folder': return 'Move pending'
    case 'rename_folder': return 'Rename pending'
    case 'create_folder': return 'New folder pending'
    default: return 'Upload pending'
  }
}

export function usePendingCompGhosts({ enabled, activeChannel, currentPath, entries, isSearching }: {
  enabled: boolean
  activeChannel: string
  currentPath: string
  entries: JWApiFileEntry[]
  isSearching: boolean
}): {
  ghosts: PendingGhost[]
  /** Pending proposal touching an existing entry (replace/delete/move source). */
  pendingFor: (path: string) => CompFileProposal | undefined
} {
  const [pending, setPending] = useState<CompFileProposal[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  // Uploads and staged changes announce themselves on this event when they
  // land, so a just-proposed file shows up without leaving the folder.
  useEffect(() => {
    const onChanged = (): void => setReloadKey(k => k + 1)
    window.addEventListener(COMP_UPLOADS_CHANGED, onChanged)
    return () => window.removeEventListener(COMP_UPLOADS_CHANGED, onChanged)
  }, [])

  useEffect(() => {
    if (!enabled) { setPending([]); return }
    let cancelled = false
    getMyCompProposals(activeChannel)
      .then((data) => { if (!cancelled) setPending(data.filter(p => p.status === 'pending')) })
      .catch(() => { if (!cancelled) setPending([]) })
    return () => { cancelled = true }
  }, [enabled, activeChannel, reloadKey])

  const ghosts = useMemo(() => {
    if (isSearching || pending.length === 0) return []
    const here = norm(currentPath)
    const prefix = here ? `${here}/` : ''
    const existing = new Set(entries.map(e => norm(e.path)))
    const byPath = new Map<string, PendingGhost>()
    for (const p of pending) {
      const target = createdPath(p)
      if (!target || !target.path.startsWith(prefix)) continue
      const rest = target.path.slice(prefix.length)
      if (!rest) continue
      const [first, ...deeper] = rest.split('/')
      const path = prefix + first
      if (existing.has(path)) continue
      const prev = byPath.get(path)
      if (prev) { prev.count++; continue }
      byPath.set(path, {
        name: first, path, proposal: p, count: 1,
        type: deeper.length > 0 || target.dir ? 'directory' : 'file',
      })
    }
    return [...byPath.values()].sort((a, b) =>
      a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name))
  }, [pending, currentPath, entries, isSearching])

  const touched = useMemo(() => {
    const m = new Map<string, CompFileProposal>()
    for (const p of pending) {
      if (p.change_type === 'upload' || p.change_type === 'create_folder') continue
      m.set(norm(p.file_path), p)
    }
    return m
  }, [pending])

  return { ghosts, pendingFor: (path) => touched.get(norm(path)) }
}
