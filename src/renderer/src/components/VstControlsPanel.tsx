import { memo, useRef, useState } from 'react'
import { Check, RotateCcw, Save, Search, Trash2, X } from 'lucide-react'
import type { VstParam } from '../lib/vstPlugins'

type SetFn = (id: number, value: number) => void
export interface VstPresetApi {
  names: string[]
  save: (name: string) => Promise<void>
  load: (name: string) => void
  remove: (name: string) => Promise<void>
}

/** A plug-in's parameters as controls that fit them - switches for on/off, buttons or a menu for
 *  named steps, knobs for the rest - whatever the plug-in's own window looks like. */
export default function VstControlsPanel({ params, onSet, presets }: { params: VstParam[]; onSet: SetFn; presets?: VstPresetApi }): JSX.Element {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q ? params.filter((p) => p.name.toLowerCase().includes(q)) : params
  const changed = params.filter((p) => !p.ro && Math.abs(p.value - p.def) > 1e-6)
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {presets && <PresetBar presets={presets} />}
      <div className="px-2 pt-2 shrink-0 flex items-center gap-2">
        {params.length > 8 ? (
          <div className="flex-1 min-w-0 flex items-center gap-1.5 h-6 px-2 rounded bg-[var(--surface-raised)]">
            <Search size={12} className="text-text-muted shrink-0" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${params.length} parameters`} className="flex-1 min-w-0 bg-transparent text-xs text-text-primary outline-none" />
          </div>
        ) : <div className="flex-1" />}
        <button
          className="h-6 px-2 shrink-0 rounded-md text-[11px] flex items-center gap-1 bg-[var(--surface-raised)] text-text-secondary hover:text-text-primary disabled:opacity-40"
          title="Put every parameter back to its default"
          disabled={!changed.length}
          onClick={() => { for (const p of changed) onSet(p.id, p.def) }}
        >
          <RotateCcw size={11} /> Reset all
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {!params.length && <div className="px-1 text-[11px] text-text-muted">This plug-in has no adjustable parameters.</div>}
        {params.length > 0 && !shown.length && <div className="px-1 text-[11px] text-text-muted">No parameter matches.</div>}
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))' }}>
          {shown.map((p) => <ParamCard key={p.id} param={p} onSet={onSet} />)}
        </div>
      </div>
    </div>
  )
}

/** Pick a saved preset to load it; save the current values under a name; delete the picked one. */
function PresetBar({ presets }: { presets: VstPresetApi }): JSX.Element {
  const [active, setActive] = useState('')
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const known = presets.names.includes(active) ? active : ''
  const commit = (): void => {
    const n = name.trim()
    if (!n) return
    void presets.save(n).then(() => setActive(n))
    setNaming(false)
  }
  const btn = 'h-6 w-6 shrink-0 rounded-md flex items-center justify-center bg-[var(--surface-raised)] text-text-secondary hover:text-text-primary disabled:opacity-40'
  return (
    <div className="px-2 pt-2 shrink-0 flex items-center gap-1.5">
      {naming ? (
        <>
          <input
            autoFocus value={name} maxLength={60} placeholder="Preset name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setNaming(false) }}
            className="flex-1 min-w-0 h-6 px-2 rounded bg-[var(--surface-raised)] text-xs text-text-primary outline-none border border-[var(--accent)]"
          />
          <button className={btn} title="Save preset" disabled={!name.trim()} onClick={commit}><Check size={13} /></button>
          <button className={btn} title="Cancel" onClick={() => setNaming(false)}><X size={13} /></button>
        </>
      ) : (
        <>
          <select
            value={known} disabled={!presets.names.length}
            onChange={(e) => { setActive(e.target.value); if (e.target.value) presets.load(e.target.value) }}
            className="flex-1 min-w-0 h-6 rounded bg-[var(--surface-raised)] border border-[var(--border)] text-[11px] text-text-primary outline-none px-1"
          >
            <option value="">{presets.names.length ? 'Presets' : 'No presets saved yet'}</option>
            {presets.names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className={btn} title="Save the current values as a preset" onClick={() => { setName(known); setNaming(true) }}><Save size={13} /></button>
          <button className={btn} title="Delete this preset" disabled={!known} onClick={() => { void presets.remove(known); setActive('') }}><Trash2 size={13} /></button>
        </>
      )}
    </div>
  )
}

/** Which named option a value falls on, and the value that picks option `i`. */
const optionAt = (p: VstParam): number => (p.cuts ? p.cuts.filter((c) => p.value >= c).length : Math.round(p.value * p.steps))
const optionValue = (p: VstParam, i: number): number => p.levels?.[i] ?? i / p.steps

const ParamCard = memo(function ParamCard({ param: p, onSet }: { param: VstParam; onSet: SetFn }): JSX.Element {
  const named = p.options && p.options.length >= 2 ? p.options : null
  const isSwitch = p.steps === 1 || named?.length === 2
  const options = named && named.length > 2 ? named : null
  // Long lists of names get a menu; a few short ones get buttons across the whole card.
  const menu = !!options && (options.length > 4 || options.some((o) => o.length > 7))
  const wide = !!options && !menu
  const readout = p.text ? `${p.text}${p.units && !p.text.includes(p.units) ? ` ${p.units}` : ''}` : p.value.toFixed(2)
  return (
    <div
      className={`min-w-0 flex flex-col items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-raised)]/40 px-1.5 py-1.5 ${wide ? 'col-span-2' : ''} ${p.ro ? 'opacity-60' : ''}`}
      onDoubleClick={() => { if (!p.ro && !options) onSet(p.id, p.def) }}
      title={`${p.name}${p.ro || options ? '' : ' - double-click to reset'}`}
    >
      <div className="w-full truncate text-center text-[10px] leading-3 text-text-secondary">{p.name}</div>
      {/* Names line up along the top; whatever the control is sits in the middle of what's left. */}
      <div className="flex-1 w-full flex flex-col items-center justify-center gap-1">
        {isSwitch ? <Switch p={p} onSet={onSet} /> : options ? (menu ? <Menu p={p} options={options} onSet={onSet} /> : <Segments p={p} options={options} onSet={onSet} />) : <Knob p={p} onSet={onSet} />}
        {!options && <div className="w-full truncate text-center text-[10px] leading-3 tabular-nums text-text-primary">{readout}</div>}
      </div>
    </div>
  )
})

function Switch({ p, onSet }: { p: VstParam; onSet: SetFn }): JSX.Element {
  const named = p.options && p.options.length === 2
  const on = named ? optionAt(p) === 1 : p.value >= 0.5
  return (
    <button
      role="switch" aria-checked={on} disabled={p.ro}
      onClick={() => onSet(p.id, named ? optionValue(p, on ? 0 : 1) : on ? 0 : 1)}
      className={`relative w-10 h-[22px] rounded-full transition-colors disabled:cursor-default ${on ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
    >
      <span className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : ''}`} />
    </button>
  )
}

function Segments({ p, options, onSet }: { p: VstParam; options: string[]; onSet: SetFn }): JSX.Element {
  const at = optionAt(p)
  return (
    <div className="flex w-full rounded overflow-hidden border border-[var(--border)]">
      {options.map((o, i) => (
        <button
          key={i} disabled={p.ro} onClick={() => onSet(p.id, optionValue(p, i))} title={o}
          className={`flex-1 min-w-0 truncate h-5 px-1 text-[10px] transition-colors ${i === at ? 'bg-[var(--accent)] text-white' : 'text-text-secondary hover:text-text-primary hover:bg-[var(--surface-raised)]'}`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function Menu({ p, options, onSet }: { p: VstParam; options: string[]; onSet: SetFn }): JSX.Element {
  return (
    <select
      value={optionAt(p)} disabled={p.ro}
      onChange={(e) => onSet(p.id, optionValue(p, Number(e.target.value)))}
      className="w-full h-6 rounded bg-[var(--surface-raised)] border border-[var(--border)] text-[11px] text-text-primary outline-none px-1"
    >
      {options.map((o, i) => <option key={i} value={i}>{o}</option>)}
    </select>
  )
}

// ─── The knob ────────────────────────────────────────────────────────────────

const SWEEP = 135 // degrees either side of straight up
const point = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  return [22 + r * Math.sin(a), 22 - r * Math.cos(a)]
}
const arc = (from: number, to: number, r: number): string => {
  if (Math.abs(to - from) < 0.01) return ''
  const [x0, y0] = point(from, r)
  const [x1, y1] = point(to, r)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** Drag up/down to turn (hold Shift for fine control); arrow keys nudge. */
function Knob({ p, onSet }: { p: VstParam; onSet: SetFn }): JSX.Element {
  const [drag, setDrag] = useState<number | null>(null)
  const start = useRef<{ y: number; v: number } | null>(null)
  const value = drag ?? p.value
  const snap = (v: number): number => {
    v = Math.max(0, Math.min(1, v))
    return p.steps > 0 ? Math.round(v * p.steps) / p.steps : v
  }
  const put = (v: number): void => { v = snap(v); setDrag(v); if (v !== p.value) onSet(p.id, v) }
  const bipolar = Math.abs(p.def - 0.5) < 0.01
  const to = -SWEEP + value * 2 * SWEEP
  const from = bipolar ? 0 : -SWEEP
  const [nx, ny] = point(to, 11)
  return (
    <svg
      width={44} height={44} viewBox="0 0 44 44" tabIndex={p.ro ? -1 : 0}
      role="slider" aria-valuemin={0} aria-valuemax={1} aria-valuenow={value} aria-label={p.name}
      className={`touch-none outline-none rounded-full focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${p.ro ? '' : 'cursor-ns-resize'}`}
      onPointerDown={(e) => { if (p.ro) return; e.currentTarget.setPointerCapture(e.pointerId); start.current = { y: e.clientY, v: value } }}
      onPointerMove={(e) => { const s = start.current; if (s) put(s.v + (s.y - e.clientY) / (e.shiftKey ? 900 : 180)) }}
      onPointerUp={() => { start.current = null; setDrag(null) }}
      onPointerCancel={() => { start.current = null; setDrag(null) }}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0
        if (!d || p.ro) return
        e.preventDefault()
        put(value + d * (p.steps > 0 ? 1 / p.steps : e.shiftKey ? 0.002 : 0.02))
        setDrag(null)
      }}
    >
      <path d={arc(-SWEEP, SWEEP, 18)} fill="none" stroke="var(--border)" strokeWidth={3} strokeLinecap="round" />
      <path d={arc(Math.min(from, to), Math.max(from, to), 18)} fill="none" stroke="var(--accent)" strokeWidth={3} strokeLinecap="round" />
      <circle cx={22} cy={22} r={12.5} fill="var(--surface-raised)" stroke="var(--border)" />
      <line x1={22} y1={22} x2={nx} y2={ny} stroke="currentColor" className="text-text-primary" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}
