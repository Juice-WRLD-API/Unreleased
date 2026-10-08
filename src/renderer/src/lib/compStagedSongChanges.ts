import { useStore, StagedSongChange } from '../store/useStore'
import * as userApi from './userApi'
import { invalidateLyricsCache } from '../components/Player'
import { errorMessage } from './format'

// Submits the song edit/delete proposals the Tracker's editors staged (see
// the store's stagedSongChanges). Mirrors compStagedChanges.ts's file-change
// flow: nothing is proposed until this runs from the Uploads panel.

export function stagedSongChangeLabel(change: StagedSongChange): string {
  if (change.changeType === 'delete') return `Delete “${change.title}”`
  if (change.changeType === 'create') return `New song “${change.title}”`
  return `Update “${change.title}”`
}

/** Proposes every staged song change. Each one that lands is dropped from the
 *  queue; failures stay queued carrying the error so they can be retried
 *  without re-editing the song. */
export async function proposeStagedSongChanges(): Promise<{ proposed: number; failed: number }> {
  const { stagedSongChanges, updateStagedSongChange, unstageSongChange } = useStore.getState()
  let proposed = 0
  let failed = 0

  for (const change of stagedSongChanges) {
    updateStagedSongChange(change.id, { error: undefined })
    try {
      await userApi.createProposal({
        song: change.songId,
        change_type: change.changeType,
        title: change.title,
        proposed_data: change.proposedData,
        editor_notes: change.editorNotes,
        channel: change.channel,
      })
      unstageSongChange(change.id)
      // Lyrics may have changed (and auto-approve admins make it live
      // instantly) - drop the cached copy so the next play reflects it. Only
      // meaningful for an existing song; a 'create' has nothing cached yet.
      if (change.songId != null && ('lyrics' in change.proposedData || 'synced_lyrics' in change.proposedData)) {
        invalidateLyricsCache(change.songId)
      }
      proposed++
    } catch (e) {
      updateStagedSongChange(change.id, { error: errorMessage(e, 'Could not propose this change') })
      failed++
    }
  }

  return { proposed, failed }
}
