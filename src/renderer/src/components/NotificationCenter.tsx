import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AlertCircle, Bell, Info, Megaphone, MessageSquare, Newspaper, Trash2, X, type LucideIcon } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import {
  clearNotifications, getNotifications, markNotificationsRead, removeNotification,
  type NotificationEntry, type NotificationKind, type NotificationLevel,
} from '../lib/notificationHistory'
import { openNotificationTarget } from '../lib/openNotification'
import { useNotificationHistory } from '../hooks/useNotificationHistory'
import { useBackToClose } from '../hooks/useBackToClose'
import { useEscapeToClose } from '../hooks/useEscapeToClose'
import { useListMotion } from '../hooks/useListMotion'
import { useIsMobile } from '../hooks/useIsMobile'
import { clickable } from '../lib/a11y'
import { PopLayer } from './PopLayer'
import { BackButton, CompactBar, LargeTitle, LARGE_TITLE_COLLAPSE, useScrolledPast } from './mobile/NavBar'

// The notification area: every banner (chat messages, device alerts, news
// posts, announcements) and toast that came up, newest first, so one that
// came and went can still be read. Entries live in lib/notificationHistory.
// Opened from the Notifications control in the side menu (Sidebar) or the
// bell on mobile Home; anchored top-right like Transfers (UploadManager), and
// closed the same way - outside click, Escape, Android back. On phones it's a
// full page instead: large title, day-grouped cards, swipe a row to remove it.
// The buttons that
// open it carry data-notifications-toggle, so their click isn't an outside
// click that closes it only for the button to reopen it.

const KIND_LABEL: Record<NotificationKind, string> = { chat: 'Chat', news: 'News', broadcast: 'Announcements', app: 'App' }
const KIND_ORDER: NotificationKind[] = ['chat', 'news', 'broadcast', 'app']
const KIND_ICON: Record<NotificationKind, LucideIcon> = { chat: MessageSquare, news: Newspaper, broadcast: Megaphone, app: Info }

const LEVEL_TINT: Record<NotificationLevel, string> = {
  info: 'text-accent bg-accent/15',
  success: 'text-emerald-400 bg-emerald-500/15',
  warning: 'text-amber-400 bg-amber-500/15',
  error: 'text-red-400 bg-red-500/15',
}

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayLabel(day: number, today: number): string {
  if (day === today) return 'Today'
  // A millisecond before midnight, not 24h back, so a DST change can't skip it.
  if (day === startOfDay(today - 1)) return 'Yesterday'
  const d = new Date(day)
  return d.toLocaleDateString([], {
    weekday: 'long', month: 'short', day: 'numeric',
    ...(d.getFullYear() !== new Date(today).getFullYear() ? { year: 'numeric' } : {}),
  })
}

