// Reducer-based replacement for AddSongModal's ~26 separate useState fields
// (desktop and mobile AddSongModal are near-identical, confirmed by diffing
// both files in full). Auxiliary UI-only state (showMore, copiedFrom banner
// text, syncedTable toggle, file-picker visibility, eras list, submit
// state/error) intentionally stays as plain useState in AddSongModal itself
// - this module only owns the fields that become the proposal payload.
//
// buildProposedData reproduces the exact existing "only include non-empty
// fields" logic, field-name mapping, and fallbacks - this is the single most
// contract-sensitive extraction in the rewrite: the payload sent to
// createProposal must be byte-for-byte identical before and after.
import { useCallback, useReducer } from 'react'
import type { JWApiSong } from './juicewrldApi'
import { cleanDate } from '../components/EditorPage.desktop'

export interface ProposalFormState {
  name: string
  artists: string
  cat: string
  album: string
  eraId: string
  imageUrl: string
  altNames: string
  lyrics: string
  syncedLyrics: string
  prod: string
  engineer: string
  location: string
  filePath: string
  previewDate: string
  leakType: string
  recDate: string
  relDate: string
  instrumentals: string
  instrumentalNames: string
  sessionTitles: string
  sessionTracking: string
  addInfo: string
  notes: string
  dateLeaked: string
  fileNames: string
  songLength: string
  bitrate: string
  edNotes: string
}

export const EMPTY_PROPOSAL_FORM: ProposalFormState = {
  name: '', artists: '', cat: '', album: '', eraId: '', imageUrl: '', altNames: '',
  lyrics: '', syncedLyrics: '', prod: '', engineer: '', location: '', filePath: '',
  previewDate: '', leakType: '', recDate: '', relDate: '', instrumentals: '',
  instrumentalNames: '', sessionTitles: '', sessionTracking: '', addInfo: '', notes: '', dateLeaked: '', fileNames: '',
  songLength: '', bitrate: '', edNotes: '',
}

type Action =
  | { type: 'update'; key: keyof ProposalFormState; value: string }
  | { type: 'copyFrom'; song: JWApiSong }
  | { type: 'reset' }

function reducer(state: ProposalFormState, action: Action): ProposalFormState {
  switch (action.type) {
    case 'update':
      return { ...state, [action.key]: action.value }
    case 'copyFrom': {
      // Everything the source song knows, minus the three fields that
      // describe its specific audio file - a new version has its own file,
      // length and bitrate, and silently inheriting those would submit
      // wrong data for the common case. (Matches AddSongModal's original
      // copyFrom exactly - same fields, same order, same fallbacks.)
      const s = action.song
      return {
        ...state,
        name: s.name || '',
        artists: s.credited_artists || '',
        album: s.album ?? s.era?.name ?? '',
        cat: s.category || '',
        eraId: s.era?.id ? String(s.era.id) : '',
        imageUrl: s.image_url || '',
        altNames: (s.track_titles || []).join('\n'),
        lyrics: s.lyrics || '',
        syncedLyrics: s.synced_lyrics || '',
        prod: s.producers || '',
        engineer: s.engineers || '',
        location: s.recording_locations || '',
        recDate: s.record_dates || '',
        relDate: cleanDate(s.release_date),
        previewDate: cleanDate(s.preview_date),
        leakType: s.leak_type || '',
        dateLeaked: cleanDate(s.date_leaked),
        instrumentals: s.instrumentals || '',
        instrumentalNames: s.instrumental_names || '',
        sessionTitles: s.session_titles || '',
        sessionTracking: s.session_tracking || '',
        fileNames: s.file_names || '',
        addInfo: s.additional_information || '',
        notes: s.notes || '',
      }
    }
    case 'reset':
      return EMPTY_PROPOSAL_FORM
    default:
      return state
  }
}

export function useProposalForm(): {
  formState: ProposalFormState
  updateField: (key: keyof ProposalFormState, value: string) => void
  copyFrom: (song: JWApiSong) => void
  reset: () => void
} {
  const [formState, dispatch] = useReducer(reducer, EMPTY_PROPOSAL_FORM)

  const updateField = useCallback((key: keyof ProposalFormState, value: string) => {
    dispatch({ type: 'update', key, value })
  }, [])

  const copyFrom = useCallback((song: JWApiSong) => {
    dispatch({ type: 'copyFrom', song })
  }, [])

  const reset = useCallback(() => dispatch({ type: 'reset' }), [])

  return { formState, updateField, copyFrom, reset }
}

/** Reproduces AddSongModal's "only include non-empty fields" proposed_data
 *  mapping byte-for-byte - do not reorder, rename, or add fallbacks here
 *  without a before/after payload diff against createProposal. */
export function buildProposedData(f: ProposalFormState): Record<string, unknown> {
  const proposed: Record<string, unknown> = {}
  if (f.name)    proposed.name                = f.name
  if (f.artists) proposed.credited_artists    = f.artists
  if (f.album)   proposed.album              = f.album
  if (f.cat)     proposed.category           = f.cat
  if (f.eraId)   proposed.era_id             = Number(f.eraId)
  if (f.imageUrl) proposed.image_url = f.imageUrl
  if (f.altNames) proposed.track_titles = f.altNames.split('\n').map(s => s.trim()).filter(Boolean)
  if (f.lyrics) proposed.lyrics = f.lyrics
  if (f.syncedLyrics) proposed.synced_lyrics = f.syncedLyrics
  if (f.prod)     proposed.producers           = f.prod
  if (f.engineer) proposed.engineers           = f.engineer
  if (f.location) proposed.recording_locations = f.location
  if (f.filePath) proposed.path                = f.filePath
  if (f.leakType) proposed.leak_type     = f.leakType
  if (f.recDate)  proposed.record_dates  = f.recDate
  if (f.relDate) proposed.release_date        = f.relDate
  if (f.previewDate) proposed.preview_date    = f.previewDate
  if (f.instrumentals)     proposed.instrumentals      = f.instrumentals
  if (f.instrumentalNames) proposed.instrumental_names = f.instrumentalNames
  if (f.cat === 'recording_session' && f.sessionTitles)   proposed.session_titles   = f.sessionTitles
  if (f.cat === 'recording_session' && f.sessionTracking) proposed.session_tracking = f.sessionTracking
  // "Additional info" maps to additional_information - distinct from
  // `notes`, which previously had this textarea's value submitted under the
  // wrong key.
  if (f.addInfo) proposed.additional_information = f.addInfo
  if (f.notes)   proposed.notes                  = f.notes
  if (f.dateLeaked) proposed.date_leaked = f.dateLeaked
  if (f.fileNames)  proposed.file_names  = f.fileNames
  if (f.songLength) proposed.length      = f.songLength
  if (f.bitrate)    proposed.bitrate     = f.bitrate
  return proposed
}
