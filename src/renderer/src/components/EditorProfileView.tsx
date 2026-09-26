import { useEffect, useState, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Loader2, Trophy, FileEdit, ChevronLeft, Pencil, Trash2, RefreshCw, Plus, X, Check, AlertCircle, ChevronDown, ChevronUp, Search, Flag, ShieldCheck, FolderOpen, Copy, PictureInPicture2, User } from 'lucide-react'
import { useStore, IS_FLOAT_WINDOW } from '../store/useStore'
import { navigateFromWindow, attachToMainWindow } from '../lib/windowSync'
import { getMyProposals, getLeaderboard, withdrawProposal, createProposal, resubmitProposal, SongEditProposal, ProposalStatus, getMyCompProposals, withdrawCompProposal, CompFileProposal, isChannelContributor, isChannelManager } from '../lib/userApi'
import { isPrimaryChannelSlug } from '../hooks/useChannelRoles'
import { apiFetch, JWApiEra, JWApiSong } from '../lib/juicewrldApi'
import * as reportsApi from '../lib/reportsApi'
import type { SongReportRow, SongReportStatus } from '../lib/reportsApi'
import ReportsTab from './ReportsTab'
import FilePickerModal from './FilePickerModal'
import { BasicRow, BasicSelect, SyncedLyricsTable, cleanDate } from './EditorPage'
import AdminPage from './AdminPage'
import CompProposalList, { CompFilterBar, filterCompProposals, type CompFilterTab } from './CompProposalList'

const CATEGORIES = [
  { value: 'released', label: 'Released' },
  { value: 'unreleased', label: 'Unreleased' },
  { value: 'unsurfaced', label: 'Unsurfaced' },
  { value: 'recording_session', label: 'Session' },
]
/* ── Copy-from-song search ─────────────────────────────────────────────────── */
/* Most new entries are another version of a song that already exists, so the
   fast path is "start from that one and change what differs" rather than
   retyping every credit and date. */
