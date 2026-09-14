import type { ReactNode } from 'react'

// Generic tab bar shared by EditorProfileView.desktop.tsx/.mobile.tsx (and,
// per the rewrite plan, a future Phase 4 migration of AdminPage's own nav
// onto this same component - kept generic enough for that even though it's
// only wired into the profile view for now).
export interface ProfileTabDef<T extends string = string> {
  id: T
  label: string
  icon?: ReactNode
  badge?: number
}

export interface ProfileTabBarProps<T extends string> {
  tabs: ProfileTabDef<T>[]
  active: T
  onChange: (id: T) => void
  /** 'underline' matches EditorProfileView.desktop's original tab strip
   *  (bottom border indicator). 'pill' matches EditorProfileView.mobile's
   *  original rounded-full chip row. Caller owns the surrounding
   *  border/padding - this component only renders the tabs themselves. */
  variant?: 'underline' | 'pill'
}

export default function ProfileTabBar<T extends string>({
  tabs, active, onChange, variant = 'underline',
}: ProfileTabBarProps<T>): JSX.Element {
  if (variant === 'pill') {
    return (
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-semibold transition-colors ${
              active === t.id ? 'bg-accent text-white' : 'bg-[var(--surface-overlay)] text-text-muted'
            }`}
          >
            {t.icon}
            {t.label}
            {typeof t.badge === 'number' && t.badge > 0 && (
              <span className={`text-[10px] tabular-nums rounded-full px-1.5 ${active === t.id ? 'bg-white/20' : 'bg-surface-raised text-text-muted'}`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`relative flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium transition-colors border-b-2 ${
            active === t.id ? 'text-accent border-accent' : 'text-text-muted hover:text-text-primary border-transparent'
          }`}
        >
          <span className={active === t.id ? 'text-accent' : ''}>{t.icon}</span>
          {t.label}
          {typeof t.badge === 'number' && t.badge > 0 && (
            <span className="text-[10px] tabular-nums text-text-muted">{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  )
}
