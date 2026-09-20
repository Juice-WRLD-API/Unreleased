import { useState, useEffect, useRef, memo, type ReactNode, useId } from 'react'
import {
  Loader2, Check, AlertCircle, LogIn, Clock, X, ChevronDown, ChevronLeft,
  ChevronUp, Award, Music2, FileText, Pencil, Plus, Trash2,
  FolderOpen, CalendarDays,
} from 'lucide-react'
import FilePickerModal from './FilePickerModal'
import { buildImageUrl, CATEGORY_LABELS } from '../lib/juicewrldApi'
import * as userApi from '../lib/userApi'
import type { EditorApplication } from '../lib/userApi'
import { versionsEnabled } from '../lib/versionsApi'
import { suggestFieldValues, type SuggestField } from '../lib/fieldSuggestions'
import { accountDisplayName, errorMessage } from '../lib/format'
import {
  CATEGORIES, CAT_PILL, CAT_BADGE, formatPickedDate,
  parseSynced, serializeSynced, type SyncedLine,
} from '../lib/editorPageShared'
import { useEditorPageState, type LyricsTab } from '../hooks/useEditorPageState'
import { clickable } from '../lib/a11y'

/* ── Card - grouped section container ─────────────────────────────────────── */
export function Card({ title, icon, action, children, className = '', overflowVisible = false }: {
  title?: string; icon?: ReactNode; action?: ReactNode
  children: ReactNode; className?: string
  // Cards clip to their rounded corners by default; opt out when a child needs
  // to escape the bounds (e.g. the Versions title-suggestions dropdown).
  overflowVisible?: boolean
}): JSX.Element {
  return (
    <section className={`rounded-2xl border border-[var(--border)] bg-surface-raised/50 ${overflowVisible ? '' : 'overflow-hidden'} ${className}`}>
      {title && (
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[var(--border)]">
          {icon && <span className="text-text-muted opacity-70 shrink-0">{icon}</span>}
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-80">{title}</h3>
          {action && <div className="ml-auto">{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

/* ── Grid - responsive field grid for use inside a Card ───────────────────── */
export function FieldGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }): JSX.Element {
  // The default (cols=2) grid picks up a third column once the window is wide
  // enough to fit it (past the left rail) - the whole reason this component
  // widened in the first place was to stop wasting that space.
  const colClass = cols === 4 ? 'sm:grid-cols-4' : cols === 3 ? 'sm:grid-cols-3' : cols === 1 ? '' : 'sm:grid-cols-2 lg:grid-cols-3'
  return <div className={`grid grid-cols-1 ${colClass} gap-x-5 gap-y-4`}>{children}</div>
}

/* ── Field label with dirty dot ───────────────────────────────────────────── */
function FieldLabel({ label, changed }: { label: string; changed: boolean }): JSX.Element {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted opacity-75 select-none mb-1.5">
      {label}
      {changed && <span className="w-1 h-1 rounded-full bg-accent shrink-0" />}
    </span>
  )
}

const fieldInputClass = (changed: boolean, mono: boolean): string =>
  `w-full bg-surface-overlay/70 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none placeholder:text-text-muted placeholder:opacity-30 border transition-colors ${mono ? 'font-mono' : ''} ${
    changed ? 'border-accent/40 bg-accent/[0.04]' : 'border-[var(--border)] focus:border-accent/40'
  }`

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
          className="w-full text-left px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-overlay hover:text-text-primary transition-colors truncate"
        >
          {m}
        </button>
      ))}
    </div>
  )
}

/* ── Date picker button ───────────────────────────────────────────────────── */
/* A calendar icon that opens the browser's native date picker and appends the
 *  picked date to the field - fields hold free text (a date can be a range, a
 *  "TBD", or several dates on separate lines) so this augments rather than
 *  replaces typing. The date input itself stays invisible; only the button is
 *  seen, matching the folder-icon browse button elsewhere in these fields. */
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

/* ── Field ─────────────────────────────────────────────────────────────────── */
export function FieldRow({ label, value, original, onChange, placeholder, mono = false, span, full = false, onBrowse, suggest }: {
  label: string; value: string; original: string
  onChange: (v: string) => void; placeholder?: string; mono?: boolean
  /** Spans this many of the grid's own columns (2 of 3 pairs it with one more
   *  single-width field, rather than claiming the whole row). */
  span?: 2 | 3
  /** Always takes the whole row, however many columns the grid currently has -
   *  for fields (long paths, free-form notes) that never want a neighbor. */
  full?: boolean
  /** Shows a folder button inside the field that opens a file picker. */
  onBrowse?: () => void
  /** Autocompletes from other songs' values for this field (e.g. "album"). */
  suggest?: SuggestField
}): JSX.Element {
  const changed = value !== original && !(value === '' && original === '')
  const { matches, open, setOpen } = useValueSuggestions(suggest, value)
  return (
    <label className={`flex flex-col min-w-0 ${full ? 'sm:col-span-2 lg:col-span-3' : span === 2 ? 'sm:col-span-2' : span === 3 ? 'sm:col-span-3' : ''}`}>
      <FieldLabel label={label} changed={changed} />
      <div className="relative">
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={placeholder ?? (original || '—')}
          className={`${fieldInputClass(changed, mono)} ${onBrowse ? 'pr-9' : ''}`}
        />
        {onBrowse && (
          <button
            type="button"
            onClick={e => { e.preventDefault(); onBrowse() }}
            title="Browse API files"
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
          >
            <FolderOpen size={14} />
          </button>
        )}
        {suggest && open && <SuggestDropdown matches={matches} onPick={v => { onChange(v); setOpen(false) }} />}
      </div>
    </label>
  )
}