// Today's entries count up ("5m"); older ones sit under a day heading, so
// the clock time says the rest.
function timeLabel(at: number, now: number, today: number): string {
  if (at < today) return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const m = Math.floor((now - at) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

export default function NotificationCenter(): JSX.Element {
  const { setShowNotifications } = useStorePick('setShowNotifications')
  const entries = useNotificationHistory()
  const close = useCallback(() => setShowNotifications(false), [setShowNotifications])
  useBackToClose(close)
  // Through the shared Escape stack, so a dialog opened over the panel closes
  // first instead of both closing on one press.
  useEscapeToClose(close)

  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useListMotion(listRef)

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element | null
      if (!t || panelRef.current?.contains(t) || t.closest?.('[data-notifications-toggle]')) return
      close()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [close])

  // Opening the area is reading it: the badge clears at once, and what was
  // new keeps its dot until the panel closes. Anything that arrives while it's
  // open is treated the same way.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set(getNotifications().filter((e) => !e.read).map((e) => e.id)))
  useEffect(() => {
    const unread = entries.filter((e) => !e.read).map((e) => e.id)
    if (unread.length === 0) return
    setFresh((f) => new Set([...f, ...unread]))
    markNotificationsRead(unread)
  }, [entries])

  // Relative times ("5m") keep counting while the panel is open.
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const [filter, setFilter] = useState<NotificationKind | 'all'>('all')
  const kinds = KIND_ORDER.filter((k) => entries.some((e) => e.kind === k))
  // A filter whose last entry was cleared falls back to everything.
  const active = filter !== 'all' && kinds.includes(filter) ? filter : 'all'
  const shown = active === 'all' ? entries : entries.filter((e) => e.kind === active)
  const newCount = entries.reduce((n, e) => (fresh.has(e.id) ? n + 1 : n), 0)

  const open = (entry: NotificationEntry): void => {
    if (!entry.target) return
    close()
    openNotificationTarget(entry.target)
  }

  const isMobile = useIsMobile()
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const collapsed = useScrolledPast(scrollEl, LARGE_TITLE_COLLAPSE)

  const today = startOfDay(now)
  const clearShown = (): void => clearNotifications(active === 'all' ? undefined : [active])

  if (isMobile) {
    // One flat list (useListMotion only moves the container's direct
    // children), with each day's rows drawn as one inset-grouped card: the
    // first and last row of a day round the card's corners.
    const items: JSX.Element[] = []
    shown.forEach((e, i) => {
      const day = startOfDay(e.at)
      const first = i === 0 || startOfDay(shown[i - 1].at) !== day
      const last = i === shown.length - 1 || startOfDay(shown[i + 1].at) !== day
      if (first) {
        items.push(
          <h3 key={`day-${day}`} data-flip-key={`day-${day}`} className="px-8 pt-5 pb-1.5 text-footnote font-medium text-text-secondary">
            {dayLabel(day, today)}
          </h3>,
        )
      }
      items.push(
        <MobileNotificationRow key={e.id} entry={e} fresh={fresh.has(e.id)} time={timeLabel(e.at, now, today)} first={first} last={last} onOpen={open} />,
      )
    })

    return (
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Notifications"
        className="animate-m-page-in fixed inset-0 z-[9990] flex flex-col bg-[var(--surface)]"
      >
        <CompactBar
          title="Notifications"
          shown={collapsed}
          leading={<BackButton onClick={close} label="Close" />}
          trailing={shown.length > 0 ? (
            <button
              onClick={clearShown}
              className="glass-button h-11 px-4 rounded-full text-body font-medium text-accent active:opacity-60 transition-opacity"
            >
              Clear{active === 'all' ? ' All' : ''}
            </button>
          ) : undefined}
        />
        <div
          ref={setScrollEl}
          className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)' }}
        >
          <LargeTitle inset="bar" title="Notifications" subtitle={newCount > 0 ? `${newCount} new` : undefined} />
          {kinds.length > 1 && (
            <div className="flex gap-2 px-4 pt-1 pb-1 overflow-x-auto no-scrollbar shrink-0">
              {(['all', ...kinds] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  aria-pressed={active === k}
                  className={`h-9 px-4 rounded-full text-subhead font-medium whitespace-nowrap transition-colors active:opacity-60 ${
                    active === k ? 'bg-text-primary text-surface' : 'bg-[var(--fill)] text-text-primary'
                  }`}
                >
                  {k === 'all' ? 'All' : KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}
          <div ref={listRef} className="relative shrink-0">{items}</div>
          {items.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-10 pb-24 text-center">
              <span className="w-16 h-16 rounded-full bg-[var(--fill)] flex items-center justify-center">
                <Bell size={28} className="text-text-secondary" />
              </span>
              <p className="text-headline text-text-primary">No Notifications</p>
              <p className="text-subhead text-text-secondary">
                Chat messages, news posts, announcements and app notices show up here after they pop up.
              </p>
            </div>
          )}
          {items.length > 0 && (
            <p className="px-8 pt-3 text-footnote text-text-muted">Swipe left on a notification to remove it.</p>
          )}
        </div>
      </div>
    )
  }

  const rows: JSX.Element[] = []
  let lastDay = -1
  for (const e of shown) {
    const day = startOfDay(e.at)
    if (day !== lastDay) {
      lastDay = day
      rows.push(
        <div key={`day-${day}`} data-flip-key={`day-${day}`} className="px-4 md:px-3 pt-3 pb-1 text-footnote font-semibold text-text-secondary md:text-[10px] md:uppercase md:tracking-wider md:text-text-muted">
          {dayLabel(day, today)}
        </div>,
      )
    }
    rows.push(<NotificationRow key={e.id} entry={e} fresh={fresh.has(e.id)} time={timeLabel(e.at, now, today)} onOpen={open} />)
  }

  return (
    <PopLayer
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
        maxHeight: 'min(600px, calc(100svh - env(safe-area-inset-top, 0px) - var(--bottom-nav-height, 0px) - 7rem))',
      }}
      className="animate-menu-pop fixed right-3 z-[9990] w-[360px] max-w-[calc(100vw-1.5rem)] flex flex-col rounded-[22px] md:rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] m-glass-thick overflow-hidden"
    >
      {/* Phones: frosted like the other mobile sheets, the header part of
          the glass rather than a gray strip. */}
      <div className="flex items-center gap-2 px-4 md:px-3 py-3 md:py-2.5 max-md:bg-transparent bg-[var(--surface-overlay)] border-b border-[var(--separator)] md:border-[var(--border)] shrink-0">
        <Bell size={13} className="hidden md:block text-[var(--accent)] shrink-0" />
        <span className="text-[var(--text-primary)] text-headline md:text-xs md:font-semibold md:tracking-normal flex-1">
          Notifications
          {newCount > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-medium">{newCount} new</span>}
        </span>
        {shown.length > 0 && (
          <button
            onClick={clearShown}
            title={active === 'all' ? 'Clear every notification' : `Clear ${KIND_LABEL[active].toLowerCase()} notifications`}
            className="text-body md:text-[10px] md:tracking-normal text-accent md:text-[var(--text-muted)] hover:text-[var(--text-primary)] max-md:active:opacity-60 transition-colors px-1 rounded"
          >
            Clear
          </button>
        )}
        <button onClick={close} aria-label="Close" className="max-md:w-[30px] max-md:h-[30px] max-md:rounded-full max-md:bg-[var(--fill)] max-md:flex max-md:items-center max-md:justify-center p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <X size={13} className="max-md:w-4 max-md:h-4" />
        </button>
      </div>
      {kinds.length > 1 && (
        <div className="flex gap-2 md:gap-1 px-4 md:px-3 py-2.5 md:py-2 border-b border-[var(--separator)] md:border-[var(--border)] overflow-x-auto no-scrollbar shrink-0">
          {(['all', ...kinds] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              aria-pressed={active === k}
              className={`h-8 md:h-auto px-3.5 md:px-2.5 md:py-1 rounded-full text-subhead md:text-[11px] md:tracking-normal font-medium whitespace-nowrap transition-colors ${
                active === k ? 'bg-text-primary text-surface md:bg-[var(--accent)] md:text-white' : 'bg-[var(--fill)] md:bg-surface-raised text-text-primary md:text-text-secondary hover:text-text-primary'
              }`}
            >
              {k === 'all' ? 'All' : KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {/* Kept mounted while empty, so the first arrival and the last removal
          still animate (useListMotion). */}
      <div ref={listRef} className="relative flex-1 min-h-0 overflow-y-auto pb-1">
        {rows.length > 0 ? rows : (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Bell size={22} className="text-[var(--text-muted)]" />
            <p className="text-[var(--text-primary)] text-headline md:text-sm md:font-medium md:tracking-normal">No notifications</p>
            <p className="text-[var(--text-muted)] text-footnote md:text-xs md:tracking-normal">Chat messages, news posts, announcements and app notices show up here after they pop up.</p>
          </div>
        )}
      </div>
    </PopLayer>
  )
}

function NotificationRow({ entry, fresh, time, onOpen }: {
  entry: NotificationEntry
  fresh: boolean
  time: string
  onOpen: (entry: NotificationEntry) => void
}): JSX.Element {
  // An entry with nowhere to go (an announcement, a toast) opens up in place
  // instead, for text the banner had to cut short.
  const [expanded, setExpanded] = useState(false)
  const textOnly = !entry.body
  const clamp = expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'
  return (
    <div
      data-flip-key={entry.id}
      {...clickable(() => (entry.target ? onOpen(entry) : setExpanded((x) => !x)))}
      title={entry.target ? undefined : expanded ? 'Show less' : 'Show all'}
      className="group relative flex items-start gap-2.5 pl-4 pr-3 py-2.5 cursor-pointer outline-none hover:bg-surface-raised focus-visible:bg-surface-raised max-md:active:bg-[var(--fill)] transition-colors"
    >
      {fresh && <span aria-label="New" className="absolute left-1.5 top-[1.15rem] w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />}
      <NotificationIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className={`min-w-0 flex-1 text-subhead md:text-sm md:tracking-normal text-text-primary break-words ${textOnly ? clamp : 'font-semibold truncate'}`}>
            {entry.title}
            {(entry.count ?? 1) > 1 && <span className="ml-1.5 text-[11px] font-medium text-text-muted">×{entry.count}</span>}
          </p>
          <span className="shrink-0 pt-0.5 text-footnote md:text-[11px] md:tracking-normal text-text-muted tabular-nums">{time}</span>
        </div>
        {entry.body && <p className={`text-footnote md:text-xs md:tracking-normal text-text-muted break-words ${clamp}`}>{entry.body}</p>}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); removeNotification(entry.id) }}
        aria-label="Remove"
        title="Remove"
        className="shrink-0 p-1 -m-1 rounded-md text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
      >
        <X size={13} />
      </button>
    </div>
  )
}

// How far a row has to be dragged, as a share of its width, for letting go to
// remove it rather than spring back.
const SWIPE_REMOVE = 0.35
const SWIPE_EASE = 'cubic-bezier(0.33, 0, 0.15, 1)'

/** A phone row: one slice of its day's grouped card. Dragged left it uncovers
 *  a red strip and, let go past SWIPE_REMOVE, slides off and is removed - the
 *  phone stand-in for the desktop row's hover X. */
function MobileNotificationRow({ entry, fresh, time, first, last, onOpen }: {
  entry: NotificationEntry
  fresh: boolean
  time: string
  first: boolean
  last: boolean
  onOpen: (entry: NotificationEntry) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; dx: number; horizontal: boolean | null } | null>(null)
  const swiped = useRef(false)
  // The red strip only exists mid-swipe, so it can't fringe the card's
  // rounded corners at rest.
  const [swiping, setSwiping] = useState(false)

  const settle = (to: number, done?: () => void): void => {
    const el = contentRef.current
    if (!el) return
    const from = el.style.transform || 'translateX(0px)'
    el.style.transform = `translateX(${to}px)`
    const anim = el.animate([{ transform: from }, { transform: `translateX(${to}px)` }], { duration: to === 0 ? 320 : 240, easing: SWIPE_EASE })
    if (done) anim.onfinish = done
  }

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, horizontal: null }
    swiped.current = false
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    const d = drag.current
    const el = contentRef.current
    if (!d || d.id !== e.pointerId || !el) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    // Decide once, on the first real movement, whether this is a swipe or the
    // page scrolling; a scroll never turns into a swipe halfway.
    if (d.horizontal === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      d.horizontal = Math.abs(dx) > Math.abs(dy) && dx < 0
      if (d.horizontal) { el.setPointerCapture(e.pointerId); setSwiping(true) }
    }
    if (!d.horizontal) return
    d.dx = Math.min(0, dx)
    swiped.current = true
    el.style.transform = `translateX(${d.dx}px)`
  }
  const onPointerEnd = (e: ReactPointerEvent): void => {
    const d = drag.current
    const el = contentRef.current
    drag.current = null
    if (!d || d.id !== e.pointerId || !el || !d.horizontal) return
    const width = el.offsetWidth
    if (e.type === 'pointerup' && -d.dx > width * SWIPE_REMOVE) settle(-width, () => removeNotification(entry.id))
    else settle(0, () => setSwiping(false))
  }

  const textOnly = !entry.body
  const clamp = expanded ? 'whitespace-pre-wrap' : 'line-clamp-3'
  const corners = `${first ? 'rounded-t-[20px]' : ''} ${last ? 'rounded-b-[20px]' : ''}`
  return (
    <div data-flip-key={entry.id} className={`relative mx-4 overflow-hidden ${corners}`}>
      {swiping && (
        <div aria-hidden className="absolute inset-0 flex items-center justify-end pr-6 bg-red-500 text-white">
          <Trash2 size={20} />
        </div>
      )}
      <div
        ref={contentRef}
        {...clickable(() => {
          if (swiped.current) { swiped.current = false; return }
          if (entry.target) onOpen(entry)
          else setExpanded((x) => !x)
        })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        style={{ touchAction: 'pan-y' }}
        className="relative flex items-start gap-3 pl-4 pr-4 py-3 bg-[var(--grouped)] outline-none cursor-pointer select-none active:bg-[color-mix(in_srgb,var(--text-primary)_9%,var(--grouped))] transition-colors"
      >
        {fresh && <span aria-label="New" className="absolute left-1.5 top-[1.6rem] w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />}
        <NotificationIcon entry={entry} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className={`min-w-0 flex-1 text-subhead text-text-primary break-words ${textOnly ? clamp : 'font-semibold truncate'}`}>
              {entry.title}
              {(entry.count ?? 1) > 1 && <span className="ml-1.5 text-footnote font-medium text-text-muted">×{entry.count}</span>}
            </p>
            <span className="shrink-0 text-footnote text-text-muted tabular-nums">{time}</span>
          </div>
          {entry.body && <p className={`mt-0.5 text-subhead text-text-secondary break-words ${clamp}`}>{entry.body}</p>}
          <p className="mt-1 text-caption1 text-text-muted">{KIND_LABEL[entry.kind]}</p>
        </div>
        {!last && <span aria-hidden className="absolute bottom-0 right-0 left-[4.25rem] h-[0.5px] bg-[var(--separator)]" />}
      </div>
    </div>
  )
}

function NotificationIcon({ entry, size = 32 }: { entry: NotificationEntry; size?: number }): JSX.Element {
  const [broken, setBroken] = useState(false)
  const box = { width: size, height: size }
  if (entry.icon && !broken) {
    return <img src={entry.icon} alt="" onError={() => setBroken(true)} style={box} className="rounded-full object-cover shrink-0 bg-surface-raised" />
  }
  const Icon = entry.kind === 'app' && entry.level === 'error' ? AlertCircle : KIND_ICON[entry.kind]
  return (
    <span style={box} className={`rounded-full shrink-0 flex items-center justify-center ${LEVEL_TINT[entry.level ?? 'info']}`}>
      <Icon size={Math.round(size * 0.47)} />
    </span>
  )
}
