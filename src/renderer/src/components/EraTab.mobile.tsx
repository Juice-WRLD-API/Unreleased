import { useState } from 'react'
import { Loader2, Plus, Check, AlertCircle, Clock, Trash2, ChevronLeft, X } from 'lucide-react'
import type { Era } from '../lib/erasApi'
import { Empty } from './adminShared'
import { useBackToClose } from '../hooks/useBackToClose'
import { useEraList, useCreateEra, useEditEra, sortByName } from '../hooks/useErasAdmin'

// Admin-only tab for managing Eras - same master/detail pattern as
// ChannelsTab.mobile (list swaps for a full-screen detail on tap), but
// simpler: an era has no sub-resource like channel membership, so the
// detail screen is just its edit form.

function CreatePanel({ onCreated, onClose }: { onCreated: (era: Era) => void; onClose: () => void }): JSX.Element {
  const { name, setName, busy, error, submit } = useCreateEra(onCreated)

  const onSubmit = async (): Promise<void> => {
    await submit()
    onClose()
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 p-4 space-y-3 m-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-bold text-text-primary flex items-center gap-2 flex-1"><Plus size={14} /> New era</p>
        <button onClick={onClose} title="Close" className="p-1 rounded text-text-muted active:text-text-primary"><X size={14} /></button>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Era name - e.g. Late 2019"
        className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40"
      />
      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>}
      <button
        onClick={onSubmit}
        disabled={busy || !name.trim()}
        className="px-3 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        Create era
      </button>
    </div>
  )
}

function EraDetail({ era, onBack, onSaved, onDeleted }: {
  era: Era
  onBack: () => void
  onSaved: (era: Era) => void
  onDeleted: () => void
}): JSX.Element {
  const {
    name, setName, description, setDescription, timeFrame, setTimeFrame, playCount, setPlayCount,
    busy, deleting, error, dirty, save, remove,
  } = useEditEra(era, onSaved, onDeleted)

  useBackToClose(onBack, true)

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)]">
        <button onClick={onBack} title="Back" className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-text-primary truncate">{era.name}</p>
          <p className="text-[11px] text-text-muted truncate">Era #{era.id} · {era.play_count} plays</p>
        </div>
        <button
          onClick={remove}
          disabled={deleting}
          className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-red-400 active:bg-red-500/10 transition-colors disabled:opacity-40"
          aria-label="Delete era"
        >
          {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent/40"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent/40"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">Time frame</span>
          <input
            value={timeFrame}
            onChange={(e) => setTimeFrame(e.target.value)}
            placeholder="e.g. January - June 2018"
            className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent/40"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">Play count</span>
          <input
            type="number"
            value={playCount}
            onChange={(e) => setPlayCount(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2.5 text-sm text-text-primary tabular-nums focus:outline-none focus:border-accent/40"
          />
        </label>

        {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>}
      </div>

      <div className="shrink-0 p-3 border-t border-[var(--border)]">
        <button
          onClick={save}
          disabled={busy || !dirty || !name.trim()}
          className="w-full h-11 rounded-xl bg-accent active:bg-accent/90 text-[var(--bg)] text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save changes
        </button>
      </div>
    </div>
  )
}

export default function EraTab(): JSX.Element {
  const { eras, setEras, loading, error, selectedId, setSelectedId, selected } = useEraList()
  const [creating, setCreating] = useState(false)

  if (loading) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-text-muted" /></div>

  if (selected) {
    return (
      <EraDetail
        key={selected.id}
        era={selected}
        onBack={() => setSelectedId(null)}
        onSaved={(updated) => setEras((prev) => sortByName(prev.map((e) => e.id === updated.id ? updated : e)))}
        onDeleted={() => { setEras((prev) => prev.filter((e) => e.id !== selected.id)); setSelectedId(null) }}
      />
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
        <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted flex items-center gap-1.5">
          <Clock size={12} /> Eras
        </p>
        <button
          onClick={() => setCreating((c) => !c)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/15 text-accent text-xs font-semibold"
        >
          <Plus size={12} /> New
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-2 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
          <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {creating && <CreatePanel onCreated={(era) => setEras((prev) => sortByName([...prev, era]))} onClose={() => setCreating(false)} />}

      <div className="flex-1 overflow-y-auto">
        {eras.length === 0 && !error && <Empty label="No eras" />}
        {eras.map((e) => (
          <button
            key={e.id}
            onClick={() => setSelectedId(e.id)}
            className="w-full text-left px-4 py-3 border-b border-[var(--border)] active:bg-surface-raised transition-colors"
          >
            <div className="flex items-center gap-2">
              <Clock size={13} className="text-text-muted shrink-0" />
              <span className="text-sm font-semibold text-text-primary truncate flex-1">{e.name}</span>
              <span className="text-[10px] text-text-muted tabular-nums shrink-0">{e.play_count}</span>
            </div>
            {e.time_frame && <p className="text-[10px] text-text-muted mt-0.5 truncate">{e.time_frame}</p>}
          </button>
        ))}
      </div>
    </div>
  )
}
