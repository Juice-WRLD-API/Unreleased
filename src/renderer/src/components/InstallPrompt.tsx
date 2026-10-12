import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Share, Plus, Download, Smartphone, BatteryCharging } from 'lucide-react'
import { IS_IOS, IS_MOBILE, isStandalonePWA } from '../lib/platform'

// One-time nudge that tells mobile users the app can be installed to their home
// screen, and how. Two paths:
//   • Android/Chromium fires `beforeinstallprompt` - we capture it and offer a
//     real one-tap Install button that triggers the native prompt.
//   • iOS Safari never fires that event (no programmatic install), so there we
//     show the manual Share → "Add to Home Screen" steps instead.
// Hidden when already installed (standalone), on desktop, or once the user
// has dismissed it.

const DISMISS_KEY = 'pwa:install-dismissed'
const SHOW_DELAY_MS = 4000

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// The install event can fire before React mounts, so capture it at module load.
// Kept in a module var the component reads once it's up.
let deferredPrompt: BeforeInstallPromptEvent | null = null
const promptListeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // stop Chrome's default mini-infobar; we drive our own UI
    deferredPrompt = e as BeforeInstallPromptEvent
    promptListeners.forEach((fn) => fn())
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
    promptListeners.forEach((fn) => fn())
  })
}

function dismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

// ── Shared access to the captured install prompt ────────────────────────────
// The download page offers its own "Install" button; both UIs drive the same
// one-shot prompt, so it lives here (the module that captures it) and is
// consumed through these helpers.

export function hasPwaInstallPrompt(): boolean {
  return !!deferredPrompt
}

/** Subscribe to availability changes of the install prompt. Returns an unsubscriber. */
export function onPwaInstallPromptChange(fn: () => void): () => void {
  promptListeners.add(fn)
  return () => { promptListeners.delete(fn) }
}

/** Fire the captured native install prompt (no-op if none). Consumes it either way. */
export async function showPwaInstallPrompt(): Promise<void> {
  if (!deferredPrompt) return
  try {
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
  } catch { /* user bailed */ }
  deferredPrompt = null
  promptListeners.forEach((fn) => fn())
}

export default function InstallPrompt(): JSX.Element | null {
  const [visible, setVisible] = useState(false)
  const [hasPrompt, setHasPrompt] = useState(!!deferredPrompt)

  const eligible = IS_MOBILE && !isStandalonePWA() && !dismissed()

  // iOS: schedule the instructions after a short delay. Android: subscribe for
  // the install event (the button is pointless until it arrives).
  useEffect(() => {
    if (!eligible) return
    if (IS_IOS) {
      const t = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS)
      return () => clearTimeout(t)
    }
    const onChange = (): void => setHasPrompt(!!deferredPrompt)
    promptListeners.add(onChange)
    onChange()
    return () => { promptListeners.delete(onChange) }
  }, [eligible])

  // Android: once we actually have a prompt to fire, reveal after the delay.
  useEffect(() => {
    if (!eligible || IS_IOS || !hasPrompt) return
    const t = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS)
    return () => clearTimeout(t)
  }, [eligible, hasPrompt])

  if (!eligible || !visible) return null

  const close = (): void => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
    setVisible(false)
  }

  const install = async (): Promise<void> => {
    await showPwaInstallPrompt()
    close()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm p-0 md:p-4"
      onClick={(e) => { if (e.currentTarget === e.target) close() }}
    >
      <div
        className="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-sm max-h-[92svh] overflow-y-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="flex items-center gap-2 text-text-primary text-sm font-semibold">
            <Smartphone size={15} className="text-accent" /> Install the app
          </h2>
          <button onClick={close} className="text-text-muted hover:text-text-primary transition-colors" title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-text-secondary text-sm leading-relaxed">
            Add Unreleased to your home screen for a fullscreen, app-like experience and quick access - no app store needed.
          </p>

          {IS_IOS ? (
            <>
              {/* iOS manual steps. */}
              <ol className="space-y-2.5">
                <li className="flex items-center gap-3 text-sm text-text-primary">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-surface-overlay border border-[var(--border)] flex items-center justify-center text-xs font-semibold text-text-muted">1</span>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    Tap the
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-overlay border border-[var(--border)] text-text-secondary">
                      <Share size={13} /> Share
                    </span>
                    button in Safari
                  </span>
                </li>
                <li className="flex items-center gap-3 text-sm text-text-primary">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-surface-overlay border border-[var(--border)] flex items-center justify-center text-xs font-semibold text-text-muted">2</span>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    Choose
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-overlay border border-[var(--border)] text-text-secondary">
                      <Plus size={13} /> Add to Home Screen
                    </span>
                  </span>
                </li>
              </ol>
              <button
                onClick={close}
                className="w-full py-2.5 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent/90 transition-colors"
              >
                Got it
              </button>
            </>
          ) : (
            <>
              {/* Android / Chromium - real install prompt. */}
              <button
                onClick={install}
                className="w-full py-2.5 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent/90 transition-colors flex items-center justify-center gap-2"
              >
                <Download size={15} /> Install
              </button>
              <button
                onClick={close}
                className="w-full py-2 rounded-xl text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
              >
                Not now
              </button>
              {/* Android's Doze mode / OEM battery savers can kill background
                  web audio no matter what the app does - the one thing that
                  actually prevents it is a device-side setting only the user
                  can change. Surfaced here since this dialog is Android-only. */}
              <p className="flex items-start gap-2 text-[11px] text-text-muted bg-[var(--surface-overlay)] border border-[var(--border)] rounded-lg px-3 py-2">
                <BatteryCharging size={14} className="shrink-0 mt-px text-text-secondary" />
                <span>
                  For playback to keep going with the screen off, turn off <span className="text-text-secondary font-medium">battery optimization</span> for this app in your phone&rsquo;s settings.
                </span>
              </p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
