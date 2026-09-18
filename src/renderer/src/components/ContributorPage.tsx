import { useEffect, useState, useRef } from 'react'
import {
  Loader2, Check, AlertCircle, LogIn, Clock, XCircle, Upload, Replace, Trash2,
  FolderOpen, ChevronLeft, RefreshCw, FileUp, ArrowRight, FolderSearch, ArrowUpFromLine, X, FolderPlus,
  Pencil, FolderInput, FolderX,
} from 'lucide-react'
import { useStorePick } from '../store/useStore'
import * as userApi from '../lib/userApi'
import { isPrimaryChannelSlug } from '../hooks/useChannelRoles'
import { CONTRIBUTOR_ENABLED } from '../lib/userApi'
import type { CompFileProposal, CompProposalChangeType, EditorApplication } from '../lib/userApi'
import type { ViewType } from '../types'
import { formatBytes, errorMessage } from '../lib/format'
import CompProposalList, { CompFilterBar, filterCompProposals, type CompFilterTab } from './CompProposalList'
import FilePickerModal from './FilePickerModal'
import { queueCompUploads, cancelCompUpload, COMP_UPLOADS_CHANGED } from '../lib/compUploads'

/** Which field the browse modal is currently filling. Upload and a move's
 *  destination name a path that doesn't exist yet, so those browse for a
 *  folder and the filename is appended; the rest point at a real file. */
type PickerTarget = 'file' | 'upload-folder' | 'dest-folder' | 'delete-files'

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? ''
const parentOf = (path: string): string => path.split('/').filter(Boolean).slice(0, -1).join('/')
const joinPath = (folder: string, name: string): string => (folder ? `${folder}/${name}` : name)

type SubmitState = 'idle' | 'submitting' | 'submitted' | 'error'

const CHANGE_OPTIONS: { value: CompProposalChangeType; label: string; icon: typeof Upload }[] = [
  { value: 'upload', label: 'Upload', icon: Upload },
  { value: 'replace', label: 'Replace', icon: Replace },
  { value: 'move', label: 'Move', icon: ArrowRight },
  { value: 'delete', label: 'Delete', icon: Trash2 },
  { value: 'create_folder', label: 'New folder', icon: FolderPlus },
  { value: 'rename_folder', label: 'Rename folder', icon: Pencil },
  { value: 'move_folder', label: 'Move folder', icon: FolderInput },
  { value: 'delete_folder', label: 'Delete folder', icon: FolderX },
]

// Folder-scoped types: the target is a whole folder, not a single file - no
// filename field, no file body. Mirrors create_folder's existing shape.
const FOLDER_SCOPED_TYPES = new Set<CompProposalChangeType>([
  'create_folder', 'rename_folder', 'move_folder', 'delete_folder',
])
// Types that show the destination folder/filename fields (a second path,
// alongside the source above it).
const DESTINATION_TYPES = new Set<CompProposalChangeType>(['move', 'rename_folder', 'move_folder'])

function ApplyPanel({ onSubmitted, rejection, channel }: { onSubmitted: () => void; rejection?: EditorApplication | null; channel?: string }): JSX.Element {
  const [motivation, setMotivation] = useState('')
  const [contact, setContact] = useState('')
  const [experience, setExperience] = useState('')
  const [areas, setAreas] = useState('')
  const [state, setState] = useState<SubmitState>('idle')
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (motivation.trim().length < 20 || state === 'submitting') return
    setState('submitting')
    setError(null)
    try {
      await userApi.submitApplication({
        motivation: motivation.trim(),
        contact,
        experience,
        areas,
        application_type: 'contributor',
        channel,
      })
      setState('submitted')
      setTimeout(onSubmitted, 1200)
    } catch (e) {
      setState('error')
      setError(errorMessage(e, 'Application failed'))
      setTimeout(() => setState('idle'), 4000)
    }
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-12">
      {/* A rejected application is shown, not enforced - the reviewer's notes
          usually say what to fix, so the form stays open underneath. */}
      {rejection && (
        <div className="mb-4 rounded-2xl border border-red-500/25 bg-red-500/5 p-4">
          <p className="text-sm font-semibold text-red-400 flex items-center gap-1.5"><XCircle size={14} /> Previous application not approved</p>
          {rejection.review_notes && <p className="text-sm text-text-muted italic mt-1.5 leading-relaxed">"{rejection.review_notes}"</p>}
        </div>
      )}
      <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Apply as contributor</h1>
          <p className="text-sm text-text-muted mt-1">Propose uploads, replacements, and deletions for comp files. Admins review before changes go live.</p>
        </div>
        <textarea value={motivation} onChange={e => setMotivation(e.target.value)} rows={4} placeholder="Why do you want to contribute comp files? (min 20 chars)"
          className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent resize-none" />
        <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Contact (optional)"
          className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent" />
        <textarea value={experience} onChange={e => setExperience(e.target.value)} rows={2} placeholder="Experience (optional)"
          className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent resize-none" />
        <input value={areas} onChange={e => setAreas(e.target.value)} placeholder="Areas you can help with (optional)"
          className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent" />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button onClick={submit} disabled={state === 'submitting' || motivation.trim().length < 20}
          className="w-full py-3 rounded-xl bg-accent text-white font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2">
          {state === 'submitting' ? <Loader2 size={16} className="animate-spin" /> : state === 'submitted' ? <Check size={16} /> : <LogIn size={16} />}
          {state === 'submitted' ? 'Application submitted' : 'Submit application'}
        </button>
        </div>
      </div>
    </div>
  )
}

