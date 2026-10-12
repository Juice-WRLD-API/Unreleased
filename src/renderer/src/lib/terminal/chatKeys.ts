import { relativeTime } from '../../components/adminShared'
import { useChatStore } from '../../store/chatStore'
import { listMyDevices } from '../chatApi'
import { backupExists, changeRecoveryCode, restoreFromCode, setupBackup } from '../chatBackup'
import { identityStatus, localDeviceId, shareKeyWithUser } from '../chatE2E'
import { getFeatures, loadUserTrust, resetOwnIdentity, safetyNumber } from '../chatIdentity'
import { exportKeys, importKeys, looksLikeKeyExport } from '../chatKeyTransfer'
import { approveLink, lookupLink, pendingDevices, revokeLinkedDevice, startLink, type LinkCandidate } from '../chatLinking'
import { processInbox, requestRoomKey } from '../chatToDevice'
import { ensureDevice, ownKeys } from '../chatE2E'
import { pickLocalFile, saveBlob } from './pick'
import { resolveUser } from './users'
import { asJson, confirmAction, fail, idArg, parseArgs, table, type TermCommand, type TermCtx } from './types'

// Chat encryption housekeeping: this device's identity, the other devices on
// the account, linking a new device, the recovery-code backup and moving keys
// by file - what the chat's Devices and Trust panels do. Secrets (recovery
// codes, passphrases) are asked for with the masked prompt and never echoed;
// the one thing printed on purpose is a freshly made recovery code, which has
// to be written down.
const cs = (): ReturnType<typeof useChatStore.getState> => useChatStore.getState()
const me = (): number => cs().meId ?? fail('chat is not connected yet')

// The numbers two devices must agree on before one trusts the other.
async function confirmSas(ctx: TermCtx, c: LinkCandidate): Promise<void> {
  ctx.print(`Device "${c.session.label || c.session.device_id}" asks to join your account.\nThe new device should show this number: ${c.sas}${c.viaQr ? '\n(scanned from its code, so the keys already match)' : ''}`)
  if (!c.viaQr) {
    const answer = (await ctx.ask('does the number match? (yes/no): ')).trim().toLowerCase()
    if (answer !== 'yes' && answer !== 'y') fail('not approved - the numbers must match')
  }
}

const SUBS = ['status', 'devices', 'revoke', 'link', 'pending', 'approve', 'backup', 'export', 'import', 'trust', 'safety', 'share', 'request', 'sync', 'reset']

