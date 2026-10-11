import { useState } from 'react'

// HTML5 drag-to-reorder for Tracker field slots (List column headers,
// Detailed-view field labels, the field checklist) - same gesture as dragging
// the nav tabs in Sidebar. The dragged slot's index rides in dataTransfer
// under a per-layout MIME type rather than in shared React state, so a label
// dragged in one virtualized row can be dropped on the matching label of any
// other row (all rows share one layout) without the rows knowing about each
// other, and a drag from one layout is ignored by the other's drop targets.

const mime = (scope: string): string => `application/x-tracker-field-${scope}`

export interface FieldDrag {
  /** True while a compatible drag hovers this slot - for the drop highlight. */
  over: boolean
  props: {
    draggable: true
    onDragStart: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (e: React.DragEvent) => void
    onDragEnd: () => void
  }
}

export function useFieldDrag(scope: string, index: number, onReorder: (from: number, to: number) => void): FieldDrag {
  const [over, setOver] = useState(false)
  const type = mime(scope)
  return {
    over,
    props: {
      draggable: true,
      onDragStart: (e) => {
        e.stopPropagation()
        e.dataTransfer.setData(type, String(index))
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (e) => {
        if (!e.dataTransfer.types.includes(type)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e) => {
        setOver(false)
        if (!e.dataTransfer.types.includes(type)) return
        e.preventDefault()
        e.stopPropagation()
        const from = Number(e.dataTransfer.getData(type))
        if (Number.isInteger(from) && from !== index) onReorder(from, index)
      },
      onDragEnd: () => setOver(false),
    },
  }
}
