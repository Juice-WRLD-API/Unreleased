import { relativeTime } from '../../components/adminShared'
import {
  createChannel, createNewsItem, deleteChannel, deleteNewsItem, fetchChannels, fetchNews, fetchNewsItem, updateChannel, updateNewsItem,
  uploadAttachment, type NewsAttachment, type NewsItemInput, type NewsSort,
} from '../newsApi'
import { getSubscriptions, setSubscribed } from '../newsNotifications'
import { compressImageFile } from '../userApi'
import { pickLocalFile } from './pick'
import { asJson, confirmAction, fail, idArg, oneLine, parseArgs, parseBool, table, type TermCommand } from './types'

// The News page: reading the feed, posting (editors), managing channels
// (admins) and which channels you get notified about.
const SUBS = ['ls', 'show', 'post', 'edit', 'rm', 'upload', 'channels', 'subscribe', 'unsubscribe']

const flag = (v: string | undefined): boolean | undefined => (v === undefined ? undefined : parseBool(v) ?? fail(`expected on or off, got "${v}"`))

export const NEWS_COMMANDS: TermCommand[] = [
  {
    name: 'news', group: 'Content',
    usage: 'news [ls [channel]] · show <id> · post <channel> --title t --body "…" [--summary s] [--category c] [--featured on|off] [--cover] [--attach] · edit <id> [--title …] · rm <id> · upload · channels [new <label> | edit <id> | rm <id>] · subscribe|unsubscribe <channel>',
    description: 'The news feed: read it, post to it (editors), manage its channels (admins) and subscribe to channels for notifications. --cover and --attach open a file picker',
    covers: [
      'newsApi.fetchNews', 'newsApi.fetchNewsItem', 'newsApi.createNewsItem', 'newsApi.updateNewsItem', 'newsApi.deleteNewsItem', 'newsApi.uploadAttachment',
      'newsApi.fetchChannels', 'newsApi.createChannel', 'newsApi.updateChannel', 'newsApi.deleteChannel',
      'newsNotifications.setSubscribed', 'newsNotifications.pushSubscriptions', 'userApi.compressImageFile',
    ],
    complete: async (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return SUBS.filter((s) => s.startsWith(p))
      if (['ls', 'post', 'subscribe', 'unsubscribe'].includes(before[0]) && before.length === 1) {
        try { return (await fetchChannels()).map((c) => c.id).filter((c) => c.startsWith(p)) } catch { return [] }
      }
      return []
    },
    run: async (args, ctx) => {
      const { rest, bool, value } = parseArgs(args, ['title', 'body', 'summary', 'category', 'featured', 'channel', 'page', 'sort', 'label', 'desc'])
      const first = (rest[0] ?? 'ls').toLowerCase()
      const sub = SUBS.includes(first) ? (rest.shift(), first) : 'ls'

      if (sub === 'ls') {
        const sort = (value.get('sort') ?? 'newest') as NewsSort
        const page = await fetchNews({ channel: rest[0] ?? value.get('channel'), sort, page: Number(value.get('page')) || undefined })
        if (asJson(ctx, bool.has('json'), page)) return
        if (page.results.length === 0) { ctx.print('nothing posted yet', 'dim'); return }
        ctx.print(`${table(page.results.map((n) => [`#${n.id}`, n.featured ? '★' : ' ', n.channel, n.title, n.author ?? '', relativeTime(n.published_at)]))}\n${page.results.length} of ${page.count}${page.next ? ' · --page N for more' : ''}`)
      } else if (sub === 'show') {
        const n = await fetchNewsItem(idArg(rest[0], 'news show <id>'))
        if (asJson(ctx, bool.has('json'), n)) return
        ctx.print([
          `${n.title}  (#${n.id}, ${n.channel}${n.category ? `, ${n.category}` : ''})`,
          `${n.author ?? 'unknown'} · ${relativeTime(n.published_at)}`,
          '', n.body,
          ...(n.attachments.length ? ['', ...n.attachments.map((a) => `attachment: ${a.name}  ${a.url}`)] : []),
        ].join('\n'))
      } else if (sub === 'post' || sub === 'edit') {
        const editing = sub === 'edit'
        const id = editing ? idArg(rest[0], 'news edit <id> [--title …] [--body …]') : 0
        const channel = editing ? value.get('channel') : rest[0] ?? value.get('channel')
        if (!editing && !channel) fail('usage: news post <channel> --title t --body "…"')
        const input: Partial<NewsItemInput> = {}
        if (channel) input.channel = channel
        if (value.has('title')) input.title = value.get('title')
        if (value.has('body')) input.body = value.get('body')
        if (value.has('summary')) input.summary = value.get('summary')
        if (value.has('category')) input.category = value.get('category') || null
        const featured = flag(value.get('featured'))
        if (featured !== undefined) input.featured = featured
        // Pickers first: the browser only allows them straight after the keypress.
        if (bool.has('cover')) input.image_url = await compressImageFile(await pickLocalFile('image/*'), 1200, 400)
        if (bool.has('attach')) {
          const file = await pickLocalFile('*/*')
          ctx.print(`uploading ${file.name}…`, 'dim')
          const up: NewsAttachment = await uploadAttachment(file)
          input.attachments = [up]
        }
        if (editing) {
          if (Object.keys(input).length === 0) fail('nothing to change - give --title, --body, --summary, --category, --featured, --cover or --attach')
          const n = await updateNewsItem(id, input)
          ctx.print(`updated #${n.id}: ${oneLine(n.title)}`, 'ok')
        } else {
          if (!input.title || !input.body) fail('a post needs --title and --body')
          const n = await createNewsItem(input as NewsItemInput)
          ctx.print(`posted #${n.id} to ${n.channel}: ${oneLine(n.title)}`, 'ok')
        }
      } else if (sub === 'rm') {
        const id = idArg(rest[0], 'news rm <id>')
        if (!confirmAction(ctx, `Delete news post #${id}? This can't be undone.`, bool.has('y'))) return
        await deleteNewsItem(id)
        ctx.print(`deleted #${id}`, 'ok')
      } else if (sub === 'upload') {
        const file = await pickLocalFile('*/*')
        const a = await uploadAttachment(file)
        ctx.print(`uploaded ${a.name} (${(a.size / 1024).toFixed(0)} KB)\n${a.url}`, 'ok')
      } else if (sub === 'channels') {
        const verb = (rest[0] ?? 'ls').toLowerCase()
        if (verb === 'ls') {
          const list = await fetchChannels()
          if (asJson(ctx, bool.has('json'), list)) return
          const subs = new Set(getSubscriptions())
          ctx.print(table(list.map((c) => [subs.has(c.id) ? '🔔' : '  ', c.id, c.label, c.description ?? ''])))
        } else if (verb === 'new') {
          const label = value.get('label') ?? rest.slice(1).join(' ')
          if (!label) fail('usage: news channels new <label> [--desc text]')
          const c = await createChannel({ label, description: value.get('desc') })
          ctx.print(`created channel ${c.id} (${c.label})`, 'ok')
        } else if (verb === 'edit') {
          const id = rest[1] ?? fail('usage: news channels edit <id> [--label l] [--desc d]')
          if (!value.has('label') && !value.has('desc')) fail('nothing to change - give --label or --desc')
          const c = await updateChannel(id, { label: value.get('label'), description: value.get('desc') })
          ctx.print(`updated channel ${c.id}`, 'ok')
        } else if (verb === 'rm') {
          const id = rest[1] ?? fail('usage: news channels rm <id>')
          if (!confirmAction(ctx, `Delete the news channel "${id}"?`, bool.has('y'))) return
          await deleteChannel(id)
          ctx.print(`deleted channel ${id}`, 'ok')
        } else fail('usage: news channels [ls | new | edit | rm]')
      } else if (sub === 'subscribe' || sub === 'unsubscribe') {
        const id = rest[0] ?? fail(`usage: news ${sub} <channel>`)
        const now = setSubscribed(id, sub === 'subscribe')
        ctx.print(`${sub === 'subscribe' ? 'subscribed to' : 'unsubscribed from'} ${id} (${now.length ? now.join(', ') : 'no subscriptions'})`, 'ok')
      }
    },
  },
]
