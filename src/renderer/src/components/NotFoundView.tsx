import logo from '../assets/logo.png'
import { useStore, useStorePick } from '../store/useStore'

export default function NotFoundView(): JSX.Element {
  const { setActiveView } = useStorePick('setActiveView')
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center px-6">
      <img src={logo} alt="unreleased" className="w-16 h-16 object-contain opacity-40" />
      <div>
        <p className="text-footnote font-semibold text-accent md:text-text-muted md:text-xs md:uppercase md:tracking-widest mb-1">404</p>
        <h1 className="text-title1 md:text-2xl md:font-bold md:tracking-normal text-text-primary mb-2">Page not found</h1>
        <p className="text-subhead md:text-sm md:tracking-normal text-text-secondary md:text-text-muted">That URL doesn't exist.</p>
      </div>
      <button
        onClick={() => setActiveView('api-tracker')}
        className="px-5 h-11 md:h-auto md:py-2.5 rounded-full md:rounded-xl bg-[var(--fill)] md:bg-accent/15 hover:bg-accent/25 max-md:active:bg-[var(--fill-strong)] text-accent text-headline md:text-sm md:font-semibold md:tracking-normal transition-colors"
      >
        Back to Tracker
      </button>
    </div>
  )
}
