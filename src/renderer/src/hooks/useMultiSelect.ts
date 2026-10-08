import { useCallback, useEffect, useRef, useState } from 'react'

// Shared multi-select behavior for list/grid views (Tracker songs, Files
// entries, Playlist tracks/cards): select mode on/off, a Map of selected
// items, Escape to exit, auto-exit once the last item is deselected, and an
// optional Ctrl/Cmd+A "select all" binding. Previously each view hand-rolled
// its own copy of all of this (see the Tracker's Ctrl+A bugs this was
// extracted from - a race between the auto-exit effect and an async
// select-all fetch that silently discarded the whole selection).
//
// Keyed on a generic Id with the stored value defaulting to Id itself, so
// Set<string>-style call sites (file paths, playlist keys) work by passing
// the id as both id and value - `.selected` is still a Map, so read it with
// `[...selected.keys()]` where a Set spread was used before.
export interface UseMultiSelectCtrlAOptions<Id, T> {
  // Only wire the Ctrl+A listener while this is true (e.g. the view's own
  // tab is the active one). Defaults to true.
  enabled?: boolean
  // Everything currently selectable, synchronously - from whatever's already
  // loaded/rendered. Called on every select-all (also used to tell whether
  // the current selection already covers everything, so a second call can
  // toggle deselect).
  getAll: () => Map<Id, T>
  // For paginated/infinite-scroll views where `getAll` may not be everything
  // yet - provide this to fetch the complete set instead. Only called when
  // `needsFetch` returns true; while it's in flight, `selectAllLoading` is
  // true and calling select-all again cancels it (deselecting) instead of
  // re-running. Returning null means "cancelled or failed, don't apply" (the
  // caller is expected to have surfaced its own error).
  fetchAll?: () => Promise<Map<Id, T> | null>
  needsFetch?: () => boolean
  // Extra cleanup when select-all cancels an in-flight fetchAll (e.g. a
  // view-local loading flag `fetchAll` itself set and would otherwise only
  // clear once the now-abandoned promise settles).
  onCancel?: () => void
}

export interface UseMultiSelectOptions<Id, T> {
  // Extra per-view cleanup to run whenever select mode exits (e.g. resetting
  // a bulk-zip status alongside the selection itself).
  onExit?: () => void
  ctrlA?: UseMultiSelectCtrlAOptions<Id, T>
}

export interface UseMultiSelectResult<Id, T> {
  selectMode: boolean
  setSelectMode: (v: boolean) => void
  selected: Map<Id, T>
  setSelected: React.Dispatch<React.SetStateAction<Map<Id, T>>>
  selectAllLoading: boolean
  toggle: (id: Id, value: T) => void
  selectMany: (items: Map<Id, T>) => void
  clear: () => void
  exitSelectMode: () => void
  // Runs the same "select everything / fetch if needed / toggle-deselect if
  // everything's already selected" logic the Ctrl+A binding uses - call this
  // from a "Select all" button so both paths stay identical. No-op if
  // `ctrlA` wasn't provided.
  selectAll: () => void
}

export function useMultiSelect<Id, T = Id>(
  opts: UseMultiSelectOptions<Id, T> = {},
): UseMultiSelectResult<Id, T> {
  const { onExit, ctrlA } = opts
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Map<Id, T>>(new Map())
  const [selectAllLoading, setSelectAllLoading] = useState(false)

  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  const clear = useCallback((): void => setSelected(new Map()), [])

  const exitSelectMode = useCallback((): void => {
    setSelectMode(false)
    setSelected(new Map())
    onExitRef.current?.()
  }, [])

  const toggle = useCallback((id: Id, value: T): void => {
    setSelectMode(true)
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, value)
      return next
    })
  }, [])

  const selectMany = useCallback((items: Map<Id, T>): void => {
    setSelectMode(true)
    setSelected(items)
  }, [])

  // Deselecting the last item (click, context-menu unlink, etc.) drops out of
  // select mode on its own, so there's no separate "Cancel" needed once
  // you're in it. Suppressed while a select-all fetch is loading - the first
  // select-all on an empty selection sets selectMode true before the fetch
  // has populated `selected`, and without this guard this effect would see
  // size===0 and flip select mode back off before the fetch ever finishes.
  useEffect(() => {
    if (selectMode && selected.size === 0 && !selectAllLoading) setSelectMode(false)
  }, [selectMode, selected, selectAllLoading])

  // Escape exits select mode.
  useEffect(() => {
    if (!selectMode) return
    const onKeyDown = (e: KeyboardEvent): void => { if (e.key === 'Escape') exitSelectMode() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectMode, exitSelectMode])

  // Bumped to invalidate an in-flight fetchAll - calling select-all again
  // while loading cancels it so a stale response can't land afterward and
  // silently re-select everything after the user just asked to deselect.
  const fetchTokenRef = useRef(0)
  const fetchInFlightRef = useRef(false)

  // Kept in a ref (rather than depended-on directly) so `selectAll` and the
  // Ctrl+A listener always read the current `selected`/`selectMode` without
  // needing to be recreated - and thus re-subscribed to `window` - every
  // time the selection changes.
  const stateRef = useRef({ selectMode, selected, selectAllLoading })
  stateRef.current = { selectMode, selected, selectAllLoading }

  const selectAll = useCallback((): void => {
    if (!ctrlA) return
    const { getAll, fetchAll, needsFetch, onCancel } = ctrlA
    const { selectMode: curMode, selected: curSelected, selectAllLoading: curLoading } = stateRef.current

    if (curLoading) {
      fetchTokenRef.current++
      fetchInFlightRef.current = false
      setSelectAllLoading(false)
      onCancel?.()
      exitSelectMode()
      return
    }

    const all = getAll()

    if (curMode && all.size > 0 && curSelected.size === all.size) {
      exitSelectMode()
      return
    }

    if (fetchAll && needsFetch?.()) {
      if (fetchInFlightRef.current) return
      fetchInFlightRef.current = true
      const token = ++fetchTokenRef.current
      setSelectMode(true)
      setSelectAllLoading(true)
      fetchAll().then((result) => {
        if (fetchTokenRef.current !== token || !result) return
        setSelected(result)
      }).finally(() => {
        fetchInFlightRef.current = false
        if (fetchTokenRef.current === token) setSelectAllLoading(false)
      })
      return
    }

    setSelectMode(true)
    setSelected(all)
  }, [ctrlA, exitSelectMode])

  useEffect(() => {
    if (!ctrlA || ctrlA.enabled === false) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      selectAll()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ctrlA, selectAll])

  return { selectMode, setSelectMode, selected, setSelected, selectAllLoading, toggle, selectMany, clear, exitSelectMode, selectAll }
}
