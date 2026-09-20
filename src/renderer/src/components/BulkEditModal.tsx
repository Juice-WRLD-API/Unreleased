import { useCallback, useEffect, useMemo, useState } from 'react'
import { ModalOverlay, LockToggle } from './Modal'
import {
  Loader2, Check, AlertCircle, X, Pencil, ChevronDown, ChevronRight, Eraser, ArrowRight,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { apiFetch, CATEGORY_LABELS } from '../lib/juicewrldApi'
import type { JWApiSong, JWApiEra } from '../lib/juicewrldApi'
import { useCanEdit } from '../hooks/useChannelRoles'
import { getVersionMetaForSongs, getOwnVersionMeta, setOwnVersionTitle, linkSongVersion, setGroupVersionTitle } from '../lib/versionsApi'
import type { SongVersionMeta } from '../lib/versionsApi'
import { invalidateCompactGroupsCache } from '../lib/compactGroups'
import { cleanDate, errorMessage } from '../lib/format'

// Bulk editor - one dialog, two sources:
//
//   • API songs, from the Tracker's multi-select "Edit". The API has no bulk
//     endpoint, so this stages one ordinary update proposal per song, exactly
//     like EditorPage does for a single song - nothing is actually proposed
//     until the Uploads panel's Propose is used; from there review, admin
//     auto-approve and My Proposals all behave the same.
//   • Local library files, from the Library's multi-select "Edit tags". These
//     write ID3 frames straight to disk through the writeTrackMetadata
//     channel, then mirror the change into the in-memory library index.
//
// Both share the whole interaction model - tick a field, pick how the value
// combines with what's there, preview, submit - so the machinery below is
// generic over the item type and each source only supplies a BulkSpec.
//
// Only fields that make sense across many items appear. Per-item identity
// (song title, track number, file path, lyrics, versions) is deliberately
// absent, since setting those in bulk would only ever be a mistake.

/* ── Field model ───────────────────────────────────────────────────────────── */

type FieldKind = 'text' | 'textarea' | 'list' | 'select'

/** How a field's input is combined with each item's existing value. Which of
 *  these a field offers depends on its kind (see DEFAULT_MODES). */
type Mode =
  | 'set'      // overwrite
  | 'fill'     // write only where the item currently has nothing
  | 'add'      // list fields - append entries that aren't already there
  | 'remove'   // list fields - drop the named entries
  | 'append'   // free text - add on a new line after what's there
  | 'clear'    // empty the field

interface BulkField<T> {
  /** Key handed back to the spec's commit(). */
  key: string
  label: string
  kind: FieldKind
  /** Which section of the dialog this field sits in. */
  group: string
  placeholder?: string
  mono?: boolean
  /** This item's current value, as an editor-shaped string - the comparison
   *  basis for skipping items that already match. */
  read: (item: T) => string
  /** True when `read` can't actually see the stored value (ID3 frames the
   *  library index doesn't keep). Such a field only offers Replace/Clear, is
   *  always written rather than diffed, and says so in the UI. */
  writeOnly?: boolean
  /** 'select' only. Four or fewer renders as pills, more as a dropdown. */
  options?: { value: string; label: string }[]
  /** Narrows the modes this field offers beyond its kind's default. */
  modes?: Mode[]
  /** Caveat shown once the field is ticked - for consequences that only
   *  matter when you're actually about to use it. */
  note?: string
  /** This field's current values are still loading; it reads as empty until
   *  they arrive, so it can't be ticked yet. */
  pending?: boolean
  /** A one-click alternative to the normal per-item Submit flow, for
   *  operations the item-by-item diff/patch model can't express (linking
   *  several items into one group before titling them, say). Runs
   *  immediately on click rather than waiting for Submit; once it succeeds,
   *  Submit stops trying to also apply this field per-item (see the 'done'
   *  guard on activeFields) so it can't undo what the action just did. Shown
   *  only once `minItems` items are selected. */
  customAction?: {
    minItems: number
    label: (n: number) => string
    run: (items: T[], value: string) => Promise<void>
  }
}

/** Everything one source has to supply for the dialog to drive it. */
interface BulkSpec<T> {
  items: T[]
  groups: string[]
  fields: BulkField<T>[]
  keyOf: (item: T) => string
  titleOf: (item: T) => string
  /** Reason this item can't be written at all, or null. Excluded from the
   *  batch and surfaced as a count rather than failing mid-run. */
  skip?: (item: T) => string | null
  /** Applies one item's changes. Patch values are final strings; '' means the
   *  field should end up empty. Throwing marks that item failed. */
  commit: (item: T, patch: Record<string, string>, note: string) => Promise<void>
  /** Copy for the submit button and the success state. */
  actionLabel: (n: number) => string
  doneLabel: (n: number) => string
  /** What one item is called, for the header and counters. */
  noun: [singular: string, plural: string]
  subtitle: string
  /** Shows a free-text note box above the submit button, passed to commit().
   *  Omitted when the source has nowhere to put it. */
  notePlaceholder?: string
  /** Blocks the whole dialog (not an editor, not on desktop). */
  unavailable?: string
}

const DEFAULT_MODES: Record<FieldKind, Mode[]> = {
  select:   ['set', 'clear'],
  list:     ['set', 'add', 'remove', 'fill', 'clear'],
  textarea: ['set', 'append', 'fill', 'clear'],
  text:     ['set', 'fill', 'clear'],
}

const MODE_LABELS: Record<Mode, string> = {
  set: 'Replace', fill: 'Fill blanks', add: 'Add', remove: 'Remove', append: 'Append', clear: 'Clear',
}

const MODE_HINTS: Record<Mode, string> = {
  set:    'Overwrites this field everywhere.',
  fill:   'Only writes where this field is currently empty.',
  add:    'Adds these entries, keeping what is already there (no duplicates).',
  remove: 'Removes these entries, leaving the rest intact.',
  append: 'Adds this on a new line after whatever is already there.',
  clear:  'Empties this field everywhere.',
}

function modesFor<T>(f: BulkField<T>): Mode[] {
  if (f.modes) return f.modes
  // A field we can't read back can't be diffed, appended to, or filtered -
  // only overwritten or emptied.
  if (f.writeOnly) return ['set', 'clear']
  return DEFAULT_MODES[f.kind]
}

/* ── Value combination ─────────────────────────────────────────────────────── */

// Credits are free text holding comma-separated names ("Nick Mira, Taz
// Taylor") - the same convention the Tracker's producers tab splits on.
const splitList = (v: string): string[] => v.split(',').map(s => s.trim()).filter(Boolean)
const joinList = (parts: string[]): string => parts.join(', ')
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** The value this field should end up with on an item, or undefined when the
 *  item is outside the mode's reach (fill on something that already has a
 *  value, remove of a name it never carried). */
