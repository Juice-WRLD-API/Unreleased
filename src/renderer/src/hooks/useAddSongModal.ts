// Shared state/logic for AddSongModal (propose a new song). Desktop and
// mobile wrap this in their own JSX - keep behavior here, layout in them.
import { useEffect, useState } from 'react'
import * as userApi from '../lib/userApi'
import { errorMessage } from '../lib/format'
import { apiFetch, JWApiEra, JWApiSong } from '../lib/juicewrldApi'
import { useProposalForm, buildProposedData, type ProposalFormState } from '../lib/proposalForm'
import { loadEraFullNames, listEras } from '../lib/eras'

export function useAddSongModal(onSubmitted: () => void, onClose: () => void, channel?: string): {
  f: ProposalFormState
  updateField: ReturnType<typeof useProposalForm>['updateField']
  showMore: boolean
  setShowMore: React.Dispatch<React.SetStateAction<boolean>>
  copiedFrom: string | null
  setCopiedFrom: (v: string | null) => void
  syncedTable: boolean
  setSyncedTable: React.Dispatch<React.SetStateAction<boolean>>
  pickingFile: boolean
  setPickingFile: (v: boolean) => void
  eras: JWApiEra[]
  submitState: 'idle' | 'submitting' | 'submitted' | 'error'
  submitError: string | null
  edNotes: string
  setEdNotes: (v: string) => void
  copyFrom: (s: JWApiSong) => void
  handleSubmit: () => Promise<void>
} {
  // Every field lives in one reducer (lib/proposalForm.ts) instead of ~26
  // separate useState calls. Auxiliary UI-only state (showMore, copiedFrom
  // banner, syncedTable toggle, file picker, eras, submit state) stays as
  // plain useState here - it never becomes part of the proposal payload.
  const { formState: f, updateField, copyFrom: copyFromForm } = useProposalForm()
  const [showMore, setShowMore] = useState(false)
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null)
  const [syncedTable, setSyncedTable] = useState(() => localStorage.getItem('editor:syncedFormat') !== 'raw')
  const [pickingFile, setPickingFile] = useState(false)
  const [eras, setEras] = useState<JWApiEra[]>([])
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [edNotes, setEdNotes] = useState('')

  useEffect(() => {
    loadEraFullNames().catch(() => undefined).finally(() => setEras(listEras()))
  }, [])

  // Everything the source song knows, minus the three fields that describe its
  // specific audio file - a new version has its own file, length and bitrate,
  // and silently inheriting those would submit wrong data for the common case.
  // (copyFromForm's field set/order/fallbacks live in proposalForm.ts's
  // reducer - see its 'copyFrom' case.)
  const copyFrom = (s: JWApiSong): void => {
    copyFromForm(s)
    setCopiedFrom(s.name || null)
    setShowMore(true)
  }

  // buildProposedData reproduces the exact pre-rewrite "only include
  // non-empty fields" payload mapping byte-for-byte (verified field-by-field
  // against proposalForm.ts's implementation) - do not hand-roll this here.
  const handleSubmit = async (): Promise<void> => {
    if (!f.name.trim() || submitState === 'submitting') return
    setSubmitState('submitting'); setSubmitError(null)
    try {
      await userApi.createProposal({
        song: null,
        change_type: 'create',
        title: f.name.trim(),
        proposed_data: buildProposedData(f),
        editor_notes: edNotes,
        channel,
      })
      setSubmitState('submitted')
      setTimeout(() => { onSubmitted(); onClose() }, 1200)
    } catch (e) {
      setSubmitState('error')
      setSubmitError(errorMessage(e, 'Submission failed'))
    }
  }

  return {
    f, updateField, showMore, setShowMore, copiedFrom, setCopiedFrom, syncedTable, setSyncedTable,
    pickingFile, setPickingFile, eras, submitState, submitError, edNotes, setEdNotes, copyFrom, handleSubmit,
  }
}