export default function ContributorPage(): JSX.Element {
  const { account, setActiveView, previousView, pendingCompProposal, setPendingCompProposal, uploads, activeChannel, channels } = useStorePick('account', 'setActiveView', 'previousView', 'pendingCompProposal', 'setPendingCompProposal', 'uploads', 'activeChannel', 'channels')
  const activeUploads = uploads.filter((d) => d.type === 'upload' && d.state === 'downloading')
  const [application, setApplication] = useState<EditorApplication | null | undefined>(undefined)
  const [proposals, setProposals] = useState<CompFileProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<CompFilterTab>('all')
  // The API takes one `file_path`, but typing a whole path by hand is what
  // made this page painful - a folder comes from the browser, a filename from
  // the file you picked or from typing. They're joined on submit.
  const [folderPath, setFolderPath] = useState('')
  const [fileName, setFileName] = useState('')
  const [destFolder, setDestFolder] = useState('')
  const [destFileName, setDestFileName] = useState('')
  const [changeType, setChangeType] = useState<CompProposalChangeType>('upload')
  const [notes, setNotes] = useState('')
  // A batch shares one folder, change type and note; the API takes one file
  // per proposal, so N files become N proposals submitted in sequence.
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  // Delete works off existing paths rather than local files, so it keeps its
  // own list - gathered from the picker's multi-select.
  const [deletePaths, setDeletePaths] = useState<string[]>([])
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [withdrawingId, setWithdrawingId] = useState<number | null>(null)
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // React state lags a render behind, so `submitState` alone can't stop a
  // second call fired in the same tick or during the post-submit cooldown.
  // A ref flips synchronously the moment a submit is accepted and only clears
  // once the form is ready for another, guaranteeing one queue per click.
  const submitLatch = useRef(false)

  const isContributor = userApi.isChannelContributor(account, activeChannel, isPrimaryChannelSlug(channels, activeChannel))

  // Where "back" goes. Prefer the profile the user actually arrived from -
  // an editor-contributor reaches this page from the editor profile, and
  // sending them to the contributor profile strands them without the
  // Proposals/Reports tabs. Fall back to whichever profile their role owns
  // (same rule as Sidebar/BottomNav) when they deep-linked straight here.
  const backView: ViewType = previousView === 'editor-profile' || previousView === 'contributor-profile'
    ? previousView
    : account?.is_editor || account?.is_administrator ? 'editor-profile' : 'contributor-profile'

  const reload = (): void => {
    if (!isContributor) return
    setLoading(true)
    userApi.getMyCompProposals(activeChannel).then(setProposals).catch(() => {}).finally(() => setLoading(false))
  }

  // A background upload landing means there's a new proposal to show. The
  // queue fires this on window rather than reaching into this page, so it
  // stays a plain module with no knowledge of who's listening.
  useEffect(() => {
    if (!isContributor) return
    const onChanged = (): void => reload()
    window.addEventListener(COMP_UPLOADS_CHANGED, onChanged)
    return () => window.removeEventListener(COMP_UPLOADS_CHANGED, onChanged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContributor])

  useEffect(() => {
    if (!account) {
      setApplication(undefined)
      setLoading(false)
      return
    }
    userApi.getMyApplication('contributor', activeChannel).then(r => setApplication(r.application)).catch(() => setApplication(null))
    if (isContributor) reload()
    else setLoading(false)
  }, [account, isContributor, activeChannel])

  // Arrived from the Files context menu with a file already in mind. Consumed
  // once and cleared, so coming back to this page later starts blank instead
  // of silently re-arming the last proposal.
  useEffect(() => {
    if (!pendingCompProposal || !isContributor) return
    const { paths, changeType: type } = pendingCompProposal
    setChangeType(type)
    if (type === 'delete') {
      if (paths.length === 0) { setPendingCompProposal(null); return }
      setDeletePaths((prev) => [...prev, ...paths.filter((x) => !prev.includes(x))])
    } else if (type === 'upload') {
      // The Files context menu hands over the folder being browsed, not a
      // file - there's nothing to pick apart into folder + name yet.
      setFolderPath(paths[0] ?? '')
    } else {
      if (paths.length === 0) { setPendingCompProposal(null); return }
      // Replace is single by definition - a selection can only seed the first.
      setFolderPath(parentOf(paths[0]))
      setFileName(basename(paths[0]))
    }
    setSubmitError(null)
    setPendingCompProposal(null)
  }, [pendingCompProposal, isContributor, setPendingCompProposal])

  const filtered = filterCompProposals(proposals, filter)
  const cleanFolder = folderPath.trim().replace(/\/+$/, '')
  const isCreateFolder = changeType === 'create_folder'
  const isFolderOp = FOLDER_SCOPED_TYPES.has(changeType)
  const filePath = isFolderOp ? cleanFolder : joinPath(cleanFolder, fileName.trim())
  const carriesFile = changeType !== 'delete' && changeType !== 'move' && !isFolderOp
  const needsDestination = DESTINATION_TYPES.has(changeType)
  // Upload is the only type that batches local files: a replace targets one
  // existing file with one new body, and a move renames one path to another.
  const isUpload = changeType === 'upload'
  const isDelete = changeType === 'delete'
  // Past one file each keeps its own name, so the editable filename field is
  // replaced by the batch list. One file still allows renaming on upload.
  const isBatch = (isUpload && selectedFiles.length > 1) || (isDelete && deletePaths.length > 1)
  const batchPaths = selectedFiles.map((f) => joinPath(cleanFolder, f.name))
  // Delete drives everything off its own list, so the folder/filename pair is
  // hidden for it entirely.
  const usesPathFields = !isDelete
  const destinationPath = joinPath(destFolder.trim().replace(/\/+$/, ''), destFileName.trim())

  // Switching type drops any files picked under the previous one. The file
  // section is hidden for move/delete/create_folder, so a leftover selection
  // would be invisible here and still ride along on the request below.
  const selectChangeType = (type: CompProposalChangeType): void => {
    setChangeType(type)
    setSelectedFiles([])
    setSubmitError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const buildForm = (path: string, file: File | null): FormData => {
    const form = new FormData()
    form.append('file_path', path)
    if (needsDestination) form.append('destination_path', destinationPath)
    form.append('change_type', changeType)
    form.append('contributor_notes', notes)
    if (file) form.append('file', file)
    if (activeChannel) form.append('channel', activeChannel)
    return form
  }

  const submitProposal = async (): Promise<void> => {
    if (submitLatch.current || submitState === 'submitting') return
    if (isDelete && deletePaths.length === 0) {
      setSubmitError('Pick at least one file to delete.')
      return
    }
    if (isFolderOp && !cleanFolder) {
      setSubmitError('Enter a folder path.')
      return
    }
    if (usesPathFields && !isFolderOp && !isBatch && !fileName.trim()) {
      setSubmitError('Enter a filename.')
      return
    }
    if (needsDestination && !destFileName.trim()) {
      setSubmitError(changeType === 'rename_folder' || changeType === 'move_folder'
        ? 'Enter a destination folder name.'
        : 'Enter a destination filename for move proposals.')
      return
    }
    if (carriesFile && selectedFiles.length === 0) {
      setSubmitError('Select a file for upload or replace proposals.')
      return
    }
    submitLatch.current = true
    setSubmitState('submitting')
    setSubmitError(null)

    // Sequential, not Promise.all: these carry file bodies, and a batch of
    // twenty firing at once is a good way to get rate-limited halfway through
    // with no idea which ones landed.
    const jobs: { path: string; file: File | null }[] = isDelete
      ? deletePaths.map((path) => ({ path, file: null as File | null }))
      : isUpload && selectedFiles.length > 1
        ? selectedFiles.map((file, i) => ({ path: batchPaths[i], file: file as File | null }))
        // `carriesFile` guard as well as the reset above: only upload/replace
        // may send a body, and a move or new-folder proposal that quietly
        // carried one would be accepted looking like something it isn't.
        : [{ path: filePath, file: carriesFile ? selectedFiles[0] ?? null : null }]
    // Anything carrying a file body goes to the background queue: a comp zip is
    // routinely hundreds of megabytes, and awaiting it here meant the user had
    // to sit on this page (and keep the window open) until it finished. The
    // queue reports progress into the Downloads panel instead - see
    // lib/compUploads. Delete and move proposals carry no body, so they stay
    // inline below where their result can be reported immediately.
    if (carriesFile) {
      try {
        queueCompUploads(jobs.map((job) => ({
          label: basename(job.path),
          form: buildForm(job.path, job.file),
          bytes: job.file?.size,
        })))
      } catch (e) {
        // Without this the latch never clears and the submit button stays dead
        // for the life of the page.
        setSubmitState('error')
        setSubmitError(errorMessage(e, 'Could not queue the upload'))
        setTimeout(() => { setSubmitState('idle'); submitLatch.current = false }, 4000)
        return
      }
      setSubmitState('submitted')
      setSelectedFiles([])
      setNotes('')
      setFileName('')
      setDestFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setTimeout(() => { setSubmitState('idle'); submitLatch.current = false }, 2000)
      return
    }

    const failed: string[] = []
    setBatchProgress(jobs.length > 1 ? { done: 0, total: jobs.length } : null)
    for (const [i, job] of jobs.entries()) {
      try {
        await userApi.createCompProposal(buildForm(job.path, job.file))
      } catch {
        failed.push(basename(job.path))
      }
      if (jobs.length > 1) setBatchProgress({ done: i + 1, total: jobs.length })
    }
    setBatchProgress(null)

    // A partial batch is the interesting case: the ones that landed are real
    // proposals, so don't roll the form back as if nothing happened - keep
    // the failures named and let them retry just those.
    if (failed.length === jobs.length) {
      setSubmitState('error')
      setSubmitError(jobs.length > 1 ? 'None of the files could be submitted.' : 'Submission failed')
      setTimeout(() => { setSubmitState('idle'); submitLatch.current = false }, 4000)
      reload()
      return
    }
    if (failed.length > 0) {
      setSubmitState('error')
      setSubmitError(`${jobs.length - failed.length} of ${jobs.length} submitted. Failed: ${failed.join(', ')}`)
      setTimeout(() => { setSubmitState('idle'); submitLatch.current = false }, 6000)
      reload()
      return
    }

    try {
      setSubmitState('submitted')
      setSelectedFiles([])
      setDeletePaths([])
      setNotes('')
      setFileName('')
      setDestFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      reload()
      setTimeout(() => { setSubmitState('idle'); submitLatch.current = false }, 2000)
    } catch (e) {
      setSubmitState('error')
      setSubmitError(errorMessage(e, 'Submission failed'))
      setTimeout(() => { setSubmitState('idle'); submitLatch.current = false }, 4000)
    }
  }

  const withdraw = async (id: number): Promise<void> => {
    setWithdrawingId(id)
    setSubmitError(null)
    try {
      await userApi.withdrawCompProposal(id)
      setProposals(prev => prev.filter(p => p.id !== id))
    } catch (e) {
      setSubmitError(errorMessage(e, 'Could not withdraw that proposal'))
    } finally {
      setWithdrawingId(null)
    }
  }

  if (!CONTRIBUTOR_ENABLED) {
    return (
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center h-full gap-3 text-text-muted px-6 text-center">
        <FolderOpen size={32} className="opacity-40" />
        <p className="text-sm font-medium text-text-primary">Comp contributions aren't open yet</p>
        <p className="text-xs opacity-70">This page turns on once the contribution endpoints ship.</p>
      </div>
    )
  }

  if (!account) {
    return (
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center h-full gap-4 text-text-muted">
        <LogIn size={32} className="opacity-40" />
        <p className="text-sm">Sign in with Discord to contribute comp files.</p>
      </div>
    )
  }

  if (!isContributor) {
    if (application === undefined) return <div className="flex-1 min-w-0 flex items-center justify-center h-full"><Loader2 className="animate-spin text-text-muted" /></div>
    if (application?.status === 'pending') {
      return (
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center h-full gap-3 text-text-muted px-6 text-center">
          <Clock size={32} className="opacity-40" />
          <p className="text-sm font-medium text-text-primary">Contributor application pending</p>
          <p className="text-xs opacity-70">An admin will review your application soon.</p>
        </div>
      )
    }
    return (
      <ApplyPanel
        rejection={application?.status === 'rejected' ? application : null}
        onSubmitted={() => userApi.getMyApplication('contributor', activeChannel).then(r => setApplication(r.application))}
        channel={activeChannel}
      />
    )
  }

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
        <button onClick={() => setActiveView(backView)} title="Back to your profile"
          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-text-primary">Comp file proposals</h1>
          <p className="text-xs text-text-muted">Upload, replace, or delete files in comp/</p>
        </div>
        <button onClick={() => setActiveView('api-files')} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-accent bg-accent/10 hover:bg-accent/15 transition-colors flex items-center gap-1.5">
          <FolderOpen size={14} /> Browse files
        </button>
        <button onClick={reload} className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">
          <section className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 p-5 space-y-4">
            <h2 className="text-sm font-bold text-text-primary">New proposal</h2>
            {usesPathFields && (
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted block">
                {changeType === 'move' ? 'Source (relative to comp/)'
                  : isCreateFolder ? 'New folder (relative to comp/)'
                  : changeType === 'delete_folder' ? 'Folder to delete (relative to comp/)'
                  : changeType === 'rename_folder' ? 'Folder to rename (relative to comp/)'
                  : changeType === 'move_folder' ? 'Folder to move (relative to comp/)'
                  : 'Target (relative to comp/)'}
              </label>
              <div className="flex gap-2">
                <input value={folderPath} onChange={e => setFolderPath(e.target.value)} placeholder="Folder - e.g. Compilation/Unreleased"
                  className="flex-1 min-w-0 rounded-xl border border-[var(--border)] bg-surface-overlay px-4 py-2.5 text-sm font-mono text-text-primary focus:outline-none focus:border-accent" />
                <button
                  type="button"
                  onClick={() => setPicker(changeType === 'upload' || isFolderOp ? 'upload-folder' : 'file')}
                  title={changeType === 'upload' ? 'Pick the folder to upload into' : isCreateFolder ? 'Pick where to create the folder' : isFolderOp ? 'Pick the folder this applies to' : 'Pick the file this applies to'}
                  className="shrink-0 px-3 rounded-xl border border-[var(--border)] bg-surface-overlay text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors flex items-center gap-1.5 text-xs font-semibold"
                >
                  <FolderSearch size={14} /> Browse
                </button>
              </div>
              {!isBatch && !isFolderOp && (
                <input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="Filename - e.g. My Song.mp3"
                  className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-4 py-2.5 text-sm font-mono text-text-primary focus:outline-none focus:border-accent" />
              )}
              {/* The joined value is what actually gets submitted, so show it
                  rather than making the contributor assemble it mentally. */}
              {!isBatch && (
                <p className="text-[11px] font-mono text-text-muted truncate" title={filePath || undefined}>
                  {filePath ? `comp/${filePath}` : 'comp/…'}
                </p>
              )}
            </div>
            )}

            {isDelete && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Files to delete
                  </label>
                  <button type="button" onClick={() => setPicker('delete-files')}
                    className="shrink-0 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-surface-overlay text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors flex items-center gap-1.5 text-xs font-semibold">
                    <FolderSearch size={14} /> Pick files
                  </button>
                </div>
                {deletePaths.length === 0 ? (
                  <p className="text-xs text-text-muted py-2">No files picked yet.</p>
                ) : (
                  <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                    {deletePaths.map((path) => (
                      <div key={path} className="flex items-center gap-2 px-3 py-2">
                        <Trash2 size={13} className="text-text-muted shrink-0" />
                        <span className="text-xs font-mono text-text-primary truncate flex-1 min-w-0" title={`comp/${path}`}>{path}</span>
                        <button type="button" onClick={() => setDeletePaths(prev => prev.filter(x => x !== path))}
                          title="Remove from this batch"
                          className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0">
                          <XCircle size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {deletePaths.length > 1 && (
                  <p className="text-[11px] text-text-muted leading-relaxed">
                    {deletePaths.length} separate deletion proposals, reviewed individually.
                  </p>
                )}
              </div>
            )}
            {needsDestination && (
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted block">
                  {changeType === 'rename_folder' ? 'New location - same parent folder (relative to comp/)' : 'Destination (relative to comp/)'}
                </label>
                <div className="flex gap-2">
                  <input value={destFolder} onChange={e => setDestFolder(e.target.value)} placeholder="Folder - e.g. Compilation/Released"
                    className="flex-1 min-w-0 rounded-xl border border-[var(--border)] bg-surface-overlay px-4 py-2.5 text-sm font-mono text-text-primary focus:outline-none focus:border-accent" />
                  <button
                    type="button"
                    onClick={() => setPicker('dest-folder')}
                    title="Pick the folder to move it into"
                    className="shrink-0 px-3 rounded-xl border border-[var(--border)] bg-surface-overlay text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors flex items-center gap-1.5 text-xs font-semibold"
                  >
                    <FolderSearch size={14} /> Browse
                  </button>
                </div>
                <input value={destFileName} onChange={e => setDestFileName(e.target.value)}
                  placeholder={changeType === 'rename_folder' || changeType === 'move_folder' ? 'New folder name' : 'Filename - leave as-is to keep the name'}
                  className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-4 py-2.5 text-sm font-mono text-text-primary focus:outline-none focus:border-accent" />
                <p className="text-[11px] font-mono text-text-muted truncate" title={destinationPath || undefined}>
                  {destinationPath ? `comp/${destinationPath}` : 'comp/…'}
                </p>
                {changeType === 'rename_folder' && (
                  <p className="text-[11px] text-text-muted leading-relaxed">Rename keeps the folder in the same parent - only the folder name changes.</p>
                )}
                {changeType === 'move_folder' && (
                  <p className="text-[11px] text-text-muted leading-relaxed">Move requires a different parent folder.</p>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {CHANGE_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => selectChangeType(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${changeType === opt.value ? 'bg-accent text-white' : 'bg-surface-overlay text-text-muted hover:text-text-primary'}`}>
                  <opt.icon size={13} /> {opt.label}
                </button>
              ))}
            </div>
            {carriesFile && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {isUpload ? 'Files' : 'File'}
                  {isUpload && <span className="normal-case tracking-normal font-normal opacity-70"> - pick several to propose them all into the folder above</span>}
                </label>
                <div className="mt-1.5">
                  <input ref={fileInputRef} type="file" multiple={isUpload}
                    onChange={e => {
                      // A replace swaps one file's contents, so it never
                      // takes more than the first even if the OS dialog is
                      // coaxed into handing over several.
                      const files = Array.from(e.target.files ?? []).slice(0, isUpload ? Infinity : 1)
                      setSelectedFiles(files)
                      // Don't make them retype the name of the file they just
                      // picked off disk - but never clobber one they typed.
                      // Only meaningful for a single file; a batch keeps each
                      // file's own name.
                      if (files.length === 1 && !fileName.trim()) setFileName(files[0].name)
                    }}
                    className="text-sm text-text-muted file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-accent/15 file:text-accent file:text-xs file:font-semibold" />
                </div>
                {selectedFiles.length > 0 && (
                  <div className="mt-2.5 rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                    {selectedFiles.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                        <FileUp size={13} className="text-text-muted shrink-0" />
                        <span className="text-xs font-mono text-text-primary truncate flex-1 min-w-0"
                          title={isBatch ? `comp/${batchPaths[i]}` : undefined}>
                          {isBatch ? batchPaths[i] : f.name}
                        </span>
                        <span className="text-[10px] text-text-muted shrink-0 tabular-nums">{formatBytes(f.size)}</span>
                        <button type="button" onClick={() => setSelectedFiles(prev => prev.filter((_, j) => j !== i))}
                          title="Remove from this batch"
                          className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0">
                          <XCircle size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {isBatch && (
                  <p className="text-[11px] text-text-muted mt-2 leading-relaxed">
                    {selectedFiles.length} separate proposals, one per file, each keeping its own
                    name under <span className="font-mono">comp/{cleanFolder || '…'}</span>. Reviewers
                    approve or reject them individually.
                  </p>
                )}
              </div>
            )}
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes for reviewers (optional)"
              className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent resize-none" />
            {submitError && <p className="text-sm text-red-400 flex items-center gap-1.5"><AlertCircle size={14} />{submitError}</p>}

            {/* Mirror of the Downloads panel's upload rows. The panel itself is
                desktop-only (and easy to miss), so the page it was started from
                shows the same progress - leaving the page no longer stops it. */}
            {activeUploads.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-surface-overlay/60 divide-y divide-[var(--border)]/40">
                {activeUploads.map((u) => (
                  <div key={u.id} className="px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <ArrowUpFromLine size={12} className="text-accent shrink-0 animate-pulse" />
                      <span className="flex-1 min-w-0 truncate text-xs text-text-primary">{u.filename}</span>
                      <span className="text-[11px] text-text-muted tabular-nums shrink-0">{u.percent}%</span>
                      <button onClick={() => cancelCompUpload(u.id)} title="Cancel upload"
                        className="p-0.5 rounded text-text-muted hover:text-red-400 transition-colors shrink-0">
                        <X size={12} />
                      </button>
                    </div>
                    <div className="mt-1.5 h-1 bg-[var(--surface)] rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all duration-200" style={{ width: `${u.percent}%` }} />
                    </div>
                  </div>
                ))}
                <p className="px-3.5 py-2 text-[11px] text-text-muted">
                  Uploading in the background - you can leave this page.
                </p>
              </div>
            )}
            <button onClick={submitProposal}
              disabled={submitState === 'submitting'
                || (isFolderOp ? !cleanFolder : isDelete ? deletePaths.length === 0 : !isBatch && !fileName.trim())
                || (carriesFile && selectedFiles.length === 0)
                || (needsDestination && !destFileName.trim())}
              className="px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-2">
              {submitState === 'submitting' ? <Loader2 size={15} className="animate-spin" /> : submitState === 'submitted' ? <Check size={15} /> : <FileUp size={15} />}
              {submitState === 'submitted' ? (carriesFile ? 'Queued' : 'Submitted')
                : batchProgress ? `Submitting ${batchProgress.done}/${batchProgress.total}…`
                : isBatch ? `Submit ${isDelete ? deletePaths.length : selectedFiles.length} proposals`
                : 'Submit proposal'}
            </button>
          </section>

          <section>
            <div className="mb-3">
              <CompFilterBar filter={filter} setFilter={setFilter} />
            </div>
            <CompProposalList
              proposals={filtered}
              loading={loading}
              onWithdraw={withdraw}
              withdrawingId={withdrawingId}
              empty="No proposals yet."
            />
          </section>
        </div>
      </div>

      {picker && (
        <FilePickerModal
          // 'any' rather than 'audio': a comp proposal can target artwork or a
          // tracklist just as easily as a song.
          kind="any"
          allowFolderSelect={picker === 'upload-folder' || picker === 'dest-folder'}
          emptyFolderProposable={isCreateFolder}
          channel={activeChannel}
          multiple={picker === 'delete-files'}
          onSelectMany={(paths) => {
            setDeletePaths(prev => [...prev, ...paths.filter(x => !prev.includes(x))])
            setSubmitError(null)
            setPicker(null)
          }}
          title={
            picker === 'file' ? 'Pick the file this proposal applies to'
              : picker === 'delete-files' ? 'Pick the files to delete'
              : picker === 'upload-folder' ? (
                  isCreateFolder ? 'Pick where to create the folder'
                    : isFolderOp ? 'Pick the folder this applies to'
                    : 'Pick the folder to upload into'
                )
              : 'Pick the folder to move it into'
          }
          onClose={() => setPicker(null)}
          onSelect={(path) => {
            if (picker === 'file') {
              // A picked file fills both halves.
              setFolderPath(parentOf(path))
              setFileName(basename(path))
            } else if (picker === 'upload-folder') {
              setFolderPath(path)
              if (!fileName.trim() && selectedFiles.length === 1) setFileName(selectedFiles[0].name)
            } else {
              setDestFolder(path)
              // A move keeps its filename unless the user renames it - that's
              // the whole difference between a move and a rename.
              if (!destFileName.trim()) setDestFileName(fileName.trim())
            }
            setSubmitError(null)
            setPicker(null)
          }}
        />
      )}
    </div>
  )
}
