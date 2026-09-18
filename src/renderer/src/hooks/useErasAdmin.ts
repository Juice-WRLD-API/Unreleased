// Shared data/logic for the Eras admin tab. Desktop and mobile wrap these
// hooks in their own layouts - keep behavior here, JSX in them.
import { useCallback, useEffect, useState } from 'react'
import { useStrictModeSafeEffect } from './useStrictModeSafeEffect'
import * as erasApi from '../lib/erasApi'
import type { Era } from '../lib/erasApi'

export function useEraList(): {
  eras: Era[]
  setEras: React.Dispatch<React.SetStateAction<Era[]>>
  loading: boolean
  error: string | null
  selectedId: number | null
  setSelectedId: (id: number | null) => void
  selected: Era | null
  reload: () => void
} {
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

  return { eras, setEras, loading, error, selectedId, setSelectedId, selected, reload }
}

export function useCreateEra(onCreated: (era: Era) => void): {
  name: string
  setName: (v: string) => void
  busy: boolean
  error: string | null
  submit: () => Promise<void>
} {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
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
  }, [name, busy, onCreated])

  return { name, setName, busy, error, submit }
}

export function useEditEra(era: Era, onSaved: (era: Era) => void, onDeleted: () => void): {
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  timeFrame: string
  setTimeFrame: (v: string) => void
  playCount: string
  setPlayCount: (v: string) => void
  busy: boolean
  deleting: boolean
  error: string | null
  dirty: boolean
  save: () => Promise<void>
  remove: () => Promise<void>
} {
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

  const save = useCallback(async () => {
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
  }, [era.id, name, description, timeFrame, playCount, busy, onSaved])

  const remove = useCallback(async () => {
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
  }, [era.id, era.name, onDeleted])

  return { name, setName, description, setDescription, timeFrame, setTimeFrame, playCount, setPlayCount, busy, deleting, error, dirty, save, remove }
}

export function sortByName<T extends { name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name))
}
