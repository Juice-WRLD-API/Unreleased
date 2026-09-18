// Shared logic for AdminPage's RevisePanel (desktop + mobile) - field
// editing, add/remove, and submit. JSX/chrome stays in each view.
import { useState } from 'react'
import * as userApi from '../lib/userApi'
import type { SongEditProposal } from '../lib/userApi'
import { ALL_SONG_FIELDS } from '../lib/proposalRevise'
import { errorMessage } from '../lib/format'

export function useReviseProposalForm(proposal: SongEditProposal, channel: string | undefined, onDone: () => void): {
  fields: Record<string, string>
  reviewNote: string
  setReviewNote: (v: string) => void
  addKey: string
  setAddKey: (v: string) => void
  saving: boolean
  err: string | null
  snap: Record<string, unknown>
  available: string[]
  addField: (key: string) => void
  removeField: (key: string) => void
  setFieldValue: (key: string, value: string) => void
  submit: () => Promise<void>
} {
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    Object.entries(proposal.proposed_data || {}).forEach(([k, v]) => {
      init[k] = Array.isArray(v) ? v.join('\n') : (typeof v === 'string' ? v : JSON.stringify(v))
    })
    return init
  })
  const [reviewNote, setReviewNote] = useState('')
  const [addKey, setAddKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const snap = proposal.original_snapshot || {}
  const available = ALL_SONG_FIELDS.filter(k => !(k in fields))

  const addField = (key: string): void => {
    if (!key) return
    const snapVal = snap[key]
    const init = Array.isArray(snapVal) ? (snapVal as string[]).join('\n')
      : typeof snapVal === 'string' ? snapVal : ''
    setFields(f => ({ ...f, [key]: init }))
    setAddKey('')
  }

  const removeField = (key: string): void => {
    setFields(f => { const n = { ...f }; delete n[key]; return n })
  }

  const setFieldValue = (key: string, value: string): void => {
    setFields(f => ({ ...f, [key]: value }))
  }

  const submit = async (): Promise<void> => {
    setSaving(true); setErr(null)
    try {
      // Convert back - track_titles is array
      const revised_data: Record<string, unknown> = {}
      Object.entries(fields).forEach(([k, v]) => {
        if (k === 'track_titles') {
          revised_data[k] = v.split('\n').map(s => s.trim()).filter(Boolean)
        } else {
          revised_data[k] = v
        }
      })
      await userApi.adminReviewProposal(proposal.id, {
        action: 'revise',
        review_notes: reviewNote,
        revised_data,
        channel,
      })
      onDone()
    } catch (e) {
      setErr(errorMessage(e, 'Failed to revise'))
    } finally {
      setSaving(false)
    }
  }

  return { fields, reviewNote, setReviewNote, addKey, setAddKey, saving, err, snap, available, addField, removeField, setFieldValue, submit }
}
