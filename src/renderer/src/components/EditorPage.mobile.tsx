import { useState, useEffect, useRef, useCallback, memo, type ReactNode } from 'react'
import {
  Loader2, Check, AlertCircle, LogIn, Clock, X, ChevronDown, ArrowLeft,
  ChevronUp, Award, Music2, FileText, Pencil, Plus, Trash2, FolderOpen, CalendarDays,
} from 'lucide-react'
import FilePickerModal from './FilePickerModal'
import { useStore, useStorePick } from '../store/useStore'
import { apiFetch, JWApiSong, JWApiEra, buildImageUrl, CATEGORY_LABELS } from '../lib/juicewrldApi'
import * as userApi from '../lib/userApi'
import { isPrimaryChannelSlug } from '../hooks/useChannelRoles'
import { invalidateLyricsCache } from './Player'
import type { EditorApplication } from '../lib/userApi'
import {
  versionsEnabled, getOwnVersionMeta, setSongVersion, setGroupVersionTitle, setOwnVersionTitle,
  searchVersionTitles, joinVersionGroup, getVersionGroup,
} from '../lib/versionsApi'
import type { VersionTitleSuggestion } from '../lib/versionsApi'
import { invalidateCompactGroupsCache } from '../lib/compactGroups'
import { suggestFieldValues, type SuggestField } from '../lib/fieldSuggestions'
import { cleanDate, accountDisplayName, errorMessage } from '../lib/format'
import { useEditorPageState } from '../hooks/useEditorPageState'

type SubmitState = 'idle' | 'submitting' | 'submitted' | 'error'
type LyricsTab = 'lyrics' | 'synced'

const CATEGORIES = [
  { value: 'released',          label: 'Released' },
  { value: 'unreleased',        label: 'Unreleased' },
  { value: 'unsurfaced',        label: 'Unsurfaced' },
  { value: 'recording_session', label: 'Session' },
]

const CAT_PILL: Record<string, string> = {
  released:          'bg-emerald-500 text-white',
  unreleased:        'bg-accent text-white',
  unsurfaced:        'bg-yellow-500 text-black',
  recording_session: 'bg-zinc-500 text-white',
}

const CAT_BADGE: Record<string, string> = {
  released:          'bg-emerald-500/20 text-emerald-400',
  unreleased:        'bg-accent/20 text-accent',
  unsurfaced:        'bg-yellow-500/20 text-yellow-400',
  recording_session: 'bg-zinc-500/20 text-zinc-400',
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const k of Object.keys(after)) {
    const a = after[k], b = before[k]
    if (a === '' && (b === '' || b == null)) continue
    if (a == null && b == null) continue
    if (JSON.stringify(a) !== JSON.stringify(b)) patch[k] = a === '' ? null : a
  }
  return patch
}

/* ── Card - grouped section, mobile Settings-style (caption + inset card) ──── */
export function Card({ title, icon, action, children, className = '', overflowVisible = false }: {
  title?: string; icon?: ReactNode; action?: ReactNode
  children: ReactNode; className?: string
  // Cards clip to their rounded corners by default; opt out when a child needs
  // to escape the bounds (e.g. the Versions title-suggestions dropdown).
  overflowVisible?: boolean
}): JSX.Element {
  return (
    <section className={`mb-3.5 ${className}`}>
      {(title || action) && (
        <div className="flex items-center gap-1.5 px-1 pb-1.5">
          {icon && <span className="text-text-muted opacity-70 shrink-0">{icon}</span>}
          {title
            ? <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted flex-1 min-w-0">{title}</p>
            : <span className="flex-1" />}
          {action}
        </div>
      )}
      <div className={`rounded-2xl bg-[var(--surface-overlay)] p-3.5 space-y-2.5 ${overflowVisible ? '' : 'overflow-hidden'}`}>
        {children}
      </div>
    </section>
  )
}

