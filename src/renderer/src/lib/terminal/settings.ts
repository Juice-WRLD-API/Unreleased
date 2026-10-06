import { useStore } from '../../store/useStore'
import { FONTS } from '../fonts'
import { allSkins } from '../skins'
import { HOME_SECTIONS, isHomeSectionVisible } from '../homeSections'
import {
  DEFAULT_NAV_CONTROL_ORDER, DEFAULT_NAV_CONTROL_VISIBILITY, DEFAULT_NAV_ORDER, DEFAULT_NAV_VISIBILITY,
  NAV_ITEMS, orderedNavControls, orderedNavItems,
} from '../navItems'
import type { ViewType } from '../../types'
import { DEFAULT_JWAPI_BASE, JWAPI_BASE, getServerOverride, getRouteRules, normalizePrefix, setRouteRules, setServerOverride } from '../apiServers'
import { fail, parseBool, pickByName, type TermCommand } from './types'

const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

interface Setting {
  key: string
  desc: string
  kind: 'bool' | 'number' | 'enum' | 'color'
  /** Number range, in the unit the user types. */
  min?: number
  max?: number
  unit?: string
  options?: () => { value: string; label: string }[]
  get: () => string | number | boolean | null
  set: (value: string | number | boolean | null) => void
}

const bool = (key: string, desc: string, get: () => boolean, set: (v: boolean) => void): Setting =>
  ({ key, desc, kind: 'bool', get, set: (v) => set(v as boolean) })

const num = (key: string, desc: string, min: number, max: number, get: () => number, set: (v: number) => void, unit = ''): Setting =>
  ({ key, desc, kind: 'number', min, max, unit, get, set: (v) => set(v as number) })

const choice = (key: string, desc: string, options: Setting['options'], get: () => string, set: (v: string) => void): Setting =>
  ({ key, desc, kind: 'enum', options, get, set: (v) => set(v as string) })

const color = (key: string, desc: string, get: () => string | null, set: (v: string | null) => void): Setting =>
  ({ key, desc, kind: 'color', get, set: (v) => set(v as string | null) })

