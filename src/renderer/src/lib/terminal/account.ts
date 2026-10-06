import { useStore } from '../../store/useStore'
import { getSongById } from '../juicewrldApi'
import {
  compressImageFile, decideLoginApproval, getDiscordAuthUrl, getFavorites, getMe, getOtpSetup, listLoginApprovals, pollLoginApproval,
  confirmOtpSetup, removeAvatar, requestLoginApproval, updateAvatar, updateBio, updateDisplayName,
  updateNowPlaying, updatePrivacySettings, updateUserSettings, discordRedirectUri, type AccountUser,
} from '../userApi'
import { relativeTime } from '../../components/adminShared'
import { pickLocalFile } from './pick'
import { songFromArg, completeSongs } from './player'
import { asJson, confirmAction, fail, oneLine, parseArgs, parseBool, parseJsonArg, table, type TermCommand, type TermCtx } from './types'

// Everything the sign-in modal, the Settings account section and the
// sign-in-approval prompt do. Passwords are asked for with a masked prompt so
// they never reach the scrollback or the history.
const st = (): ReturnType<typeof useStore.getState> => useStore.getState()
const signedIn = (): AccountUser => st().account ?? fail('sign in first (login)')

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('cancelled')); return }
    const t = window.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { window.clearTimeout(t); reject(new Error('cancelled')) }, { once: true })
  })

const who = (a: AccountUser): string => a.username || a.discord_username || a.display_name

// The login "approve on another device" flow: the request shows a code, a
// signed-in device approves it, and this polls until it is decided.
async function loginByApproval(username: string, password: string, ctx: TermCtx): Promise<void> {
  const req = await requestLoginApproval(username, password)
  ctx.print(`Approve this sign-in on a device that is already signed in. Code: ${req.code}\n(on that device: approvals, then approvals approve <id>) - Ctrl+C to give up`, 'ok')
  const deadline = Date.now() + req.expires_in * 1000
  for (;;) {
    await sleep(2000, ctx.signal)
    const res = await pollLoginApproval(req.id, req.secret)
    if (res.status === 'approved') { await st().completeApprovedLogin(res.token, res.user); return }
    if (res.status === 'denied') fail('the other device denied this sign-in')
    if (res.status === 'expired' || Date.now() > deadline) fail('the request expired - try again')
  }
}

async function passwordSignIn(username: string, ctx: TermCtx): Promise<void> {
  const password = await ctx.ask('password: ', { secret: true })
  if (!password) fail('a password is required')
  try {
    await st().loginWithPassword(username, password)
  } catch (err) {
    if (!/otp/i.test((err as Error)?.message ?? '')) throw err
    // Staff accounts have a second factor: a code, or a nod from another device.
    const answer = (await ctx.ask('2FA code (or "approve" to approve it on another device): ')).trim()
    if (answer.toLowerCase() === 'approve') await loginByApproval(username, password, ctx)
    else await st().loginWithPassword(username, password, answer)
  }
}

function describeMe(a: AccountUser): string {
  const roles = [a.is_administrator && 'administrator', a.is_manager && 'manager', a.is_editor && 'editor', a.is_contributor && 'contributor', a.is_news && 'news', a.is_donor && 'donor'].filter(Boolean)
  return [
    `${a.display_name}  (@${who(a)})  #${a.id}`,
    `roles       ${roles.length ? roles.join(', ') : 'listener'}${a.otp_enabled ? '  ·  2FA on' : ''}`,
    `bio         ${oneLine(a.bio, 120) || '-'}`,
    `public      history ${a.public_play_history ? 'on' : 'off'} · playlists ${a.public_playlists ? 'on' : 'off'} · now playing ${a.public_now_playing ? 'on' : 'off'}`,
  ].join('\n')
}

const PRIVACY_KEYS: Record<string, 'public_play_history' | 'public_playlists' | 'public_now_playing'> = {
  history: 'public_play_history', playlists: 'public_playlists', nowplaying: 'public_now_playing',
}

