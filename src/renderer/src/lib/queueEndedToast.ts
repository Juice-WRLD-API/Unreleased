// Shown when a skip finds nothing left to play (end of a non-repeating queue,
// or no queue at all), offering the tracker's random radio instead.
import { useStore } from '../store/useStore'
import { showAppToast } from './appToast'

export function showQueueEndedToast(): void {
  showAppToast('Nothing left in the queue', {
    tone: 'info',
    action: { label: 'Play radio', onClick: () => useStore.getState().startRandomRadio() },
  })
}