// Everything in Settings that is a plain on/off, number, choice or colour. The
// values go through the same store setters the Settings screen uses, so they
// persist and sync to the account exactly the same way.
const SETTINGS: Setting[] = [
  choice('theme', 'Colour theme', () => allSkins().map((s) => ({ value: s.id, label: s.name })), () => st().theme, (v) => st().setTheme(v)),
  color('accent', 'Accent colour (#rrggbb)', () => st().accentColor, (v) => { if (v) st().setAccentColor(v) }),
  choice('sidebar', 'Where the navigation sits', () => ['left', 'right', 'top', 'bottom'].map((v) => ({ value: v, label: v })), () => st().sidebarPosition, (v) => st().setSidebarPosition(v as 'left' | 'right' | 'top' | 'bottom')),
  bool('auto-hide-nav', 'Hide the navigation until you reach for it', () => st().autoHideNav, (v) => st().setAutoHideNav(v)),
  bool('lyrics-override', 'Use your own lyrics colours over the theme', () => st().lyricsOverride, (v) => st().setLyricsOverride(v)),
  num('text-scale', 'App-wide text size', 0.75, 1.5, () => st().appTextScale, (v) => st().setAppTextScale(v), 'x'),
  choice('font', 'App font', () => FONTS.map((f) => ({ value: f.id, label: f.id })), () => st().appFont, (v) => st().setAppFont(v)),
  choice('lyrics-font', 'Lyrics font', () => FONTS.map((f) => ({ value: f.id, label: f.id })), () => st().lyricsFont, (v) => st().setLyricsFont(v)),
  num('lyrics-scale', 'Lyrics text size', 0.5, 2, () => st().lyricsScale, (v) => st().setLyricsScale(v), 'x'),
  choice('lyrics-align', 'Lyrics alignment', () => [{ value: 'left', label: 'left' }, { value: 'center', label: 'center' }], () => st().lyricsAlign, (v) => st().setLyricsAlign(v as 'left' | 'center')),
  bool('lyrics-blur', 'Blur the lines that are not playing', () => st().lyricsBlur, (v) => st().setLyricsBlur(v)),
  num('lyrics-blur-amount', 'How strong that blur is', 0, 3, () => st().lyricsBlurAmount, (v) => st().setLyricsBlurAmount(v), 'x'),
  num('lyrics-offset', 'Shift synced lyrics later (+) or earlier (-)', -10, 10, () => st().lyricsOffset, (v) => st().setLyricsOffset(v), 's'),
  color('lyrics-color-active', 'Colour of the line being sung (or auto)', () => st().lyricsColorActive, (v) => st().setLyricsColorActive(v)),
  color('lyrics-color-inactive', 'Colour of the other lines (or auto)', () => st().lyricsColorInactive, (v) => st().setLyricsColorInactive(v)),
  bool('gradients', 'Accent gradients on the shell', () => st().gradientsEnabled, (v) => st().setGradientsEnabled(v)),
  bool('surface-gradients', 'Gradients on small surfaces too', () => st().surfaceGradientsEnabled, (v) => st().setSurfaceGradientsEnabled(v)),
  bool('wrld-theme-bg', 'WRLD tab uses the theme instead of the cover', () => st().wrldThemeBackground, (v) => st().setWrldThemeBackground(v)),
  bool('full-era-names', 'Show full era names', () => st().fullEraNames, (v) => st().setFullEraNames(v)),
  bool('prefer-og', 'Play the OG version when one is linked', () => st().preferOgVersion, (v) => st().setPreferOgVersion(v)),
  bool('rotate-covers', 'Rotate suggested covers on each play', () => st().rotateSuggestedCovers, (v) => st().setRotateSuggestedCovers(v)),
  num('volume', 'Volume', 0, 100, () => Math.round(st().volume * 100), (v) => st().setVolume(v / 100), '%'),
  num('speed', 'Playback speed', 0.5, 2, () => st().playbackSpeed, (v) => st().setPlaybackSpeed(v), 'x'),
  bool('crossfade', 'Crossfade between tracks', () => st().crossfadeEnabled, (v) => st().setCrossfade(v, st().crossfadeDuration)),
  num('crossfade-seconds', 'Crossfade length', 1, 12, () => st().crossfadeDuration, (v) => st().setCrossfade(st().crossfadeEnabled, v), 's'),
  bool('pause-fade', 'Fade out on pause', () => st().pauseFadeEnabled, (v) => st().setPauseFade(v)),
  bool('skip-silence', 'Skip silence', () => st().skipSilence, (v) => st().setSkipSilence(v)),
  bool('eq', 'Equalizer on', () => st().eqEnabled, (v) => st().setEqEnabled(v)),
  bool('mono', 'Mono output', () => st().eqMono, (v) => st().setEqMono(v)),
  num('balance', 'Left/right balance', -100, 100, () => Math.round(st().eqBalance * 100), (v) => st().setEqBalance(v / 100)),
  num('boost', 'Volume boost', 100, 200, () => Math.round(st().eqBoost * 100), (v) => st().setEqBoost(v / 100), '%'),
  bool('reverb', 'Reverb on', () => st().reverbEnabled, (v) => st().setReverbEnabled(v)),
  num('reverb-mix', 'Reverb amount', 0, 100, () => Math.round(st().reverbMix * 100), (v) => st().setReverbMix(v / 100), '%'),
  num('reverb-decay', 'Reverb tail length', 1, 8, () => st().reverbDecay, (v) => st().setReverbDecay(v), 's'),
  bool('pitch-shift', 'Let pitch follow the speed', () => st().pitchShift, (v) => st().setPitchShift(v)),
  num('hotkey-seek', 'Seconds the skip shortcuts jump', 1, 120, () => st().hotkeySeekSeconds, (v) => st().setHotkeySeekSeconds(v), 's'),
  bool('global-hotkeys', 'OS-wide keyboard shortcuts (desktop app)', () => st().globalHotkeysEnabled, (v) => st().setGlobalHotkeysEnabled(v)),
  bool('media-overlay', 'Windows media overlay (desktop app)', () => st().mediaOverlayEnabled, (v) => st().setMediaOverlayEnabled(v)),
  bool('developer-mode', 'Developer tab in Settings', () => st().developerMode, (v) => st().setDeveloperMode(v)),
]

