import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Download, MoreHorizontal, Search, User } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { dashboardSwap } from '../lib/dashboardSwap'
import * as userApi from '../lib/userApi'
import { filterListeningPlaysByDays } from '../lib/listeningPlays'
import { allTimePrefs } from '../lib/listeningStats'
import { apiFetch, apiPeek, type JWApiStats } from '../lib/juicewrldApi'
import { isHomeSectionVisible } from '../lib/homeSections'
import { orderedNavItems, isNavItemVisible } from '../lib/navItems'
import { AnchoredContextMenu } from './ContextMenu'
import type { ViewType } from '../types'

// Home's top line - greeting, the staff dashboard button, search, more, and
// "Your listening" folded in as numbers. The staff dashboards show it too, in
// the same spot, so it stays put while the widgets below swipe between the
// two (lib/dashboardSwap.ts). That is also why it has no data-swap.

// `{n}` is where ", <name>" goes; it is dropped when signed out.
type Period = 'night' | 'morning' | 'afternoon' | 'evening'

const CLASSIC: Record<Period, string> = {
  night: 'Up late{n}',
  morning: 'Good morning{n}',
  afternoon: 'Good afternoon{n}',
  evening: 'Good evening{n}',
}

const QUIRKY: Record<Period, string[]> = {
  night: [
    'Still awake{n}?',
    'Night owl hours{n}',
    'Can\'t sleep either{n}?',
    'The vault never closes{n}',
    '3am listening session{n}',
    'Go to bed{n}. Okay, one more song',
    'Your alarm is going to hate you{n}',
    'Sleep is for people without snippets{n}',
    'Just one more song{n}, right?',
    'Bold of you to be awake{n}',
  ],
  morning: [
    'Rise and grind{n}',
    'Coffee and unreleased{n}',
    'Morning{n}, press play',
    'Early bird gets the leaks{n}',
    'Up before the leakers{n}',
    'Did you even brush your teeth{n}?',
    'Breakfast of champions{n}: unreleased',
    'Five more minutes{n}? Nah, press play',
  ],
  afternoon: [
    'Afternoon spin{n}?',
    'Lunch break listening{n}',
    'Midday session{n}',
    'Shouldn\'t you be working{n}?',
    'Your boss can\'t hear this{n}',
    'Cure for the post-lunch slump{n}',
    'Productivity is overrated{n}',
  ],
  evening: [
    'Evening session{n}',
    'Golden hour{n}',
    'Winding down{n}?',
    'Dinner can wait{n}',
    'Main character hours{n}',
    'Tonight\'s forecast: 100% Juice{n}',
  ],
}

const ANYTIME = [
  'Welcome back{n}',
  'What\'s good{n}',
  'Back in the vault{n}',
  'Pull up{n}',
  '999{n}',
  'What are we playing{n}?',
  'Legends never die{n}',
  'Queue something up{n}',
  'Headphones on{n}',
  'Has it leaked yet{n}? Probably not',
  'Refreshing for leaks again{n}?',
  'We checked{n}, no new leaks',
  'Snippet hunting{n}?',
  'How\'s the groupbuy fund{n}?',
  'Your queue missed you{n}',
  'The skip button is feeling lonely{n}',
  'Touch grass later{n}',
  'Certified vault dweller{n}',
  'Running on 999% vibes{n}',
  'Back again{n}? Respect',
  'Oh, it\'s you{n}! Good',
  'Volume up{n}. Sorry, neighbors',
  'Ears ready{n}?',
  'Someone hit shuffle{n}',
  'Hackin your hood{n}',
]

function periodNow(): Period {
  const h = new Date().getHours()
  if (h < 5) return 'night'
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}

// A new line each time Home opens (the view remounts on every visit). The
// staff dashboards and a swipe back from one keep the current line, since the
// top line is meant to stay put while the widgets swap (lib/dashboardSwap.ts).
let picked: { period: Period; line: string } | null = null

function pickGreeting(): void {
  const period = periodNow()
  const pool = [...QUIRKY[period], ...ANYTIME].filter((l) => l !== picked?.line)
  const line = Math.random() < 0.25 && picked?.line !== CLASSIC[period]
    ? CLASSIC[period]
    : pool[Math.floor(Math.random() * pool.length)]
  picked = { period, line }
}

function greeting(name: string | undefined): string {
  if (picked?.period !== periodNow()) pickGreeting()
  return picked!.line.replace('{n}', name ? `, ${name}` : '')
}

function Stat({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <span className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-text-primary text-base font-bold tabular-nums">{value}</span>
      <span className="text-text-muted text-xs truncate">{label}</span>
    </span>
  )
}