function combine(mode: Mode, input: string, current: string): string | undefined {
  switch (mode) {
    case 'clear':
      return ''
    case 'set':
      return input
    case 'fill':
      return current.trim() ? undefined : input
    case 'append':
      return current.trim() ? `${current}\n${input}` : input
    case 'add': {
      const cur = splitList(current)
      const additions = splitList(input).filter(p => !cur.some(c => sameName(c, p)))
      return additions.length ? joinList([...cur, ...additions]) : undefined
    }
    case 'remove': {
      const cur = splitList(current)
      const drop = splitList(input)
      const kept = cur.filter(c => !drop.some(p => sameName(p, c)))
      return kept.length === cur.length ? undefined : joinList(kept)
    }
  }
}

/** True once this field has enough to act on. 'clear' needs no input; every
 *  other mode does - so an emptied box never silently wipes a field. */
function isActionable(mode: Mode, input: string): boolean {
  return mode === 'clear' || input.trim() !== ''
}

/** Runs `task` over `items` a few at a time - one request (or one tag write)
 *  per item would otherwise fire the whole selection at once. */
async function pooled<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await task(items[i])
    }
  })
  await Promise.all(workers)
}

interface Target<T> {
  item: T
  patch: Record<string, string>
  /** Per-field before/after, for the preview list. */
  changes: { label: string; from: string; to: string }[]
}

/* ── API songs ─────────────────────────────────────────────────────────────── */

const API_GROUPS = ['Details', 'Versions', 'Credits', 'Dates']

const VERSION_TITLE_NOTE =
  "Retitles just this song. If it's currently linked with others, it's split into its own version group with the new title rather than renaming the shared one - same as the single-song editor. To rename a whole group in place, use that song's Versions card instead."

/** Links every song in `songs` into one version group and sets its title,
 *  regardless of whatever groups they were each in before - the explicit,
 *  opt-in counterpart to the per-song split setOwnVersionTitle does by
 *  default. Same pairwise-merge as the Tracker's "Link versions" button
 *  (linking each song to the first one merges all of their groups), plus the
 *  title write "Link versions" leaves as a follow-up prompt. */
