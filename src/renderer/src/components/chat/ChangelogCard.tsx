import { CheckCircle2, Clock, HelpCircle, RefreshCw } from 'lucide-react'
import type { ChangelogStatus } from '../../lib/appVersion'
import type { RoomRef } from '../../store/chatStore'
import { relativeTime } from '../adminShared'
import LocalNoticeFrame from './LocalNoticeFrame'

const BUILT = {
  live: { Icon: CheckCircle2, cls: 'text-green-400', text: 'Built and live' },
  building: { Icon: Clock, cls: 'text-amber-400', text: 'Not built yet' },
  unknown: { Icon: HelpCircle, cls: 'text-text-muted', text: 'Build status unknown' },
} as const

// Rendered for /changelog's local notice - a snapshot taken when the command
// ran, so it doesn't update if the deploy lands afterwards.
export default function ChangelogCard({ room, messageId, status }: { room?: RoomRef; messageId?: number; status: ChangelogStatus }): JSX.Element {
  const { tip, built, deployed, running, branch, needsReload } = status
  const { Icon, cls, text } = BUILT[built]
  const [subject, ...body] = tip.message.split('\n')
  const detail = built === 'building'
    ? `The site is still serving ${deployed}.`
    : built === 'unknown'
      ? `Couldn't read the site's version - this tab is running ${running}.`
      : null
  return (
    <LocalNoticeFrame room={room} messageId={messageId} title="Latest commit">
      <p className="mt-2 text-xs text-text-primary break-words [overflow-wrap:anywhere]">{subject || 'No message'}</p>
      {body.join('\n').trim() && (
        <p className="mt-1 text-[11px] text-text-muted whitespace-pre-line break-words [overflow-wrap:anywhere] line-clamp-4">{body.join('\n').trim()}</p>
      )}
      <p className="mt-1 text-[11px] text-text-muted">
        <a href={tip.url} target="_blank" rel="noopener noreferrer" className="font-mono text-accent hover:underline">{tip.sha.slice(0, 7)}</a>
        {' · '}{tip.author} · {relativeTime(tip.date)} · {branch}
      </p>
      <div className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${cls}`}>
        <Icon size={14} /> {text}
      </div>
      {detail && <p className="mt-0.5 text-[11px] text-text-muted">{detail}</p>}
      {needsReload && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-400">
          <RefreshCw size={11} /> This tab is on {running} - reload to run it.
        </p>
      )}
    </LocalNoticeFrame>
  )
}