// Lists the nav destinations that ship off by default (Liked Songs, API
// Docs - see `defaultHidden` in navItems.tsx): still one click away without
// having to turn them on in Settings first. Download app always goes last:
// the desktop side menu never shows it.
function MoreMenu({ anchorRef, onClose, items, onSelect }: {
  anchorRef: React.RefObject<HTMLElement>
  onClose: () => void
  items: { view: ViewType; label: string; icon: React.ReactNode }[]
  onSelect: (view: ViewType) => void
}): JSX.Element {
  return (
    <AnchoredContextMenu
      anchorRef={anchorRef}
      onClose={onClose}
      className="min-w-[190px]"
      items={items.map((item) => ({ label: item.label, icon: navMenuIcon(item.view, item.icon), onSelect: () => onSelect(item.view) }))}
      body={items.length === 0 ? <p className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">Nothing else to show</p> : undefined}
    />
  )
}

// The nav registry's icons are elements sized for the side menu; the menu
// wants a component it sizes and tints itself. One per view, so a row's icon
// keeps its identity across renders.
const navMenuIcons = new Map<ViewType, React.ElementType>()
function navMenuIcon(view: ViewType, node: React.ReactNode): React.ElementType {
  let icon = navMenuIcons.get(view)
  if (!icon) {
    icon = function NavMenuIcon({ className = '' }: { className?: string }): JSX.Element {
      return <span className={`flex items-center justify-center [&_svg]:w-3.5 [&_svg]:h-3.5 ${className}`}>{node}</span>
    }
    navMenuIcons.set(view, icon)
  }
  return icon
}

/** `on` is the page showing it: on a staff dashboard the staff button reads
 *  as the current tab and takes you back to Home. */
export default function HomeHero({ on }: { on: 'home' | 'staff' }): JSX.Element {
  const {
    account, setActiveView, openProfile, openOwnPublicProfile, homeSectionVisibility,
    listeningPlays, songPrefs, navOrder, navVisibility,
  } = useStorePick(
    'account', 'setActiveView', 'openProfile', 'openOwnPublicProfile', 'homeSectionVisibility',
    'listeningPlays', 'songPrefs', 'navOrder', 'navVisibility',
  )
  // Runs once per mount, before the first render reads the line.
  useState(() => {
    if (on === 'home' && dashboardSwap(useStore.getState().previousView, 'home') === 0) pickGreeting()
    return null
  })
  const [showMore, setShowMore] = useState(false)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const moreItems: { view: ViewType; label: string; icon: React.ReactNode }[] = [
    ...orderedNavItems(navOrder).filter((i) => i.defaultHidden && !isNavItemVisible(i, navVisibility, false)),
    { view: 'download', label: 'Download app', icon: <Download size={18} /> },
  ]
  const showListening = isHomeSectionVisible('listening', homeSectionVisibility)

  // All-time totals come off songPrefs' aggregate counts - the log is capped,
  // so its length alone stalls at SERVER_LISTENING_PLAYS_LIMIT.
  const allTime = useMemo(() => allTimePrefs(listeningPlays, songPrefs), [listeningPlays, songPrefs])
  const totalPlays = useMemo(() => allTime.reduce((n, p) => n + p.playcount, 0), [allTime])
  const distinctSongs = allTime.length
  const weekPlays = useMemo(() => filterListeningPlaysByDays(listeningPlays, 7).length, [listeningPlays])

  // Site-wide catalog totals (GET /stats/). Stale-while-revalidate:
  // ApiTrackerView already warms this exact cache key, so most visits paint
  // it instantly from there.
  const [siteStats, setSiteStats] = useState<JWApiStats | null>(() => apiPeek<JWApiStats>('/stats/') ?? null)
  useEffect(() => {
    apiFetch<JWApiStats>('/stats/').then(setSiteStats).catch(() => undefined)
  }, [])

  return (
    <div data-swap-keep className="shrink-0 flex items-center gap-3.5 flex-wrap">
      <button
        onClick={openOwnPublicProfile}
        aria-label="Your public profile"
        className="w-11 h-11 shrink-0 rounded-full overflow-hidden bg-[var(--surface-overlay)] flex items-center justify-center text-text-muted hover:bg-surface-highest transition-colors"
      >
        {account?.avatar
          ? <img src={account.avatar} alt="" className="w-full h-full object-cover" />
          : <User size={19} />}
      </button>
      <h1 className="text-text-primary text-xl font-bold leading-tight truncate min-w-0">
        {greeting(account?.display_name)}
      </h1>
      {account && userApi.showStaffProfile(account) && (
        <button
          onClick={on === 'staff' ? () => setActiveView('home') : openProfile}
          aria-pressed={on === 'staff'}
          title={on === 'staff' ? 'Back to Home' : undefined}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold transition-colors ${
            on === 'staff'
              ? 'bg-accent/20 text-accent hover:bg-accent/30'
              : 'bg-surface-raised hover:bg-surface-highest text-text-secondary hover:text-text-primary'
          }`}
        >
          {userApi.staffProfileLabel(account)}
        </button>
      )}
      <button
        onClick={() => setActiveView('api-tracker')}
        aria-label="Search the catalog"
        title="Search the catalog"
        className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors"
      >
        <Search size={17} />
      </button>
      <div className="relative shrink-0">
        <button
          ref={moreBtnRef}
          onClick={() => setShowMore((v) => !v)}
          aria-label="More"
          title="More"
          className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors"
        >
          <MoreHorizontal size={19} />
        </button>
        {showMore && (
          <MoreMenu
            anchorRef={moreBtnRef}
            onClose={() => setShowMore(false)}
            items={moreItems}
            onSelect={setActiveView}
          />
        )}
      </div>
      {showListening && (
        <div className="ml-auto flex items-center gap-4 min-w-0">
          {totalPlays === 0 ? (
            <span className="text-text-muted text-xs truncate">Play something and your stats will show up here.</span>
          ) : (
            <>
              <Stat value={totalPlays.toLocaleString()} label={totalPlays === 1 ? 'play' : 'plays'} />
              <Stat value={distinctSongs.toLocaleString()} label={distinctSongs === 1 ? 'song' : 'songs'} />
              <Stat value={weekPlays.toLocaleString()} label="this week" />
            </>
          )}
          {siteStats && (
            <>
              <div className="w-px h-6 bg-[var(--border)] shrink-0" />
              <button
                onClick={() => setActiveView('statistics')}
                title="Catalog statistics"
                className="rounded-lg -mx-1 px-1 hover:bg-[var(--surface-overlay)] transition-colors"
              >
                <Stat value={siteStats.total_songs.toLocaleString()} label="in the catalog" />
              </button>
            </>
          )}
          <button
            onClick={() => setActiveView('stats')}
            className="flex items-center gap-0.5 px-2.5 py-1 rounded-lg text-text-muted text-xs font-semibold hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors shrink-0"
          >
            Wrapped<ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