/* ── Grid - 1 or 2 columns (a phone has no room for 3) ────────────────────── */
export function FieldGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }): JSX.Element {
  return <div className={`grid gap-2 ${cols === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>{children}</div>
}

/* ── Field-value autocomplete ─────────────────────────────────────────────── */
/* Shared by FieldRow and BasicRow - a value-matching dropdown fed from
 *  fieldSuggestions.ts (album/credits/location/leak type already used
 *  elsewhere in the catalog), same idea as the Versions card's title
 *  autocomplete but backed by song data instead of the /versions/ table. */
function useValueSuggestions(field: SuggestField | undefined, value: string): {
  matches: string[]; open: boolean; setOpen: (v: boolean) => void
} {
  const [matches, setMatches] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!field) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      suggestFieldValues(field, value, value).then(setMatches)
    }, 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [field, value])

  return { matches, open, setOpen }
}

function SuggestDropdown({ matches, onPick }: { matches: string[]; onPick: (v: string) => void }): JSX.Element | null {
  if (matches.length === 0) return null
  return (
    <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] bg-surface-raised shadow-2xl py-1">
      {matches.map(m => (
        <button
          key={m}
          // mousedown (not click) fires before the input's blur, so the
          // suggestion is still in `matches` when this runs.
          onMouseDown={e => { e.preventDefault(); onPick(m) }}
          className="w-full text-left px-2.5 py-2 text-xs text-text-secondary active:bg-surface-overlay active:text-text-primary transition-colors truncate"
        >
          {m}
        </button>
      ))}
    </div>
  )
}

/* ── Date picker button ───────────────────────────────────────────────────── */
/* A calendar icon that opens the native date picker and appends the picked
 *  date to the field - fields hold free text (a date can be a range, a
 *  "TBD", or several dates on separate lines) so this augments rather than
 *  replaces typing. The date input itself stays invisible; only the button is
 *  seen, matching the folder-icon browse button elsewhere in these fields. */
// Constructed from the y/m/d parts (not `new Date(iso)`) so the picked day
// never shifts - parsing an ISO date string alone is read back as UTC
// midnight, which formats as the previous day in negative-UTC timezones.
function formatPickedDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function DatePickerButton({ onPick, className }: { onPick: (date: string) => void; className: string }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        onClick={e => {
          e.preventDefault()
          const el = ref.current
          if (!el) return
          try { el.showPicker() } catch { el.focus() }
        }}
        title="Pick a date"
        className={className}
      >
        <CalendarDays size={14} />
      </button>
      <input
        ref={ref}
        type="date"
        onChange={e => { const v = e.target.value; if (v) onPick(formatPickedDate(v)); e.target.value = '' }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  )
}

/* ── Field - bordered box with the label inline at the top, touch-sized ───── */
export function FieldRow({ label, value, original = '', onChange, placeholder, mono = false, span, onBrowse, suggest }: {
  label: string; value: string; original?: string
  onChange: (v: string) => void; placeholder?: string; mono?: boolean; span?: 2 | 3
  /** Shows a folder button inside the field that opens a file picker. */
  onBrowse?: () => void
  /** Autocompletes from other songs' values for this field (e.g. "album"). */
  suggest?: SuggestField
}): JSX.Element {
  const changed = value !== original && !(value === '' && original === '')
  const { matches, open, setOpen } = useValueSuggestions(suggest, value)
  return (
    <label className={`relative block rounded-xl border px-2.5 py-1.5 transition-colors ${span ? 'col-span-2' : ''} ${
      changed ? 'border-accent/40 bg-accent/[0.06]' : 'border-[var(--border)] bg-surface-raised/50'
    }`}>
      <span className="block text-[10px] font-semibold tracking-wide text-text-muted select-none leading-tight">{label}</span>
      <div className="flex items-center gap-1">
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={placeholder ?? (original || '—')}
          className={`flex-1 min-w-0 bg-transparent border-0 p-0 text-[13.5px] leading-snug text-text-primary focus:outline-none placeholder:text-text-muted placeholder:opacity-40 ${mono ? 'font-mono text-xs' : ''}`}
        />
        {onBrowse && (
          <button
            type="button"
            onClick={e => { e.preventDefault(); onBrowse() }}
            title="Browse API files"
            className="shrink-0 -my-0.5 p-1.5 rounded text-text-muted active:text-text-primary transition-colors"
          >
            <FolderOpen size={14} />
          </button>
        )}
      </div>
      {suggest && open && <SuggestDropdown matches={matches} onPick={v => { onChange(v); setOpen(false) }} />}
    </label>
  )
}

/* ── Textarea field ────────────────────────────────────────────────────────── */
export function TextareaRow({ label, value, original = '', onChange, rows = 3, placeholder, mono = false, span, suggest, dateInput = false }: {
  label: string; value: string; original?: string
  onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean; span?: 2 | 3
  /** Autocompletes from other songs' values for this field (e.g. "recording_locations"). */
  suggest?: SuggestField
  /** Shows a calendar button that appends a picked date onto the field. */
  dateInput?: boolean
}): JSX.Element {
  const changed = value !== original && !(value === '' && original === '')
  const { matches, open, setOpen } = useValueSuggestions(suggest, value)
  return (
    <label className={`relative block rounded-xl border px-2.5 py-1.5 transition-colors ${span ? 'col-span-2' : ''} ${
      changed ? 'border-accent/40 bg-accent/[0.06]' : 'border-[var(--border)] bg-surface-raised/50'
    }`}>
      <span className="block text-[10px] font-semibold tracking-wide text-text-muted select-none leading-tight">{label}</span>
      <div className="relative">
        <textarea
          rows={rows} value={value} onChange={e => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          className={`w-full bg-transparent border-0 p-0 mt-0.5 text-[13.5px] leading-snug text-text-primary focus:outline-none resize-none placeholder:text-text-muted placeholder:opacity-40 ${mono ? 'font-mono text-xs' : ''} ${dateInput ? 'pr-7' : ''}`}
        />
        {dateInput && (
          <DatePickerButton
            onPick={picked => onChange(value.trim() ? `${value}\n${picked}` : picked)}
            className="absolute right-0 top-0 p-1 rounded text-text-muted active:text-text-primary active:bg-surface-overlay transition-colors"
          />
        )}
      </div>
      {suggest && open && <SuggestDropdown matches={matches} onPick={v => { onChange(v); setOpen(false) }} />}
    </label>
  )
}

/* ── Basic-view fields (still used by EditorProfileView's create-song form) ─ */
/* Hoisted to module scope so React keeps the inputs mounted across re-renders. */
const basicControlClass =
  'w-full bg-transparent border-0 p-0 text-[13px] leading-snug text-text-primary focus:outline-none placeholder:text-text-muted placeholder:opacity-40'

const basicShellClass = (changed: boolean): string =>
  `block rounded-md border px-2.5 py-1.5 transition-colors focus-within:border-accent/50 ${
    changed ? 'border-accent/40 bg-accent/[0.06]' : 'border-[var(--border)] bg-surface-overlay/60'
  }`

const basicLabelClass =
  'block text-[10px] font-semibold tracking-wide text-text-muted select-none leading-tight'

export function BasicRow({ label, value, original, onChange, rows = 1, placeholder, mono = false, onBrowse, suggest }: {
  label: string; value: string; original?: string
  onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean
  /** Shows a folder button inside the field that opens a file picker. */
  onBrowse?: () => void
  /** Autocompletes from other songs' values for this field (e.g. "album"). */
  suggest?: SuggestField
}): JSX.Element {
  const changed = original != null && value !== original && !(value === '' && original === '')
  const { matches, open, setOpen } = useValueSuggestions(suggest, value)
  return (
    <label
      className={`relative ${basicShellClass(changed)} ${open && matches.length > 0 ? 'z-20' : ''}`}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
    >
      <span className={basicLabelClass}>{label}</span>
      {rows > 1
        ? <textarea
            rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            className={`${basicControlClass} resize-y ${mono ? 'font-mono text-xs' : ''}`} />
        : <div className="flex items-center gap-1">
            <input
              value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
              className={`${basicControlClass} ${mono ? 'font-mono text-xs' : ''}`} />
            {onBrowse && (
              <button
                type="button"
                onClick={e => { e.preventDefault(); onBrowse() }}
                title="Browse API files"
                className="shrink-0 -my-0.5 p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
              >
                <FolderOpen size={13} />
              </button>
            )}
          </div>
      }
      {suggest && open && <SuggestDropdown matches={matches} onPick={v => { onChange(v); setOpen(false) }} />}
    </label>
  )
}

/* A themed replacement for <select>: the native popup is drawn by the OS in its
   own light-mode chrome, which looks nothing like the rest of the editor. */
export function BasicSelect({ label, value, original, onChange, options, placeholder }: {
  label: string; value: string; original: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]; placeholder?: string
}): JSX.Element {
  const changed = value !== original
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    // z-20 while open keeps the popup above the rows that follow it, which are
    // themselves positioned and would otherwise paint on top.
    <div ref={ref} className={`${basicShellClass(changed)} relative cursor-pointer ${open ? 'z-20' : ''}`}
      onClick={() => setOpen(v => !v)}>
      <span className={basicLabelClass}>{label}</span>
      <div className="flex items-center gap-1 pr-0.5">
        <span className={`flex-1 min-w-0 truncate text-[13px] leading-snug ${selected ? 'text-text-primary' : 'text-text-muted opacity-40'}`}>
          {selected?.label || placeholder || '—'}
        </span>
        <ChevronDown size={13} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-lg border border-[var(--border)] bg-surface-raised shadow-2xl py-1">
          {[{ value: '', label: placeholder || '—' }, ...options].map(o => {
            const active = o.value === value
            return (
              <button
                key={o.value || '__none'}
                onClick={e => { e.stopPropagation(); onChange(o.value); setOpen(false) }}
                className={`w-full flex items-center gap-1.5 text-left px-2.5 py-2 text-xs transition-colors ${
                  active ? 'text-accent font-semibold bg-accent/10' : 'text-text-secondary active:bg-surface-overlay'
                }`}
              >
                <span className="flex-1 min-w-0 truncate">{o.label}</span>
                {active && <Check size={12} className="shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Synced lyrics table ───────────────────────────────────────────────────── */
/* Raw LRC ("[1:05.96] Animal, animal") is hard to read and easy to corrupt, so
   the editor can show it as one row per line: timestamp field + text field.
   The bracket contents are kept verbatim rather than normalised, so a partly
   typed timestamp survives a re-render and metadata tags ([ar: …]) round-trip
   untouched. */
type SyncedLine = { time: string; text: string }

function parseSynced(v: string): SyncedLine[] {
  if (!v) return []
  return v.split('\n').map(line => {
    const m = /^\s*\[([^\]]*)\]\s?(.*)$/.exec(line)
    return m ? { time: m[1], text: m[2] } : { time: '', text: line }
  })
}

function serializeSynced(rows: SyncedLine[]): string {
  return rows.map(r => (r.time.trim() ? `[${r.time.trim()}] ${r.text}`.trimEnd() : r.text)).join('\n')
}

export function SyncedLyricsTable({ value, onChange }: {
  value: string; onChange: (v: string) => void
}): JSX.Element {
  const rows = parseSynced(value)
  const commit = (next: SyncedLine[]): void => onChange(serializeSynced(next))
  const update = (i: number, patch: Partial<SyncedLine>): void =>
    commit(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const insertAfter = (i: number): void =>
    commit([...rows.slice(0, i + 1), { time: '', text: '' }, ...rows.slice(i + 1)])

  return (
    <div>
      <div className="max-h-[320px] overflow-y-auto pr-0.5 space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="group flex items-center gap-1.5">
            <input
              value={r.time}
              onChange={e => update(i, { time: e.target.value })}
              placeholder="0:00.00"
              title="Timestamp for this line"
              className={`w-[72px] shrink-0 rounded border px-1.5 py-1.5 font-mono text-[11px] text-center focus:outline-none focus:border-accent/50 transition-colors ${
                r.time.trim()
                  ? 'border-[var(--border)] bg-surface-overlay text-text-primary'
                  : 'border-dashed border-[var(--border)] bg-transparent text-text-muted'
              } placeholder:text-text-muted placeholder:opacity-40`}
            />
            <input
              value={r.text}
              onChange={e => update(i, { text: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertAfter(i) } }}
              placeholder="Lyric line…"
              className="flex-1 min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1.5 text-[13px] text-text-primary focus:outline-none focus:border-accent/50 focus:bg-surface-overlay transition-colors placeholder:text-text-muted placeholder:opacity-40"
            />
            <button
              onClick={() => commit(rows.filter((_, j) => j !== i))}
              title="Remove line"
              className="shrink-0 p-1.5 rounded text-text-muted opacity-60 active:opacity-100 active:text-red-400 transition-all"
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="py-2 text-[11px] text-text-muted opacity-60">No synced lines yet.</p>
        )}
      </div>
      <button
        onClick={() => commit([...rows, { time: '', text: '' }])}
        className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-text-muted opacity-70 active:opacity-100 active:text-accent transition-colors"
      >
        <Plus size={11} /> Add line
      </button>
    </div>
  )
}

/* ── Genius lyrics helpers ─────────────────────────────────────────────────── */
const isGeniusUrl = (s: string): boolean =>
  /^https?:\/\/(www\.)?genius\.com\/.+/i.test(s.trim())

function extractGeniusLyrics(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const containers = Array.from(doc.querySelectorAll('[data-lyrics-container="true"]'))
  if (!containers.length) throw new Error('No lyrics containers found')

  const raw = containers
    .map(c => {
      const clone = c.cloneNode(true) as Element
      clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
      return clone.textContent ?? ''
    })
    .join('\n\n')

  // The page injects contributor counts, translations, and a song description
  // before the actual lyrics. Trim everything up to the first [Section] tag.
  // Fall back to trimming after "Read More" (end of song description) if no tags.
  let start = raw.indexOf('[')
  if (start < 0) {
    const rm = raw.lastIndexOf('Read More')
    start = rm >= 0 ? rm + 9 : 0
  }

  return raw
    .slice(start)
    .replace(/^\[.*?\]\n?/gm, '')   // strip section tags
    .replace(/\n{2,}/g, '\n\n')
    .trim()
}

/* ── Main export ──────────────────────────────────────────────────────────── */
export default function EditorPage({ initialSongId = null }: {
  /** Song to open on mount, for callers that know their target before this
   *  page renders (the pop-out editor window boots straight into one). Known
   *  during the first render, so it beats the currently-playing prefill
   *  without depending on effect ordering. */
  initialSongId?: number | null
} = {}): JSX.Element {
  const {
    account, isAdmin, canEdit, backView, setActiveView, activeChannel, channels,
    application, appLoading, onSubmitted, onSignOut, setShowUserAuth, logoutAccount,
    song, loading, loadError, lastLoadIdRef, loadSong, eras,
    isNewSongDraft, editingPropId, cancelEditProposal, closeSong,
    name, setName, artists, setArtists, album, setAlbum, cat, setCat, eraId, setEraId,
    prod, setProd, eng, setEng, loc, setLoc, recDate, setRecDate, relDate, setRelDate,
    previewDate, setPreviewDate, leak, setLeak, dateLeaked, setDateLeaked,
    lyrics, setLyrics, synced, setSynced, addInfo, setAddInfo, notes, setNotes, edNotes, setEdNotes,
    imageUrl, setImageUrl, filePath, setFilePath, songLength, setSongLength, bitrate, setBitrate,
    bpm, setBpm, musicalKey, setMusicalKey, altNames, setAltNames, fileNames, setFileNames,
    instrumentals, setInstrumentals, instrumentalNames, setInstrumentalNames,
    sessionTitles, setSessionTitles, sessionTracking, setSessionTracking,
    lyricsTab, setLyricsTab, lyricsLoading, lyricsError, handleLyricsPaste,
    syncedTable, setSyncedTable,
    submitState, submitError, submit,
    deleteState, setDeleteState, deleteError, submitDeletion,
    showMore, setShowMore,
    pickingFile, setPickingFile, pickingImage, setPickingImage,
    versionNum, setVersionNum, versionTitle, setVersionTitle,
    loadedTitle, linkedCount, versionSaveStatus, linkError, saveVersionInfo,
    titleSuggestions, showTitleSuggestions, setShowTitleSuggestions, handlePickTitleSuggestion,
    base, current, patch, changedCount, alreadySubmitted,
  } = useEditorPageState(initialSongId)

  /* ── Guards ──────────────────────────────────────────────────────────────── */
  if (!account) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-surface-overlay border border-[var(--border)] flex items-center justify-center">
        <LogIn size={24} className="text-text-muted" />
      </div>
      <div className="space-y-1.5">
        <p className="text-text-primary font-bold text-base">Log in to contribute</p>
        <p className="text-text-muted text-sm max-w-[220px]">Editors propose corrections to song entries.</p>
      </div>
      <button onClick={() => setShowUserAuth(true)}
        className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-[#5865F2] active:bg-[#4752c4] text-white text-sm font-semibold transition-colors shadow-lg">
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.03.06a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 13.978 13.978 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
        Continue with Discord
      </button>
    </div>
  )

  if (!canEdit) return (
    <ApplicationView
      application={application} loading={appLoading}
      onSubmitted={onSubmitted} onSignOut={onSignOut} channel={activeChannel}
    />
  )

  const showFooter = (song || isNewSongDraft) && !loading

  /* ── Editor UI ───────────────────────────────────────────────────────────── */
  return (
    <div className="flex-1 flex flex-col min-h-0">

      {/* App bar - matches Settings' header shape */}
      <div className="shrink-0 flex items-center gap-1 px-2 pt-2">
        <button
          onClick={() => setActiveView(backView)}
          aria-label="Back"
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0 px-0.5">
          <h1 className="text-text-primary text-[20px] font-bold leading-tight truncate">Song editor</h1>
          <p className="text-text-muted text-xs truncate">
            {isAdmin ? 'Admin' : 'Editor'} · {accountDisplayName(account)}
          </p>
        </div>
        <button onClick={() => logoutAccount()} className="shrink-0 px-2.5 py-2 text-xs font-medium text-text-muted opacity-75 active:opacity-100 transition-opacity">
          Sign out
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={18} className="animate-spin text-text-muted" />
          </div>
        ) : !song && !isNewSongDraft && loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 h-64 px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-surface-overlay border border-[var(--border)] flex items-center justify-center">
              <AlertCircle size={18} className="text-red-400" />
            </div>
            <div className="space-y-1">
              <p className="text-text-primary text-sm font-medium">Couldn't load song</p>
              <p className="text-text-muted opacity-65 text-xs leading-relaxed">{loadError}</p>
            </div>
            {lastLoadIdRef.current != null && (
              <button
                onClick={() => { const id = lastLoadIdRef.current; if (id != null) loadSong(id) }}
                className="text-xs font-medium text-accent active:opacity-70 transition-opacity"
              >
                Try again
              </button>
            )}
          </div>
        ) : !song && !isNewSongDraft ? (
          <div className="flex flex-col items-center justify-center gap-3 h-64 px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-surface-overlay border border-[var(--border)] flex items-center justify-center">
              <FileText size={18} className="text-text-muted opacity-65" />
            </div>
            <div className="space-y-1">
              <p className="text-text-primary text-sm font-medium">No song selected</p>
              <p className="text-text-muted opacity-65 text-xs leading-relaxed">Play a song to start editing,<br/>or use the context menu.</p>
            </div>
          </div>
        ) : (
          <div className="px-3.5 pt-3 pb-5">

            {/* ── Editing proposal banner ── */}
            {editingPropId != null && (
              <div className="flex items-center gap-2 px-4 py-2.5 mb-3.5 rounded-xl bg-accent/10 border border-accent/20">
                <Pencil size={12} className="text-accent shrink-0" />
                <span className="text-xs text-accent font-medium flex-1">Editing proposal #{editingPropId}</span>
                <button onClick={cancelEditProposal}
                  className="text-accent opacity-60 active:opacity-100 text-xs transition-colors">
                  Cancel
                </button>
              </div>
            )}

            {/* ── Identity hero strip ── */}
            <Card>
              <div className="flex items-center gap-3">
                {imageUrl
                  ? <img src={buildImageUrl(imageUrl)} alt=""
                      className="w-14 h-14 rounded-xl object-cover shrink-0 shadow-lg ring-1 ring-white/10" />
                  : <div className="w-14 h-14 rounded-xl bg-surface-raised border border-[var(--border)] flex items-center justify-center shrink-0">
                      <Music2 size={20} className="text-text-muted" />
                    </div>
                }
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary font-bold text-[15px] leading-snug truncate">
                    {name || song?.name || 'Untitled'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${CAT_BADGE[cat] || 'bg-surface-raised text-text-muted'}`}>
                      {CATEGORY_LABELS[cat] || cat || 'Uncategorized'}
                    </span>
                    <span className="text-text-muted opacity-40 text-[11px]">{song ? `#${song.id}` : 'new song'}</span>
                  </div>
                </div>
                <button onClick={closeSong} title="Close" aria-label="Close"
                  className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-text-muted opacity-65 active:opacity-100 active:bg-surface-raised transition-colors">
                  <X size={16} />
                </button>
              </div>
            </Card>

            <Card title="Identity" overflowVisible>
              <FieldRow label="Title" value={name} original={String(base.name || '')} onChange={setName} />
              <FieldRow label="Album" value={album} original={String(base.album || '')} onChange={setAlbum} suggest="album" />
              <TextareaRow
                label="Alt titles (one per line)" value={altNames}
                original={Array.isArray(base.track_titles) ? (base.track_titles as string[]).join('\n') : ''}
                onChange={setAltNames} rows={2}
              />
            </Card>

            <Card title="Category">
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map(c => (
                  <button key={c.value} onClick={() => setCat(c.value)}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all ${
                      cat === c.value
                        ? CAT_PILL[c.value] || 'bg-accent text-white'
                        : 'bg-surface-raised text-text-muted active:text-text-primary border border-[var(--border)]'
                    }`}>
                    {c.label}
                  </button>
                ))}
              </div>
              <BasicSelect
                label="Era" value={eraId} original={song?.era?.id ? String(song.era.id) : ''}
                onChange={setEraId}
                options={eras.map(e => ({ value: String(e.id), label: e.name }))}
                placeholder={song?.era?.name || '—'}
              />
            </Card>

            <Card title="Credits" overflowVisible>
              <FieldRow label="Credited artists" value={artists} original={String(base.credited_artists || '')} onChange={setArtists} suggest="credited_artists" />
              <FieldGrid>
                <FieldRow label="Producers" value={prod} original={String(base.producers || '')} onChange={setProd} suggest="producers" />
                <FieldRow label="Engineers" value={eng}  original={String(base.engineers || '')} onChange={setEng} suggest="engineers" />
              </FieldGrid>
            </Card>

            <Card title="Recording" overflowVisible>
              <TextareaRow label="Locations"    value={loc}     original={String(base.recording_locations || '')} onChange={setLoc}     rows={2} placeholder="Studio / city" suggest="recording_locations" />
              <TextareaRow label="Record dates" value={recDate} original={String(base.record_dates || '')}        onChange={setRecDate} rows={2} placeholder="YYYY-MM-DD" mono dateInput />
            </Card>

            <Card title="Dates" overflowVisible>
              <div className="grid grid-cols-3 gap-2">
                <TextareaRow label="Preview" value={previewDate} original={String(base.preview_date || '')} onChange={setPreviewDate} rows={2} placeholder="YYYY-MM-DD" mono dateInput />
                <TextareaRow label="Released" value={relDate}    original={String(base.release_date || '')} onChange={setRelDate}     rows={2} placeholder="YYYY-MM-DD" mono dateInput />
                <TextareaRow label="Leaked"  value={dateLeaked}  original={String(base.date_leaked || '')}  onChange={setDateLeaked}  rows={2} placeholder="YYYY-MM-DD" mono dateInput />
              </div>
            </Card>

            {versionsEnabled && song && (
              <Card title="Versions" overflowVisible>
                <FieldGrid>
                  <FieldRow label="Version" value={versionNum} original={versionNum} onChange={setVersionNum} placeholder="v1, TV Mix" />
                  <div className="relative">
                    <FieldRow
                      label="Version title" value={versionTitle} original={versionTitle} onChange={setVersionTitle}
                      placeholder="Shared by linked songs"
                    />
                  </div>
                </FieldGrid>
                {titleSuggestions.length > 0 && versionTitle.trim() && (
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-surface-raised">
                    {titleSuggestions.map(s => (
                      <button
                        key={s.groupId}
                        onClick={() => handlePickTitleSuggestion(s)}
                        title="Joins this song into that existing version group"
                        className="w-full text-left px-2.5 py-2 text-xs text-text-secondary active:bg-surface-overlay active:text-text-primary transition-colors truncate"
                      >
                        {s.title}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={saveVersionInfo}
                  disabled={versionSaveStatus === 'saving'}
                  className={`w-full py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    versionSaveStatus === 'saved' ? 'bg-emerald-500/20 text-emerald-400' :
                    versionSaveStatus === 'error' ? 'bg-red-500/20 text-red-400' :
                    'bg-surface-raised border border-[var(--border)] text-text-primary active:bg-surface'
                  }`}
                >
                  {versionSaveStatus === 'saving' && <Loader2 size={12} className="animate-spin" />}
                  {versionSaveStatus === 'saved'  && <Check size={12} />}
                  {versionSaveStatus === 'error'  && <AlertCircle size={12} />}
                  {versionSaveStatus === 'idle'    ? 'Save version info' : versionSaveStatus === 'saving' ? 'Saving…' : versionSaveStatus === 'saved' ? 'Saved!' : 'Try again'}
                </button>
                {linkError && <p className="text-red-400 text-xs">{linkError}</p>}
                {/* The title belongs to the group, so say plainly what
                    saving a changed one will do to the other members. */}
                {linkedCount > 0 && (
                  <p className="text-[11px] text-text-muted opacity-75">
                    {versionTitle.trim() !== loadedTitle
                      ? `Saving moves this song out of its group of ${linkedCount + 1} under the new title. The others keep "${loadedTitle || '—'}".`
                      : `Linked with ${linkedCount} other song${linkedCount === 1 ? '' : 's'} under this title.`}
                  </p>
                )}
              </Card>
            )}

            {/* More fields */}
            <button
              onClick={() => setShowMore(v => !v)}
              className="flex items-center gap-1.5 px-1 mb-3.5 text-[11px] font-semibold text-text-muted opacity-70 active:opacity-100 transition-colors select-none">
              {showMore ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showMore ? 'Fewer fields' : 'More fields'}
            </button>

            {showMore && (
              <Card title="More fields">
                <div className="grid grid-cols-3 gap-2">
                  <FieldRow label="Length" value={songLength} original={String(base.length || '')}  onChange={setSongLength} placeholder="3:59" mono />
                  <FieldRow label="BPM"    value={bpm}        original={base.bpm != null ? String(base.bpm) : ''} onChange={setBpm} placeholder="140" mono />
                  <FieldRow label="Key"    value={musicalKey} original={String(base.key || '')}      onChange={setMusicalKey} placeholder="C# Minor" />
                </div>
                <TextareaRow label="Bitrate" value={bitrate} original={String(base.bitrate || '')}  onChange={setBitrate}    rows={2} placeholder="320 kbps" mono />
                <FieldGrid>
                  <TextareaRow label="Leak type" value={leak} original={String(base.leak_type || '')} onChange={setLeak} rows={2} placeholder="HQ, LQ…" suggest="leak_type" />
                  <FieldRow label="File names"        value={fileNames}        original={String(base.file_names || '')}            onChange={setFileNames} />
                  <FieldRow label="Instrumentals"     value={instrumentals}    original={String(base.instrumentals || '')}         onChange={setInstrumentals} placeholder="Versions available" />
                  <FieldRow label="Inst. names"       value={instrumentalNames} original={String(base.instrumental_names || '')}   onChange={setInstrumentalNames} />
                  <FieldRow label="Cover URL"         value={imageUrl}         original={String(base.image_url || '')}             onChange={setImageUrl} mono onBrowse={() => setPickingImage(true)} />
                  {cat === 'recording_session' && (
                    <>
                      <FieldRow label="Session titles" value={sessionTitles} original={String(base.session_titles || '')} onChange={setSessionTitles} />
                      <FieldRow label="Session tracking" value={sessionTracking} original={String(base.session_tracking || '')} onChange={setSessionTracking} />
                    </>
                  )}
                </FieldGrid>
                <FieldRow label="File path" value={filePath} original={String(base.path || '')} onChange={setFilePath} mono onBrowse={() => setPickingFile(true)} />
                <TextareaRow label="Additional info" value={addInfo} original={String(base.additional_information || '')} onChange={setAddInfo} rows={3} />
                <TextareaRow label="Notes"           value={notes}   original={String(base.notes || '')}                  onChange={setNotes}   rows={2} />
              </Card>
            )}

            {/* LYRICS */}
            <Card
              title="Lyrics"
              action={
                <div className="flex items-center gap-0.5">
                  {lyricsTab === 'synced' && (
                    <button
                      onClick={() => { setSyncedTable(v => !v); localStorage.setItem('editor:syncedFormat', syncedTable ? 'raw' : 'table') }}
                      title={syncedTable ? 'Edit the raw LRC text' : 'Edit as timestamped lines'}
                      className="px-1.5 py-1 rounded-lg text-[10px] font-semibold text-text-muted opacity-60 active:opacity-100 transition-opacity"
                    >
                      {syncedTable ? 'Raw' : 'Lines'}
                    </button>
                  )}
                  {(['lyrics', 'synced'] as LyricsTab[]).map(tab => {
                    const active = lyricsTab === tab
                    const dirty = tab === 'lyrics'
                      ? lyrics !== String(base.lyrics || '')
                      : !!synced
                    return (
                      <button key={tab} onClick={() => setLyricsTab(tab)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all ${
                          active ? 'bg-surface-raised text-text-primary' : 'text-text-muted opacity-75'
                        }`}>
                        {tab === 'lyrics' ? 'Lyrics' : 'Synced'}
                        {dirty && <span className="w-1 h-1 rounded-full bg-accent inline-block" />}
                      </button>
                    )
                  })}
                </div>
              }
            >
              {lyricsTab === 'lyrics' ? (
                <div className="relative">
                  <textarea
                    rows={12} value={lyrics} onChange={e => setLyrics(e.target.value)}
                    onPaste={handleLyricsPaste}
                    disabled={lyricsLoading}
                    placeholder="Full lyrics… or paste a Genius URL"
                    className={`w-full bg-surface-raised/70 rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none resize-none placeholder:text-text-muted placeholder:opacity-25 border transition-colors leading-relaxed ${
                      lyrics !== String(base.lyrics || '') ? 'border-accent/40' : 'border-[var(--border)] focus:border-accent/40'
                    } ${lyricsLoading ? 'opacity-40' : ''}`}
                  />
                  {lyricsLoading && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl pointer-events-none">
                      <div className="flex items-center gap-2 text-text-muted text-xs bg-surface-overlay/90 px-3 py-1.5 rounded-lg">
                        <Loader2 size={13} className="animate-spin" /> Fetching from Genius…
                      </div>
                    </div>
                  )}
                  {lyricsError && (
                    <div className="absolute bottom-2 inset-x-2 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/20 text-red-400 text-xs pointer-events-none">
                      <AlertCircle size={12} className="shrink-0" /> {lyricsError}
                    </div>
                  )}
                </div>
              ) : syncedTable ? (
                <SyncedLyricsTable value={synced} onChange={setSynced} />
              ) : (
                <textarea
                  rows={12} value={synced} onChange={e => setSynced(e.target.value)}
                  placeholder={"[00:00.00] Line one\n[00:05.20] Line two\n…"}
                  className={`w-full bg-surface-raised/70 rounded-xl px-3 py-2.5 text-sm font-mono text-text-primary focus:outline-none resize-none placeholder:text-text-muted placeholder:opacity-25 border transition-colors ${
                    synced ? 'border-accent/40' : 'border-[var(--border)] focus:border-accent/40'
                  }`}
                />
              )}
            </Card>

            <FieldRow label="Notes for the reviewer (optional)" value={edNotes} onChange={setEdNotes} />
          </div>
        )}

      </div>

      {/* Sticky footer actions */}
      {showFooter && (
        <div className="shrink-0 border-t border-[var(--border)] px-3.5 pt-2.5 pb-3 space-y-2">
          {submitError && (
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle size={12} className="shrink-0" /> {submitError}
            </div>
          )}
          {deleteError && (
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle size={12} className="shrink-0" /> {deleteError}
            </div>
          )}
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] text-text-muted opacity-65">Changes</span>
            <span className={`text-xs font-bold tabular-nums ${changedCount > 0 ? 'text-accent' : 'text-text-muted opacity-30'}`}>
              {changedCount} field{changedCount !== 1 ? 's' : ''}
            </span>
          </div>
          <button
            onClick={submit}
            disabled={submitState === 'submitting' || submitState === 'submitted' || changedCount === 0 || alreadySubmitted}
            className={`w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
              submitState === 'submitted' ? 'bg-emerald-500/20 text-emerald-400' :
              submitState === 'error'     ? 'bg-red-500/20 text-red-400' :
              changedCount === 0 || alreadySubmitted ? 'bg-surface-overlay text-text-muted opacity-30' :
              'bg-accent text-white active:bg-accent/90 shadow-lg shadow-accent/20'
            }`}>
            {submitState === 'submitting' && <Loader2 size={14} className="animate-spin" />}
            {submitState === 'submitted'  && <Check size={14} />}
            {submitState === 'error'      && <AlertCircle size={14} />}
            {submitState === 'idle' && alreadySubmitted && (editingPropId != null ? 'Updated' : 'Staged')}
            {submitState === 'idle' && !alreadySubmitted && (editingPropId != null ? 'Update proposal' : 'Stage proposal')}
            {submitState === 'submitting' && (editingPropId != null ? 'Updating…' : 'Staging…')}
            {submitState === 'submitted'  && (editingPropId != null ? 'Updated!' : 'Staged!')}
            {submitState === 'error'      && 'Try again'}
          </button>

          {/* Stage deletion - only for an existing song, not a new-song draft or an in-progress edit proposal */}
          {song && !isNewSongDraft && editingPropId == null && (
            <button
              onClick={submitDeletion}
              onBlur={() => { if (deleteState === 'confirm') setDeleteState('idle') }}
              disabled={deleteState === 'submitting' || deleteState === 'submitted'}
              title="Stage this song entry for deletion. Review it in the Uploads panel before it's proposed - admins review before it's removed."
              className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                deleteState === 'submitted' ? 'bg-emerald-500/20 text-emerald-400' :
                deleteState === 'error'     ? 'bg-red-500/20 text-red-400' :
                deleteState === 'confirm'   ? 'bg-red-500 text-white' :
                'bg-transparent text-red-400/70 active:text-red-400 active:bg-red-500/10'
              }`}>
              {deleteState === 'submitting' && <Loader2 size={12} className="animate-spin" />}
              {deleteState === 'submitted'  && <Check size={12} />}
              {(deleteState === 'idle' || deleteState === 'confirm') && <Trash2 size={12} />}
              {deleteState === 'error'      && <AlertCircle size={12} />}
              {deleteState === 'idle'       && 'Stage deletion'}
              {deleteState === 'confirm'    && 'Tap again to confirm'}
              {deleteState === 'submitting' && 'Staging…'}
              {deleteState === 'submitted'  && 'Staged!'}
              {deleteState === 'error'      && 'Try again'}
            </button>
          )}
        </div>
      )}

      {pickingFile && (
        <FilePickerModal
          kind="audio"
          songTitle={name || song?.name}
          altTitles={altNames.split('\n').map(s => s.trim()).filter(Boolean)}
          onSelect={p => { setFilePath(p); setPickingFile(false) }}
          onClose={() => setPickingFile(false)}
        />
      )}

      {pickingImage && (
        <FilePickerModal
          kind="image"
          songTitle={name || song?.name}
          altTitles={altNames.split('\n').map(s => s.trim()).filter(Boolean)}
          onSelect={p => { setImageUrl(p); setPickingImage(false) }}
          onClose={() => setPickingImage(false)}
        />
      )}
    </div>
  )
}

/* ── AppField - hoisted to module scope so React never remounts inputs ──────── */
function AppField({ label, value, onChange, rows, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void
  rows?: number; placeholder?: string; hint?: string
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted opacity-65">{label}</label>
        {hint && <span className="text-[10px] text-text-muted opacity-55">{hint}</span>}
      </div>
      {(rows ?? 1) > 1
        ? <textarea rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent/40 resize-none placeholder:text-text-muted placeholder:opacity-30 transition-colors" />
        : <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent/40 placeholder:text-text-muted placeholder:opacity-30 transition-colors" />
      }
    </div>
  )
}

/* ── Application view ─────────────────────────────────────────────────────── */
const ApplicationView = memo(function ApplicationView({ application, loading, onSubmitted, onSignOut, channel }: {
  application: EditorApplication | null
  loading: boolean
  onSubmitted: (a: EditorApplication) => void
  onSignOut: () => void
  channel?: string
}): JSX.Element {
  const [displayName, setDisplayName] = useState('')
  const [contact,     setContact]     = useState('')
  const [experience,  setExperience]  = useState('')
  const [motivation,  setMotivation]  = useState('')
  const [areas,       setAreas]       = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)

    const submit = async (): Promise<void> => {
    setError(null)
    if (motivation.trim().length < 20) { setError('Motivation must be at least 20 characters.'); return }
    setSubmitting(true)
    try { onSubmitted(await userApi.submitApplication({ display_name: displayName, contact, experience, motivation, areas, channel })) }
    catch (e) { setError(errorMessage(e, 'Submission failed')) }
    finally { setSubmitting(false) }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-text-muted" /></div>

  if (application?.status === 'pending') return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
        <Clock size={22} className="text-yellow-400" />
      </div>
      <div className="space-y-1.5">
        <p className="text-text-primary font-bold">Application pending</p>
        <p className="text-text-muted text-sm max-w-[220px] leading-relaxed">Your application is under review. You'll be notified on Discord.</p>
      </div>
      <button onClick={onSignOut} className="text-xs text-text-muted opacity-65 active:text-text-muted transition-colors mt-1">Sign out</button>
    </div>
  )

  if (application?.status === 'rejected') return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
        <X size={22} className="text-red-400" />
      </div>
      <div className="space-y-1.5">
        <p className="text-text-primary font-bold">Not approved</p>
        {application.review_notes && <p className="text-text-muted text-sm max-w-[220px] italic leading-relaxed">"{application.review_notes}"</p>}
      </div>
      <button onClick={onSignOut} className="text-xs text-text-muted opacity-65 active:text-text-muted transition-colors mt-1">Sign out</button>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="w-full px-4 py-6">
        <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 overflow-hidden">
          <div className="px-5 pt-5 pb-4 border-b border-[var(--border)] flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
              <Award size={19} className="text-accent" />
            </div>
            <div>
              <p className="text-text-primary font-bold text-[15px]">Become an editor</p>
              <p className="text-text-muted opacity-75 text-xs mt-0.5">Propose corrections. Admins review and apply them.</p>
            </div>
          </div>
          <div className="px-5 py-5 space-y-3.5">
            <AppField label="Display name"      value={displayName} onChange={setDisplayName} placeholder="How you want to be credited" />
            <AppField label="Contact"           value={contact}     onChange={setContact}     placeholder="Discord, email…" />
            <AppField label="Areas of focus"    value={areas}       onChange={setAreas}       placeholder="Lyrics, sessions, recording dates…" />
            <AppField label="Experience"        value={experience}  onChange={setExperience}  rows={3}
              placeholder="Other databases you've contributed to, sources you have access to…" />
            <AppField label="Motivation"        value={motivation}  onChange={setMotivation}  rows={4} hint="min. 20 chars"
              placeholder="Why do you want to be an editor and what can you contribute?" />
            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                <AlertCircle size={13} className="shrink-0" /> {error}
              </div>
            )}
            <button onClick={submit} disabled={submitting}
              className="w-full py-3 rounded-xl bg-accent text-white active:bg-accent/90 text-sm font-bold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-accent/20">
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Submit application
            </button>
            <button onClick={onSignOut} className="w-full text-xs text-text-muted opacity-65 active:opacity-100 transition-colors py-1">Sign out</button>
          </div>
        </div>
      </div>
    </div>
  )
})
