import { useEffect } from 'react'
import { registerBackHandler } from '../lib/backHandlers'

// Android back closes this component, for the modals/menus whose open state
// lives in a parent's local state rather than the store (the store-backed
// layers are handled centrally in useAndroidBackButton).
//
// Call it from a component that only mounts while open: the registration then
// lasts exactly as long as the UI does, and because handlers run
// last-registered-first, a modal opened on top of another gets the press.
//
// `active` is for components that stay mounted and render null while closed -
// without it they'd swallow a back press while invisible.
export function useBackToClose(onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return
    return registerBackHandler(() => { onClose(); return true })
  }, [onClose, active])
}