export const ACCOUNT_COMMANDS: TermCommand[] = [
  {
    name: 'login', aliases: ['signin'], group: 'Account', usage: 'login [username] | login discord [pasted callback url]',
    description: 'Sign in (asks for the password, then a 2FA code or a nod from another device if the account needs one). `login discord` opens Discord sign-in',
    covers: ['userApi.passwordLogin', 'userApi.requestLoginApproval', 'userApi.pollLoginApproval', 'userApi.getDiscordAuthUrl', 'userApi.exchangeDiscord', 'userApi.discordRedirectUri', 'userApi.setToken'],
    complete: (before, partial) => (before.length === 0 && 'discord'.startsWith(partial.toLowerCase()) ? ['discord'] : []),
    run: async (args, ctx) => {
      const { rest } = parseArgs(args)
      if (st().account) fail(`already signed in as ${who(st().account as AccountUser)} (logout first)`)
      if (rest[0]?.toLowerCase() === 'discord') {
        const pasted = rest[1]
        if (!pasted) {
          const { authorize_url } = await getDiscordAuthUrl(discordRedirectUri())
          ctx.print(`Opening Discord sign-in…\n${authorize_url}`, 'dim')
          await st().loginWithDiscord()
          return
        }
        // The address Discord sent you back to, with ?code=…&state=… on the end.
        let code: string | null = null
        let state: string | null = null
        try { const u = new URL(pasted); code = u.searchParams.get('code'); state = u.searchParams.get('state') } catch { /* not a URL */ }
        if (!code || !state) fail('that address has no code and state in it')
        await st().completeDiscordLogin(code as string, state as string)
        ctx.print(`signed in as ${who(signedIn())}`, 'ok')
        return
      }
      const username = (rest[0] ?? (await ctx.ask('username: '))).trim()
      if (!username) fail('a username is required')
      await passwordSignIn(username, ctx)
      ctx.print(`signed in as ${who(signedIn())}`, 'ok')
    },
  },
  {
    name: 'register', aliases: ['signup'], group: 'Account', usage: 'register [username] [--name "Display name"]',
    description: 'Create a username + password account (asks for the password twice)',
    covers: ['userApi.registerAccount'],
    run: async (args, ctx) => {
      const { rest, value } = parseArgs(args, ['name'])
      if (st().account) fail('you are signed in - logout first to create another account')
      const username = (rest[0] ?? (await ctx.ask('username: '))).trim()
      if (!username) fail('a username is required')
      const password = await ctx.ask('password: ', { secret: true })
      if (!password) fail('a password is required')
      if (password !== (await ctx.ask('again: ', { secret: true }))) fail('the passwords don’t match')
      await st().signupWithPassword(username, password, value.get('name'))
      ctx.print(`account created - signed in as ${who(signedIn())}`, 'ok')
    },
  },
  {
    name: 'me', aliases: ['whoami'], group: 'Account', usage: 'me [--json]', description: 'Your account: name, roles, bio and privacy switches (re-read from the API)',
    covers: ['userApi.getMe'],
    run: async (args, ctx) => {
      const { bool } = parseArgs(args)
      if (!st().account) fail('not signed in (login)')
      const me = await getMe()
      useStore.setState({ account: me })
      if (!asJson(ctx, bool.has('json'), me)) ctx.print(describeMe(me))
    },
  },
  {
    name: 'profile', group: 'Account', usage: 'profile <name <text> | bio <text> | avatar [set|rm] | privacy [history|playlists|nowplaying] [on|off] | settings [json]>',
    description: 'Edit your profile: display name, bio, avatar (opens a file picker), the public-profile switches and the synced settings blob',
    covers: ['userApi.updateDisplayName', 'userApi.updateBio', 'userApi.updateAvatar', 'userApi.removeAvatar', 'userApi.compressImageFile', 'userApi.updatePrivacySettings', 'userApi.updateUserSettings'],
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return ['name', 'bio', 'avatar', 'privacy', 'settings'].filter((v) => v.startsWith(p))
      if (before[0] === 'avatar' && before.length === 1) return ['set', 'rm'].filter((v) => v.startsWith(p))
      if (before[0] === 'privacy' && before.length === 1) return Object.keys(PRIVACY_KEYS).filter((v) => v.startsWith(p))
      if (before[0] === 'privacy' && before.length === 2) return ['on', 'off'].filter((v) => v.startsWith(p))
      return []
    },
    run: async (args, ctx) => {
      const account = signedIn()
      const trimmed = args.trim()
      const sub = (trimmed.split(/\s+/)[0] ?? '').toLowerCase()
      const text = trimmed.slice(sub.length).trim()
      if (sub === 'name') {
        if (!text) fail('usage: profile name <new display name>')
        useStore.setState({ account: await updateDisplayName(text) })
        ctx.print(`display name is now ${text}`, 'ok')
      } else if (sub === 'bio') {
        useStore.setState({ account: await updateBio(text) })
        ctx.print(text ? 'bio saved' : 'bio cleared', 'ok')
      } else if (sub === 'avatar') {
        const mode = text.toLowerCase()
        if (mode === 'rm' || mode === 'remove') {
          useStore.setState({ account: await removeAvatar() })
          ctx.print('avatar removed', 'ok')
        } else if (!mode || mode === 'set') {
          const file = await pickLocalFile('image/*')
          const base64 = await compressImageFile(file, 256, 200)
          useStore.setState({ account: await updateAvatar(base64) })
          ctx.print(`avatar set from ${file.name}`, 'ok')
        } else fail('usage: profile avatar [set | rm]')
      } else if (sub === 'privacy') {
        const [key, flag] = text.toLowerCase().split(/\s+/)
        if (!key) {
          ctx.print(Object.entries(PRIVACY_KEYS).map(([k, field]) => `${k.padEnd(12)}${account[field] ? 'public' : 'private'}`).join('\n'))
          return
        }
        const field = PRIVACY_KEYS[key] ?? fail(`privacy: ${Object.keys(PRIVACY_KEYS).join(' | ')}`)
        const on = flag === undefined ? !account[field] : (parseBool(flag) ?? fail('usage: profile privacy <history|playlists|nowplaying> [on|off]'))
        useStore.setState({ account: await updatePrivacySettings({ [field]: on }) })
        ctx.print(`${key} is now ${on ? 'public' : 'private'}`, 'ok')
      } else if (sub === 'settings') {
        const current = account.user_settings ?? {}
        if (!text) { ctx.print(JSON.stringify(current, null, 2)); return }
        const patch = parseJsonArg(text, 'profile settings {"theme":"dark"}')
        if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) fail('settings must be a JSON object')
        // The blob is stored whole, so a change is merged into what is there.
        useStore.setState({ account: await updateUserSettings({ ...current, ...(patch as Record<string, unknown>) }) })
        await st().loadAccount()
        ctx.print('settings saved', 'ok')
      } else fail('usage: profile <name | bio | avatar | privacy | settings> …')
    },
  },
  {
    name: 'nowplaying', group: 'Account', usage: 'nowplaying [set <song> | clear]',
    description: 'What your profile shows as now playing (no argument: the current value)',
    covers: ['userApi.updateNowPlaying'],
    complete: (before, partial) => (before.length === 0 ? ['set', 'clear'].filter((v) => v.startsWith(partial.toLowerCase())) : before[0] === 'set' ? completeSongs(before.slice(1), partial) : []),
    run: async (args, ctx) => {
      const account = signedIn()
      const [sub = '', ...more] = args.trim().split(/\s+/).filter(Boolean)
      if (!sub) {
        const np = account.now_playing as { song?: number; path?: string; position?: number; updated_at?: string } | undefined
        if (!np?.song) { ctx.print('nothing shown as now playing', 'dim'); return }
        const song = await getSongById(np.song).catch(() => null)
        ctx.print(`${song?.name ?? `song #${np.song}`}  ${np.position ? `at ${Math.round(np.position)}s` : ''}${np.updated_at ? `  ·  ${relativeTime(np.updated_at)}` : ''}`)
      } else if (sub.toLowerCase() === 'clear') {
        useStore.setState({ account: await updateNowPlaying(null) })
        ctx.print('now playing cleared', 'ok')
      } else if (sub.toLowerCase() === 'set') {
        const song = await songFromArg(more.join(' '))
        useStore.setState({ account: await updateNowPlaying({ song: song.id, path: song.path, position: 0 }) })
        ctx.print(`now playing set to ${song.name}`, 'ok')
      } else fail('usage: nowplaying [set <song> | clear]')
    },
  },
  {
    name: 'approvals', group: 'Account', usage: 'approvals [approve <id> | deny <id>]',
    description: 'Sign-in requests from other devices waiting for you to approve (staff 2FA option)',
    covers: ['userApi.listLoginApprovals', 'userApi.decideLoginApproval'],
    complete: (before, partial) => (before.length === 0 ? ['approve', 'deny'].filter((v) => v.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      signedIn()
      const [sub = '', id = ''] = args.trim().split(/\s+/)
      if (!sub) {
        const list = await listLoginApprovals()
        if (list.length === 0) { ctx.print('no sign-in requests waiting', 'dim'); return }
        ctx.print(`${table(list.map((a) => [a.id, `code ${a.code}`, a.ip ?? '?', oneLine(a.user_agent, 40), relativeTime(a.created_at)]))}\napprovals approve <id> · approvals deny <id>`)
        return
      }
      const verb = sub.toLowerCase()
      if ((verb !== 'approve' && verb !== 'deny') || !id) fail('usage: approvals [approve <id> | deny <id>]')
      await decideLoginApproval(id, verb as 'approve' | 'deny')
      ctx.print(`${verb === 'approve' ? 'approved' : 'denied'} ${id}`, 'ok')
    },
  },
  {
    name: 'otp', group: 'Account', usage: 'otp [setup | confirm <code>]',
    description: 'Two-factor authentication: show the secret to put in an authenticator app, then confirm it with a code',
    covers: ['userApi.getOtpSetup', 'userApi.confirmOtpSetup'],
    complete: (before, partial) => (before.length === 0 ? ['setup', 'confirm'].filter((v) => v.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      signedIn()
      const [sub = 'setup', code = ''] = args.trim().split(/\s+/)
      if (sub.toLowerCase() === 'confirm') {
        if (!code) fail('usage: otp confirm <6-digit code>')
        const r = await confirmOtpSetup(code)
        ctx.print(r.otp_enabled ? '2FA is on' : 'that code wasn’t accepted', r.otp_enabled ? 'ok' : 'error')
        return
      }
      if (sub.toLowerCase() !== 'setup') fail('usage: otp [setup | confirm <code>]')
      const s = await getOtpSetup()
      if (s.otp_enabled && !s.otp_secret) { ctx.print('2FA is already on for this account', 'dim'); return }
      ctx.print([
        `account   ${s.account_label ?? ''}`,
        `secret    ${s.otp_secret ?? '(none)'}`,
        s.provisioning_uri ? `uri       ${s.provisioning_uri}` : '',
        'Add it to an authenticator app, then: otp confirm <code>',
      ].filter(Boolean).join('\n'))
    },
  },
  {
    name: 'favorites', aliases: ['favs'], group: 'Library', usage: 'favorites [ls | add <song> | rm <song>] [--json]',
    description: 'Your liked songs on the server (like / unlike act on what is playing)',
    covers: ['userApi.getFavorites', 'userApi.addFavorite', 'userApi.removeFavorite'],
    complete: (before, partial) => (before.length === 0 ? ['ls', 'add', 'rm'].filter((v) => v.startsWith(partial.toLowerCase())) : completeSongs(before.slice(1), partial)),
    run: async (args, ctx) => {
      signedIn()
      const { rest, bool } = parseArgs(args)
      const sub = (rest.shift() ?? 'ls').toLowerCase()
      if (sub === 'ls' || sub === 'list') {
        const list = await getFavorites()
        if (asJson(ctx, bool.has('json'), list)) return
        if (list.length === 0) { ctx.print('no liked songs yet', 'dim'); return }
        ctx.print(`${table(list.map((f, i) => [String(i + 1), f.song.name, f.song.era?.name ?? f.song.category]))}\n${list.length} liked`)
        return
      }
      if (sub !== 'add' && sub !== 'rm' && sub !== 'remove') fail('usage: favorites [ls | add <song> | rm <song>]')
      const song = await songFromArg(rest.join(' '))
      const id = `jw-${song.id}`
      const liked = st().likedTrackIds.includes(id)
      if (sub === 'add') {
        if (liked) { ctx.print(`${song.name} is already liked`, 'dim'); return }
        st().toggleLike(id)
        ctx.print(`♥ liked ${song.name}`, 'ok')
      } else {
        if (!liked) { ctx.print(`${song.name} isn’t in your liked songs`, 'dim'); return }
        if (!confirmAction(ctx, `Remove ${song.name} from your liked songs?`, bool.has('y'))) return
        st().toggleLike(id)
        ctx.print(`♡ removed ${song.name}`, 'ok')
      }
    },
  },
]
