import { relativeTime } from '../../components/adminShared'
import {
  getThanksAdmin, getThanksPage, resetThanksPage, resolveThanks, saveThanksPage, THANKS_DEFAULT, THANKS_ICONS,
  type ThanksAdminPayload, type ThanksIcon, type ThanksPageContent, type ThanksSection,
} from '../thanksApi'
import { useStore } from '../../store/useStore'
import { asJson, confirmAction, fail, parseArgs, type TermCommand, type TermCtx } from './types'

// The Thank you page, as the Admin -> Thank you tab edits it. Every change
// reads the server's page, changes it and saves the whole page back (PUT
// replaces it). Before anything is saved the page is the built-in one, so the
// first edit starts from that. Sections are named by number (from `thanks`)
// or by title; text goes after ` -- `.

const USAGE = [
  'thanks [--json]',
  'thanks public [--json]',
  'thanks add <section> -- <name>[, <name>...]',
  'thanks rm <section> -- <name>',
  'thanks set <title|intro|footnote> -- <text>   (empty text uses the built-in wording)',
  'thanks section add [--icon <icon>] -- <title>',
  'thanks section rm <section>',
  'thanks section rename <section> -- <title>',
  'thanks section icon <section> <icon>',
  'thanks section move <section> <position>',
  'thanks reset [-y]',
  'thanks open',
].join('\n  ')

function current(s: ThanksAdminPayload): ThanksPageContent {
  const base = s.configured ? s : THANKS_DEFAULT
  return { title: base.title, intro: base.intro, footnote: base.footnote, sections: base.sections.map((x) => ({ ...x, names: [...x.names] })) }
}

function findSection(sections: ThanksSection[], word: string | undefined): number {
  if (!word) return fail(`usage:\n  ${USAGE}`)
  const n = Number(word)
  if (Number.isInteger(n) && n >= 1 && n <= sections.length) return n - 1
  const i = sections.findIndex((s) => s.title.toLowerCase() === word.toLowerCase())
  if (i < 0) fail(`no section "${word}" (${sections.map((s, j) => `${j + 1} ${s.title || '(untitled)'}`).join(', ') || 'none'})`)
  return i
}

function iconArg(word: string | undefined): ThanksIcon {
  const icon = (word ?? '').toLowerCase()
  const value = icon === 'none' ? '' : icon
  if (!(THANKS_ICONS as readonly string[]).includes(value)) fail(`icon is one of: none, ${THANKS_ICONS.filter(Boolean).join(', ')}`)
  return value as ThanksIcon
}

function print(ctx: TermCtx, page: ThanksPageContent, note: string): void {
  ctx.print(page.title || THANKS_DEFAULT.title, 'plain')
  ctx.print(page.intro || THANKS_DEFAULT.intro, 'dim')
  page.sections.forEach((s, i) => {
    ctx.print(`${i + 1}. ${s.title || '(untitled)'}${s.icon ? `  [${s.icon}]` : ''}  · ${s.names.length} name${s.names.length === 1 ? '' : 's'}`, 'plain')
    if (s.names.length) ctx.print(`   ${s.names.join(', ')}`, 'dim')
  })
  ctx.print(`footnote: ${page.footnote || THANKS_DEFAULT.footnote}`, 'dim')
  ctx.print(note, 'dim')
}

