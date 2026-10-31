import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { ModalOverlay } from './Modal'
import { useStore } from '../store/useStore'
import type { LibraryTrack } from '../types'
import type { LocalTagChanges } from '../lib/localLibrary'
import { registerBackHandler } from '../lib/backHandlers'

const fields = [
  ['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'],
  ['albumArtist', 'Album artist'], ['composer', 'Composer'], ['genre', 'Genre'],
  ['year', 'Year'], ['trackNumber', 'Track number'], ['discNumber', 'Disc number'],
] as const

export default function LocalTagEditor({ track, onClose }: { track: LibraryTrack; onClose: () => void }): JSX.Element {
  const [initial] = useState(() => Object.fromEntries(fields.map(([key]) => [key, String(track[key] ?? '')])) as Record<keyof LocalTagChanges, string>)
  const [values, setValues] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const supported = track.ext.toLowerCase() === 'mp3'
  const changes: LocalTagChanges = {}
  for (const [key] of fields) if (values[key] !== initial[key]) changes[key] = values[key].trim()
  const close = (): void => { if (!busy.current) onClose() }
  useEffect(() => registerBackHandler(() => { close(); return true }), [onClose])

  const save = async (): Promise<void> => {
    if (busy.current || !Object.keys(changes).length) return
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      await useStore.getState().saveLocalTags(track.id, changes)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save tags.')
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  return <ModalOverlay standalone onClose={close} zIndexClassName="z-[160]" panelClassName="bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[85dvh] overflow-y-auto p-5">
    {() => <form onSubmit={e => { e.preventDefault(); void save() }}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-text-primary">Edit local tags</h2>
        <button type="button" aria-label="Close tag editor" disabled={saving} onClick={close} className="p-2 text-text-muted"><X size={20} /></button>
      </div>
      <p className="text-xs text-text-muted mb-4 break-words">{track.title}</p>
      {!supported ? <p className="text-sm text-text-secondary">Tag editing currently supports MP3 files. This {track.ext.toUpperCase()} file cannot be edited yet.</p> : <>
        <p className="text-xs text-text-secondary mb-4">Changes are saved to the original file. Existing cover art and lyrics are kept. Leave a field empty to clear it.</p>
        <fieldset disabled={saving} className="grid grid-cols-2 gap-3">
          {fields.map(([key, label]) => <label key={key} className={`text-xs text-text-secondary ${key === 'title' || key === 'artist' || key === 'album' ? 'col-span-2' : ''}`}>
            {label}
            <input value={values[key]} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
              inputMode={key === 'year' ? 'numeric' : 'text'}
              placeholder={key === 'trackNumber' || key === 'discNumber' ? 'e.g. 1 or 1/12' : undefined}
              pattern={key === 'year' ? '[0-9]{4}' : key === 'trackNumber' || key === 'discNumber' ? '[1-9][0-9]{0,3}(/[1-9][0-9]{0,3})?' : undefined}
              className="mt-1 w-full rounded-lg border border-border bg-surface-overlay p-2.5 text-sm text-text-primary" />
          </label>)}
        </fieldset>
        {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={saving || !Object.keys(changes).length} className="mt-5 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 flex justify-center items-center gap-2">
          {saving && <Loader2 size={16} className="animate-spin" />}{saving ? 'Saving tags…' : 'Save tags'}
        </button>
      </>}
    </form>}
  </ModalOverlay>
}
