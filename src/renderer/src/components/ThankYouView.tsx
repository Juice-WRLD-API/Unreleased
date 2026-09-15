import { Heart, Code2 } from 'lucide-react'
import logo from '../assets/logo.png'

// Placeholder donor list - replace with the real names. Order here is
// display order (most recent or most generous first, whatever you prefer).
const DONORS: string[] = [
  'Jane Doe',
  'John Smith',
  'Anonymous',
]

// Placeholder dev/contributor list - replace with real names/handles.
// freakylatif kept as a seed since it's already credited in the README.
const DEVELOPERS: string[] = [
  'saint', 'hackinhood (X)'
]

// Placeholder list for a third, unlabeled section - replace with real names.
const OTHERS: string[] = [
  'Pure',
  'emzie',
]

export default function ThankYouView(): JSX.Element {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="relative w-full max-w-3xl mx-auto px-5 md:px-8 pt-16 md:pt-24 pb-16 text-center">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[480px] max-w-full h-[300px] rounded-full bg-accent/20 blur-[110px]" />

        <div className="relative">
          <img src={logo} alt="" className="w-16 h-16 mx-auto object-contain drop-shadow-2xl mb-5" />
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-accent/15 text-accent mb-5">
            <Heart size={22} />
          </div>
          <h1 className="text-text-primary text-3xl md:text-4xl font-extrabold tracking-tight mb-3">
            Thank you
          </h1>
          <p className="text-text-secondary text-base leading-relaxed max-w-xl mx-auto mb-10">
            unreleased is free to use and kept running by donations from people like you.
            Every bit helps cover hosting and keeps the site ad-free. This page is our way
            of saying thanks.
          </p>

          <div className="rounded-2xl border border-[var(--border)] bg-surface-overlay/40 p-6 md:p-8">
            <p className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-4">
              With thanks to
            </p>
            <ul className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
              {DONORS.map((name) => (
                <li
                  key={name}
                  className="px-3 py-1.5 rounded-full bg-surface-raised border border-[var(--border)] text-text-primary text-sm font-medium"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-text-muted text-xs mt-8">
            Donated and don&rsquo;t see your name here? Let us know and we&rsquo;ll add it.
          </p>

          <div className="rounded-2xl border border-[var(--border)] bg-surface-overlay/40 p-6 md:p-8 mt-6">
            <p className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-4 flex items-center justify-center gap-1.5">
              <Code2 size={13} /> Built by
            </p>
            <ul className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
              {DEVELOPERS.map((name) => (
                <li
                  key={name}
                  className="px-3 py-1.5 rounded-full bg-surface-raised border border-[var(--border)] text-text-primary text-sm font-medium"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-surface-overlay/40 p-6 md:p-8 mt-6">
            <p className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-4">
              Fuck You (oops)
            </p>
            <ul className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
              {OTHERS.map((name) => (
                <li
                  key={name}
                  className="px-3 py-1.5 rounded-full bg-surface-raised border border-[var(--border)] text-text-primary text-sm font-medium"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
