import { useStore } from '../store/useStore'
import { removeCustomFont } from './fonts'

/** Removes a custom font, moving the app and lyrics fonts off it first. */
export async function deleteFont(id: string): Promise<void> {
  const s = useStore.getState()
  if (s.appFont === id) s.setAppFont('system')
  if (s.lyricsFont === id) s.setLyricsFont('system')
  await removeCustomFont(id)
}
