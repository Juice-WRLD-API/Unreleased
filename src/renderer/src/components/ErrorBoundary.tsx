import { Component, ReactNode } from 'react'
import { AlertTriangle, Copy, Check, Flag, Loader2, CloudOff } from 'lucide-react'
import { useStore } from '../store/useStore'
import { isChunkLoadError } from '../lib/lazyView'

// Strips anything a stack/component-stack shouldn't be carrying off-device
// before an auto-report sends it anywhere: a dev server serves modules from
// real absolute paths (Windows drive letters, /Users/, /home/), which would
// otherwise leak the reporter's local folder structure verbatim. Bundle-
// relative production paths (the normal case) pass through untouched.
function redactLocalPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]*/g, '<local-path>')
    .replace(/\/(?:Users|home|root)\/[^\s)]*/g, '<local-path>')
}

// Query string / hash can carry short-lived but sensitive values (an OAuth
// callback's `code`/`state`, a share token) - only the origin and path are
// worth reporting for context anyway.
function sanitizedUrl(): string {
  const { origin, pathname } = window.location
  return origin + pathname
}

interface Props {
  children: ReactNode
  fallback?: ReactNode
  // 'inline' (default) - the error card fills its slot in the layout, for
  // boundaries around a content pane.
  // 'overlay' - for boundaries around modals and pop-out panels, which render
  // as loose siblings at the root rather than inside a sized container. The
  // card is centered over a backdrop instead of stretching the root flex
  // column, and gets a Close button so a crashed modal can still be dismissed
  // (`onDismiss` should flip whatever store flag mounts it - without that the
  // card would sit over the app with no way out).
  variant?: 'inline' | 'overlay'
  onDismiss?: () => void
}
// 'sending' covers the queue + first delivery attempt; 'delivered' means it
// actually reached the server this round; 'queued' means it only made it to
// the local outbox (offline, API disabled, etc.) - same three-way status
// ReportForm shows, so a crash report doesn't silently claim success when it
// hasn't actually gone out yet.
type ReportStatus = 'idle' | 'sending' | 'delivered' | 'queued'
interface State { error: Error | null; copied: boolean; reportStatus: ReportStatus }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false, reportStatus: 'idle' }
  private componentStack: string | null = null
  // Guards against double-sending - the reportStatus 'sending' value alone
  // can't do this, since it's also pre-set synchronously below (to avoid a
  // flash of the manual button) before the actual send starts.
  private reported = false

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Pre-set 'sending' when auto-report is on so the card never flashes an
    // idle "Report this error" button an instant before componentDidCatch
    // (below) fires it automatically anyway.
    return { error, reportStatus: useStore.getState().autoReportErrors ? 'sending' : 'idle' }
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    console.error('ErrorBoundary caught:', error, info)
    this.componentStack = info.componentStack
    this.reported = false
    if (useStore.getState().autoReportErrors) void this.reportError(true)
  }

  // A failed chunk import can't be retried in place: React.lazy caches the
  // rejected promise, so clearing the error just re-throws it. Only a reload
  // picks up the current build's chunk names.
  private retry = (): void => {
    if (isChunkLoadError(this.state.error)) window.location.reload()
    else this.setState({ error: null })
  }

  private copyError = (): void => {
    const { error } = this.state
    if (!error) return
    const text = `${error.message}\n\n${error.stack ?? ''}`
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    }).catch(() => {/* ignore */})
  }

  /** `auto` distinguishes componentDidCatch firing this on its own (the
   *  autoReportErrors setting) from a person clicking "Report this error" -
   *  only the former is genuinely unattended, so only that gets the API's
   *  `automated` field. */
  private reportError = async (auto = false): Promise<void> => {
    const { error } = this.state
    if (!error || this.reported) return
    this.reported = true
    this.setState({ reportStatus: 'sending' })
    const message = [
      `Crash: ${redactLocalPaths(error.message)}`,
      error.stack ? `\nStack:\n${redactLocalPaths(error.stack)}` : '',
      this.componentStack ? `\nComponent stack:\n${redactLocalPaths(this.componentStack)}` : '',
      `\nURL: ${sanitizedUrl()}`,
      `User agent: ${navigator.userAgent}`,
    ].join('\n')
    const delivered = await useStore.getState().submitFeedback('bug', message, undefined, auto)
    this.setState({ reportStatus: delivered ? 'delivered' : 'queued' })
  }

  private dismiss = (): void => {
    this.setState({ error: null })
    this.props.onDismiss?.()
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback
      const overlay = this.props.variant === 'overlay'
      const card = (
          <div className={`flex flex-col items-center justify-center gap-3 p-8 text-center ${overlay ? 'w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl' : 'h-full flex-1'}`}>
            <AlertTriangle className="text-text-muted w-8 h-8" />
            <p className="text-text-primary text-sm font-semibold">Something went wrong</p>
            <p className="text-red-400 text-xs font-mono max-w-md break-all">
              {this.state.error.message}
            </p>
            <div className="relative w-full max-w-lg">
              <pre className="text-text-muted text-[10px] font-mono max-h-44 overflow-auto text-left bg-surface-overlay rounded-lg p-3 whitespace-pre-wrap">
                {this.state.error.stack}
              </pre>
              <button
                onClick={this.copyError}
                title="Copy error to clipboard"
                className="absolute top-2 right-2 p-1.5 rounded bg-surface-raised hover:bg-surface-highest text-text-muted hover:text-text-primary transition-colors"
              >
                {this.state.copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              </button>
            </div>
            {this.state.reportStatus === 'delivered' ? (
              <p className="flex items-center gap-1.5 text-xs text-accent mt-1">
                <Check size={13} /> Reported - thanks
              </p>
            ) : this.state.reportStatus === 'queued' ? (
              <p className="flex items-center gap-1.5 text-xs text-amber-500 mt-1">
                <CloudOff size={13} /> Saved - will send once back online
              </p>
            ) : (
              <button
                // Not `onClick={this.reportError}` directly - that would
                // hand the click's SyntheticEvent to `auto` (truthy), wrongly
                // marking a manual report as automated.
                onClick={() => this.reportError()}
                disabled={this.state.reportStatus === 'sending'}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary underline mt-1 disabled:opacity-50"
              >
                {this.state.reportStatus === 'sending'
                  ? <><Loader2 size={13} className="animate-spin" /> Reporting…</>
                  : <><Flag size={13} /> Report this error</>}
              </button>
            )}
            <div className="flex items-center gap-4 mt-1">
              <button
                className="text-xs text-accent hover:text-accent-hover underline"
                onClick={this.retry}
              >
                {isChunkLoadError(this.state.error) ? 'Reload' : 'Try again'}
              </button>
              {overlay && this.props.onDismiss && (
                <button className="text-xs text-text-muted hover:text-text-primary underline" onClick={this.dismiss}>
                  Close
                </button>
              )}
            </div>
          </div>
      )
      if (!overlay) return card
      return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
          {card}
        </div>
      )
    }
    return this.props.children
  }
}