function CopyFromSong({ onCopy, copiedFrom, onClear }: {
  onCopy: (song: JWApiSong) => void
  copiedFrom: string | null
  onClear: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<JWApiSong[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingId, setLoadingId] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (debounced.length < 2) { setResults([]); return }
    let cancelled = false
    setLoading(true)
    apiFetch<{ results: JWApiSong[] }>('/songs/', { search: debounced, page_size: 8 })
      .then(d => { if (!cancelled) setResults(d.results ?? []) })
      .catch(() => { if (!cancelled) setResults([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debounced])

  // The list endpoint returns trimmed rows (no lyrics/credits), so the pick
  // has to be re-fetched in full before its fields can be copied across.
  const pick = async (row: JWApiSong): Promise<void> => {
    setLoadingId(row.id)
    try { onCopy(await apiFetch<JWApiSong>(`/songs/${row.id}/`)) }
    catch { onCopy(row) }
    finally { setLoadingId(null); setQuery(''); setDebounced(''); setResults([]) }
  }

  if (copiedFrom) return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 border border-accent/20">
      <Copy size={12} className="text-accent shrink-0" />
      <span className="text-[11px] text-accent font-medium flex-1 min-w-0 truncate">Copied from "{copiedFrom}"</span>
      <button onClick={onClear} className="text-accent opacity-60 hover:opacity-100 text-[11px] transition-opacity shrink-0">Clear</button>
    </div>
  )

  return (
    <div className="relative">
      <Search size={13} className="absolute left-2.5 top-[9px] text-text-muted pointer-events-none" />
      <input
        value={query} onChange={e => setQuery(e.target.value)}
        placeholder="Copy fields from an existing song…"
        className="w-full bg-[var(--surface-overlay)] border border-[var(--border)] rounded-lg pl-8 pr-8 py-1.5 text-xs text-text-primary placeholder:text-text-muted placeholder:opacity-40 focus:outline-none focus:border-accent/40 transition-colors"
      />
      {loading && <Loader2 size={12} className="absolute right-2.5 top-2.5 animate-spin text-text-muted" />}
      {results.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] shadow-2xl py-1">
          {results.map(r => (
            <button
              key={r.id}
              onClick={() => pick(r)}
              className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 text-xs text-text-secondary hover:bg-[var(--surface-overlay)] hover:text-text-primary transition-colors"
            >
              <span className="flex-1 min-w-0 truncate">{r.name}</span>
              {r.era?.name && <span className="text-[10px] text-text-muted opacity-60 shrink-0">{r.era.name}</span>}
              {loadingId === r.id && <Loader2 size={11} className="animate-spin shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AddSongModal({ onClose, onSubmitted, channel }: { onClose: () => void; onSubmitted: () => void; channel?: string }): JSX.Element {
  const [name,    setName]    = useState('')
  const [artists, setArtists] = useState('')
  const [cat,     setCat]     = useState('')
  const [album,   setAlbum]   = useState('')
  const [eraId,   setEraId]   = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [altNames, setAltNames] = useState('')
  const [lyrics,   setLyrics]   = useState('')
  const [syncedLyrics, setSyncedLyrics] = useState('')
  const [prod,     setProd]     = useState('')
  const [engineer, setEngineer] = useState('')
  const [location, setLocation] = useState('')
  const [filePath, setFilePath] = useState('')
  const [previewDate, setPreviewDate] = useState('')
  const [leakType, setLeakType] = useState('')
  const [recDate,  setRecDate]  = useState('')
  const [relDate,  setRelDate]  = useState('')
  const [instrumentals,     setInstrumentals]     = useState('')
  const [instrumentalNames, setInstrumentalNames] = useState('')
  const [addInfo,  setAddInfo]  = useState('')
  const [notes,    setNotes]    = useState('')
  const [dateLeaked, setDateLeaked] = useState('')
  const [fileNames,  setFileNames]  = useState('')
  const [songLength, setSongLength] = useState('')
  const [bitrate,    setBitrate]    = useState('')
  const [edNotes, setEdNotes] = useState('')
  const [showMore, setShowMore] = useState(false)
  // Title of the song this draft was copied from, if any — shown as a banner
  // so it's obvious why the form arrived pre-filled.
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null)
  const [syncedTable, setSyncedTable] = useState(() => localStorage.getItem('editor:syncedFormat') !== 'raw')
  // File picker for the audio path field
  const [pickingFile, setPickingFile] = useState(false)
  const [eras, setEras] = useState<JWApiEra[]>([])
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    apiFetch<JWApiEra[] | { results: JWApiEra[] }>('/eras/')
      .then(d => setEras(Array.isArray(d) ? d : (d as { results: JWApiEra[] }).results ?? []))
      .catch(() => undefined)
  }, [])

  // Everything the source song knows, minus the three fields that describe its
  // specific audio file — a new version has its own file, length and bitrate,
  // and silently inheriting those would submit wrong data for the common case.
  const copyFrom = (s: JWApiSong): void => {
    setName(s.name || '')
    setArtists(s.credited_artists || '')
    setAlbum(s.album ?? s.era?.name ?? '')
    setCat(s.category || '')
    setEraId(s.era?.id ? String(s.era.id) : '')
    setImageUrl(s.image_url || '')
    setAltNames((s.track_titles || []).join('\n'))
    setLyrics(s.lyrics || '')
    setSyncedLyrics(s.synced_lyrics || '')
    setProd(s.producers || '')
    setEngineer(s.engineers || '')
    setLocation(s.recording_locations || '')
    setRecDate(s.record_dates || '')
    setRelDate(cleanDate(s.release_date))
    setPreviewDate(cleanDate(s.preview_date))
    setLeakType(s.leak_type || '')
    setDateLeaked(cleanDate(s.date_leaked))
    setInstrumentals(s.instrumentals || '')
    setInstrumentalNames(s.instrumental_names || '')
    setFileNames(s.file_names || '')
    setAddInfo(s.additional_information || '')
    setNotes(s.notes || '')
    setCopiedFrom(s.name || null)
    setShowMore(true)
  }

  const proposed: Record<string, unknown> = {}
  if (name)    proposed.name                = name
  if (artists) proposed.credited_artists    = artists
  if (album)   proposed.album              = album
  if (cat)     proposed.category           = cat
  if (eraId)   proposed.era_id             = Number(eraId)
  if (imageUrl) proposed.image_url = imageUrl
  if (altNames) proposed.track_titles = altNames.split('\n').map(s => s.trim()).filter(Boolean)
  if (lyrics) proposed.lyrics = lyrics
  if (syncedLyrics) proposed.synced_lyrics = syncedLyrics
  if (prod)     proposed.producers           = prod
  if (engineer) proposed.engineers           = engineer
  if (location) proposed.recording_locations = location
  if (filePath) proposed.path                = filePath
  if (leakType) proposed.leak_type     = leakType
  if (recDate)  proposed.record_dates  = recDate
  if (relDate) proposed.release_date        = relDate
  if (previewDate) proposed.preview_date    = previewDate
  if (instrumentals)     proposed.instrumentals      = instrumentals
  if (instrumentalNames) proposed.instrumental_names = instrumentalNames
  // "Additional info" maps to additional_information — distinct from `notes`,
  // which previously had this textarea's value submitted under the wrong key.
  if (addInfo) proposed.additional_information = addInfo
  if (notes)   proposed.notes                  = notes
  if (dateLeaked) proposed.date_leaked = dateLeaked
  if (fileNames)  proposed.file_names  = fileNames
  if (songLength) proposed.length      = songLength
  if (bitrate)    proposed.bitrate     = bitrate

  const handleSubmit = async (): Promise<void> => {
    if (!name.trim() || submitState === 'submitting') return
    setSubmitState('submitting'); setSubmitError(null)
    try {
      await createProposal({ song: null, change_type: 'create', title: name.trim(), proposed_data: proposed, editor_notes: edNotes, channel })
      setSubmitState('submitted')
      setTimeout(() => { onSubmitted(); onClose() }, 1200)
    } catch (e) {
      setSubmitState('error')
      setSubmitError(e instanceof Error ? e.message : 'Submission failed')
      setTimeout(() => setSubmitState('idle'), 4000)
    }
  }

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-end justify-center" onClick={e => { if (e.target === overlayRef.current) onClose() }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[var(--surface)] rounded-t-2xl shadow-2xl border border-[var(--border)] border-b-0 animate-slide-up flex flex-col max-h-[88dvh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-[var(--border)] shrink-0">
          <div className="w-8 h-8 rounded-xl bg-accent/15 border border-accent/20 flex items-center justify-center shrink-0">
            <Plus size={15} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-text-primary font-bold text-sm">Propose new song</p>
            <p className="text-text-muted text-xs opacity-60 mt-0.5">Admins review and add it to the database</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Scrollable fields — same flat layout as the editor's Basic view, so
            creating a song and editing one look and behave alike. */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 flex flex-col gap-1.5">
          <CopyFromSong onCopy={copyFrom} copiedFrom={copiedFrom} onClear={() => setCopiedFrom(null)} />

          <BasicRow label="Name *" value={name} onChange={setName} placeholder="Song title" />
          <div className="grid grid-cols-2 gap-1.5">
            <BasicSelect
              label="Era" value={eraId} original="" onChange={setEraId}
              options={eras.map(e => ({ value: String(e.id), label: e.name }))}
            />
            <BasicSelect label="Category" value={cat} original="" onChange={setCat} options={CATEGORIES} />
          </div>
          <BasicRow label="Album" value={album} onChange={setAlbum} placeholder="Album name" suggest="album" />
          <BasicRow label="Alternate titles (one per line)" value={altNames} onChange={setAltNames} rows={3} />
          <BasicRow label="Credited artists" value={artists} onChange={setArtists} placeholder="Juice WRLD ft. …" suggest="credited_artists" />

          <button onClick={() => setShowMore(v => !v)}
            className="flex items-center gap-1.5 self-start px-1 py-1 text-[11px] font-semibold text-text-muted opacity-60 hover:opacity-100 transition-opacity select-none">
            {showMore ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {showMore ? 'Fewer fields' : 'More fields'}
          </button>

          {showMore && (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Producers" value={prod} onChange={setProd} placeholder="Producer names" suggest="producers" />
                <BasicRow label="Engineers" value={engineer} onChange={setEngineer} placeholder="Engineer name" suggest="engineers" />
              </div>
              <BasicRow label="Recording locations" value={location} onChange={setLocation} rows={2} placeholder="Studio / city" suggest="recording_locations" />
              <BasicRow label="Record dates" value={recDate} onChange={setRecDate} rows={2} placeholder="YYYY-MM-DD" mono />
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Length" value={songLength} onChange={setSongLength} placeholder="3:59" mono />
                <BasicRow label="Bitrate" value={bitrate} onChange={setBitrate} placeholder="320 kbps" mono />
              </div>
              <BasicRow label="Additional information" value={addInfo} onChange={setAddInfo} rows={3} placeholder="Any other info…" />
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="File names" value={fileNames} onChange={setFileNames} rows={2} />
                <BasicRow label="Instrumentals" value={instrumentals} onChange={setInstrumentals} rows={2} placeholder="Instrumental versions available" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Preview date" value={previewDate} onChange={setPreviewDate} placeholder="YYYY-MM-DD" mono />
                <BasicRow label="Release date" value={relDate} onChange={setRelDate} placeholder="YYYY-MM-DD" mono />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Instrumental names" value={instrumentalNames} onChange={setInstrumentalNames} rows={2} />
                <BasicRow label="Notes" value={notes} onChange={setNotes} rows={2} placeholder="Internal notes…" />
              </div>
              <BasicRow label="Lyrics" value={lyrics} onChange={setLyrics} rows={8} placeholder="Plain lyrics…" />

              {/* Synced lyrics get the editor's line table, with the same raw
                  escape hatch for pasting a whole LRC at once. */}
              <div className="rounded-md border border-[var(--border)] bg-[var(--surface-overlay)]/60 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold tracking-wide text-text-muted leading-tight">Synced lyrics</span>
                  <span className="flex-1" />
                  <button
                    onClick={() => { setSyncedTable(v => !v); localStorage.setItem('editor:syncedFormat', syncedTable ? 'raw' : 'table') }}
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-text-muted opacity-60 hover:opacity-100 transition-opacity">
                    {syncedTable ? 'Raw' : 'Lines'}
                  </button>
                </div>
                {syncedTable ? (
                  <SyncedLyricsTable value={syncedLyrics} onChange={setSyncedLyrics} />
                ) : (
                  <textarea rows={6} value={syncedLyrics} onChange={e => setSyncedLyrics(e.target.value)} placeholder="[mm:ss.xx] line…"
                    className="w-full bg-transparent border-0 p-0 mt-1 text-xs font-mono leading-snug text-text-primary focus:outline-none resize-y placeholder:text-text-muted placeholder:opacity-40" />
                )}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Date leaked" value={dateLeaked} onChange={setDateLeaked} placeholder="YYYY-MM-DD" mono />
                <BasicRow label="Leak type" value={leakType} onChange={setLeakType} placeholder="e.g. Stem, Master, Video…" suggest="leak_type" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Image URL" value={imageUrl} onChange={setImageUrl} placeholder="https://…" mono />
                <BasicRow label="File path" value={filePath} onChange={setFilePath} placeholder="Path to the audio file" mono onBrowse={() => setPickingFile(true)} />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-[var(--border)] px-5 py-4 space-y-3">
          <input value={edNotes} onChange={e => setEdNotes(e.target.value)} placeholder="Editor notes (optional)…"
            className="w-full bg-[var(--surface-overlay)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-text-primary placeholder:text-text-muted placeholder:opacity-30 focus:outline-none focus:border-accent/40 transition-colors" />
          {submitError && (
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle size={12} className="shrink-0" /> {submitError}
            </div>
          )}
          <button onClick={handleSubmit} disabled={!name.trim() || submitState === 'submitting' || submitState === 'submitted'}
            className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
              submitState === 'submitted' ? 'bg-emerald-500/20 text-emerald-400' :
              submitState === 'error'     ? 'bg-red-500/20 text-red-400' :
              !name.trim()                ? 'bg-[var(--surface-overlay)] text-text-muted opacity-40 cursor-not-allowed' :
              'bg-accent text-white hover:bg-accent/90 shadow-lg shadow-accent/20'
            }`}>
            {submitState === 'submitting' && <Loader2 size={14} className="animate-spin" />}
            {submitState === 'submitted'  && <Check size={14} />}
            {submitState === 'error'      && <AlertCircle size={14} />}
            {submitState === 'idle'       && 'Submit proposal'}
            {submitState === 'submitting' && 'Submitting…'}
            {submitState === 'submitted'  && 'Submitted!'}
            {submitState === 'error'      && 'Try again'}
          </button>
        </div>
      </div>

      {pickingFile && (
        <FilePickerModal
          kind="audio"
          songTitle={name}
          altTitles={altNames.split('\n').map(s => s.trim()).filter(Boolean)}
          onSelect={p => { setFilePath(p); setPickingFile(false) }}
          onClose={() => setPickingFile(false)}
        />
      )}
    </div>
  )
}

type LeaderboardEntry = {
  rank: number
  user_id: number
  username: string
  discord_username: string
  discord_avatar: string
  approved_count: number
  badges: Array<{ slug: string; name: string; icon: string; description: string; category: string; note: string; awarded_at: string; awarded_by_username: string | null }>
}

const STATUS_STYLES: Record<ProposalStatus, { label: string; bar: string; badge: string }> = {
  pending:  { label: 'Pending',  bar: 'bg-yellow-400',  badge: 'bg-yellow-500/15 text-yellow-400' },
  approved: { label: 'Approved', bar: 'bg-green-400',   badge: 'bg-green-500/15 text-green-400' },
  rejected: { label: 'Rejected', bar: 'bg-red-400',     badge: 'bg-red-500/15 text-red-400' },
  reversed: { label: 'Reversed', bar: 'bg-surface-overlay', badge: 'bg-surface-overlay text-text-muted' },
}

const RANK_STYLES: Record<number, { num: string; badge: string }> = {
  1: { num: 'text-yellow-400 font-black', badge: 'bg-yellow-500/15 ring-1 ring-yellow-500/30' },
  2: { num: 'text-slate-300 font-black',  badge: 'bg-slate-500/15 ring-1 ring-slate-400/30' },
  3: { num: 'text-amber-600 font-black',  badge: 'bg-amber-700/15 ring-1 ring-amber-600/30' },
}

type FilterTab = 'all' | ProposalStatus

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function changeTypeLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function EditorProfileView(): JSX.Element {
  const isElectron = navigator.userAgent.includes('Electron')
  const { account, setPendingEditorSongId, setPendingEditProposal, activeChannel, channels, setActiveChannel, loadChannels, openOwnPublicProfile } = useStore(useShallow(s => ({
    account: s.account,
    setPendingEditorSongId: s.setPendingEditorSongId,
    setPendingEditProposal: s.setPendingEditProposal,
    activeChannel: s.activeChannel,
    channels: s.channels,
    setActiveChannel: s.setActiveChannel,
    loadChannels: s.loadChannels,
    openOwnPublicProfile: s.openOwnPublicProfile,
  })))
  // Every list on this page — my proposals, my comp proposals, the Admin tab's
  // review queues — is already scoped to activeChannel (see the effects
  // below and AdminPage). ApiFilesView is the only other place that lets a
  // user change it; without a switcher here too, reviewing a second channel
  // meant leaving the profile to flip it in Files first.
  useEffect(() => { if (channels.length === 0) loadChannels().catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // This page also renders as its own window (FloatApp's `profile` view), where
  // setActiveView is a no-op — nothing routes there. Every link that leaves the
  // profile goes through this instead, which hands the navigation to the main
  // window when we're a pop-out.
  const go = navigateFromWindow
  const floating = IS_FLOAT_WINDOW
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).electron

  const [proposals, setProposals] = useState<SongEditProposal[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loadingProposals, setLoadingProposals] = useState(true)
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [resubmittingId, setResubmittingId] = useState<number | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [showAddSong, setShowAddSong] = useState(false)

  // Reports review (moved out of the Admin sidebar entry for editor-only
  // accounts — it now lives as a tab alongside their own proposals).
  const canReviewReports = !!(account?.is_editor || account?.is_administrator)
  // Not `|| is_administrator`: this tab lists proposals *you* submitted, and
  // an admin who never contributed has none. Their review queue is the Admin
  // tab's "Comp files" — the one place proposals are reviewed.
  const isPrimary = isPrimaryChannelSlug(channels, activeChannel)
  const isContributor = isChannelContributor(account, activeChannel, isPrimary)
  const isAdmin = !!account?.is_administrator
  // Managers review the same two queues admins do, so they get the same
  // embedded panel here. Scoped to the active channel — a manager grant on
  // one channel shouldn't leave this tab visible (and then erroring) on a
  // channel they don't actually manage.
  const isManager = isChannelManager(account, activeChannel, isPrimary)
  const canReviewStaff = isAdmin || isManager
  const [profileTab, setProfileTab] = useState<'proposals' | 'reports' | 'admin' | 'comp'>('proposals')
  const [reportStatus, setReportStatus] = useState<SongReportStatus | ''>('pending')
  const [reports, setReports] = useState<SongReportRow[]>([])
  const [loadingReports, setLoadingReports] = useState(false)
  const [compProposals, setCompProposals] = useState<CompFileProposal[]>([])
  const [loadingComp, setLoadingComp] = useState(false)
  const [compFilter, setCompFilter] = useState<CompFilterTab>('all')
  const [withdrawingCompId, setWithdrawingCompId] = useState<number | null>(null)

  useEffect(() => {
    if (profileTab !== 'comp' || !isContributor) return
    setLoadingComp(true)
    getMyCompProposals(activeChannel).then(setCompProposals).catch(() => {}).finally(() => setLoadingComp(false))
  }, [profileTab, isContributor, refreshKey, activeChannel])

  const handleWithdrawComp = async (id: number): Promise<void> => {
    setWithdrawingCompId(id)
    try {
      await withdrawCompProposal(id)
      setCompProposals(prev => prev.filter(p => p.id !== id))
    } catch {
      setRefreshKey(k => k + 1)
    } finally {
      setWithdrawingCompId(null)
    }
  }

  useEffect(() => {
    if (profileTab !== 'reports' || !canReviewReports) return
    setLoadingReports(true)
    reportsApi.listSongReports(reportStatus || undefined)
      .then(setReports)
      .catch(() => {})
      .finally(() => setLoadingReports(false))
  }, [profileTab, reportStatus, refreshKey, canReviewReports])

  const handleDelete = async (id: number): Promise<void> => {
    setDeletingId(id)
    try {
      await withdrawProposal(id)
      setProposals(prev => prev.filter(p => p.id !== id))
    } catch (e) { console.error('withdraw failed:', e) }
    finally { setDeletingId(null) }
  }

  const handleResubmit = async (p: SongEditProposal): Promise<void> => {
    setResubmittingId(p.id)
    try {
      const fresh = await resubmitProposal(p)
      setProposals(prev => [fresh, ...prev.filter(x => x.id !== p.id)])
    } catch (e) { console.error('resubmit failed:', e) }
    finally { setResubmittingId(null) }
  }

  const handleEdit = (p: SongEditProposal): void => {
    // p.song is null for 'create' proposals (new song, no backing record yet) —
    // EditorPage handles that case, so don't block it here.
    setPendingEditProposal({ id: p.id, songId: p.song, proposedData: p.proposed_data, editorNotes: p.editor_notes || '' })
    setPendingEditorSongId(p.song)
    go('editor')
  }

  useEffect(() => {
    setRefreshing(true)
    Promise.all([
      getMyProposals(activeChannel).then(setProposals).catch(() => {}),
      getLeaderboard().then((data) => setLeaderboard(data as LeaderboardEntry[])).catch(() => {}),
    ]).finally(() => {
      setLoadingProposals(false)
      setLoadingLeaderboard(false)
      setRefreshing(false)
    })
  }, [refreshKey, activeChannel])

  const myEntry = leaderboard.find((e) => e.discord_username === account?.discord_username)

  // Searchable text for a proposal: its title, change type, notes, song id,
  // and any string/number values in the proposed data (name, artists, album,
  // producers, etc.) so a query matches whatever the proposal actually edits.
  const proposalSearchText = (p: SongEditProposal): string => {
    const dataVals = Object.values(p.proposed_data ?? {})
      .filter(v => typeof v === 'string' || typeof v === 'number')
      .join(' ')
    return [p.title, changeTypeLabel(p.change_type), p.editor_notes, p.song != null ? `song #${p.song}` : '', dataVals]
      .filter(Boolean).join(' ').toLowerCase()
  }

  const filteredProposals = useMemo(() => {
    const byStatus = filter === 'all' ? proposals : proposals.filter(p => p.status === filter)
    const q = search.trim().toLowerCase()
    if (!q) return byStatus
    return byStatus.filter(p => proposalSearchText(p).includes(q))
  }, [proposals, filter, search])

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all',      label: 'All' },
    { key: 'pending',  label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
  ]

  const tabCount = (tab: FilterTab) => tab === 'all' ? proposals.length : proposals.filter(p => p.status === tab).length

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

      {/* ── Header ── */}
      {/* The utility row (channel switcher / pop-out / refresh) is right-aligned
          here, which in Electron sits directly under the fixed window-control
          buttons (minimize/maximize/close, 28px tall) — the app's `main`
          element doesn't otherwise reserve space for them, it just draws a
          drag region behind the content. Extra top padding pushes this row
          below that band instead of overlapping it. */}
      {/* The pop-out has FloatTitleBar above it holding its own controls, in
          normal flow — so it needs none of that clearance. */}
      <div className={`px-6 pb-5 border-b border-[var(--border)] shrink-0 ${isElectron && !floating ? 'pt-9' : 'pt-5'}`}>
        <div className="flex items-center justify-between mb-4">
          {floating ? (
            // No "Back" in a pop-out — there's nothing behind it. Docking puts
            // the profile back in the main window and closes this one, which is
            // the in-the-moment escape hatch for someone who doesn't want the
            // separate window right now (the Settings toggle is the permanent one).
            <button
              onClick={() => { attachToMainWindow({ view: 'profile' }); el?.closeSelf?.() }}
              className="flex items-center gap-1.5 text-text-muted hover:text-text-primary text-xs transition-colors"
              title="Move back into the main window"
            >
              <PictureInPicture2 size={13} /> Dock
            </button>
          ) : (
            <button
              onClick={() => go('api-tracker')}
              className="flex items-center gap-1.5 text-text-muted hover:text-text-primary text-xs transition-colors"
            >
              <ChevronLeft size={14} /> Back
            </button>
          )}
          <div className="flex items-center gap-1.5">
            {channels.length > 0 && (
              <div className="flex items-center bg-surface-overlay rounded-lg p-1 gap-0.5 mr-1">
                {channels.map((ch) => (
                  <button
                    key={ch.slug}
                    onClick={() => setActiveChannel(ch.slug)}
                    disabled={channels.length === 1}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${activeChannel === ch.slug ? 'bg-surface-raised text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'} disabled:opacity-70`}
                    title={ch.description || ch.name}
                  >{ch.name}</button>
                ))}
              </div>
            )}
            <button
              onClick={openOwnPublicProfile}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors"
              title="View your public profile"
            >
              <User size={13} />
            </button>
            {/* Shown only when the pop-out is turned off — with it on, this page
                *is* the pop-out and the button would reopen the window it's
                already in. */}
            {!floating && el?.openFloatWindow && (
              <button
                onClick={() => el.openFloatWindow('profile')}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors"
                title="Open in its own window"
              >
                <PictureInPicture2 size={13} />
              </button>
            )}
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              disabled={refreshing}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {account?.discord_avatar ? (
            <img src={account.discord_avatar} alt="" className="w-14 h-14 rounded-full object-cover shrink-0 ring-2 ring-[var(--border)]" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xl font-bold shrink-0">
              {(account?.display_name || account?.discord_username || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-text-primary text-xl font-bold truncate">
                {account?.display_name || account?.discord_username || 'My Profile'}
              </h1>
              {account?.is_administrator && (
                <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[10px] font-semibold uppercase tracking-wide shrink-0">Admin</span>
              )}
              {isManager && !account?.is_administrator && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[10px] font-semibold uppercase tracking-wide shrink-0">Manager</span>
              )}
              {account?.is_editor && !account.is_administrator && (
                <span className="px-1.5 py-0.5 rounded bg-surface-overlay text-text-secondary text-[10px] font-semibold uppercase tracking-wide shrink-0">Editor</span>
              )}
              {isContributor && !account?.is_administrator && (
                <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 text-[10px] font-semibold uppercase tracking-wide shrink-0">Contributor</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {myEntry && (
                <p className="text-text-muted text-xs flex items-center gap-1.5">
                  <Trophy size={11} className="text-accent" />
                  Rank #{myEntry.rank} · {myEntry.approved_count} approved
                </p>
              )}
              {!loadingProposals && (
                <p className="text-text-muted opacity-60 text-xs">{proposals.length} proposal{proposals.length !== 1 ? 's' : ''} submitted</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      {(canReviewReports || isContributor || canReviewStaff) && (
        <div className="flex items-center gap-1 px-6 pt-3 shrink-0 border-b border-[var(--border)]">
          {([
            { id: 'proposals' as const, label: 'Proposals', icon: <FileEdit size={13} /> },
            ...(isContributor ? [{ id: 'comp' as const, label: 'Comp files', icon: <FolderOpen size={13} /> }] : []),
            ...(canReviewReports ? [{ id: 'reports' as const, label: 'Reports', icon: <Flag size={13} /> }] : []),
            ...(canReviewStaff ? [{ id: 'admin' as const, label: isAdmin ? 'Admin' : 'Manager', icon: <ShieldCheck size={13} /> }] : []),
          ]).map(t => (
            <button key={t.id} onClick={() => setProfileTab(t.id)}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium transition-colors border-b-2 ${
                profileTab === t.id
                  ? 'text-accent border-accent'
                  : 'text-text-muted hover:text-text-primary border-transparent'
              }`}>
              <span className={profileTab === t.id ? 'text-accent' : ''}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {profileTab === 'admin' && canReviewStaff ? (
        <div className="flex-1 overflow-hidden p-4 md:p-5">
          <div className="h-full rounded-2xl border border-[var(--border)] bg-surface-raised/40 overflow-hidden flex flex-col">
            <AdminPage embedded />
          </div>
        </div>
      ) : profileTab === 'comp' && isContributor ? (
        <div className="flex-1 overflow-hidden p-4 md:p-5">
          <div className="h-full flex flex-col min-h-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-surface-raised/40">
            <div className="px-5 pt-4 pb-3 shrink-0 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 mb-3">
                <FolderOpen size={13} className="text-text-muted" />
                <h2 className="text-text-secondary text-xs font-semibold uppercase tracking-widest">Comp Files</h2>
                {!loadingComp && (
                  <span className="text-text-muted text-xs">
                    {compProposals.length} total · {compProposals.filter(p => p.status === 'approved').length} approved
                  </span>
                )}
                <button
                  onClick={() => go('contributor')}
                  className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent text-xs font-semibold transition-colors"
                  title="Propose a comp file change"
                >
                  <Plus size={12} /> New comp proposal
                </button>
              </div>
              <CompFilterBar filter={compFilter} setFilter={setCompFilter} />
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 p-3">
              <CompProposalList
                proposals={filterCompProposals(compProposals, compFilter)}
                loading={loadingComp}
                onSelect={() => go('contributor')}
                onWithdraw={handleWithdrawComp}
                withdrawingId={withdrawingCompId}
              />
            </div>
          </div>
        </div>
      ) : profileTab === 'reports' && canReviewReports ? (
        <div className="flex-1 overflow-hidden p-5">
          <div className="h-full rounded-2xl border border-[var(--border)] bg-surface-raised/40 overflow-hidden relative">
            {loadingReports && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg)]/60 backdrop-blur-[1px]">
                <Loader2 size={20} className="animate-spin text-text-muted" />
              </div>
            )}
            <ReportsTab
              reports={reports}
              status={reportStatus}
              setStatus={setReportStatus}
              onChanged={() => setRefreshKey(k => k + 1)}
            />
          </div>
        </div>
      ) : (
      // Stacked below md — side by side, the fixed-width leaderboard left
      // the proposals column 2px wide on a phone.
      <div className="flex-1 flex flex-col md:flex-row gap-4 md:gap-5 overflow-hidden p-4 md:p-5">

        {/* ── Left: My Proposals ── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-surface-raised/40">
          {/* Section header */}
          <div className="px-5 pt-4 pb-3 shrink-0 border-b border-[var(--border)]">
            <div className="flex items-center gap-2 mb-3">
              <FileEdit size={13} className="text-text-muted" />
              <h2 className="text-text-secondary text-xs font-semibold uppercase tracking-widest">My Proposals</h2>
              {!loadingProposals && (
                <span className="text-text-muted text-xs">{proposals.length} total</span>
              )}
              {(account?.is_editor || account?.is_administrator) && (
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={() => go('albums-admin')}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-raised hover:bg-surface-highest text-text-secondary hover:text-text-primary text-xs font-semibold transition-colors"
                    title="Edit albums (wrlddata.json)"
                  >
                    Edit albums
                  </button>
                  <button
                    onClick={() => setShowAddSong(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent text-xs font-semibold transition-colors"
                    title="Propose a new song"
                  >
                    <Plus size={12} /> New song
                  </button>
                </div>
              )}
            </div>

            {/* Search */}
            <div className="relative mb-3">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search proposals…"
                className="w-full bg-surface-overlay text-text-primary text-xs pl-7 pr-7 py-2 rounded-lg outline-none border border-transparent focus:ring-1 ring-accent focus:border-accent/40 placeholder:text-text-muted"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1">
              {TABS.map(({ key, label }) => {
                const count = tabCount(key)
                const active = filter === key
                return (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                    }`}
                  >
                    {label}
                    {count > 0 && (
                      <span className={`text-[10px] tabular-nums ${active ? 'text-accent/70' : 'text-text-muted'}`}>
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Proposals list */}
          <div className="flex-1 overflow-y-auto min-h-0 p-3">
            {loadingProposals ? (
              <div className="flex justify-center py-12">
                <Loader2 size={18} className="animate-spin text-text-muted" />
              </div>
            ) : filteredProposals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-muted opacity-50">
                <FileEdit size={28} />
                <p className="text-sm">
                  {search.trim()
                    ? `No proposals match "${search.trim()}"`
                    : filter === 'all' ? 'No proposals yet' : `No ${filter} proposals`}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredProposals.map((p) => {
                  const s = STATUS_STYLES[p.status]
                  return (
                    <div key={p.id} className="flex items-stretch gap-0 rounded-xl overflow-hidden bg-surface/60 border border-[var(--border)] hover:border-accent/30 transition-colors group">
                      {/* Status bar */}
                      <div className={`w-1 shrink-0 ${s.bar}`} />
                      <div className="flex items-center gap-3 px-3.5 py-3 flex-1 min-w-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-text-primary text-sm font-medium truncate">{p.title || `Song #${p.song}`}</p>
                          <p className="text-text-muted text-xs mt-0.5">{changeTypeLabel(p.change_type)} · {formatDate(p.created_at)}</p>
                        </div>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${s.badge}`}>
                          {s.label}
                        </span>
                        {p.status === 'pending' && (
                          /* Always visible on touch (no hover to reveal them) */
                          <div className="flex items-center gap-0.5 shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleEdit(p)}
                              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition-all"
                              title="Edit proposal"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => handleResubmit(p)}
                              disabled={resubmittingId === p.id || deletingId === p.id}
                              className="p-1.5 rounded-lg text-text-muted hover:text-accent hover:bg-accent/10 transition-all disabled:opacity-40"
                              title="Resubmit proposal (withdraws and re-submits fresh)"
                            >
                              {resubmittingId === p.id
                                ? <Loader2 size={12} className="animate-spin" />
                                : <RefreshCw size={12} />
                              }
                            </button>
                            <button
                              onClick={() => handleDelete(p.id)}
                              disabled={deletingId === p.id || resubmittingId === p.id}
                              className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40"
                              title="Withdraw proposal"
                            >
                              {deletingId === p.id
                                ? <Loader2 size={12} className="animate-spin" />
                                : <Trash2 size={12} />
                              }
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Leaderboard ── */}
        {/* Mobile: fixed-height strip under the proposals list (which keeps
            the remaining height); desktop: full-height side column. */}
        <div className="h-44 md:h-auto w-full md:w-80 flex flex-col min-h-0 overflow-hidden shrink-0 rounded-2xl border border-[var(--border)] bg-surface-raised/40">
          <div className="px-5 pt-4 pb-3 shrink-0 flex items-center gap-2 border-b border-[var(--border)]">
            <Trophy size={13} className="text-text-muted" />
            <h2 className="text-text-secondary text-xs font-semibold uppercase tracking-widest">Leaderboard</h2>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 p-3">
            {loadingLeaderboard ? (
              <div className="flex justify-center py-12">
                <Loader2 size={18} className="animate-spin text-text-muted" />
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-muted opacity-50">
                <Trophy size={28} />
                <p className="text-sm">No data</p>
              </div>
            ) : (
              <div className="space-y-1">
                {leaderboard.map((entry) => {
                  const isMe = entry.discord_username === account?.discord_username
                  const rankStyle = RANK_STYLES[entry.rank]
                  return (
                    <div
                      key={entry.user_id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                        isMe ? 'bg-accent/8 ring-1 ring-accent/20' : 'hover:bg-surface-overlay'
                      }`}
                    >
                      {/* Rank */}
                      <span className={`w-5 shrink-0 flex items-center justify-center`}>
                        <span className={`text-xs tabular-nums rounded-md px-1 py-0.5 ${
                          rankStyle ? `${rankStyle.num} ${rankStyle.badge}` : 'text-text-muted font-medium'
                        }`}>
                          {entry.rank}
                        </span>
                      </span>

                      {/* Avatar */}
                      {entry.discord_avatar ? (
                        <img src={entry.discord_avatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-surface-raised flex items-center justify-center text-xs text-text-muted shrink-0">
                          {(entry.discord_username || '?').charAt(0).toUpperCase()}
                        </div>
                      )}

                      {/* Name */}
                      <p className={`flex-1 min-w-0 text-sm truncate ${isMe ? 'text-accent font-semibold' : 'text-text-primary'}`}>
                        {entry.username || entry.discord_username}
                        {isMe && <span className="ml-1.5 text-xs opacity-60 font-normal">you</span>}
                      </p>

                      {/* Approved count */}
                      <span className={`text-xs tabular-nums shrink-0 font-semibold ${isMe ? 'text-accent' : rankStyle ? rankStyle.num : 'text-text-muted'}` }>
                        {entry.approved_count}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {showAddSong && (
        <AddSongModal
          onClose={() => setShowAddSong(false)}
          onSubmitted={() => setRefreshKey(k => k + 1)}
          channel={activeChannel}
        />
      )}
    </div>
  )
}
