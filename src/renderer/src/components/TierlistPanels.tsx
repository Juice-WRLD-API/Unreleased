// Panel bodies shared by both Tier List views: the saved-lists manager and the
// song-pool filters. Each view supplies its own chrome around them (a centered
// modal on desktop, a bottom Sheet on mobile); `touch` only scales hit areas.
import { useState } from 'react'
import {
  Check, Copy, Pencil, Plus, RefreshCw, Trash2, Disc3, ListOrdered, Globe, Lock, Link, Cloud, CloudOff, Music2,
} from 'lucide-react'
import { POOL_LABELS } from '../lib/heardle'
import type { HeardleSong, PoolId } from '../lib/heardle'
import { rankedCount } from '../lib/tierlist'
import type { Tierlist } from '../lib/tierlist'
import { smallCoverUrl } from '../lib/juicewrldApi'
import type { Album } from '../lib/albumsApi'
import type { TierlistData } from '../hooks/useTierlistData'

function filterSummary(l: Tierlist, albums: Album[]): string {
  if (l.filters.albumId !== null) {
    const title = albums.find((a) => a.id === l.filters.albumId)?.title ?? 'Album'
    return l.filters.categories.includes('unreleased') ? `${title} + other versions` : title
  }
  const cats = l.filters.categories.map((c) => POOL_LABELS[c]).join(' + ')
  return l.filters.eras.length ? `${cats} · ${l.filters.eras.join(', ')}` : cats
}

const inputCls = 'w-full px-3 rounded-lg bg-[var(--surface-overlay)] border border-[var(--border)] text-sm text-text-primary focus:outline-none focus:border-accent/50'

function AlbumSelect({ albums, value, onChange, touch, emptyLabel }: {
  albums: Album[]
  value: number | null
  onChange: (id: number | null) => void
  touch: boolean
  emptyLabel: string
}): JSX.Element {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={`${inputCls} ${touch ? 'h-11' : 'py-1.5'}`}
    >
      <option value="">{emptyLabel}</option>
      {albums.map((a) => (
        <option key={a.id} value={a.id}>
          {a.title}{a.release_date ? ` (${a.release_date.slice(0, 4)})` : ''}
        </option>
      ))}
    </select>
  )
}

// ─── Saved lists ─────────────────────────────────────────────────────────────

