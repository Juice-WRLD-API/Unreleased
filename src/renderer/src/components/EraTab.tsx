import { useState, useCallback, useEffect } from 'react'
import { useStrictModeSafeEffect } from '../hooks/useStrictModeSafeEffect'
import { Loader2, Plus, Check, AlertCircle, Clock, Trash2 } from 'lucide-react'
import * as erasApi from '../lib/erasApi'
import type { Era } from '../lib/erasApi'
import { Empty } from './adminShared'

function CreatePanel({ onCreated }: { onCreated: (era: Era) => void }): JSX.Element {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const era = await erasApi.adminCreateEra({ name: name.trim() })
      setName('')
      onCreated(era)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the era')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 p-4 space-y-3">
      <p className="text-sm font-bold text-text-primary flex items-center gap-2"><Plus size={14} /> New era</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        placeholder="Era name - e.g. Late 2019"
        className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40"
      />
      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>}
      <button
        onClick={submit}
        disabled={busy || !name.trim()}
        className="px-3 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        Create era
      </button>
    </div>
  )
}

function EditPanel({ era, onSaved, onDeleted }: { era: Era; onSaved: (era: Era) => void; onDeleted: () => void }): JSX.Element {
  const [name, setName] = useState(era.name)
  const [description, setDescription] = useState(era.description ?? '')
  const [timeFrame, setTimeFrame] = useState(era.time_frame ?? '')
  const [playCount, setPlayCount] = useState(String(era.play_count ?? 0))
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the working fields whenever a different era is selected - without
  // this the form would keep showing the previously selected era's edits.
  useEffect(() => {
    setName(era.name)
    setDescription(era.description ?? '')
    setTimeFrame(era.time_frame ?? '')
    setPlayCount(String(era.play_count ?? 0))
    setError(null)
  }, [era])

  const dirty = name !== era.name || description !== (era.description ?? '')
    || timeFrame !== (era.time_frame ?? '') || playCount !== String(era.play_count ?? 0)

  const save = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await erasApi.adminUpdateEra(era.id, {
        name: name.trim(),
        description,
        time_frame: timeFrame,
        play_count: Number(playCount) || 0,
      })
      onSaved(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save changes')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!confirm(`Delete "${era.name}"? This can't be undone.`)) return
    setDeleting(true)
    setError(null)
    try {
      await erasApi.adminDeleteEra(era.id)
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this era')
      setDeleting(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-[var(--border)] bg-surface-raised flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-text-primary truncate">{era.name}</p>
          <p className="text-[10px] text-text-muted">Era #{era.id} · {era.play_count} plays</p>
        </div>
        <button
          onClick={remove}
          disabled={deleting}
          className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold flex items-center gap-1.5 border border-red-500/20 disabled:opacity-40"
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          Delete
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">Time frame</label>
          <input
            value={timeFrame}
            onChange={(e) => setTimeFrame(e.target.value)}
            placeholder="e.g. January - June 2018"
            className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">Play count</label>
          <input
            type="number"
            value={playCount}
            onChange={(e) => setPlayCount(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2 text-sm text-text-primary tabular-nums focus:outline-none focus:border-accent/40"
          />
        </div>

        {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>}
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-[var(--border)]">
        <button
          onClick={save}
          disabled={busy || !dirty || !name.trim()}
          className="px-3 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Save changes
        </button>
      </div>
    </div>
  )
}

export default function EraTab(): JSX.Element {
  const [eras, setEras] = useState<Era[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    erasApi.fetchEraList()
      .then((list) => {
        setEras(list)
        setSelectedId((prev) => (prev != null && list.some((e) => e.id === prev) ? prev : null))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load eras'))
      .finally(() => setLoading(false))
  }, [])

  useStrictModeSafeEffect(() => { reload() }, [reload])

  const selected = eras.find((e) => e.id === selectedId) ?? null

  if (loading) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-text-muted" /></div>

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-80 shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden">
        {error && (
          <div className="m-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
            <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {eras.length === 0 && !error && <Empty label="No eras" />}
          {eras.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className={`w-full text-left px-4 py-3 border-b border-[var(--border)] transition-colors ${
                selectedId === e.id ? 'bg-accent/10' : 'hover:bg-surface-raised'
              }`}
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
        <div className="shrink-0 p-3 border-t border-[var(--border)]">
          <CreatePanel onCreated={(era) => { setEras((prev) => [...prev, era].sort((a, b) => a.name.localeCompare(b.name))); setSelectedId(era.id) }} />
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <Empty label="Select an era" />
        ) : (
          <EditPanel
            key={selected.id}
            era={selected}
            onSaved={(updated) => setEras((prev) => prev.map((e) => e.id === updated.id ? updated : e).sort((a, b) => a.name.localeCompare(b.name)))}
            onDeleted={() => { setEras((prev) => prev.filter((e) => e.id !== selected.id)); setSelectedId(null) }}
          />
        )}
      </div>
    </div>
  )
}