/* ── Select field ──────────────────────────────────────────────────────────── */
function SelectRow({ label, value, original, onChange, options, placeholder }: {
  label: string; value: string; original: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]; placeholder?: string
}): JSX.Element {
  const changed = value !== original
  return (
    <label className="flex flex-col min-w-0">
      <FieldLabel label={label} changed={changed} />
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className={`${fieldInputClass(changed, false)} appearance-none cursor-pointer`}
      >
        <option value="" style={{ color: '#111', backgroundColor: '#fff' }}>{placeholder || '—'}</option>
        {options.map(o => <option key={o.value} value={o.value} style={{ color: '#111', backgroundColor: '#fff' }}>{o.label}</option>)}
      </select>
    </label>
  )
}

/* ── Textarea field ────────────────────────────────────────────────────────── */
export function TextareaRow({ label, value, original, onChange, rows = 3, placeholder, mono = false, span, full = false, suggest, dateInput = false }: {
  label: string; value: string; original: string
  onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean
  /** Spans this many of the grid's own columns (2 of 3 pairs it with one more
   *  single-width field, rather than claiming the whole row). */
  span?: 2 | 3
  /** Always takes the whole row, however many columns the grid currently has -
   *  for fields (long paths, free-form notes) that never want a neighbor. */
  full?: boolean
  /** Autocompletes from other songs' values for this field (e.g. "leak_type"). */
  suggest?: SuggestField
  /** Shows a calendar button that appends a picked date onto the field. */
  dateInput?: boolean
}): JSX.Element {
  const changed = value !== original && !(value === '' && original === '')
  const { matches, open, setOpen } = useValueSuggestions(suggest, value)
  return (
    <label className={`relative flex flex-col min-w-0 ${full ? 'sm:col-span-2 lg:col-span-3' : span === 2 ? 'sm:col-span-2' : span === 3 ? 'sm:col-span-3' : ''}`}>
      <FieldLabel label={label} changed={changed} />
      <div className="relative">
        <textarea
          rows={rows} value={value} onChange={e => onChange(e.target.value)}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          placeholder={placeholder || '—'}
          className={`${fieldInputClass(changed, mono)} resize-none leading-relaxed py-2.5 ${dateInput ? 'pr-9' : ''}`}
        />
        {dateInput && (
          <DatePickerButton
            onPick={picked => onChange(value.trim() ? `${value}\n${picked}` : picked)}
            className="absolute right-1.5 top-1.5 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
          />
        )}
      </div>
      {suggest && open && <SuggestDropdown matches={matches} onPick={v => { onChange(v); setOpen(false) }} />}
    </label>
  )
}

/* ── Basic view fields ─────────────────────────────────────────────────────── */
/* The "basic" editor view is a flat, top-to-bottom form: every field visible at
   once, no left rail, no cards, no collapsible sections or tabs. Hoisted to
   module scope so React keeps the inputs mounted across re-renders. */
const basicControlClass =
  'w-full bg-transparent border-0 p-0 text-[13px] leading-snug text-text-primary focus:outline-none placeholder:text-text-muted placeholder:opacity-40'

const basicShellClass = (changed: boolean, roomy = false): string =>
  `block rounded-md border ${roomy ? 'pl-2.5 pr-3 pt-1.5 pb-3' : 'px-2.5 py-1.5'} transition-colors focus-within:border-accent/50 ${
    changed ? 'border-accent/40 bg-accent/[0.06]' : 'border-[var(--border)] bg-surface-overlay/60'
  }`

const basicLabelClass =
  'block text-[10px] font-semibold tracking-wide text-text-muted select-none leading-tight'