async function linkAndTitle(songs: JWApiSong[], title: string): Promise<void> {
  if (songs.length < 2) return
  const [first, ...rest] = songs
  for (const s of rest) await linkSongVersion(first.id, s.id)
  const meta = await getOwnVersionMeta(first.id)
  if (meta) await setGroupVersionTitle(meta.groupId, title || null)
  invalidateCompactGroupsCache()
}

function apiFields(
  eras: JWApiEra[],
  versionMeta: Map<number, SongVersionMeta> | null,
  refreshVersionMeta: () => Promise<void>,
): BulkField<JWApiSong>[] {
  return [
    { key: 'category', label: 'Category', kind: 'select', group: 'Details', modes: ['set'], read: s => s.category || '',
      options: Object.keys(CATEGORY_LABELS).map(v => ({ value: v, label: CATEGORY_LABELS[v] })) },
    { key: 'era_id', label: 'Era', kind: 'select', group: 'Details', read: s => (s.era?.id ? String(s.era.id) : ''),
      options: eras.map(e => ({ value: String(e.id), label: e.name })) },
    { key: 'album', label: 'Album', kind: 'text', group: 'Details', read: s => s.album ?? s.era?.name ?? '' },
    { key: 'image_url', label: 'Cover URL', kind: 'text', group: 'Details', placeholder: 'https://…', mono: true, read: s => s.image_url || '' },
    { key: 'leak_type', label: 'Leak type', kind: 'text', group: 'Details', placeholder: 'HQ, LQ, snippet…', read: s => s.leak_type || '' },
    { key: 'instrumentals', label: 'Instrumentals', kind: 'text', group: 'Details', placeholder: 'Instrumental versions available', read: s => s.instrumentals || '' },
    { key: 'additional_information', label: 'Add. info', kind: 'textarea', group: 'Details', read: s => s.additional_information || '' },
    { key: 'notes', label: 'Notes', kind: 'textarea', group: 'Details', read: s => s.notes || '' },

    // Unlike every other field here this does NOT go through the proposal
    // system - it writes straight to the /versions/ table, same as the
    // single-song editor's Versions card, and for the same reason that card
    // uses setOwnVersionTitle rather than setGroupVersionTitle: retitling one
    // song shouldn't silently relabel songs the user didn't touch. The
    // per-song "version" label (v1 / TV Mix) is deliberately absent - stamping
    // one label across a selection would just claim every song is the same
    // version.
    { key: 'versionTitle', label: 'Version title', kind: 'text', group: 'Versions',
      modes: ['set', 'fill', 'clear'], placeholder: "e.g. She's The One",
      pending: !versionMeta, note: VERSION_TITLE_NOTE,
      read: s => versionMeta?.get(s.id)?.versionTitle ?? '',
      // The per-song default above means typing the same title on several
      // *unlinked* songs gives each its own identical-looking-but-separate
      // group rather than one shared one - this is the one-click fix for
      // when that's not what was wanted: merge the whole selection into a
      // single group and write the title once.
      customAction: {
        minItems: 2,
        label: n => `Link all ${n} as one group`,
        run: async (songs, value) => {
          await linkAndTitle(songs, value)
          // Awaited: the "done" status this unblocks must not show until the
          // field's read() reflects the merge - otherwise a subsequent Submit
          // could still see the pre-merge snapshot and undo it (see
          // fetchVersionMeta's comment).
          await refreshVersionMeta()
        },
      } },

    { key: 'credited_artists', label: 'Artists', kind: 'list', group: 'Credits', placeholder: 'Juice WRLD, Lil Uzi Vert', read: s => s.credited_artists || '' },
    { key: 'producers', label: 'Producers', kind: 'list', group: 'Credits', placeholder: 'Nick Mira, Taz Taylor', read: s => s.producers || '' },
    { key: 'engineers', label: 'Engineers', kind: 'list', group: 'Credits', read: s => s.engineers || '' },
    { key: 'recording_locations', label: 'Location', kind: 'text', group: 'Credits', placeholder: 'Studio / city', read: s => s.recording_locations || '' },

    { key: 'record_dates', label: 'Recorded', kind: 'text', group: 'Dates', placeholder: 'YYYY-MM-DD', mono: true, read: s => s.record_dates || '' },
    { key: 'release_date', label: 'Released', kind: 'text', group: 'Dates', placeholder: 'YYYY-MM-DD', mono: true, read: s => cleanDate(s.release_date) },
    { key: 'preview_date', label: 'Preview', kind: 'text', group: 'Dates', placeholder: 'YYYY-MM-DD', mono: true, read: s => cleanDate(s.preview_date) },
    { key: 'date_leaked', label: 'Date leaked', kind: 'text', group: 'Dates', placeholder: 'YYYY-MM-DD', mono: true, read: s => cleanDate(s.date_leaked) },
  ]
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export default function BulkEditModal(): JSX.Element | null {
  const { target, close, activeChannel } = useStore(
    useShallow(s => ({
      target: s.bulkEdit, close: s.closeBulkEditor, activeChannel: s.activeChannel,
    }))
  )
  const canEdit = useCanEdit()

  const [eras, setEras] = useState<JWApiEra[]>([])
  // Which version group each selected song sits in, and that group's shared
  // title. One cached bulk fetch for the whole selection rather than a lookup
  // per song. Null until it lands, which keeps the field disabled instead of
  // letting it read as "empty on all".
  const [versionMeta, setVersionMeta] = useState<Map<number, SongVersionMeta> | null>(null)
  const isApi = target?.kind === 'api'

  useEffect(() => {
    if (!isApi || eras.length) return
    apiFetch<JWApiEra[] | { results: JWApiEra[] }>('/eras/')
      .then(d => setEras(Array.isArray(d) ? d : (d as { results: JWApiEra[] }).results ?? []))
      .catch(() => undefined)
  }, [isApi, eras.length])

  // Also used to refresh after linkAndTitle changes the server's grouping out
  // from under the initial fetch - without this the field would keep reading
  // its stale pre-link snapshot, and setOwnVersionTitle (which doesn't check
  // whether a song's title already matches before deciding to split) would
  // undo the very merge that action just made the next time Submit runs.
  // Returns the promise so the customAction can await the refresh completing
  // before it reports itself done.
  const fetchVersionMeta = useCallback(async (): Promise<void> => {
    if (target?.kind !== 'api') return
    try { setVersionMeta(await getVersionMetaForSongs(target.songs.map(s => s.id))) }
    catch { setVersionMeta(new Map()) }
  }, [target])

  useEffect(() => {
    if (target?.kind !== 'api') { setVersionMeta(null); return }
    fetchVersionMeta()
    // fetchVersionMeta is stable per `target` (see its own deps), so this only
    // needs to key off target itself to avoid re-fetching on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const apiSpec = useMemo<BulkSpec<JWApiSong> | null>(() => {
    if (target?.kind !== 'api') return null

    return {
      items: target.songs,
      groups: API_GROUPS,
      fields: apiFields(eras, versionMeta, fetchVersionMeta),
      keyOf: s => String(s.id),
      titleOf: s => s.name,
      noun: ['song', 'songs'],
      subtitle: 'Stages one edit proposal per song - review and propose them from the Uploads panel.',
      notePlaceholder: 'Editor notes (shared by every proposal)…',
      unavailable: canEdit ? undefined : 'Only editors can propose changes.',
      actionLabel: n => `Stage ${n} proposal${n === 1 ? '' : 's'}`,
      doneLabel: n => `${n} proposal${n === 1 ? '' : 's'} staged`,
      commit: async (song, patch, note) => {
        // Version titles are written straight to the /versions/ table rather
        // than proposed for review (same as the single-song editor), so they
        // never belong in proposed_data and are never staged - they go out
        // immediately. setOwnVersionTitle re-reads the song's row itself
        // before deciding what to do, so it's correct even if the prefetch
        // above failed or is stale - the groupId passed here is only a hint
        // it uses when the song has no row at all yet.
        const { versionTitle, ...rest } = patch
        if (versionTitle !== undefined) {
          await setOwnVersionTitle(song.id, versionTitle || null, versionMeta?.get(song.id)?.groupId ?? null)
          invalidateCompactGroupsCache()
        }
        if (Object.keys(rest).length === 0) return

        const proposed: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(rest)) {
          proposed[key] = key === 'era_id' ? (value ? Number(value) : null) : (value === '' ? null : value)
        }
        useStore.getState().stageSongChanges([{
          songId: song.id,
          changeType: 'update',
          title: song.name,
          proposedData: proposed,
          editorNotes: note,
          channel: activeChannel,
        }])
      },
    }
  }, [target, canEdit, eras, versionMeta, fetchVersionMeta, activeChannel])

  if (!target) return null
  if (apiSpec) return <BulkEditor key="api" spec={apiSpec} onClose={close} />
  return null
}