export const THANKS_COMMANDS: TermCommand[] = [
  {
    name: 'thanks', group: 'Admin', usage: 'thanks [public | add | rm | set | section | reset | open] ...',
    description: 'The Thank you page: its lists (donors, developers, any others), heading and text. Changes show on every player the next time the page opens',
    covers: ['thanksApi.getThanksAdmin', 'thanksApi.getThanksPage', 'thanksApi.saveThanksPage', 'thanksApi.resetThanksPage'],
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return ['public', 'add', 'rm', 'set', 'section', 'reset', 'open'].filter((v) => v.startsWith(p))
      if (before[0] === 'set' && before.length === 1) return ['title', 'intro', 'footnote'].filter((v) => v.startsWith(p))
      if (before[0] === 'section' && before.length === 1) return ['add', 'rm', 'rename', 'icon', 'move'].filter((v) => v.startsWith(p))
      if (before[0] === 'section' && before[1] === 'icon' && before.length === 3) return ['none', ...THANKS_ICONS.filter(Boolean)].filter((v) => v.startsWith(p))
      return []
    },
    run: async (args, ctx) => {
      const dash = args.split(/\s+--(?:\s+|$)/)
      const { rest, bool, value } = parseArgs(dash[0], ['icon'])
      const text = dash.slice(1).join(' -- ').trim()
      const hasText = dash.length > 1
      const sub = (rest.shift() ?? '').toLowerCase()

      if (sub === 'open') { useStore.getState().setActiveView('thanks'); ctx.print('opened the Thank you page', 'ok'); return }
      if (sub === 'public') {
        const p = await getThanksPage(ctx.signal)
        if (asJson(ctx, bool.has('json'), p)) return
        print(ctx, resolveThanks(p), p.configured ? 'what players see (from the server)' : 'the server has no page yet; players show the built-in one')
        return
      }
      if (sub === 'reset') {
        if (!confirmAction(ctx, 'Remove the saved Thank you page? Players go back to the built-in page.', bool.has('y'))) return
        await resetThanksPage()
        ctx.print('reset: players show the built-in Thank you page', 'ok')
        return
      }

      const s = await getThanksAdmin(ctx.signal)
      if (!sub) {
        if (asJson(ctx, bool.has('json'), s)) return
        print(ctx, current(s), s.configured
          ? `saved${s.updated_by ? ` by ${s.updated_by}` : ''}${s.updated_at ? ` ${relativeTime(s.updated_at)}` : ''}`
          : 'not saved yet: this is the built-in page; the first change saves it to the server')
        return
      }

      const page = current(s)
      let done = ''
      if (sub === 'add' || sub === 'rm') {
        const i = findSection(page.sections, rest[0])
        if (!text) fail(`usage: thanks ${sub} <section> -- <name>`)
        const section = page.sections[i]
        if (sub === 'add') {
          const names = text.split(',').map((n) => n.trim()).filter((n) => n && !section.names.includes(n))
          if (!names.length) fail('already listed')
          section.names.push(...names)
          done = `added ${names.join(', ')} to ${section.title || `section ${i + 1}`}`
        } else {
          const j = section.names.findIndex((n) => n.toLowerCase() === text.toLowerCase())
          if (j < 0) fail(`"${text}" is not in ${section.title || `section ${i + 1}`}`)
          done = `removed ${section.names.splice(j, 1)[0]} from ${section.title || `section ${i + 1}`}`
        }
      } else if (sub === 'set') {
        const field = (rest[0] ?? '').toLowerCase()
        if (field !== 'title' && field !== 'intro' && field !== 'footnote') fail('usage: thanks set <title|intro|footnote> -- <text>')
        if (!hasText) fail(`usage: thanks set ${field} -- <text>`)
        page[field as 'title' | 'intro' | 'footnote'] = text
        done = text ? `${field} set` : `${field} back to the built-in wording`
      } else if (sub === 'section') {
        const op = (rest.shift() ?? '').toLowerCase()
        if (op === 'add') {
          if (page.sections.length >= 20) fail('at most 20 sections')
          page.sections.push({ title: text, icon: iconArg(value.get('icon') ?? 'none'), names: [] })
          done = `added section ${page.sections.length}${text ? ` ${text}` : ''}`
        } else if (op === 'rm') {
          const i = findSection(page.sections, rest[0])
          const [gone] = page.sections.splice(i, 1)
          if (gone.names.length && !confirmAction(ctx, `Remove "${gone.title || `section ${i + 1}`}" and its ${gone.names.length} names?`, bool.has('y'))) return
          done = `removed ${gone.title || `section ${i + 1}`}`
        } else if (op === 'rename') {
          const i = findSection(page.sections, rest[0])
          if (!hasText) fail('usage: thanks section rename <section> -- <title>')
          page.sections[i].title = text
          done = `section ${i + 1} renamed`
        } else if (op === 'icon') {
          const i = findSection(page.sections, rest[0])
          page.sections[i].icon = iconArg(rest[1])
          done = `section ${i + 1} icon set`
        } else if (op === 'move') {
          const i = findSection(page.sections, rest[0])
          const to = Number(rest[1])
          if (!Number.isInteger(to) || to < 1 || to > page.sections.length) fail(`usage: thanks section move <section> <1-${page.sections.length}>`)
          page.sections.splice(to - 1, 0, ...page.sections.splice(i, 1))
          done = `moved to position ${to}`
        } else fail(`usage:\n  ${USAGE}`)
      } else fail(`usage:\n  ${USAGE}`)

      const saved = await saveThanksPage(page)
      if (asJson(ctx, bool.has('json'), saved)) return
      ctx.print(done, 'ok')
    },
  },
]
