import { memo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw, Search, X } from 'lucide-react'
import type { VstParam } from '../lib/vstPlugins'

/** A plug-in's parameters as plain sliders - works for any VST3, whatever its own window looks like. */
export default function VstControlsPanel({ title, params, onSet, onClose }: {
  title: string
  params: VstParam[]
  onSet: (id: number, value: number) => void
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q ? params.filter((p) => p.name.toLowerCase().includes(q)) : params
  return createPortal(
    <div className="fixed right-4 bottom-4 z-[60] w-80 max-h-[70vh] flex flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
      <div className="flex items-center gap-2 px-3 h-9 shrink-0 border-b border-[var(--border)]">
        <div className="flex-1 min-w-0 truncate text-xs font-medium text-text-primary" title={title}>{title}</div>
        <button className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary" title="Close" onClick={onClose}><X size={14} /></button>
      </div>
      {params.length > 8 && (
        <div className="px-2 pt-2 shrink-0">
          <div className="flex items-center gap-1.5 h-6 px-2 rounded bg-[var(--surface-raised)]">
            <Search size={12} className="text-text-muted shrink-0" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${params.length} parameters`} className="flex-1 min-w-0 bg-transparent text-xs text-text-primary outline-none" />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {!params.length && <div className="text-[11px] text-text-muted">This plug-in has no adjustable parameters.</div>}
        {params.length > 0 && !shown.length && <div className="text-[11px] text-text-muted">No parameter matches.</div>}
        {shown.map((p) => <ParamRow key={p.id} param={p} onSet={onSet} />)}
      </div>
    </div>,
    document.body,
  )
}

const ParamRow = memo(function ParamRow({ param: p, onSet }: { param: VstParam; onSet: (id: number, value: number) => void }): JSX.Element {
  // While dragging, the slider follows the pointer rather than the plug-in's echo of it.
  const [drag, setDrag] = useState<number | null>(null)
  const dragging = useRef(false)
  const value = dragging.current && drag != null ? drag : p.value
  const step = p.steps > 0 ? 1 / p.steps : 0.001
  const readout = p.text ? `${p.text}${p.units && !p.text.includes(p.units) ? ` ${p.units}` : ''}` : value.toFixed(2)
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] leading-4">
        <span className="flex-1 min-w-0 truncate text-text-secondary" title={p.name}>{p.name}</span>
        <span className="shrink-0 tabular-nums text-text-primary">{readout}</span>
        {!p.ro && (
          <button className="w-4 h-4 shrink-0 flex items-center justify-center rounded text-text-muted hover:text-accent" title="Reset to default" onClick={() => onSet(p.id, p.def)}>
            <RotateCcw size={10} />
          </button>
        )}
      </div>
      <input
        type="range" min={0} max={1} step={step} value={value} disabled={p.ro}
        className="w-full h-3 accent-[var(--accent)] disabled:opacity-40"
        onPointerDown={() => { dragging.current = true }}
        onPointerUp={() => { dragging.current = false; setDrag(null) }}
        onChange={(e) => { const v = Number(e.target.value); setDrag(v); onSet(p.id, v) }}
        onDoubleClick={() => onSet(p.id, p.def)}
      />
    </div>
  )
})