const show = (s: Setting): string => {
  const v = s.get()
  if (v === null || v === '') return 'auto'
  if (s.kind === 'bool') return v ? 'on' : 'off'
  if (s.kind === 'enum') {
    const label = s.options?.().find((o) => o.value === v)?.label
    return label && label !== v ? `${String(v)} (${label})` : String(v)
  }
  return `${v}${s.unit ?? ''}`
}

function describeRange(s: Setting): string {
  if (s.kind === 'bool') return 'on | off'
  if (s.kind === 'number') return `${s.min}-${s.max}${s.unit ?? ''}`
  if (s.kind === 'color') return '#rrggbb | auto'
  return (s.options?.() ?? []).map((o) => o.value).join(' | ')
}

function findSetting(key: string): Setting {
  const k = key.trim().toLowerCase().replace(/_/g, '-')
  return SETTINGS.find((s) => s.key === k) ?? pickByName(SETTINGS, (s) => s.key, k) ?? fail(`no setting "${key}" (try: settings)`)
}

function applySetting(s: Setting, raw: string): void {
  const value = raw.trim()
  if (s.kind === 'bool') {
    const b = value.toLowerCase() === 'toggle' ? !s.get() : parseBool(value)
    if (b === null) fail(`${s.key}: use on or off`)
    s.set(b)
  } else if (s.kind === 'number') {
    const n = Number(value.replace(/[x%s]$/i, ''))
    if (!Number.isFinite(n)) fail(`${s.key}: expected a number (${describeRange(s)})`)
    if (n < (s.min ?? -Infinity) || n > (s.max ?? Infinity)) fail(`${s.key}: out of range (${describeRange(s)})`)
    s.set(n)
  } else if (s.kind === 'color') {
    if (/^(auto|default|none)$/i.test(value)) {
      if (s.key === 'accent') fail('accent: give a colour like #7c5cff')
      s.set(null)
    } else if (/^#[0-9a-f]{6}$/i.test(value)) s.set(value.toLowerCase())
    else fail(`${s.key}: use a hex colour like #7c5cff${s.key === 'accent' ? '' : ' or auto'}`)
  } else {
    const options = s.options?.() ?? []
    const match = options.find((o) => o.value.toLowerCase() === value.toLowerCase())
      ?? pickByName(options, (o) => o.value, value) ?? pickByName(options, (o) => o.label, value)
    if (!match) fail(`${s.key}: choose one of ${describeRange(s)}`)
    s.set(match!.value)
  }
}

/** Settings whose key or description mentions `q` - for the terminal's lookup. */
export function searchSettings(q: string): { key: string; value: string; desc: string }[] {
  const needle = q.trim().toLowerCase()
  return SETTINGS.filter((s) => s.key.includes(needle) || s.desc.toLowerCase().includes(needle)).map((s) => ({ key: s.key, value: show(s), desc: s.desc }))
}

// The menu's tabs and bottom buttons share one namespace for the `nav` command
// (their ids never collide), so one verb set covers both.
interface NavEntry { id: string; label: string; kind: 'tab' | 'button'; visible: boolean }

function navEntries(): NavEntry[] {
  const s = st()
  const tabs = orderedNavItems(s.navOrder, true, true).map((i): NavEntry => ({
    id: i.view, label: i.label, kind: 'tab', visible: !!i.alwaysVisible || (s.navVisibility[i.view] ?? !i.defaultHidden),
  }))
  const buttons = orderedNavControls(s.navControlOrder).map((c): NavEntry => ({
    id: c.id, label: c.label, kind: 'button', visible: s.navControlVisibility[c.id] ?? !c.defaultHidden,
  }))
  return [...tabs, ...buttons]
}

function findNavEntry(name: string): NavEntry {
  const all = navEntries()
  const q = name.trim().toLowerCase()
  return all.find((e) => e.id === q) ?? pickByName(all, (e) => e.id, q) ?? pickByName(all, (e) => e.label, q) ?? fail(`no menu item "${name}" (try: nav)`)
}

function setNavVisible(e: NavEntry, visible: boolean): void {
  if (e.kind === 'tab') {
    if (NAV_ITEMS.find((i) => i.view === e.id)?.alwaysVisible && !visible) fail(`${e.label} can't be hidden`)
    st().setNavItemVisible(e.id as ViewType, visible)
  } else st().setNavControlVisible(e.id, visible)
}

function moveNavEntry(e: NavEntry, to: string): void {
  const s = st()
  const group = navEntries().filter((x) => x.kind === e.kind).map((x) => x.id)
  const from = group.indexOf(e.id)
  let index: number
  if (to === 'up') index = from - 1
  else if (to === 'down') index = from + 1
  else if (to === 'top' || to === 'first') index = 0
  else if (to === 'bottom' || to === 'last') index = group.length - 1
  else {
    const n = Number(to)
    if (!Number.isInteger(n) || n < 1 || n > group.length) fail(`position: up | down | top | bottom | 1-${group.length}`)
    index = n - 1
  }
  index = Math.max(0, Math.min(group.length - 1, index))
  group.splice(from, 1)
  group.splice(index, 0, e.id)
  if (e.kind === 'tab') s.setNavOrder(group as ViewType[])
  else s.setNavControlOrder(group)
}

const NAV_VERBS = ['show', 'hide', 'toggle', 'move', 'reset']

// `api`: Settings > About's server override and route rules. The setters
// reload the page (every API module reads its base at import time), so the
// message goes up first and the change follows a moment later.
const API_SUBS = ['set', 'reset', 'rule', 'unrule']

function isHttpUrl(s: string): boolean {
  try {
    const { protocol } = new URL(s)
    return protocol === 'https:' || protocol === 'http:'
  } catch { return false }
}

const reloadAfter = (apply: () => void): void => { setTimeout(apply, 500) }

export const SETTINGS_COMMANDS: TermCommand[] = [
  {
    name: 'nav', aliases: ['menu', 'navbar'], group: 'Settings', usage: 'nav [show|hide|toggle <item> | move <item> <up|down|top|bottom|n> | reset]',
    description: 'List the menu items and bottom buttons, show or hide them, reorder them, or reset to the defaults (same as Settings > Menu items)',
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return NAV_VERBS.filter((v) => v.startsWith(p))
      const verb = before[0].toLowerCase()
      if (before.length === 1 && ['show', 'hide', 'toggle', 'move'].includes(verb)) return navEntries().map((e) => e.id).filter((id) => id.startsWith(p))
      if (before.length === 2 && verb === 'move') return ['up', 'down', 'top', 'bottom'].filter((v) => v.startsWith(p))
      return []
    },
    run: (args, ctx) => {
      const [verb, ...rest] = args.trim().split(/\s+/).filter(Boolean)
      if (!verb) {
        const rows = navEntries()
        const line = (e: NavEntry, i: number): string => `${String(i + 1).padStart(2)}  ${e.id.padEnd(16)}${e.label.padEnd(16)}${e.visible ? 'shown' : 'hidden'}`
        ctx.print(`Menu tabs\n${rows.filter((e) => e.kind === 'tab').map(line).join('\n')}\n\nBottom buttons\n${rows.filter((e) => e.kind === 'button').map(line).join('\n')}`)
        return
      }
      const v = verb.toLowerCase()
      if (v === 'reset') {
        const s = st()
        s.setNavOrder(DEFAULT_NAV_ORDER)
        s.setNavControlOrder(DEFAULT_NAV_CONTROL_ORDER)
        for (const [id, on] of Object.entries(DEFAULT_NAV_VISIBILITY)) s.setNavItemVisible(id as ViewType, on)
        for (const [id, on] of Object.entries(DEFAULT_NAV_CONTROL_VISIBILITY)) s.setNavControlVisible(id, on)
        ctx.print('menu reset to the defaults', 'ok')
        return
      }
      if (!NAV_VERBS.includes(v)) fail(`unknown option "${verb}" (show, hide, toggle, move, reset)`)
      if (rest.length === 0) fail(`usage: nav ${v} <item>${v === 'move' ? ' <up|down|top|bottom|n>' : ''}`)
      if (v === 'move') {
        if (rest.length < 2) fail('usage: nav move <item> <up|down|top|bottom|n>')
        const e = findNavEntry(rest.slice(0, -1).join(' '))
        moveNavEntry(e, rest[rest.length - 1].toLowerCase())
        const group = navEntries().filter((x) => x.kind === e.kind)
        ctx.print(`${e.label} is now #${group.findIndex((x) => x.id === e.id) + 1} of ${group.length}`, 'ok')
        return
      }
      const e = findNavEntry(rest.join(' '))
      setNavVisible(e, v === 'toggle' ? !e.visible : v === 'show')
      ctx.print(`${e.label}: ${findNavEntry(e.id).visible ? 'shown' : 'hidden'}`, 'ok')
    },
  },
  {
    name: 'home-sections', aliases: ['homesections'], group: 'Settings', usage: 'home-sections [show|hide|toggle <section>]',
    description: 'List the Home screen sections or show/hide one (same as Settings > Home screen)',
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return ['show', 'hide', 'toggle'].filter((v) => v.startsWith(p))
      return before.length === 1 ? HOME_SECTIONS.map((x) => x.id).filter((id) => id.startsWith(p)) : []
    },
    run: (args, ctx) => {
      const [verb, ...rest] = args.trim().split(/\s+/).filter(Boolean)
      const vis = (id: string): boolean => isHomeSectionVisible(id, st().homeSectionVisibility)
      if (!verb) {
        ctx.print(HOME_SECTIONS.map((x) => `${x.id.padEnd(12)}${x.label.padEnd(24)}${vis(x.id) ? 'shown' : 'hidden'}`).join('\n'))
        return
      }
      const v = verb.toLowerCase()
      if (!['show', 'hide', 'toggle'].includes(v) || rest.length === 0) fail('usage: home-sections [show|hide|toggle <section>]')
      const name = rest.join(' ')
      const section = HOME_SECTIONS.find((x) => x.id === name.toLowerCase()) ?? pickByName(HOME_SECTIONS, (x) => x.id, name) ?? pickByName(HOME_SECTIONS, (x) => x.label, name) ?? fail(`no section "${name}" (try: home-sections)`)
      st().setHomeSectionVisible(section.id, v === 'toggle' ? !vis(section.id) : v === 'show')
      ctx.print(`${section.label}: ${vis(section.id) ? 'shown' : 'hidden'}`, 'ok')
    },
  },
  {
    name: 'api', group: 'Settings', usage: 'api [set <url> | reset | rule <prefix> <url> | unrule <prefix>]',
    description: 'Show or change the API base, and route path prefixes (/cdn, /chat…) to other servers (same as Settings > About). A change reloads the page',
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return API_SUBS.filter((v) => v.startsWith(p))
      return before.length === 1 && before[0].toLowerCase() === 'unrule' ? getRouteRules().map((r) => r.prefix).filter((x) => x.startsWith(p)) : []
    },
    run: (args, ctx) => {
      const [sub = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
      const verb = sub.toLowerCase()
      if (!verb || verb === 'show') {
        const rules = getRouteRules()
        const how = getServerOverride() ? '' : ' (default)'
        ctx.print(`API ${JWAPI_BASE}${how}${rules.length ? `\n${rules.map((r) => `  ${r.prefix.padEnd(14)} -> ${r.base}`).join('\n')}` : '\nno route rules'}`)
        return
      }
      if (verb === 'set') {
        const url = (rest[0] ?? '').trim().replace(/\/+$/, '')
        if (!isHttpUrl(url)) fail('usage: api set <url>  (a full http(s) address, e.g. https://staging.example.com/juicewrld)')
        ctx.print(`API base -> ${url} - reloading…`, 'ok')
        reloadAfter(() => setServerOverride(url))
        return
      }
      if (verb === 'reset') {
        if (!getServerOverride() && getRouteRules().length === 0) { ctx.print(`already on the default (${DEFAULT_JWAPI_BASE})`, 'dim'); return }
        ctx.print('API base and route rules cleared - reloading…', 'ok')
        reloadAfter(() => { setRouteRules([]); setServerOverride(null) })
        return
      }
      if (verb === 'rule') {
        const prefix = normalizePrefix(rest[0] ?? '')
        const base = (rest[1] ?? '').trim().replace(/\/+$/, '')
        if (!prefix || !isHttpUrl(base)) fail('usage: api rule <prefix> <url>  (e.g. api rule /cdn https://cdn.example.com/juicewrld)')
        ctx.print(`${prefix} -> ${base} - reloading…`, 'ok')
        reloadAfter(() => setRouteRules([...getRouteRules().filter((r) => r.prefix !== prefix), { prefix, base }]))
        return
      }
      if (verb === 'unrule') {
        const prefix = normalizePrefix(rest[0] ?? '')
        if (!getRouteRules().some((r) => r.prefix === prefix)) fail(`unrule: ${prefix || '?'}: no such rule (api lists them)`)
        ctx.print(`removed rule ${prefix} - reloading…`, 'ok')
        reloadAfter(() => setRouteRules(getRouteRules().filter((r) => r.prefix !== prefix)))
        return
      }
      fail('usage: api [set <url> | reset | rule <prefix> <url> | unrule <prefix>]')
    },
  },
  {
    name: 'settings', group: 'Settings', usage: 'settings [filter]', description: 'List every setting you can change here with its current value',
    run: (args, ctx) => {
      const q = args.trim().toLowerCase()
      const rows = SETTINGS.filter((s) => !q || s.key.includes(q) || s.desc.toLowerCase().includes(q))
      if (rows.length === 0) { ctx.print(`no settings match "${args.trim()}"`, 'dim'); return }
      ctx.print(rows.map((s) => `${s.key.padEnd(23)}${show(s).padEnd(16)}${s.desc}`).join('\n'))
    },
  },
  {
    name: 'set', aliases: ['config'], group: 'Settings', usage: 'set <setting> [value]',
    description: 'Show or change a setting (same as the Settings screen). "set <setting>" shows its value and choices; "settings" lists them all',
    complete: (before, partial) => {
      if (before.length === 0) return SETTINGS.map((s) => s.key).filter((k) => k.startsWith(partial.toLowerCase()))
      if (before.length === 1) {
        const s = SETTINGS.find((x) => x.key === before[0].toLowerCase())
        if (!s) return []
        const options = s.kind === 'bool' ? ['on', 'off', 'toggle'] : s.kind === 'enum' ? (s.options?.() ?? []).map((o) => o.value) : s.kind === 'color' && s.key !== 'accent' ? ['auto'] : []
        return options.filter((o) => o.toLowerCase().startsWith(partial.toLowerCase()))
      }
      return []
    },
    run: (args, ctx) => {
      const [key, ...rest] = args.trim().split(/\s+/)
      if (!key) fail('usage: set <setting> [value]  (settings lists them)')
      const setting = findSetting(key)
      if (rest.length === 0) { ctx.print(`${setting.key} = ${show(setting)}\n  ${setting.desc} · ${describeRange(setting)}`); return }
      applySetting(setting, rest.join(' '))
      ctx.print(`${setting.key} = ${show(setting)}`, 'ok')
    },
  },
]
