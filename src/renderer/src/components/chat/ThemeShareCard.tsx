import { Palette } from 'lucide-react'
import type { SharedThemePayload } from '../../lib/chatShare'
import { newSkinId } from '../../lib/skins'
import { useStore } from '../../store/useStore'

// Applying a shared theme always creates a fresh custom skin (same as
// importing a .jwskin.json file) rather than trying to match it back to an
// existing one - there's no reliable identity to match on since a shared
// built-in theme could have been re-skinned locally under the same name.
export default function ThemeShareCard({ theme }: { theme: SharedThemePayload }): JSX.Element {
  const applyTheme = (): void => {
    const store = useStore.getState()
    const skin = { id: newSkinId(), name: theme.name, dark: theme.dark, custom: true, accent: theme.accent, vars: theme.vars }
    store.saveCustomSkin(skin)
    store.setTheme(skin.id)
    if (theme.accent) store.setAccentColor(theme.accent)
  }
  return (
    <div
      onClick={applyTheme}
      className="flex items-center gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 cursor-pointer hover:border-text-muted transition-colors"
    >
      <span
        className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 grid grid-cols-2 grid-rows-2 border border-[var(--border)]"
        style={{ background: theme.vars['--surface'] }}
      >
        <span style={{ background: theme.vars['--surface-raised'] }} />
        <span style={{ background: theme.vars['--surface-overlay'] }} />
        <span style={{ background: theme.vars['--surface-highest'] }} />
        <span style={{ background: theme.accent ?? theme.vars['--text-primary'] }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate flex items-center gap-1.5">
          <Palette size={13} className="text-text-muted shrink-0" />
          {theme.name}
        </p>
        <p className="text-xs text-text-muted">Click to apply this theme</p>
      </div>
    </div>
  )
}