const keysCommand: TermCommand = {
  name: 'keys', group: 'People', chat: true,
  usage: 'keys [status] · devices · revoke <deviceId> · link · pending · approve <code|qr | deviceId> · backup [setup|change|restore] · export · import · trust <user> · safety <user> · share <conversationId> <user> · request <conversationId> <version> · sync · reset',
  description: 'Chat encryption: this device’s identity and status, your other devices, linking a new device, the recovery-code backup, exporting and importing keys, who you trust, and safety numbers',
  covers: [
    'chatApi.listMyDevices', 'chatApi.getE2EFeatures', 'chatApi.revokeDevice', 'chatApi.registerDevice', 'chatApi.putIdentity', 'chatApi.putDeviceList',
    'chatApi.createLinkSession', 'chatApi.getLinkSession', 'chatApi.getUserKeys', 'chatApi.getUsersKeys', 'chatApi.getBackup', 'chatApi.putBackup',
    'chatApi.postBackupEntries', 'chatApi.listBackupEntries', 'chatApi.sendToDevice', 'chatApi.fetchToDevice', 'chatApi.ackToDevice',
    'chatApi.establishKey', 'chatApi.rotateKey', 'chatApi.postEnvelopes', 'chatApi.listEnvelopes', 'chatApi.listConversationDevices',
    'chatE2E.ensureDevice', 'chatE2E.identityStatus', 'chatE2E.localDeviceId', 'chatE2E.shareKeyWithUser', 'chatE2E.storeRoomKey', 'chatE2E.fetchRoomKey',
    'chatE2E.establishRoomKey', 'chatE2E.resolveRoomKey', 'chatE2E.onDevicesUpdated',
    'chatIdentity.getFeatures', 'chatIdentity.loadUserTrust', 'chatIdentity.loadUsersTrust', 'chatIdentity.ensureIdentity', 'chatIdentity.publishDeviceList',
    'chatIdentity.resetOwnIdentity', 'chatIdentity.safetyNumber',
    'chatLinking.startLink', 'chatLinking.ownDeviceSas', 'chatLinking.lookupLink', 'chatLinking.pendingDevices', 'chatLinking.approveLink', 'chatLinking.revokeLinkedDevice',
    'chatBackup.backupExists', 'chatBackup.setupBackup', 'chatBackup.changeRecoveryCode', 'chatBackup.restoreFromCode', 'chatBackup.backupRoomKey',
    'chatKeyTransfer.importKeys', 'chatToDevice.processInbox', 'chatToDevice.requestRoomKey', 'chatToDevice.sendToDevices', 'chatToDevice.sendLinkBundle',
  ],
  complete: async (before, partial) => {
    const p = partial.toLowerCase()
    if (before.length === 0) return SUBS.filter((s) => s.startsWith(p))
    if (before[0] === 'backup' && before.length === 1) return ['setup', 'change', 'restore'].filter((s) => s.startsWith(p))
    return []
  },
  run: async (args, ctx) => {
    const { rest, bool } = parseArgs(args)
    const sub = (rest.shift() ?? 'status').toLowerCase()
    const id = me()

    if (sub === 'status') {
      const [status, features, device, backup] = await Promise.all([identityStatus(id), getFeatures(), localDeviceId(id), backupExists(id).catch(() => false)])
      const out = { identity: status, features, device, backup }
      if (asJson(ctx, bool.has('json'), out)) return
      ctx.print([
        `identity   ${status === 'ready' ? 'ready - this device holds your security key' : status === 'needs-link' ? 'needs linking - another device holds your security key (keys link)' : 'disabled on this server'}`,
        `device     ${device ?? 'not registered yet'}`,
        `backup     ${backup ? 'recovery-code backup is set up' : 'none (keys backup setup)'}`,
        `server     encrypted send ${features.send ? 'on' : 'off'} · identity ${features.identity ? 'on' : 'off'} · linking ${features.linking ? 'on' : 'off'} · backup ${features.backup ? 'on' : 'off'}`,
      ].join('\n'))
    } else if (sub === 'devices') {
      const [rows, here] = await Promise.all([listMyDevices(), localDeviceId(id)])
      if (asJson(ctx, bool.has('json'), rows)) return
      ctx.print(rows.length ? table(rows.map((d) => [d.device_id === here ? '*' : ' ', d.device_id, d.label, d.algorithm, d.created_at ? relativeTime(d.created_at) : ''])) : 'no devices registered', rows.length ? 'plain' : 'dim')
    } else if (sub === 'revoke') {
      const deviceId = rest[0] ?? fail('usage: keys revoke <deviceId>  (keys devices lists them)')
      if (!confirmAction(ctx, `Revoke device ${deviceId}? Rooms rotate their keys on the next send.`, bool.has('y'))) return
      await revokeLinkedDevice(id, deviceId)
      ctx.print(`revoked ${deviceId}`, 'ok')
    } else if (sub === 'link') {
      const link = await startLink(id)
      ctx.print([
        'This device asks to join your account. On a device that is already signed in, run:',
        `  keys approve ${link.sessionId}`,
        `and check it shows this number: ${link.sas}`,
        `(or paste the whole code instead of the id: ${link.qr})`,
        `This request expires ${relativeTime(link.expiresAt)}. Then: keys sync`,
      ].join('\n'), 'ok')
    } else if (sub === 'pending') {
      const list = await pendingDevices(id)
      ctx.print(list.length ? table(list.map((c) => [c.session.device_id, c.session.label, `number ${c.sas}`])) : 'no devices waiting to be approved', list.length ? 'plain' : 'dim')
    } else if (sub === 'approve') {
      const target = rest[0] ?? fail('usage: keys approve <session id | link code | deviceId>  (keys pending lists waiting devices)')
      const waiting = (await pendingDevices(id)).find((c) => c.session.device_id === target)
      const candidate = waiting ?? (await lookupLink(target.startsWith('unrlsd-link:') ? { qr: target } : { code: target }))
      await confirmSas(ctx, candidate)
      await approveLink(id, candidate)
      ctx.print(`approved ${candidate.session.label || candidate.session.device_id} - it now has your keys`, 'ok')
    } else if (sub === 'backup') {
      const verb = (rest[0] ?? 'status').toLowerCase()
      if (verb === 'status') {
        ctx.print((await backupExists(id)) ? 'a recovery-code backup is set up' : 'no backup (keys backup setup)', 'plain')
      } else if (verb === 'setup') {
        if (!confirmAction(ctx, 'Create the recovery-code backup? You will be shown a code once - write it down.', bool.has('y'))) return
        const code = await setupBackup(id)
        ctx.print(`Recovery code (shown once - write it down):\n  ${code}`, 'ok')
      } else if (verb === 'change') {
        const old = await ctx.ask('current recovery code: ', { secret: true })
        const code = await changeRecoveryCode(id, old.trim())
        ctx.print(`New recovery code (shown once - write it down):\n  ${code}`, 'ok')
      } else if (verb === 'restore') {
        const code = await ctx.ask('recovery code: ', { secret: true })
        let shown = 0
        const n = await restoreFromCode(id, code.trim(), (done, total) => { const pct = total ? Math.floor((done / total) * 4) * 25 : 0; if (pct > shown && pct < 100) { shown = pct; ctx.print(`restoring ${pct}%`, 'dim') } })
        await cs().refreshIdentity()
        ctx.print(`restored ${n} room key${n === 1 ? '' : 's'}`, 'ok')
      } else fail('usage: keys backup [status | setup | change | restore]')
    } else if (sub === 'export') {
      if (!confirmAction(ctx, 'Export every room key on this device into a file protected by a passphrase? Anyone with the file and passphrase can read your chats.', bool.has('y'))) return
      const pass = await ctx.ask('passphrase: ', { secret: true })
      if (pass !== (await ctx.ask('again: ', { secret: true }))) fail('the passphrases don’t match')
      const { blob, count } = await exportKeys(id, pass)
      saveBlob(new Blob([blob], { type: 'text/plain' }), 'unreleased-chat-keys.txt')
      ctx.print(`exported ${count} key${count === 1 ? '' : 's'} to unreleased-chat-keys.txt in your downloads`, 'ok')
    } else if (sub === 'import') {
      const file = await pickLocalFile('.txt,text/plain')
      const text = await file.text()
      if (!looksLikeKeyExport(text)) fail('that file isn’t a key export')
      const pass = await ctx.ask('passphrase: ', { secret: true })
      const res = await importKeys(id, text, pass)
      await cs().adoptKeys(res.conversations)
      ctx.print(`imported ${res.imported} key${res.imported === 1 ? '' : 's'}${res.skipped ? `, skipped ${res.skipped}` : ''}${res.fromOtherAccount ? ' (the file is from another account)' : ''}`, 'ok')
    } else if (sub === 'trust' || sub === 'safety') {
      const user = await resolveUser(rest.join(' '))
      if (sub === 'trust') {
        const t = await loadUserTrust(id, user.id)
        ctx.print(t.state === 'ok' ? `${user.username}: ok · ${t.devices.length} device${t.devices.length === 1 ? '' : 's'}${t.verified ? ' · verified' : ' · not verified'}` : t.state === 'changed' ? `${user.username}: their security key CHANGED since you last saw it` : t.state === 'invalid' ? `${user.username}: invalid (${t.reason})` : `${user.username}: no v2 identity yet (older client)`, t.state === 'ok' ? 'ok' : 'plain')
      } else {
        const s = await safetyNumber(id, user.id)
        ctx.print(s ? `Safety number, you ↔ ${user.username}:\n${s.digits.join(' ')}\nCompare it with theirs out loud.` : `no safety number yet - ${user.username} has no identity`, s ? 'plain' : 'dim')
      }
    } else if (sub === 'share') {
      const convId = idArg(rest[0], 'keys share <conversationId> <user>')
      const conv = cs().conversations.find((c) => c.id === convId) ?? fail(`#${convId} isn’t one of your conversations (convo ls)`)
      const user = await resolveUser(rest.slice(1).join(' '))
      await shareKeyWithUser(id, conv, user.id)
      ctx.print(`shared the room key of #${convId} with ${user.username}`, 'ok')
    } else if (sub === 'request') {
      await requestRoomKey(id, idArg(rest[0], 'keys request <conversationId> <version>'), idArg(rest[1], 'keys request <conversationId> <version>'))
      ctx.print('asked your other devices for that room key', 'ok')
    } else if (sub === 'sync') {
      await processInbox(id)
      await cs().refreshIdentity()
      ctx.print('checked for keys sent from your other devices', 'ok')
    } else if (sub === 'reset') {
      if (!confirmAction(ctx, 'Reset your encryption identity? Other people will see your security key change, and you must relink your other devices. This cannot be undone.', bool.has('y'))) return
      const device = await ensureDevice(id)
      await resetOwnIdentity(id, ownKeys(device))
      await cs().refreshIdentity()
      ctx.print('identity reset', 'ok')
    } else fail(`usage: keys [${SUBS.join(' | ')}]`)
  },
}

export const CHAT_KEY_COMMANDS: TermCommand[] = [keysCommand]
