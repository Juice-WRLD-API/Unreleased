import { useSyncExternalStore } from 'react'
import { listCustomFonts, subscribeCustomFonts, type CustomFont } from '../lib/fonts'

/** The user's custom fonts; re-renders when one is added, removed or finishes loading. */
export function useCustomFonts(): CustomFont[] {
  return useSyncExternalStore(subscribeCustomFonts, listCustomFonts)
}
