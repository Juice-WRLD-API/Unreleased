import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, EyeOff, Plus, RotateCcw } from 'lucide-react'
import {
  TRACKER_FIELDS, TRACKER_FIELD_MAP, unusedFields, replaceField, removeField, insertField, moveField,
} from '../lib/trackerFields'
import type { TrackerFieldKey } from '../lib/trackerFields'

// ─── Tracker field picker (desktop) ───────────────────────────────────────────
// Pointer-anchored popover for customizing a Tracker field layout (Detailed
// view's metadata grid, List view's columns). Opened two ways:
//  - on a specific slot (clicking a field label / right-clicking a column
//    header): replace that slot with another field, hide it, move it, or add
//    a new field right after it;
//  - with no slot (the layout's "customize" button): a checklist of every
//    field to show/hide in one place.

export interface TrackerFieldMenuState {
  x: number
  y: number
  /** Slot being edited, or -1 for the whole-layout checklist. */
  index: number
}

interface Props {
  state: TrackerFieldMenuState
  keys: TrackerFieldKey[]
  defaults: TrackerFieldKey[]
  max: number
  /** "field" / "column" - used in the action labels. */
  noun: string
  onChange: (keys: TrackerFieldKey[]) => void
  onClose: () => void
}

const itemCls = 'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'
const headCls = 'px-3 pt-2 pb-1 text-[0.625rem] font-bold uppercase tracking-widest text-text-muted'

export default function TrackerFieldMenu({ state, keys, defaults, max, noun, onChange, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: state.x, top: state.y })
  // 'add' swaps the "replace with" list for an "insert after this slot" one.
  const [mode, setMode] = useState<'replace' | 'add'>('replace')
  // Tracked by key rather than index so Move left/right keeps editing the
  // same field as it changes position.
  const [slotKey] = useState<TrackerFieldKey | undefined>(() => (state.index >= 0 ? keys[state.index] : undefined))
  const slot = slotKey ? keys.indexOf(slotKey) : -1
  const current = slotKey ? TRACKER_FIELD_MAP.get(slotKey) : undefined
  const full = keys.length >= max
  const isDefault = keys.length === defaults.length && keys.every((k, i) => k === defaults[i])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    // Any scroll moves the anchor out from under the popover - close rather
    // than leave it floating over the wrong row.
    const onScroll = (e: Event): void => { if (!ref.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  // Keep the popover on-screen (re-run when the mode swap changes its height).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(state.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(state.y, window.innerHeight - r.height - 8)),
    })
  }, [state.x, state.y, mode])

  // The slot can vanish under us (e.g. reset while open) - nothing to edit then.
  if (slotKey && (slot < 0 || !current)) return <></>

  const apply = (next: TrackerFieldKey[], close = true): void => { onChange(next); if (close) onClose() }

  const body = !slotKey ? (
    <>
      <p className={headCls}>Show {noun}s</p>
      <div className="max-h-72 overflow-y-auto">
        {TRACKER_FIELDS.map((f) => {
          const on = keys.includes(f.key)
          return (
            <button
              key={f.key}
              className={itemCls}
              disabled={!on && full}
              title={!on && full ? `Up to ${max} ${noun}s` : undefined}
              onClick={() => apply(on ? keys.filter((k) => k !== f.key) : [...keys, f.key], false)}
            >
              <span className="w-3.5 shrink-0">{on && <Check size={14} className="text-accent" />}</span>
              {f.label}
            </button>
          )
        })}
      </div>
    </>
  ) : mode === 'add' ? (
    <>
      <p className={headCls}>Add after {current!.label}</p>
      <div className="max-h-72 overflow-y-auto">
        {unusedFields(keys).map((f) => (
          <button key={f.key} className={itemCls} onClick={() => apply(insertField(keys, slot, f.key))}>
            <Plus size={14} className="shrink-0 text-text-muted" />
            {f.label}
          </button>
        ))}
      </div>
    </>
  ) : (
    <>
      <p className={headCls}>Replace {current!.label} with</p>
      <div className="max-h-56 overflow-y-auto">
        {unusedFields(keys).map((f) => (
          <button key={f.key} className={itemCls} onClick={() => apply(replaceField(keys, slot, f.key))}>
            <span className="w-3.5 shrink-0" />
            {f.label}
          </button>
        ))}
      </div>
      <div className="my-1 border-t border-[var(--border)]" />
      <button className={itemCls} disabled={slot === 0} onClick={() => apply(moveField(keys, slot, -1), false)}>
        <ArrowLeft size={14} className="shrink-0" /> Move left
      </button>
      <button className={itemCls} disabled={slot === keys.length - 1} onClick={() => apply(moveField(keys, slot, 1), false)}>
        <ArrowRight size={14} className="shrink-0" /> Move right
      </button>
      <button
        className={itemCls}
        disabled={full}
        title={full ? `Up to ${max} ${noun}s` : undefined}
        onClick={() => setMode('add')}
      >
        <Plus size={14} className="shrink-0" /> Add {noun} after
      </button>
      <button className={itemCls} onClick={() => apply(removeField(keys, slot))}>
        <EyeOff size={14} className="shrink-0" /> Hide {current!.label}
      </button>
    </>
  )

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[90] w-60 py-1 bg-surface border border-[var(--border)] rounded-xl shadow-2xl"
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
    >
      {body}
      <div className="my-1 border-t border-[var(--border)]" />
      <button className={itemCls} disabled={isDefault} onClick={() => apply(defaults, !!slotKey)}>
        <RotateCcw size={14} className="shrink-0" /> Reset {noun}s
      </button>
    </div>,
    document.body,
  )
}
