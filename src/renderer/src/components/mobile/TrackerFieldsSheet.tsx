import { useState } from 'react'
import { ArrowLeft, EyeOff, GripVertical, Plus, RotateCcw } from 'lucide-react'
import { Sheet, SheetItem, SheetDivider } from './Sheet'
import { useDragReorder } from './useDragReorder'
import {
  TRACKER_FIELD_MAP, unusedFields, replaceField, removeField, insertField, reorderField,
} from '../../lib/trackerFields'
import type { TrackerFieldKey } from '../../lib/trackerFields'

// ─── Tracker field picker (phone) ─────────────────────────────────────────────
// Bottom-sheet counterpart of the desktop TrackerFieldMenu: lists the fields
// the Detailed view currently shows - tap one to replace it with another,
// drag its grip to reorder (same touch drag as Settings' nav list), hide with
// the eye - plus Add / Reset. Tapping a
// field inside a row would fight the row's own tap-to-play, so customizing
// lives here (reached from the View sheet) instead.

type Page = { kind: 'main' } | { kind: 'replace'; key: TrackerFieldKey } | { kind: 'add' }

interface Props {
  keys: TrackerFieldKey[]
  defaults: TrackerFieldKey[]
  max: number
  onChange: (keys: TrackerFieldKey[]) => void
  onClose: () => void
}

export function TrackerFieldsSheet({ keys, defaults, max, onChange, onClose }: Props): JSX.Element {
  const [page, setPage] = useState<Page>({ kind: 'main' })
  const full = keys.length >= max
  const isDefault = keys.length === defaults.length && keys.every((k, i) => k === defaults[i])
  const back = (): void => setPage({ kind: 'main' })
  const drag = useDragReorder(keys.length, (from, to) => onChange(reorderField(keys, from, to)))

  if (page.kind !== 'main') {
    const replacing = page.kind === 'replace' ? TRACKER_FIELD_MAP.get(page.key) : undefined
    return (
      <Sheet onClose={onClose} title={replacing ? `Replace ${replacing.label}` : 'Add field'}>
        <SheetItem icon={ArrowLeft} label="Back" onClick={back} />
        <SheetDivider />
        {unusedFields(keys).map((f) => (
          <SheetItem
            key={f.key}
            label={f.label}
            onClick={() => {
              const idx = page.kind === 'replace' ? keys.indexOf(page.key) : -1
              onChange(page.kind === 'replace' && idx >= 0 ? replaceField(keys, idx, f.key) : insertField(keys, -1, f.key))
              back()
            }}
          />
        ))}
      </Sheet>
    )
  }

  const iconBtn = 'shrink-0 w-10 h-11 flex items-center justify-center text-text-muted active:text-accent disabled:opacity-30'
  return (
    <Sheet onClose={onClose} title="Detail fields">
      {keys.length === 0 && (
        <p className="px-5 py-3 text-sm text-text-muted">No fields shown - rows show just the title line.</p>
      )}
      {keys.map((key, i) => {
        const label = TRACKER_FIELD_MAP.get(key)!.label
        return (
          <div
            key={key}
            data-drag-row
            style={drag.rowStyle(i)}
            className={`flex items-center pl-1 pr-2 bg-surface ${drag.dragIndex === i ? 'shadow-xl rounded-lg' : ''}`}
          >
            <button
              {...drag.handleProps(i)}
              aria-label={`Drag to reorder ${label}`}
              className="w-10 h-11 shrink-0 flex items-center justify-center text-text-muted touch-none active:text-text-primary"
            >
              <GripVertical size={17} />
            </button>
            <button
              className="flex-1 min-w-0 pr-3 py-3 text-left active:bg-surface-overlay"
              onClick={() => setPage({ kind: 'replace', key })}
            >
              <span className="block text-[15px] text-text-primary truncate">{label}</span>
              <span className="block text-xs text-text-muted truncate mt-0.5">Tap to replace</span>
            </button>
            <button className={iconBtn} onClick={() => onChange(removeField(keys, i))} aria-label={`Hide ${label}`}>
              <EyeOff size={17} />
            </button>
          </div>
        )
      })}
      <SheetDivider />
      <SheetItem
        icon={Plus}
        label="Add field"
        sub={full ? `Up to ${max} fields` : undefined}
        disabled={full}
        onClick={() => setPage({ kind: 'add' })}
      />
      <SheetItem icon={RotateCcw} label="Reset to default" disabled={isDefault} onClick={() => onChange(defaults)} />
    </Sheet>
  )
}
