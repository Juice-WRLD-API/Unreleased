import { Check } from 'lucide-react'
import { allSkins } from '../../lib/skins'
import type { RoomRef } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import LocalNoticeFrame from './LocalNoticeFrame'

// Rendered for /theme (no args)'s local notice - lists every theme and lets
// you click one to apply it directly, same as typing "/theme <name>" would.
export default function ThemeListCard({ room, messageId }: { room: RoomRef; messageId: number }): JSX.Element {
  const current = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  return (
    <LocalNoticeFrame room={room} messageId={messageId} title="Themes">
      <ul className="mt-2 space-y-0.5">
        {allSkins().map((s) => (
          <li key={s.id}>
            <button
              onClick={() => setTheme(s.id)}
              className="w-full flex items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs text-text-secondary hover:bg-surface-overlay hover:text-text-primary transition-colors"
            >
              <span className="w-3.5 shrink-0">{s.id === current && <Check size={13} className="text-accent" />}</span>
              {s.name}
            </button>
          </li>
        ))}
      </ul>
    </LocalNoticeFrame>
  )
}
