import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Download, CheckCircle2, AlertCircle, Loader2, ArrowUpCircle, ShieldAlert } from 'lucide-react'
import {
  checkForAndroidUpdate, openApkDownload, canInstallInApp, hasInstallPermission,
  openInstallSettings, downloadAndInstall, type UpdateCheck,
} from '../lib/androidUpdate'

// Settings → About, Android wrap only. The desktop build has electron-updater
// driving the header's refresh button; the sideloaded APK has no update
// channel at all, so this is it. Rendered by Settings behind an isAndroidApp()
// check — see lib/androidUpdate for why the version and the release feed both
// come from somewhere other than the obvious place.

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; result: UpdateCheck }
  | { kind: 'error'; message: string }

// Separate from State: an install runs on top of an already-resolved check,
// and folding it in would throw away the release info mid-download.
//
// `installing` is not a dead end: the plugin reports the session's outcome, so
// a blocked or cancelled install lands on 'error' with a reason instead of
// leaving this stuck mid-install with nothing to say.
type Install =
  | { kind: 'none' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'installing' }
  | { kind: 'needsPermission' }
  | { kind: 'error'; message: string }

export default function AndroidUpdateSection(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [install, setInstall] = useState<Install>({ kind: 'none' })
  // Survives the check/download resolving after the user closes Settings.
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const check = useCallback(async () => {
    setState({ kind: 'checking' })
    setInstall({ kind: 'none' })
    try {
      const result = await checkForAndroidUpdate()
      if (alive.current) setState({ kind: 'done', result })
    } catch (err) {
      if (alive.current) {
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not check for updates.' })
      }
    }
  }, [])

  // One automatic check when the section is opened, so "up to date" is the
  // default thing you see rather than an unanswered button.
  useEffect(() => { void check() }, [check])

  // Unsubscribe for the install-status listener, which outlives the
  // downloadAndInstall promise (the outcome arrives after the commit).
  const unsubStatus = useRef<(() => void) | null>(null)
  useEffect(() => () => unsubStatus.current?.(), [])

  const startInstall = useCallback(async (url: string) => {
    // Checked up front so the user gets the "allow installs" prompt before
    // sitting through a download that couldn't have installed anyway.
    if (!(await hasInstallPermission())) {
      if (alive.current) setInstall({ kind: 'needsPermission' })
      return
    }
    setInstall({ kind: 'downloading', percent: 0 })
    try {
      unsubStatus.current?.()
      unsubStatus.current = await downloadAndInstall(
        url,
        (percent) => {
          if (alive.current) setInstall({ kind: 'downloading', percent })
        },
        (status) => {
          if (!alive.current) return
          // 'success' never really lands — the update replaces this process
          // before it can render — but treat it as still installing rather
          // than inventing a done state we can't be sure of.
          if (status.state === 'failed' || status.state === 'cancelled') {
            setInstall({ kind: 'error', message: status.message ?? 'The install failed.' })
          } else {
            setInstall({ kind: 'installing' })
          }
        },
      )
      // Resolves when the install session is committed, not when it finishes —
      // the system installer takes over from here and reports back through the
      // status listener above.
      if (alive.current) setInstall((prev) => (prev.kind === 'error' ? prev : { kind: 'installing' }))
    } catch (err) {
      if (!alive.current) return
      const msg = err instanceof Error ? err.message : String(err)
      setInstall(msg.includes('PERMISSION_REQUIRED')
        ? { kind: 'needsPermission' }
        : { kind: 'error', message: msg })
    }
  }, [])

  const result = state.kind === 'done' ? state.result : null
  const update = result?.updateAvailable ? result.latest : null

  return (
    <div className="rounded-xl border border-[var(--border)] overflow-hidden mt-2">
      <div className="flex items-center gap-2.5 px-3 py-2.5 bg-[var(--surface-raised)]">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#16a34a' }}>
          <ArrowUpCircle size={13} className="text-white" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-text-primary text-sm">App updates</p>
          <p className="text-text-muted text-xs md:text-[11px] leading-snug">
            {result ? `Installed: v${result.installed}` : 'Checks GitHub for a newer APK'}
          </p>
        </div>
        <button
          onClick={check}
          disabled={state.kind === 'checking' || install.kind === 'downloading' || install.kind === 'installing'}
          aria-label="Check for updates"
          className="shrink-0 w-9 h-9 md:w-auto md:h-auto md:p-1 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={15} className={state.kind === 'checking' ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="px-3 py-3 border-t border-[var(--border)] space-y-2.5">
        {state.kind === 'checking' && (
          <p className="flex items-center gap-2 text-text-muted text-xs">
            <Loader2 size={13} className="animate-spin shrink-0" /> Checking for updates…
          </p>
        )}

        {state.kind === 'error' && (
          <p className="flex items-start gap-1.5 text-red-400 text-xs">
            <AlertCircle size={13} className="shrink-0 mt-px" /> {state.message}
          </p>
        )}

        {result && !result.latest && (
          <p className="text-text-muted text-xs">No Android releases published yet.</p>
        )}

        {result && result.latest && !update && (
          <p className="flex items-center gap-1.5 text-emerald-500 text-xs">
            <CheckCircle2 size={13} className="shrink-0" /> You&rsquo;re on the latest version.
          </p>
        )}

        {update && (
          <>
            <p className="text-text-primary text-sm font-semibold">v{update.version} available</p>
            {update.notes && (
              // Release notes are plain text from the GitHub release body;
              // clamped so a long changelog can't push the button off-screen.
              <pre className="text-text-muted text-xs leading-relaxed whitespace-pre-wrap font-sans max-h-32 overflow-y-auto">
                {update.notes}
              </pre>
            )}

            {!update.apkUrl ? (
              <a
                href={update.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] text-text-secondary text-sm font-medium transition-colors"
              >
                View release on GitHub
              </a>
            ) : install.kind === 'downloading' ? (
              <div className="space-y-1.5">
                <div className="h-2 rounded-full bg-[var(--surface-overlay)] overflow-hidden">
                  <div
                    className="h-full bg-accent transition-[width] duration-150"
                    style={{ width: `${install.percent}%` }}
                  />
                </div>
                <p className="text-text-muted text-xs">Downloading… {install.percent}%</p>
              </div>
            ) : install.kind === 'installing' ? (
              <p className="flex items-start gap-1.5 text-text-muted text-xs">
                <Loader2 size={13} className="animate-spin shrink-0 mt-px" />
                Installing — follow the Android prompt to finish updating.
              </p>
            ) : install.kind === 'needsPermission' ? (
              <div className="space-y-2">
                <p className="flex items-start gap-1.5 text-amber-500 text-xs">
                  <ShieldAlert size={13} className="shrink-0 mt-px" />
                  Android needs permission to install apps from this app.
                </p>
                <button
                  onClick={() => { void openInstallSettings() }}
                  className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold transition-colors"
                >
                  Open settings
                </button>
                <p className="text-text-muted text-[11px] leading-snug">
                  Turn on &ldquo;Allow from this source&rdquo;, come back, and tap Update again.
                </p>
              </div>
            ) : (
              <>
                {install.kind === 'error' && (
                  <p className="flex items-start gap-1.5 text-red-400 text-xs">
                    <AlertCircle size={13} className="shrink-0 mt-px" /> {install.message}
                  </p>
                )}
                <button
                  onClick={() => {
                    // Older APKs predate the native plugin and can't install
                    // in-app — they fall back to the browser download, which
                    // is how such a build reaches one that can.
                    if (canInstallInApp()) void startInstall(update.apkUrl as string)
                    else openApkDownload(update.apkUrl as string)
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold transition-colors"
                >
                  <Download size={15} />
                  {canInstallInApp() ? `Update to v${update.version}` : `Download v${update.version}`}
                </button>
                {!canInstallInApp() && (
                  <p className="text-text-muted text-[11px] leading-snug">
                    Opens in your browser. Tap the downloaded file to install.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
