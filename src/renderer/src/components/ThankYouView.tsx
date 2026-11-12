import { useEffect, useState } from 'react'
import { Heart, Code2, ChevronLeft, Star, Users, Skull, type LucideIcon } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { getThanksPage, resolveThanks, type ThanksPageContent, type ThanksIcon } from '../lib/thanksApi'
import logo from '../assets/logo.png'

// The lists are edited by administrators on the server (Admin -> Thank you,
// terminal `thanks`). Until the server answers, or when it has no page yet,
// the built-in copy in thanksApi shows.
const SECTION_ICONS: Record<ThanksIcon, LucideIcon | null> = {
  '': null, heart: Heart, code: Code2, star: Star, users: Users, skull: Skull,
}

export default function ThankYouView(): JSX.Element {
  const { setActiveView, previousView } = useStorePick('setActiveView', 'previousView')
  // Back to wherever this was opened from (Settings, most likely), like the
  // app's other pushed pages.
  const backView = previousView && previousView !== 'thanks' ? previousView : 'wrld'
  const [page, setPage] = useState<ThanksPageContent>(() => resolveThanks(null))

  useEffect(() => {
    const ctrl = new AbortController()
    getThanksPage(ctrl.signal).then((p) => setPage(resolveThanks(p))).catch(() => {})
    return () => ctrl.abort()
  }, [])

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="md:hidden sticky top-0 z-10 shrink-0 px-2 pt-2">
        <button
          onClick={() => setActiveView(backView)}
          aria-label="Back"
          className="glass-button w-11 h-11 flex items-center justify-center rounded-full text-text-primary active:opacity-60 transition-opacity"
        >
          <ChevronLeft size={24} strokeWidth={2.25} className="-ml-0.5" />
        </button>
      </div>
      <div className="relative w-full max-w-3xl mx-auto px-5 md:px-8 pt-6 md:pt-24 pb-16 text-center">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[480px] max-w-full h-[300px] rounded-full bg-accent/20 blur-[110px]" />

        <div className="relative">
          <img src={logo} alt="" className="w-16 h-16 mx-auto object-contain drop-shadow-2xl mb-5" />
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-accent/15 text-accent mb-5">
            <Heart size={22} />
          </div>
          <h1 className="text-text-primary text-3xl md:text-4xl font-extrabold tracking-tight mb-3">
            {page.title}
          </h1>
          <p className="text-text-secondary text-base leading-relaxed max-w-xl mx-auto mb-10">
            {page.intro}
          </p>

          {page.sections.map((section, i) => {
            const Icon = SECTION_ICONS[section.icon] ?? null
            return (
              <div key={i}>
                <div className={`rounded-2xl border border-[var(--border)] bg-surface-overlay/40 p-6 md:p-8 ${i > 0 ? 'mt-6' : ''}`}>
                  {section.title && (
                    <p className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-4 flex items-center justify-center gap-1.5">
                      {Icon && <Icon size={13} />} {section.title}
                    </p>
                  )}
                  <ul className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
                    {section.names.map((name) => (
                      <li
                        key={name}
                        className="px-3 py-1.5 rounded-full bg-surface-raised border border-[var(--border)] text-text-primary text-sm font-medium"
                      >
                        {name}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* The footnote sits under the first list (the donors), as it always has. */}
                {i === 0 && page.footnote && <p className="text-text-muted text-xs mt-8">{page.footnote}</p>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