/* ── Generic editor ────────────────────────────────────────────────────────── */

function BulkEditor<T>({ spec, onClose }: { spec: BulkSpec<T>; onClose: () => void }): JSX.Element {
  const { items, fields } = spec
  const noun = (n: number): string => (n === 1 ? spec.noun[0] : spec.noun[1])

  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [modes, setModes] = useState<Record<string, Mode>>({})
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  /** Set after a partial failure - the items still to be written, so "Retry"
   *  doesn't redo the ones that already went through. */
  const [retryTargets, setRetryTargets] = useState<Target<T>[] | null>(null)
  const [succeeded, setSucceeded] = useState(0)
  // Per-field status for customAction buttons - 'done' shouldn't linger once
  // the value it applied to has been edited again.
  const [customActionStatus, setCustomActionStatus] = useState<Record<string, 'running' | 'done' | 'error'>>({})
  const [customActionError, setCustomActionError] = useState<Record<string, string>>({})

  // Touching the form after a run invalidates that run's outcome - the patches
  // it was built from no longer describe what's on screen.
  useEffect(() => {
    setStatus(s => (s === 'submitting' ? s : 'idle'))
    setRetryTargets(null); setError(null); setSucceeded(0); setConfirmClose(false)
    setCustomActionStatus({}); setCustomActionError({})
  }, [enabled, values, modes])

  /** Items this source can't write at all, split out so they're reported as a
   *  count instead of failing mid-run. */
  const [writable, unwritable] = useMemo(() => {
    if (!spec.skip) return [items, [] as T[]]
    const ok: T[] = [], no: T[] = []
    for (const item of items) (spec.skip(item) ? no : ok).push(item)
    return [ok, no]
  }, [items, spec])

  /** Per field: the value shared by every writable item, or null when they
   *  differ - drives both the "N values" hint and the prefill. */
  const commonValues = useMemo(() => {
    const out: Record<string, string | null> = {}
    for (const f of fields) {
      if (f.writeOnly || !writable.length) { out[f.key] = null; continue }
      const first = f.read(writable[0])
      out[f.key] = writable.every(i => f.read(i) === first) ? first : null
    }
    return out
  }, [fields, writable])

  const activeFields = useMemo(
    () => fields.filter(f =>
      enabled[f.key]
      && isActionable(modes[f.key] ?? 'set', values[f.key] ?? '')
      // A field whose customAction just ran is already applied - Submit
      // shouldn't also patch it per-item against data the action changed.
      && customActionStatus[f.key] !== 'done'
    ),
    [fields, enabled, modes, values, customActionStatus]
  )

  const display = (f: BulkField<T>, value: string): string => {
    if (!value) return '—'
    if (f.options) return f.options.find(o => o.value === value)?.label ?? value
    return value
  }

  /** One patch per item, with fields it already matches (or that the mode
   *  doesn't reach) left out, and items with nothing to change dropped. */
  const targets = useMemo<Target<T>[]>(() => {
    return writable
      .map(item => {
        const patch: Record<string, string> = {}
        const changes: Target<T>['changes'] = []
        for (const f of activeFields) {
          const mode = modes[f.key] ?? 'set'
          const current = f.read(item)
          const next = combine(mode, values[f.key] ?? '', current)
          if (next === undefined) continue
          // A write-only field can't be diffed - it's always written.
          if (!f.writeOnly && next === current) continue
          patch[f.key] = next
          changes.push({
            label: f.label,
            from: f.writeOnly ? '?' : display(f, current),
            to: display(f, next),
          })
        }
        return { item, patch, changes }
      })
      .filter(t => t.changes.length > 0)
    // `display` only shapes the preview strings, not what's written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writable, activeFields, modes, values])

  const dirty = fields.some(f => enabled[f.key])
  const unchanged = writable.length - targets.length
  // A retry after a partial failure must only re-send what failed.
  const batch = retryTargets ?? targets

  function attemptClose(): void {
    if (status === 'submitting') return
    if (dirty && status !== 'done' && !confirmClose) { setConfirmClose(true); return }
    onClose()
  }

  async function submit(): Promise<void> {
    if (spec.unavailable || batch.length === 0 || status === 'submitting' || status === 'done') return
    setStatus('submitting')
    setError(null); setProgress(0); setFailed(0)
    const failures: Target<T>[] = []
    let lastError = ''
    await pooled(batch, 4, async (target) => {
      try {
        await spec.commit(target.item, target.patch, note)
      } catch (e) {
        failures.push(target)
        lastError = errorMessage(e, 'Failed')
        setFailed(failures.length)
      } finally {
        setProgress(p => p + 1)
      }
    })
    setSucceeded(n => n + batch.length - failures.length)
    if (failures.length) {
      setRetryTargets(failures)
      setError(lastError)
      setStatus('error')
    } else {
      setRetryTargets(null)
      setStatus('done')
    }
  }

  // Ctrl/Cmd+Enter submits, Escape closes (guarded once fields are ticked).
  // Deliberately re-bound every render: both handlers read form state that
  // changes as the user types, and a stale closure would act on the wrong batch.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (status === 'submitting') return
      if (e.key === 'Escape') { attemptClose(); return }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const toggleField = (f: BulkField<T>): void => {
    const on = !enabled[f.key]
    // Prefill with the shared value the first time a field is ticked, so the
    // input starts from what the items already have rather than from nothing.
    if (on && values[f.key] === undefined) {
      setValues(v => ({ ...v, [f.key]: commonValues[f.key] ?? '' }))
    }
    setEnabled(prev => ({ ...prev, [f.key]: on }))
  }

  const setValue = (key: string, v: string): void => setValues(prev => ({ ...prev, [key]: v }))
  const setMode = (key: string, m: Mode): void => setModes(prev => ({ ...prev, [key]: m }))

  const runCustomAction = async (f: BulkField<T>): Promise<void> => {
    if (!f.customAction || customActionStatus[f.key] === 'running') return
    setCustomActionStatus(prev => ({ ...prev, [f.key]: 'running' }))
    try {
      await f.customAction.run(writable, values[f.key] ?? '')
      // Left ticked (not unticked) so the "Done" state stays visible - the
      // 'done' guard in activeFields above is what keeps Submit from also
      // patching it per-item.
      setCustomActionStatus(prev => ({ ...prev, [f.key]: 'done' }))
    } catch (e) {
      setCustomActionStatus(prev => ({ ...prev, [f.key]: 'error' }))
      setCustomActionError(prev => ({ ...prev, [f.key]: errorMessage(e, 'Failed') }))
    }
  }

  const summaryFor = (f: BulkField<T>): string => {
    if (f.writeOnly) return 'not read from files'
    const common = commonValues[f.key]
    if (common === null) return `${new Set(writable.map(i => f.read(i))).size} values`
    if (!common) return 'empty on all'
    return display(f, common)
  }

  const inputClass = (mono?: boolean): string =>
    `w-full bg-surface-overlay/70 border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40 placeholder:text-text-muted placeholder:opacity-30 transition-colors ${mono ? 'font-mono' : ''}`

  const renderField = (f: BulkField<T>): JSX.Element => {
    const on = !!enabled[f.key]
    const value = values[f.key] ?? ''
    const mode = modes[f.key] ?? 'set'
    const availableModes = modesFor(f)
    const needsInput = mode !== 'clear' && !value.trim()
    // How many items this one field would actually move - the per-field
    // equivalent of the footer's total, so a mode that reaches nothing
    // (e.g. "Fill blanks" when none are blank) is obvious before submitting.
    const reach = on && !needsInput
      ? f.writeOnly
        ? writable.length
        : writable.filter(i => {
            const next = combine(mode, value, f.read(i))
            return next !== undefined && next !== f.read(i)
          }).length
      : 0

    return (
      <div
        key={f.key}
        className={`rounded-xl border px-3.5 py-2.5 transition-colors ${
          on ? 'border-accent/40 bg-accent/[0.04]' : 'border-[var(--border)] bg-surface-raised/40'
        }`}
      >
        <label className={`flex items-center gap-2.5 select-none ${f.pending ? 'cursor-default opacity-60' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={on}
            disabled={f.pending}
            onChange={() => toggleField(f)}
            className="accent-[var(--accent)] w-3.5 h-3.5 shrink-0"
          />
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">{f.label}</span>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text-muted opacity-60 truncate max-w-[45%]" title={f.pending ? undefined : summaryFor(f)}>
            {f.pending
              ? <><Loader2 size={10} className="animate-spin shrink-0" /> loading…</>
              : summaryFor(f)}
          </span>
        </label>

        {on && (
          <div className="mt-2.5 space-y-2">
            {availableModes.length > 1 && (
              <div className="flex flex-wrap gap-1">
                {availableModes.map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(f.key, m)}
                    title={MODE_HINTS[m]}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${
                      mode === m
                        ? m === 'clear' || m === 'remove'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-accent/20 text-accent'
                        : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                    }`}
                  >
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            )}

            {mode === 'clear' ? (
              <p className="flex items-center gap-1.5 text-[11px] text-red-400">
                <Eraser size={11} className="shrink-0" /> {MODE_HINTS.clear}
              </p>
            ) : f.kind === 'select' && f.options ? (
              f.options.length <= 4 ? (
                <div className="flex flex-wrap gap-1.5">
                  {f.options.map(o => (
                    <button
                      key={o.value}
                      onClick={() => setValue(f.key, o.value)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                        value === o.value
                          ? 'bg-accent text-white'
                          : 'bg-surface-overlay text-text-muted hover:text-text-primary border border-[var(--border)]'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              ) : (
                <select
                  value={value}
                  onChange={e => setValue(f.key, e.target.value)}
                  className={`${inputClass()} appearance-none cursor-pointer`}
                >
                  <option value="" style={{ color: '#111', backgroundColor: '#fff' }}>Pick one…</option>
                  {f.options.map(o => (
                    <option key={o.value} value={o.value} style={{ color: '#111', backgroundColor: '#fff' }}>{o.label}</option>
                  ))}
                </select>
              )
            ) : f.kind === 'textarea' ? (
              <textarea
                rows={3}
                value={value}
                onChange={e => setValue(f.key, e.target.value)}
                placeholder={f.placeholder}
                className={`${inputClass(f.mono)} resize-none leading-relaxed`}
              />
            ) : (
              <input
                value={value}
                onChange={e => setValue(f.key, e.target.value)}
                placeholder={f.placeholder ?? (f.kind === 'list' ? 'Comma-separated' : undefined)}
                className={inputClass(f.mono)}
              />
            )}

            <p className={`text-[11px] ${needsInput ? 'text-amber-500' : reach === 0 ? 'text-text-muted opacity-60' : 'text-text-muted opacity-75'}`}>
              {needsInput
                ? availableModes.includes('clear')
                  ? 'Enter a value - or switch to "Clear" to empty this field.'
                  : 'Enter a value.'
                : reach === 0
                  ? 'Nothing would change.'
                  : `${reach} of ${writable.length} would change.`}
            </p>

            {f.note && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
                <AlertCircle size={11} className="shrink-0 mt-0.5" /> {f.note}
              </p>
            )}

            {f.customAction && mode === 'set' && !needsInput && writable.length >= f.customAction.minItems && (
              <div className="pt-1.5 border-t border-[var(--border)]/60">
                <button
                  onClick={() => runCustomAction(f)}
                  disabled={customActionStatus[f.key] === 'running'}
                  className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                    customActionStatus[f.key] === 'done'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-accent/10 text-accent hover:bg-accent/15'
                  }`}
                >
                  {customActionStatus[f.key] === 'running' ? (
                    <><Loader2 size={11} className="animate-spin" /> Working…</>
                  ) : customActionStatus[f.key] === 'done' ? (
                    <><Check size={11} /> Done</>
                  ) : (
                    f.customAction.label(writable.length)
                  )}
                </button>
                {customActionStatus[f.key] === 'error' && (
                  <p className="flex items-center gap-1.5 mt-1 text-[11px] text-red-400">
                    <AlertCircle size={11} className="shrink-0" /> {customActionError[f.key]}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <ModalOverlay
      onClose={attemptClose}
      // This modal binds Escape itself, below: it has to stay inert while a
      // submit is in flight, which the shared handling doesn't know about.
      closeOnEscape={false}
      zIndexClassName="z-[170]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-2xl max-h-[92svh]"
      minWidth={420} minHeight={420}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
      <div className="bg-surface w-full h-full flex flex-col">

        <div
          className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)] shrink-0 cursor-grab active:cursor-grabbing"
          onMouseDown={onHandleMouseDown}
        >
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-text-primary text-sm font-semibold">
              <Pencil size={15} className="text-accent" /> Edit {items.length} {noun(items.length)}
            </h2>
            <p className="text-text-muted text-xs mt-0.5">{spec.subtitle}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
            <button
              onClick={attemptClose}
              title="Close"
              disabled={status === 'submitting'}
              className="text-text-muted hover:text-text-primary disabled:opacity-40 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {spec.unavailable ? (
          <div className="px-5 py-8 text-center">
            <p className="text-text-muted text-sm">{spec.unavailable}</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
              {unwritable.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/25 px-3.5 py-2.5 text-[11px] text-amber-500">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  <span>
                    {unwritable.length} of {items.length} will be skipped - {' '}
                    {[...new Set(unwritable.map(i => spec.skip?.(i)).filter(Boolean))].join('; ')}.
                  </span>
                </div>
              )}
              {spec.groups.map(group => {
                const groupFields = fields.filter(f => f.group === group)
                if (!groupFields.length) return null
                const writeOnlyGroup = groupFields.every(f => f.writeOnly)
                return (
                  <div key={group}>
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70 mb-2">
                      {group}
                      {writeOnlyGroup && (
                        <span className="ml-2 font-medium normal-case tracking-normal opacity-70">
                          written, never read - these overwrite whatever is in the file
                        </span>
                      )}
                    </h3>
                    <div className="space-y-2">{groupFields.map(renderField)}</div>
                  </div>
                )
              })}
            </div>

            <div className="shrink-0 border-t border-[var(--border)]">
              {/* Preview - everything that would actually change, with the
                  before/after per field, so a 40-item batch isn't run on faith. */}
              {targets.length > 0 && (
                <div className="border-b border-[var(--border)]">
                  <button
                    onClick={() => setShowPreview(v => !v)}
                    className="w-full flex items-center gap-1.5 px-5 py-2.5 text-[11px] font-semibold text-text-muted hover:text-text-primary transition-colors"
                  >
                    {showPreview ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    Preview {targets.length} change{targets.length === 1 ? '' : 's'}
                  </button>
                  {showPreview && (
                    <div className="max-h-52 overflow-y-auto px-5 pb-3 space-y-2">
                      {targets.map(t => (
                        <div key={spec.keyOf(t.item)} className="rounded-lg bg-surface-raised/50 border border-[var(--border)] px-3 py-2">
                          <p className="text-xs text-text-primary font-medium truncate">{spec.titleOf(t.item)}</p>
                          <div className="mt-1 space-y-0.5">
                            {t.changes.map(c => (
                              <div key={c.label} className="flex items-center gap-1.5 text-[11px] min-w-0">
                                <span className="text-text-muted opacity-60 shrink-0 w-20 truncate">{c.label}</span>
                                <span className="text-text-muted opacity-50 truncate max-w-[35%] line-through">{c.from}</span>
                                <ArrowRight size={9} className="text-text-muted opacity-40 shrink-0" />
                                <span className="text-accent truncate flex-1">{c.to}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="px-5 py-4 space-y-2.5">
                {spec.notePlaceholder && (
                  <input
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder={spec.notePlaceholder}
                    className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-text-primary placeholder:text-text-muted placeholder:opacity-30 focus:outline-none focus:border-accent/40 transition-colors"
                  />
                )}

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-xs">
                    <AlertCircle size={12} className="shrink-0" />
                    {failed} failed - {error}
                  </div>
                )}

                <div className="flex items-center justify-between px-0.5 text-[11px]">
                  <span className="text-text-muted opacity-65">
                    {activeFields.length === 0
                      ? 'No fields set'
                      : `${activeFields.length} field${activeFields.length === 1 ? '' : 's'} → ${targets.length} ${noun(targets.length)}`}
                  </span>
                  {unchanged > 0 && activeFields.length > 0 && (
                    // Either already carrying the value, or outside the mode's
                    // reach (a "Fill blanks" that isn't blank, a "Remove" of
                    // something that was never there).
                    <span className="text-text-muted opacity-45">{unchanged} unaffected</span>
                  )}
                </div>

                <button
                  onClick={submit}
                  disabled={batch.length === 0 || status === 'submitting' || status === 'done'}
                  title={batch.length > 0 && status === 'idle' ? 'Ctrl+Enter' : undefined}
                  className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    status === 'done'  ? 'bg-emerald-500/20 text-emerald-400' :
                    status === 'error' ? 'bg-red-500/20 text-red-400' :
                    batch.length === 0 ? 'bg-surface-overlay text-text-muted opacity-30 cursor-not-allowed' :
                    'bg-accent text-white hover:bg-accent/90 shadow-lg shadow-accent/20'
                  }`}
                >
                  {status === 'submitting' && <><Loader2 size={12} className="animate-spin" /> Working {progress}/{batch.length}…</>}
                  {status === 'done' && <><Check size={12} /> {spec.doneLabel(succeeded)}</>}
                  {status === 'error' && <><AlertCircle size={12} /> Retry {batch.length} failed</>}
                  {status === 'idle' && (batch.length === 0 ? 'Nothing to change' : spec.actionLabel(batch.length))}
                </button>

                {(status === 'done' || confirmClose) && (
                  <button
                    onClick={onClose}
                    className={`w-full py-2 text-xs font-semibold transition-colors ${
                      confirmClose && status !== 'done' ? 'text-red-400 hover:text-red-300' : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {confirmClose && status !== 'done' ? 'Discard changes and close?' : 'Close'}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      )}
    </ModalOverlay>
  )
}