export function BasicRow({ label, value, original, onChange, rows = 1, placeholder, mono = false, onBrowse, suggest, dateInput = false }: {
  label: string; value: string; original?: string
  onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean
  /** Shows a folder button inside the field that opens a file picker. */
  onBrowse?: () => void
  /** Autocompletes from other songs' values for this field (e.g. "album"). */
  suggest?: SuggestField
  /** Shows a calendar button that appends a picked date onto the field. */
  dateInput?: boolean
}): JSX.Element {
  const changed = original != null && value !== original && !(value === '' && original === '')
  const { matches, open, setOpen } = useValueSuggestions(suggest, value)
  return (
    <label className={`${basicShellClass(changed, rows > 1)} relative ${open && matches.length > 0 ? 'z-20' : ''}`}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      <span className={basicLabelClass}>{label}</span>
      {rows > 1
        ? <div className="relative">
            <textarea
              rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
              className={`${basicControlClass} resize-y ${mono ? 'font-mono text-xs' : ''} ${dateInput ? 'pr-7' : ''}`} />
            {dateInput && (
              <DatePickerButton
                onPick={picked => onChange(value.trim() ? `${value}\n${picked}` : picked)}
                className="absolute right-0 top-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
              />
            )}
          </div>
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
      {...clickable(() => setOpen(v => !v))} aria-expanded={open}>
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
                className={`w-full flex items-center gap-1.5 text-left px-2.5 py-1.5 text-xs transition-colors ${
                  active ? 'text-accent font-semibold bg-accent/10' : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
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
    <div className="mt-1.5">
      <div className="max-h-[340px] overflow-y-auto pr-0.5 space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="group flex items-center gap-1.5">
            <input
              value={r.time}
              onChange={e => update(i, { time: e.target.value })}
              placeholder="0:00.00"
              title="Timestamp for this line"
              className={`w-[76px] shrink-0 rounded border px-1.5 py-1 font-mono text-[11px] text-center focus:outline-none focus:border-accent/50 transition-colors ${
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
              className="flex-1 min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] text-text-primary focus:outline-none focus:border-accent/50 focus:bg-surface-overlay transition-colors placeholder:text-text-muted placeholder:opacity-40"
            />
            <button
              onClick={() => commit(rows.filter((_, j) => j !== i))}
              title="Remove line"
              className="shrink-0 p-1 rounded text-text-muted opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 transition-all"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="py-2 text-[11px] text-text-muted opacity-60">No synced lines yet.</p>
        )}
      </div>
      <button
        onClick={() => commit([...rows, { time: '', text: '' }])}
        className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-text-muted opacity-70 hover:opacity-100 hover:text-accent transition-colors"
      >
        <Plus size={11} /> Add line
      </button>
    </div>
  )
}

/* ── Main export ──────────────────────────────────────────────────────────── */
export default function EditorPage({ initialSongId = null }: {
  /** Song to open on mount, for callers that know their target before this
   *  page renders. Known during the first render, so it beats the
   *  currently-playing prefill without depending on effect ordering. */
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
  // 'full' = the card/left-rail layout, 'basic' = one flat stacked form with
  // every field on screen. Remembered across sessions (and shared with the
  // pop-out editor window, which reads the same key). Purely a desktop-only
  // display mode, so it stays local rather than in the shared hook.
  const [basicView, setBasicView] = useState(() => localStorage.getItem('editor:view') === 'basic')

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
        className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-semibold transition-colors shadow-lg">
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

  /* ── Editor UI ───────────────────────────────────────────────────────────── */
  return (
    <div className="flex-1 flex flex-col min-h-0">

      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-[var(--border)]">
        <button
          onClick={() => setActiveView(backView)}
          title="Back"
          className="p-1.5 -ml-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors shrink-0"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-bold text-[15px] text-text-primary">Song editor</span>
        <span className="flex-1" />
        {/* Layout switch - full cards vs. the flat basic form */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-overlay border border-[var(--border)]">
          {([['full', 'Full'], ['basic', 'Basic']] as const).map(([mode, label]) => {
            const active = (mode === 'basic') === basicView
            return (
              <button
                key={mode}
                onClick={() => { setBasicView(mode === 'basic'); localStorage.setItem('editor:view', mode) }}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  active ? 'bg-surface-raised text-text-primary' : 'text-text-muted opacity-65 hover:opacity-100'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${isAdmin ? 'bg-accent/20 text-accent' : 'bg-emerald-500/20 text-emerald-400'}`}>
          {isAdmin ? 'admin' : 'editor'}
        </span>
        <span className="text-text-muted opacity-75 text-xs truncate max-w-[140px]">{accountDisplayName(account)}</span>
        <button onClick={() => logoutAccount()} className="text-text-muted opacity-65 hover:opacity-100 text-xs transition-colors">Sign out</button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0">

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
                className="text-xs font-medium text-accent hover:opacity-80 transition-opacity"
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
          <div className={`mx-auto w-full ${basicView ? 'max-w-4xl px-5 py-4' : 'max-w-[1600px] px-6 py-6'}`}>

            {/* ── Editing proposal banner ── */}
            {editingPropId != null && (
              <div className="flex items-center gap-2 px-4 py-2.5 mb-5 rounded-xl bg-accent/10 border border-accent/20">
                <Pencil size={12} className="text-accent shrink-0" />
                <span className="text-xs text-accent font-medium flex-1">Editing proposal #{editingPropId}</span>
                <button onClick={cancelEditProposal}
                  className="text-accent opacity-60 hover:opacity-100 text-xs transition-colors">
                  Cancel
                </button>
              </div>
            )}

            {basicView ? (
              /* ── Basic view: one flat form, every field in order ── */
              <div className="flex flex-col gap-1.5">
                <BasicRow label="Name" value={name} original={String(base.name || '')} onChange={setName} />
                {/* Short fields pair up so the form doesn't run twice as long as it needs to */}
                <div className="grid grid-cols-2 gap-1.5">
                  <BasicSelect
                    label="Era" value={eraId} original={song?.era?.id ? String(song.era.id) : ''}
                    onChange={setEraId}
                    options={eras.map(e => ({ value: String(e.id), label: e.name }))}
                    placeholder={song?.era?.name || '—'}
                  />
                  <BasicSelect
                    label="Category" value={cat} original={String(base.category || '')}
                    onChange={setCat} options={CATEGORIES}
                  />
                </div>
                <BasicRow label="Album" value={album} original={String(base.album || '')} onChange={setAlbum} suggest="album" />
                <BasicRow
                  label="Alternate titles (one per line)" value={altNames}
                  original={Array.isArray(base.track_titles) ? (base.track_titles as string[]).join('\n') : ''}
                  onChange={setAltNames} rows={3}
                />
                <BasicRow label="Credited artists" value={artists} original={String(base.credited_artists || '')} onChange={setArtists} suggest="credited_artists" />
                <div className="grid grid-cols-2 gap-1.5">
                  <BasicRow label="Producers" value={prod} original={String(base.producers || '')} onChange={setProd} suggest="producers" />
                  <BasicRow label="Engineers" value={eng} original={String(base.engineers || '')} onChange={setEng} suggest="engineers" />
                </div>
                <BasicRow label="Recording locations" value={loc} original={String(base.recording_locations || '')} onChange={setLoc} rows={2} suggest="recording_locations" />
                <BasicRow label="Record dates" value={recDate} original={String(base.record_dates || '')} onChange={setRecDate} rows={2} dateInput />
                {cat === 'recording_session' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <BasicRow label="Session titles" value={sessionTitles} original={String(base.session_titles || '')} onChange={setSessionTitles} rows={2} />
                    <BasicRow label="Session tracking" value={sessionTracking} original={String(base.session_tracking || '')} onChange={setSessionTracking} rows={2} />
                  </div>
                )}
                <div className="grid grid-cols-3 gap-1.5">
                  <BasicRow label="Length" value={songLength} original={String(base.length || '')} onChange={setSongLength} mono />
                  <BasicRow label="BPM" value={bpm} original={base.bpm != null ? String(base.bpm) : ''} onChange={setBpm} mono />
                  <BasicRow label="Key" value={musicalKey} original={String(base.key || '')} onChange={setMusicalKey} placeholder="C# Minor" />
                </div>
                <BasicRow label="Bitrate" value={bitrate} original={String(base.bitrate || '')} onChange={setBitrate} rows={2} mono />
                <BasicRow label="Additional information" value={addInfo} original={String(base.additional_information || '')} onChange={setAddInfo} rows={3} />
                <div className="grid grid-cols-2 gap-1.5">
                  <BasicRow label="File names" value={fileNames} original={String(base.file_names || '')} onChange={setFileNames} rows={2} />
                  <BasicRow label="Instrumentals" value={instrumentals} original={String(base.instrumentals || '')} onChange={setInstrumentals} rows={2} />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <BasicRow label="Preview date" value={previewDate} original={String(base.preview_date || '')} onChange={setPreviewDate} rows={2} mono dateInput />
                  <BasicRow label="Release date" value={relDate} original={String(base.release_date || '')} onChange={setRelDate} rows={2} mono dateInput />
                </div>
                <BasicRow label="Date leaked" value={dateLeaked} original={String(base.date_leaked || '')} onChange={setDateLeaked} rows={2} mono dateInput />
                <div className="grid grid-cols-2 gap-1.5">
                  <BasicRow label="Instrumental names" value={instrumentalNames} original={String(base.instrumental_names || '')} onChange={setInstrumentalNames} rows={2} />
                  <BasicRow label="Leak type" value={leak} original={String(base.leak_type || '')} onChange={setLeak} rows={2} suggest="leak_type" />
                </div>
                <BasicRow label="Notes" value={notes} original={String(base.notes || '')} onChange={setNotes} rows={2} />
                {/* One lyrics box, toggled between plain and synced - showing both
                    at once was most of the form's remaining height. */}
                {(() => {
                  const showSynced = lyricsTab === 'synced'
                  const value      = showSynced ? synced : lyrics
                  const originalLy = String((showSynced ? base.synced_lyrics : base.lyrics) || '')
                  const changed    = value !== originalLy && !(value === '' && originalLy === '')
                  return (
                    <div className={basicShellClass(changed)}>
                      <div className="flex items-center gap-1.5">
                        <span className={basicLabelClass}>Lyrics</span>
                        <span className="flex-1" />
                        {showSynced && (
                          <button
                            onClick={() => { setSyncedTable(v => !v); localStorage.setItem('editor:syncedFormat', syncedTable ? 'raw' : 'table') }}
                            title={syncedTable ? 'Edit the raw LRC text' : 'Edit as timestamped lines'}
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-text-muted opacity-60 hover:opacity-100 transition-opacity"
                          >
                            {syncedTable ? 'Raw' : 'Lines'}
                          </button>
                        )}
                        {(['lyrics', 'synced'] as LyricsTab[]).map(tab => {
                          const active = lyricsTab === tab
                          const dirty  = tab === 'lyrics'
                            ? lyrics !== String(base.lyrics || '')
                            : synced !== String(base.synced_lyrics || '')
                          return (
                            <button key={tab} onClick={() => setLyricsTab(tab)}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                active ? 'bg-surface-raised text-text-primary' : 'text-text-muted opacity-60 hover:opacity-100'
                              }`}>
                              {tab === 'lyrics' ? 'Plain' : 'Synced'}
                              {dirty && <span className="w-1 h-1 rounded-full bg-accent inline-block" />}
                            </button>
                          )
                        })}
                      </div>
                      {showSynced && syncedTable ? (
                        <SyncedLyricsTable value={synced} onChange={setSynced} />
                      ) : (
                        <textarea
                          rows={12}
                          value={value}
                          onChange={e => (showSynced ? setSynced : setLyrics)(e.target.value)}
                          placeholder={showSynced ? '[00:00.00] Line one\n[00:05.20] Line two\n…' : 'Full lyrics…'}
                          className={`${basicControlClass} resize-y mt-1 ${showSynced ? 'font-mono text-xs' : ''}`}
                        />
                      )}
                    </div>
                  )
                })()}
                <div className="grid grid-cols-2 gap-1.5">
                  <BasicRow label="Image URL" value={imageUrl} original={String(base.image_url || '')} onChange={setImageUrl} mono onBrowse={() => setPickingImage(true)} />
                  <BasicRow label="File path" value={filePath} original={String(base.path || '')} onChange={setFilePath} mono onBrowse={() => setPickingFile(true)} />
                </div>
                <BasicRow label="Notes for the reviewer (optional)" value={edNotes} onChange={setEdNotes} />

                {submitError && (
                  <div className="flex items-center gap-2 text-red-400 text-xs mt-1">
                    <AlertCircle size={12} className="shrink-0" /> {submitError}
                  </div>
                )}
                {deleteError && (
                  <div className="flex items-center gap-2 text-red-400 text-xs mt-1">
                    <AlertCircle size={12} className="shrink-0" /> {deleteError}
                  </div>
                )}

                <div className="flex items-center gap-2.5 mt-2">
                  <button
                    onClick={submit}
                    disabled={submitState === 'submitting' || submitState === 'submitted' || changedCount === 0 || alreadySubmitted}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                      submitState === 'submitted' ? 'bg-emerald-500/20 text-emerald-400' :
                      submitState === 'error'     ? 'bg-red-500/20 text-red-400' :
                      changedCount === 0 || alreadySubmitted ? 'bg-surface-overlay text-text-muted opacity-30 cursor-not-allowed' :
                      'bg-surface-overlay border border-[var(--border)] text-text-primary hover:border-accent/40'
                    }`}>
                    {submitState === 'submitting' && <Loader2 size={12} className="animate-spin" />}
                    {submitState === 'submitted'  && <Check size={12} />}
                    {submitState === 'error'      && <AlertCircle size={12} />}
                    {submitState === 'idle' && alreadySubmitted && (editingPropId != null ? 'Updated' : 'Staged')}
                    {submitState === 'idle' && !alreadySubmitted && (editingPropId != null ? 'Update proposal' : 'Stage update proposal')}
                    {submitState === 'submitting' && (editingPropId != null ? 'Updating…' : 'Staging…')}
                    {submitState === 'submitted'  && (editingPropId != null ? 'Updated!' : 'Staged!')}
                    {submitState === 'error'      && 'Try again'}
                  </button>
                  <span className="text-[11px] text-text-muted opacity-65 tabular-nums">
                    {changedCount} field{changedCount !== 1 ? 's' : ''} changed
                  </span>
                  <span className="flex-1" />
                  {song && !isNewSongDraft && editingPropId == null && (
                    <button
                      onClick={submitDeletion}
                      onBlur={() => { if (deleteState === 'confirm') setDeleteState('idle') }}
                      disabled={deleteState === 'submitting' || deleteState === 'submitted'}
                      title="Stage this song entry for deletion. Review it in the Uploads panel before it's proposed - admins review before it's removed."
                      className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-colors flex items-center gap-1.5 ${
                        deleteState === 'submitted' ? 'text-emerald-400' :
                        deleteState === 'error'     ? 'text-red-400' :
                        deleteState === 'confirm'   ? 'bg-red-500 text-white' :
                        'text-red-400/70 hover:text-red-400'
                      }`}>
                      {deleteState === 'submitting' && <Loader2 size={12} className="animate-spin" />}
                      {deleteState === 'idle'       && 'Delete song'}
                      {deleteState === 'confirm'    && 'Click again to confirm'}
                      {deleteState === 'submitting' && 'Staging…'}
                      {deleteState === 'submitted'  && 'Staged!'}
                      {deleteState === 'error'      && 'Try again'}
                    </button>
                  )}
                  <button
                    onClick={closeSong}
                    className="px-2.5 py-1.5 text-[11px] font-bold text-text-muted opacity-65 hover:opacity-100 transition-opacity">
                    Close
                  </button>
                </div>
              </div>
            ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">

              {/* ── Left rail: preview + actions ── */}
              <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
                <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 overflow-hidden">
                  <div className="relative overflow-hidden">
                    {imageUrl && (
                      <img src={buildImageUrl(imageUrl)} alt=""
                        className="absolute inset-0 w-full h-full object-cover scale-150 blur-3xl opacity-[0.22] pointer-events-none select-none" />
                    )}
                    <div className="relative flex flex-col items-center gap-3 px-5 pt-6 pb-5">
                      {imageUrl
                        ? <img src={buildImageUrl(imageUrl)} alt=""
                            className="w-28 h-28 rounded-xl object-cover shadow-xl ring-1 ring-white/10" />
                        : <div className="w-28 h-28 rounded-xl bg-surface-overlay border border-[var(--border)] flex items-center justify-center">
                            <Music2 size={26} className="text-text-muted" />
                          </div>
                      }
                      <div className="min-w-0 w-full text-center">
                        <p className="text-text-primary font-bold text-sm leading-snug truncate">
                          {name || song?.name || 'Untitled'}
                        </p>
                        <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${CAT_BADGE[cat] || 'bg-surface-overlay text-text-muted'}`}>
                            {CATEGORY_LABELS[cat] || cat || 'Uncategorized'}
                          </span>
                          <span className="text-text-muted opacity-25 text-[11px]">{song ? `#${song.id}` : 'new song'}</span>
                        </div>
                        {album && <p className="text-text-muted opacity-75 text-[11px] truncate mt-1">{album}</p>}
                      </div>
                      <button
                        onClick={closeSong}
                        className="flex items-center gap-1.5 text-[11px] text-text-muted opacity-60 hover:opacity-100 transition-colors">
                        <X size={11} /> Close
                      </button>
                    </div>
                  </div>
                </div>

                {/* Category pills */}
                <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 p-4">
                  <FieldLabel label="Category" changed={cat !== String(base.category || '')} />
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {CATEGORIES.map(c => (
                      <button key={c.value} onClick={() => setCat(c.value)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                          cat === c.value
                            ? CAT_PILL[c.value] || 'bg-accent text-white'
                            : 'bg-surface-overlay text-text-muted hover:text-text-primary border border-[var(--border)]'
                        }`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3.5">
                    <SelectRow
                      label="Era" value={eraId} original={song?.era?.id ? String(song.era.id) : ''}
                      onChange={setEraId}
                      options={eras.map(e => ({ value: String(e.id), label: e.name }))}
                      placeholder={song?.era?.name || '—'}
                    />
                  </div>
                </div>

                {/* Submit / delete actions */}
                <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 p-4 space-y-2.5">
                  <input
                    value={edNotes} onChange={e => setEdNotes(e.target.value)}
                    placeholder="Editor notes…"
                    className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-text-primary placeholder:text-text-muted placeholder:opacity-30 focus:outline-none focus:border-accent/40 transition-colors"
                  />
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
                    className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                      submitState === 'submitted' ? 'bg-emerald-500/20 text-emerald-400' :
                      submitState === 'error'     ? 'bg-red-500/20 text-red-400' :
                      changedCount === 0 || alreadySubmitted ? 'bg-surface-overlay text-text-muted opacity-30 cursor-not-allowed' :
                      'bg-accent text-white hover:bg-accent/90 shadow-lg shadow-accent/20'
                    }`}>
                    {submitState === 'submitting' && <Loader2 size={12} className="animate-spin" />}
                    {submitState === 'submitted'  && <Check size={12} />}
                    {submitState === 'error'      && <AlertCircle size={12} />}
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
                      className={`w-full py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        deleteState === 'submitted' ? 'bg-emerald-500/20 text-emerald-400' :
                        deleteState === 'error'     ? 'bg-red-500/20 text-red-400' :
                        deleteState === 'confirm'   ? 'bg-red-500 text-white hover:bg-red-600' :
                        'bg-transparent text-red-400/70 hover:text-red-400 hover:bg-red-500/10'
                      }`}>
                      {deleteState === 'submitting' && <Loader2 size={12} className="animate-spin" />}
                      {deleteState === 'submitted'  && <Check size={12} />}
                      {(deleteState === 'idle' || deleteState === 'confirm') && <Trash2 size={12} />}
                      {deleteState === 'error'      && <AlertCircle size={12} />}
                      {deleteState === 'idle'       && 'Stage deletion'}
                      {deleteState === 'confirm'    && 'Click again to confirm'}
                      {deleteState === 'submitting' && 'Staging…'}
                      {deleteState === 'submitted'  && 'Staged!'}
                      {deleteState === 'error'      && 'Try again'}
                    </button>
                  )}
                </div>
              </aside>

              {/* ── Right: field cards ── */}
              <div className="flex flex-col gap-5 min-w-0">

                <Card title="Identity" overflowVisible>
                  <FieldGrid>
                    <FieldRow label="Title"    value={name}     original={String(base.name || '')}    onChange={setName} />
                    <FieldRow label="Artists"  value={artists}  original={String(base.credited_artists || '')} onChange={setArtists} suggest="credited_artists" />
                    <FieldRow label="Album"    value={album}    original={String(base.album || '')}   onChange={setAlbum} suggest="album" />
                    <FieldRow label="Cover URL" value={imageUrl} original={String(base.image_url || '')} onChange={setImageUrl} placeholder="https://…" mono onBrowse={() => setPickingImage(true)} />
                    <FieldRow label="Length" value={songLength} original={String(base.length || '')}  onChange={setSongLength} placeholder="3:59" mono />
                    <FieldRow label="BPM"    value={bpm}        original={base.bpm != null ? String(base.bpm) : ''} onChange={setBpm} placeholder="140" mono />
                    <FieldRow label="Key"    value={musicalKey} original={String(base.key || '')}      onChange={setMusicalKey} placeholder="C# Minor" />
                    <FieldRow label="File URL"  value={filePath} original={String(base.path || '')}      onChange={setFilePath} placeholder="Path/URL to the audio file" mono span={2} onBrowse={() => setPickingFile(true)} />
                    <TextareaRow label="Bitrate" value={bitrate} original={String(base.bitrate || '')} onChange={setBitrate} rows={2} placeholder="320 kbps" mono full />
                    <TextareaRow
                      label="Alt names" value={altNames}
                      original={(Array.isArray(base.track_titles) ? (base.track_titles as string[]).join('\n') : '')}
                      onChange={setAltNames} rows={2} placeholder="One name per line" full
                    />
                  </FieldGrid>
                </Card>

                {versionsEnabled && song && (
                  <Card title="Versions" overflowVisible>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={versionNum}
                        onChange={(e) => setVersionNum(e.target.value)}
                        placeholder="Version (e.g. v1, TV Mix)"
                        className="w-36 bg-surface-overlay/70 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent/40"
                      />
                      <div className="relative flex-1 min-w-0">
                        <input
                          type="text"
                          value={versionTitle}
                          onChange={(e) => setVersionTitle(e.target.value)}
                          onFocus={() => setShowTitleSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowTitleSuggestions(false), 150)}
                          placeholder="Version title (shared by all linked songs)"
                          className="w-full bg-surface-overlay/70 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent/40"
                        />
                        {showTitleSuggestions && titleSuggestions.length > 0 && (
                          <div className="absolute z-10 top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-surface border border-[var(--border)] rounded-lg shadow-2xl py-1">
                            {titleSuggestions.map(s => (
                              <button
                                key={s.groupId}
                                onMouseDown={(e) => { e.preventDefault(); handlePickTitleSuggestion(s) }}
                                title="Joins this song into that existing version group"
                                className="w-full text-left px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-overlay hover:text-text-primary transition-colors truncate"
                              >
                                {s.title}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={saveVersionInfo}
                        disabled={versionSaveStatus === 'saving'}
                        title="Save version info (writes directly, not part of the proposal)"
                        className={`shrink-0 p-1.5 rounded-lg transition-colors ${
                          versionSaveStatus === 'saved' ? 'text-emerald-400' :
                          versionSaveStatus === 'error' ? 'text-red-400' :
                          'bg-surface-overlay border border-[var(--border)] text-text-muted hover:text-text-primary'
                        }`}
                      >
                        {versionSaveStatus === 'saving' && <Loader2 size={13} className="animate-spin" />}
                        {versionSaveStatus === 'saved'  && <Check size={13} />}
                        {versionSaveStatus === 'error'  && <AlertCircle size={13} />}
                        {versionSaveStatus === 'idle'    && <Check size={13} />}
                      </button>
                    </div>
                    {linkError && (
                      <p className="mt-1.5 text-red-400 text-xs">{linkError}</p>
                    )}
                    {/* The title belongs to the group, so say plainly what
                        saving a changed one will do to the other members. */}
                    {linkedCount > 0 && (
                      <p className="mt-1.5 text-[11px] text-text-muted opacity-75">
                        {versionTitle.trim() !== loadedTitle
                          ? `Saving moves this song out of its group of ${linkedCount + 1} under the new title. The others keep "${loadedTitle || '—'}".`
                          : `Linked with ${linkedCount} other song${linkedCount === 1 ? '' : 's'} under this title.`}
                      </p>
                    )}
                  </Card>
                )}

                <Card title="Credits" overflowVisible>
                  <FieldGrid>
                    <FieldRow label="Producers" value={prod} original={String(base.producers || '')} onChange={setProd} suggest="producers" />
                    <FieldRow label="Engineers" value={eng}  original={String(base.engineers || '')} onChange={setEng} suggest="engineers" />
                  </FieldGrid>
                </Card>

                <Card title="Dates">
                  <FieldGrid cols={4}>
                    <TextareaRow label="Recorded"  value={recDate} original={String(base.record_dates || '')}  onChange={setRecDate} rows={2} placeholder="YYYY-MM-DD" mono dateInput />
                    <TextareaRow label="Released"  value={relDate} original={String(base.release_date || '')}  onChange={setRelDate} rows={2} placeholder="YYYY-MM-DD" mono dateInput />
                    <TextareaRow label="Preview" value={previewDate} original={String(base.preview_date || '')} onChange={setPreviewDate} rows={2} placeholder="YYYY-MM-DD" mono dateInput />
                    <TextareaRow label="Date leaked" value={dateLeaked} original={String(base.date_leaked || '')} onChange={setDateLeaked} rows={2} placeholder="YYYY-MM-DD" mono dateInput />
                  </FieldGrid>
                </Card>

                {/* More fields */}
                <button
                  onClick={() => setShowMore(v => !v)}
                  className="flex items-center gap-1.5 self-start text-[11px] font-semibold text-text-muted opacity-70 hover:opacity-100 transition-colors select-none">
                  {showMore ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {showMore ? 'Fewer fields' : 'More fields'}
                </button>

                {showMore && (
                  <Card title="Additional details" overflowVisible>
                    <FieldGrid>
                      <FieldRow label="Location"   value={loc}              original={String(base.recording_locations || '')}   onChange={setLoc} placeholder="Studio / city" suggest="recording_locations" />
                      <TextareaRow label="Leak type" value={leak} original={String(base.leak_type || '')} onChange={setLeak} rows={2} placeholder="HQ, LQ, snippet…" suggest="leak_type" span={2} />
                      <FieldRow label="File names" value={fileNames}        original={String(base.file_names || '')}            onChange={setFileNames} />
                      <FieldRow label="Instrumentals" value={instrumentals} original={String(base.instrumentals || '')}       onChange={setInstrumentals} placeholder="Instrumental versions available" />
                      <FieldRow label="Inst. names" value={instrumentalNames} original={String(base.instrumental_names || '')} onChange={setInstrumentalNames} />
                      {cat === 'recording_session' && (
                        <>
                          <FieldRow label="Session titles" value={sessionTitles} original={String(base.session_titles || '')} onChange={setSessionTitles} />
                          <FieldRow label="Session tracking" value={sessionTracking} original={String(base.session_tracking || '')} onChange={setSessionTracking} />
                        </>
                      )}
                      <TextareaRow label="Add. info" value={addInfo} original={String(base.additional_information || '')} onChange={setAddInfo} rows={3} full />
                      <TextareaRow label="Notes"     value={notes}   original={String(base.notes || '')}                  onChange={setNotes}   rows={2} full />
                    </FieldGrid>
                  </Card>
                )}

                {/* LYRICS */}
                <Card
                  title="Lyrics"
                  action={
                    <div className="flex items-center gap-1">
                      {lyricsTab === 'synced' && (
                        <button
                          onClick={() => { setSyncedTable(v => !v); localStorage.setItem('editor:syncedFormat', syncedTable ? 'raw' : 'table') }}
                          title={syncedTable ? 'Edit the raw LRC text' : 'Edit as timestamped lines'}
                          className="px-2 py-1 rounded-lg text-[11px] font-semibold text-text-muted opacity-60 hover:opacity-100 transition-opacity"
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
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                              active ? 'bg-surface-overlay text-text-primary' : 'text-text-muted opacity-75 hover:text-text-muted'
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
                        rows={15} value={lyrics} onChange={e => setLyrics(e.target.value)}
                        onPaste={handleLyricsPaste}
                        disabled={lyricsLoading}
                        placeholder="Full lyrics… or paste a Genius URL"
                        className={`w-full bg-surface-overlay/70 rounded-xl px-3.5 py-3 text-sm text-text-primary focus:outline-none resize-none placeholder:text-text-muted placeholder:opacity-25 border transition-colors leading-relaxed ${
                          lyrics !== String(base.lyrics || '') ? 'border-accent/40' : 'border-[var(--border)] focus:border-accent/40'
                        } ${lyricsLoading ? 'opacity-40' : ''}`}
                      />
                      {lyricsLoading && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-xl pointer-events-none">
                          <div className="flex items-center gap-2 text-text-muted text-xs bg-surface-overlay/80 px-3 py-1.5 rounded-lg">
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
                      rows={15} value={synced} onChange={e => setSynced(e.target.value)}
                      placeholder={"[00:00.00] Line one\n[00:05.20] Line two\n…"}
                      className={`w-full bg-surface-overlay/70 rounded-xl px-3.5 py-3 text-sm font-mono text-text-primary focus:outline-none resize-none placeholder:text-text-muted placeholder:opacity-25 border transition-colors ${
                        synced ? 'border-accent/40' : 'border-[var(--border)] focus:border-accent/40'
                      }`}
                    />
                  )}
                </Card>
              </div>
            </div>
            )}
          </div>
        )}

      </div>

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
  // htmlFor rather than wrapping: the label shares a flex row with the hint,
  // so it cannot also be the element that wraps the field.
  const id = useId()
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={id} className="text-[11px] font-bold uppercase tracking-wider text-text-muted opacity-65">{label}</label>
        {hint && <span className="text-[10px] text-text-muted opacity-55">{hint}</span>}
      </div>
      {(rows ?? 1) > 1
        ? <textarea id={id} rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent/40 resize-none placeholder:text-text-muted placeholder:opacity-30 transition-colors" />
        : <input id={id} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
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
      <button onClick={onSignOut} className="text-xs text-text-muted opacity-65 hover:text-text-muted transition-colors mt-1">Sign out</button>
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
      <button onClick={onSignOut} className="text-xs text-text-muted opacity-65 hover:text-text-muted transition-colors mt-1">Sign out</button>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-xl px-6 py-8">
        <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 overflow-hidden">
          <div className="px-6 pt-6 pb-5 border-b border-[var(--border)] flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
              <Award size={19} className="text-accent" />
            </div>
            <div>
              <p className="text-text-primary font-bold text-[15px]">Become an editor</p>
              <p className="text-text-muted opacity-75 text-xs mt-0.5">Propose corrections. Admins review and apply them.</p>
            </div>
          </div>
          <div className="px-6 py-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AppField label="Display name"      value={displayName} onChange={setDisplayName} placeholder="How you want to be credited" />
              <AppField label="Contact"           value={contact}     onChange={setContact}     placeholder="Discord, email…" />
            </div>
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
              className="w-full py-2.5 rounded-xl bg-accent text-white hover:bg-accent/90 text-sm font-bold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-accent/20">
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Submit application
            </button>
            <button onClick={onSignOut} className="w-full text-xs text-text-muted opacity-65 hover:opacity-100 transition-colors py-1">Sign out</button>
          </div>
        </div>
      </div>
    </div>
  )
})
