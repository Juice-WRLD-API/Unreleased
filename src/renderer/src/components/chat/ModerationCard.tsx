import { Gavel, Globe2, MicOff, Timer, UserMinus, Volume2 } from 'lucide-react'
import { moderationNoticeVerb, type ModerationNoticeAction, type ModerationNoticePayload } from '../../lib/chatShare'
import { useStore } from '../../store/useStore'

// Tone per action: the ones that take something away read red, the ones that
// give it back read green, and a timeout sits between them as amber.
const STYLE: Record<ModerationNoticeAction, { icon: JSX.Element; tint: string; text: string }> = {
  mute: { icon: <MicOff size={15} />, tint: 'border-red-500/30 bg-red-500/10', text: 'text-red-300' },
  unmute: { icon: <Volume2 size={15} />, tint: 'border-emerald-500/30 bg-emerald-500/10', text: 'text-emerald-300' },
  timeout: { icon: <Timer size={15} />, tint: 'border-amber-500/30 bg-amber-500/10', text: 'text-amber-300' },
  untimeout: { icon: <Timer size={15} />, tint: 'border-emerald-500/30 bg-emerald-500/10', text: 'text-emerald-300' },
  kick: { icon: <UserMinus size={15} />, tint: 'border-red-500/30 bg-red-500/10', text: 'text-red-300' },
  ban: { icon: <Gavel size={15} />, tint: 'border-red-500/30 bg-red-500/10', text: 'text-red-300' },
  unban: { icon: <Gavel size={15} />, tint: 'border-emerald-500/30 bg-emerald-500/10', text: 'text-emerald-300' },
}

export default function ModerationCard({ notice }: { notice: ModerationNoticePayload }): JSX.Element {
  const openPublicProfile = useStore((s) => s.openPublicProfile)
  const style = STYLE[notice.action]
  return (
    <div className={`flex items-start gap-2.5 w-full max-w-sm rounded-xl border px-3 py-2.5 ${style.tint}`}>
      <span className={`mt-px shrink-0 ${style.text}`}>{style.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary [overflow-wrap:anywhere]">
          <button
            type="button"
            onClick={() => openPublicProfile(notice.userId)}
            className="font-semibold hover:underline"
          >
            {notice.name}
          </button>
          {' '}
          <span className={style.text}>{moderationNoticeVerb(notice)}</span>
        </p>
        {notice.reason && (
          <p className="mt-0.5 text-xs text-text-muted [overflow-wrap:anywhere]">Reason: {notice.reason}</p>
        )}
        {notice.site && (
          <p className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-px bg-surface-raised text-[10px] font-bold uppercase tracking-wider text-text-muted">
            <Globe2 size={10} />Site-wide
          </p>
        )}
      </div>
    </div>
  )
}
