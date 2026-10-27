import { useState } from 'react'
import { ArrowLeftRight, Check, EyeOff, GripVertical, Plus, RotateCcw } from 'lucide-react'
import {
  TRACKER_FIELD_MAP, unusedFields, replaceField, removeField, insertField, reorderField,
} from '../lib/trackerFields'
import type { TrackerField, TrackerFieldKey } from '../lib/trackerFields'
import { useFieldDrag } from '../hooks/useFieldDrag'
import ContextMenu from './ContextMenu'

// ─── Tracker field picker (desktop) ───────────────────────────────────────────
// Pointer-anchored menu for customizing a Tracker field layout (Detailed
// view's metadata grid, List view's columns). Opened two ways:
//  - on a specific slot (clicking a field label / right-clicking a column
//    header): replace that slot with another field, hide it, or add a new
//    field right after it;
//  - with no slot (the layout's "customize" button): a checklist of every
//    field to show/hide in one place, with the shown ones drag-reorderable.
// Reordering otherwise happens in place - drag a column header / field label
// onto another (useFieldDrag), same as the nav tabs.

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
  /** useFieldDrag scope - shared with the layout's in-place drag targets. */
  dragScope: string
  onChange: (keys: TrackerFieldKey[]) => void
  onClose: () => void
}

const itemCls = 'menu-glass-row w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

// One shown field in the checklist: drag the row to reorder, click to hide.
function ShownFieldRow({ field, index, scope, onReorder, onHide }: {
  field: TrackerField
  index: number
  scope: string
  onReorder: (from: number, to: number) => void
  onHide: () => void
}): JSX.Element {
  const drag = useFieldDrag(scope, index, onReorder)
  return (
    <button
      {...drag.props}
      className={`${itemCls} cursor-grab active:cursor-grabbing ${drag.over ? 'ring-1 ring-inset ring-accent' : ''}`}
      onClick={onHide}
      title="Drag to reorder · click to hide"
    >
      <GripVertical size={13} className="shrink-0 -ml-1 text-text-muted/60" />
      <Check size={14} className="shrink-0 text-accent" />
      <span className="truncate">{field.label}</span>
    </button>
  )
}

export default function TrackerFieldMenu({ state, keys, defaults, max, noun, dragScope, onChange, onClose }: Props): JSX.Element {
  // Tracked by key rather than index so a drag-reorder elsewhere while the
  // menu is open doesn't retarget it to a different field.
  const [slotKey] = useState<TrackerFieldKey | undefined>(() => (state.index >= 0 ? keys[state.index] : undefined))
  const slot = slotKey ? keys.indexOf(slotKey) : -1
  const current = slotKey ? TRACKER_FIELD_MAP.get(slotKey) : undefined
  const full = keys.length >= max
  const isDefault = keys.length === defaults.length && keys.every((k, i) => k === defaults[i])

  // The slot can vanish under us (e.g. reset while open) - nothing to edit then.
  if (slotKey && (slot < 0 || !current)) return <></>

  // On a slot: a plain menu, the fields to choose from in flyouts.
  if (slotKey && current) {
    const choices = unusedFields(keys)
    return (
      <ContextMenu
        x={state.x}
        y={state.y}
        onClose={onClose}
        zIndex={90}
        title={current.label}
        compact
        items={[
          {
            label: 'Replace with',
            icon: ArrowLeftRight,
            children: choices.map((f) => ({ label: f.label, onSelect: () => onChange(replaceField(keys, slot, f.key)) })),
            childrenEmpty: `Every ${noun} is already shown`,
          },
          {
            label: `Add ${noun} after`,
            icon: Plus,
            disabled: full,
            hint: full ? `Up to ${max} ${noun}s` : undefined,
            children: choices.map((f) => ({ label: f.label, onSelect: () => onChange(insertField(keys, slot, f.key)) })),
            childrenEmpty: `Every ${noun} is already shown`,
          },
          { label: `Hide ${current.label}`, icon: EyeOff, onSelect: () => onChange(removeField(keys, slot)) },
          'divider',
          { label: `Reset ${noun}s`, icon: RotateCcw, disabled: isDefault, onSelect: () => onChange(defaults) },
        ]}
      />
    )
  }

  // The whole layout: a checklist that stays open while fields are shown,
  // hidden and dragged into order.
  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      onClose={onClose}
      zIndex={90}
      title={`Show ${noun}s`}
      className="w-60"
      items={[]}
      body={(
        <>
          <div className="max-h-72 overflow-y-auto">
            {keys.map((key, i) => (
              <ShownFieldRow
                key={key}
                field={TRACKER_FIELD_MAP.get(key)!}
                index={i}
                scope={dragScope}
                onReorder={(from, to) => onChange(reorderField(keys, from, to))}
                onHide={() => onChange(removeField(keys, i))}
              />
            ))}
            {keys.length > 0 && <div className="my-1 border-t border-[var(--border)]" />}
            {unusedFields(keys).map((f) => (
              <button
                key={f.key}
                className={itemCls}
                disabled={full}
                title={full ? `Up to ${max} ${noun}s` : undefined}
                onClick={() => onChange([...keys, f.key])}
              >
                <span className="w-[13px] -ml-1 shrink-0" />
                <span className="w-3.5 shrink-0" />
                <span className="truncate">{f.label}</span>
              </button>
            ))}
          </div>
          <div className="my-1 border-t border-[var(--border)]" />
          <button className={itemCls} disabled={isDefault} onClick={() => onChange(defaults)}>
            <RotateCcw size={14} className="shrink-0" /> Reset {noun}s
          </button>
        </>
      )}
    />
  )
}