export function ListsPanelBody({ data, touch, onDone }: {
  data: TierlistData
  touch: boolean
  onDone: () => void
}): JSX.Element {
  const {
    lists, list: active, albums, switchList, createList, renameList, duplicateList, deleteList,
    setListPublic, shareUrl, syncState, signedIn, retrySync,
  } = data
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const canShare = signedIn && syncState !== 'unsupported'

  const copyLink = async (l: Tierlist): Promise<void> => {
    const url = shareUrl(l)
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(l.id)
      window.setTimeout(() => setCopiedId((cur) => (cur === l.id ? null : cur)), 1500)
    } catch {}
  }
  const [renameValue, setRenameValue] = useState('')
  const [newName, setNewName] = useState('')
  const [newAlbum, setNewAlbum] = useState<number | null>(null)

  const iconBtn = `${touch ? 'w-10 h-10' : 'w-7 h-7'} shrink-0 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay active:bg-surface-overlay transition-colors`

  const submitNew = (): void => {
    const albumTitle = newAlbum !== null ? albums.find((a) => a.id === newAlbum)?.title : undefined
    createList(newName || albumTitle || '', newAlbum)
    setNewName('')
    setNewAlbum(null)
    onDone()
  }

  const commitRename = (): void => {
    if (renamingId) renameList(renamingId, renameValue)
    setRenamingId(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <SyncBanner state={syncState} onRetry={retrySync} />
      <div className="flex flex-col gap-1.5">
        {[...lists].sort((a, b) => b.updatedAt - a.updatedAt).map((l) => {
          const isActive = l.id === active.id
          return (
            <div
              key={l.id}
              className={`flex items-center gap-1 rounded-xl border pl-3 pr-1 ${touch ? 'py-1.5' : 'py-1'} ${
                isActive ? 'border-accent/40 bg-accent/10' : 'border-[var(--border)]'
              }`}
            >
              {renamingId === l.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  maxLength={60}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  className={`${inputCls} ${touch ? 'h-10' : 'py-1'} flex-1`}
                />
              ) : (
                <button
                  onClick={() => { switchList(l.id); onDone() }}
                  className="flex-1 min-w-0 text-left py-1"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-text-primary truncate">{l.name}</span>
                    {isActive && <Check size={13} className="text-accent shrink-0" />}
                  </div>
                  <div className="text-[11px] text-text-muted truncate">
                    {l.isPublic && canShare && <Globe size={10} className="inline -mt-0.5 mr-1 text-accent" />}
                    {rankedCount(l)} ranked · {filterSummary(l, albums)}
                  </div>
                </button>
              )}
              {canShare && (
                <button
                  onClick={() => setListPublic(l.id, !l.isPublic)}
                  title={l.isPublic ? 'Public - anyone with the link can view. Click to make private.' : 'Private. Click to let others view it.'}
                  aria-label={l.isPublic ? 'Make private' : 'Make public'}
                  className={`${iconBtn} ${l.isPublic ? '!text-accent' : ''}`}
                >
                  {l.isPublic ? <Globe size={14} /> : <Lock size={14} />}
                </button>
              )}
              {canShare && l.isPublic && (
                <button
                  onClick={() => void copyLink(l)}
                  disabled={!shareUrl(l)}
                  title={shareUrl(l) ? 'Copy share link' : 'Saving to your account…'}
                  aria-label="Copy share link"
                  className={`${iconBtn} disabled:opacity-40`}
                >
                  {copiedId === l.id ? <Check size={14} className="text-accent" /> : <Link size={14} />}
                </button>
              )}
              <button
                onClick={() => { setRenamingId(l.id); setRenameValue(l.name) }}
                title="Rename"
                aria-label="Rename"
                className={iconBtn}
              >
                <Pencil size={14} />
              </button>
              <button onClick={() => duplicateList(l.id)} title="Duplicate" aria-label="Duplicate" className={iconBtn}>
                <Copy size={14} />
              </button>
              <button
                onClick={() => deleteList(l.id)}
                title="Delete"
                aria-label="Delete"
                className={`${iconBtn} hover:!text-red-400`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-dashed border-[var(--border)] p-3 flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-text-muted">New tier list</span>
        <input
          value={newName}
          maxLength={60}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitNew() }}
          placeholder={newAlbum !== null ? albums.find((a) => a.id === newAlbum)?.title ?? 'Name' : 'Name'}
          className={`${inputCls} ${touch ? 'h-11' : 'py-1.5'}`}
        />
        <AlbumSelect albums={albums} value={newAlbum} onChange={setNewAlbum} touch={touch} emptyLabel="Any songs (no album)" />
        <button
          onClick={submitNew}
          className={`${touch ? 'h-11' : 'py-2'} rounded-lg bg-accent/15 border border-accent/40 text-text-primary text-sm font-semibold hover:bg-accent/25 active:bg-accent/25 transition-colors flex items-center justify-center gap-1.5`}
        >
          <Plus size={14} /> Create
        </button>
      </div>
    </div>
  )
}

function SyncBanner({ state, onRetry }: { state: TierlistData['syncState']; onRetry: () => void }): JSX.Element {
  const base = 'flex items-center gap-2 rounded-lg px-3 py-2 text-[11px]'
  switch (state) {
    case 'signed-out':
      return (
        <div className={`${base} border border-[var(--border)] text-text-muted`}>
          <CloudOff size={13} className="shrink-0" />
          Saved on this device. Sign in to keep your tier lists on your account and share them.
        </div>
      )
    case 'unsupported':
      return (
        <div className={`${base} border border-[var(--border)] text-text-muted`}>
          <CloudOff size={13} className="shrink-0" />
          Account saving isn't available on this server yet - lists are saved on this device.
        </div>
      )
    case 'error':
      return (
        <div className={`${base} border border-red-500/30 bg-red-500/10 text-red-400`}>
          <CloudOff size={13} className="shrink-0" />
          <span className="flex-1">Couldn't save to your account. Your lists are still on this device.</span>
          <button onClick={onRetry} className="font-semibold underline shrink-0">Retry</button>
        </div>
      )
    default:
      return (
        <div className={`${base} text-text-muted`}>
          {state === 'syncing'
            ? <RefreshCw size={13} className="shrink-0 animate-spin" />
            : <Cloud size={13} className="shrink-0 text-accent" />}
          {state === 'syncing' ? 'Saving to your account…' : 'Saved to your account'}
        </div>
      )
  }
}

// ─── Someone else's list (read-only) ─────────────────────────────────────────

function ViewerChip({ song }: { song: HeardleSong }): JSX.Element {
  return (
    <div title={song.name} className="shrink-0 w-14 sm:w-16">
      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden border-2 border-[var(--border)]">
        {song.imageUrl ? (
          <img src={smallCoverUrl(song.imageUrl)} alt="" draggable={false} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-[var(--surface-overlay)] flex items-center justify-center">
            <Music2 size={18} className="text-text-muted" />
          </div>
        )}
      </div>
      <div className="mt-1 text-[9px] leading-tight text-text-muted text-center line-clamp-2 break-words">
        {song.name}
      </div>
    </div>
  )
}

export function TierlistViewer({ data, touch }: { data: TierlistData; touch: boolean }): JSX.Element | null {
  const { viewing, closeViewing, saveViewingCopy, viewingSongsInTier, poolLoading } = data
  if (!viewing) return null
  const btn = `${touch ? 'h-11' : 'py-2'} px-4 rounded-xl text-sm font-semibold transition-colors`

  if (viewing.status !== 'ready') {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-text-muted mb-4">
          {viewing.status === 'loading' ? 'Loading tier list…' : viewing.message}
        </p>
        {viewing.status === 'error' && (
          <button onClick={closeViewing} className={`${btn} border border-[var(--border)] text-text-primary`}>
            Go to my tier lists
          </button>
        )}
      </div>
    )
  }

  const { list } = viewing
  return (
    <div>
      <div className="text-center mb-5">
        <h2 className="text-text-primary text-xl font-bold">{list.name}</h2>
        <p className="text-xs text-text-muted mt-1">
          {list.owner?.display_name ? `by ${list.owner.display_name} · ` : ''}{list.ranked_count} ranked
        </p>
        <div className="flex items-center justify-center gap-2 mt-3">
          <button onClick={saveViewingCopy} className={`${btn} bg-accent/15 border border-accent/40 text-text-primary hover:bg-accent/25`}>
            Save a copy
          </button>
          <button onClick={closeViewing} className={`${btn} border border-[var(--border)] text-text-muted hover:text-text-primary`}>
            My tier lists
          </button>
        </div>
      </div>
      {poolLoading ? (
        <p className="text-xs text-text-muted text-center py-6">Loading songs…</p>
      ) : (
        <div className="space-y-1.5">
          {(list.data?.tiers ?? []).map((tier) => (
            <div key={tier.id} className="flex rounded-xl overflow-hidden border border-[var(--border)]">
              <div
                className="w-16 sm:w-20 shrink-0 flex items-center justify-center text-center px-1.5 py-3 font-black text-sm leading-tight"
                style={{ background: tier.color, color: 'rgba(0,0,0,0.75)' }}
              >
                {tier.label}
              </div>
              <div className="flex-1 min-h-[5.5rem] bg-[var(--surface-overlay)]/30 p-1.5 flex flex-wrap gap-1.5 content-start">
                {viewingSongsInTier(tier.id).map((s) => <ViewerChip key={s.id} song={s} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export function FiltersPanelBody({ data, touch }: { data: TierlistData; touch: boolean }): JSX.Element {
  const {
    filters, albums, album, eraOptions, toggleCategory, toggleEra, clearEras, setAlbum,
    refreshing, refreshSongs, filteredCount, rankedInFilter,
  } = data
  const albumMode = filters.albumId !== null

  // In album mode the two catalogue toggles mean "the album's tracks" and
  // "their other versions", which is what the user is actually choosing.
  const catLabel = (cat: PoolId): { title: string; sub?: string } => {
    if (!albumMode) return { title: POOL_LABELS[cat] }
    return cat === 'released'
      ? { title: 'Album tracks' }
      : { title: 'Other versions', sub: 'OGs and alternate takes of the album\'s songs' }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="text-xs text-text-muted mb-1.5 flex items-center gap-1.5"><Disc3 size={12} /> Album</span>
        <AlbumSelect albums={albums} value={filters.albumId} onChange={setAlbum} touch={touch} emptyLabel="All songs" />
        {albumMode && !album && albums.length === 0 && (
          <span className="text-[11px] text-text-muted mt-1 block">Loading albums…</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {(['released', 'unreleased'] as PoolId[]).map((cat) => {
          const on = filters.categories.includes(cat)
          const { title, sub } = catLabel(cat)
          return (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className={`flex items-center justify-between gap-2 px-3 ${touch ? 'min-h-12 py-2' : 'py-2'} rounded-lg border text-sm text-left transition-colors ${
                on ? 'border-accent/40 bg-accent/10 text-text-primary' : 'border-[var(--border)] text-text-muted'
              }`}
            >
              <span>
                {title}
                {sub && <span className="block text-[11px] text-text-muted">{sub}</span>}
              </span>
              {on && <Check size={14} className="text-accent shrink-0" />}
            </button>
          )
        })}
      </div>

      {!albumMode && eraOptions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-text-muted flex items-center gap-1.5"><ListOrdered size={12} /> Eras</span>
            {filters.eras.length > 0 && (
              <button onClick={clearEras} className="text-[11px] text-accent">
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {eraOptions.map(({ era, count }) => {
              const on = filters.eras.includes(era)
              return (
                <button
                  key={era}
                  onClick={() => toggleEra(era)}
                  className={`px-2.5 ${touch ? 'h-9' : 'py-1'} rounded-full border text-xs transition-colors ${
                    on ? 'border-accent/40 bg-accent/15 text-text-primary' : 'border-[var(--border)] text-text-muted hover:text-text-primary'
                  }`}
                >
                  {era} <span className="opacity-60">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border)]">
        <span className="text-[11px] text-text-muted pt-2">
          {rankedInFilter} of {filteredCount} ranked
        </span>
        <button
          onClick={() => void refreshSongs()}
          disabled={refreshing}
          title="Refetch songs to pick up new songs and edited covers"
          className="mt-2 flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh songs'}
        </button>
      </div>
    </div>
  )
}
