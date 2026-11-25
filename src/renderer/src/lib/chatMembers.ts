// Signed member lists (E2E v2). The server decides who is in a conversation;
// this keeps it from adding someone quietly. Each version of the list is
// signed with a member's master key and counts only if that member was on the
// version before. Room keys are sealed only to people on the newest list this
// account verified who are still in the conversation, so someone the server
// adds on its own gets nothing until a member confirms them.
//
// The first list this account sees for a conversation is taken on trust, like
// a master key on first sight. Every later version has to follow from it.
import * as api from './chatApi'
import type { MemberListRow } from './chatApi'
import { getMemberPin, loadMsk, putMemberPin, type MemberChange, type MemberPin } from './chatKeyStore'
import { b64, memberListBytes, sign, unb64, verify } from './chatV2Crypto'
import { getFeatures, loadUserTrust } from './chatIdentity'
import { ensureDevice, identityStatus } from './chatE2E'

export type { MemberChange }

export type MemberState =
  // An older server with no signed lists.
  | { state: 'unsupported' }
  // Nothing signed yet, and this device can't sign (not linked, or v2 off).
  | { state: 'unsigned'; participants: number[] }
  | { state: 'ok'; version: number; members: number[]; confirmed: number[]; unconfirmed: number[]; history: MemberChange[] }
  | { state: 'invalid'; reason: string }

const HISTORY_KEEP = 50
const cache = new Map<string, Promise<MemberState>>()
const cacheKey = (me: number, conversationId: number): string => `${me}:${conversationId}`

export function invalidateMembers(conversationId?: number): void {
  if (conversationId === undefined) {
    cache.clear()
    return
  }
  for (const k of cache.keys()) if (k.endsWith(`:${conversationId}`)) cache.delete(k)
}

export function loadMembers(me: number, conversationId: number): Promise<MemberState> {
  const k = cacheKey(me, conversationId)
  const hit = cache.get(k)
  if (hit) return hit
  // Only a list that checked out is kept: anything else may clear up on its
  // own (a key change accepted, the device linked), so it's asked again.
  const run = evaluate(me, conversationId, true).then((state) => {
    if (state.state !== 'ok' && cache.get(k) === run) cache.delete(k)
    return state
  }, (err) => {
    if (cache.get(k) === run) cache.delete(k)
    throw err
  })
  cache.set(k, run)
  return run
}

const sorted = (ids: number[]): number[] => [...new Set(ids)].sort((a, b) => a - b)
const sameIds = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])

// Null when the row checks out; otherwise why not. `prev` is the version
// before, or null for a list taken on first sight.
async function checkRow(me: number, conversationId: number, row: MemberListRow, prev: number[] | null): Promise<string | null> {
  if (!Array.isArray(row.members) || !sameIds(sorted(row.members), row.members)) return 'list-malformed'
  if (!(prev ?? row.members).includes(row.signer_user)) return 'signer-not-member'
  const trust = await loadUserTrust(me, row.signer_user)
  if (trust.state === 'changed') return 'signer-key-changed'
  if (trust.state !== 'ok') return 'signer-unverified'
  const ok = await verify(
    await unb64(row.signature),
    memberListBytes(conversationId, row.version, row.signer_user, row.members),
    await unb64(trust.mskPub),
  ).catch(() => false)
  return ok ? null : 'list-signature'
}

function change(prev: number[], next: number[], version: number, by: number, at: string): MemberChange {
  return { version, by, added: next.filter((id) => !prev.includes(id)), removed: prev.filter((id) => !next.includes(id)), at }
}

function withChange(pin: MemberPin, members: number[], version: number, by: number, at: string): MemberPin {
  return { version, members, history: [...pin.history, change(pin.members, members, version, by, at)].slice(-HISTORY_KEEP) }
}

// Signs `members` as the given version. 'conflict' when the list moved on or
// the members changed first; null when this device can't sign.
async function signList(me: number, conversationId: number, version: number, members: number[]): Promise<'ok' | 'conflict' | null> {
  if (await identityStatus(me) !== 'ready') return null
  const msk = await loadMsk(me)
  if (!msk) return null
  const device = await ensureDevice(me)
  const signature = await sign(memberListBytes(conversationId, version, me, members), msk)
  const res = await api.postMemberList(conversationId, { version, members, signer_device: device.deviceId, signature: await b64(signature) })
  return res.ok ? 'ok' : 'conflict'
}

async function evaluate(me: number, conversationId: number, mayRetry: boolean): Promise<MemberState> {
  const pin = await getMemberPin(me, conversationId)
  let lists: api.MemberLists
  try {
    lists = await api.getMemberLists(conversationId, pin?.version ?? 0)
  } catch (err) {
    if ((err as { status?: number }).status === 404) return { state: 'unsupported' }
    throw err
  }
  const participants = sorted(lists.participants ?? [])
  if (pin && lists.version < pin.version) return { state: 'invalid', reason: 'list-rollback' }

  let current = pin
  const rows = (lists.results ?? []).filter((r) => r.version > (pin?.version ?? 0)).sort((a, b) => a.version - b.version)
  if (!current && rows.length) {
    const newest = rows[rows.length - 1]
    const reason = await checkRow(me, conversationId, newest, null)
    if (reason) return { state: 'invalid', reason }
    current = { version: newest.version, members: newest.members, history: [] }
    await putMemberPin(me, conversationId, current)
  } else if (current && rows.length) {
    for (const row of rows) {
      if (row.version !== current.version + 1) return { state: 'invalid', reason: 'list-gap' }
      const reason = await checkRow(me, conversationId, row, current.members)
      if (reason) return { state: 'invalid', reason }
      current = withChange(current, row.members, row.version, row.signer_user, row.created_at)
    }
    await putMemberPin(me, conversationId, current)
  }

  if (!current) {
    // Nothing signed yet: the first member who can signs who is here now.
    const signed = await signList(me, conversationId, 1, participants)
    if (signed === 'conflict') return mayRetry ? evaluate(me, conversationId, false) : { state: 'unsigned', participants }
    if (!signed) return { state: 'unsigned', participants }
    current = { version: 1, members: participants, history: [] }
    await putMemberPin(me, conversationId, current)
  }

  const members = current.members
  return {
    state: 'ok', version: current.version, members, history: current.history,
    confirmed: participants.filter((id) => members.includes(id)),
    unconfirmed: participants.filter((id) => !members.includes(id)),
  }
}

// Signs the conversation's current members as the next version: after adding
// or removing people, or to confirm someone the server shows but nobody
// signed in. Does nothing when the newest list already matches.
export async function confirmMembers(me: number, conversationId: number): Promise<MemberState> {
  invalidateMembers(conversationId)
  const state = await loadMembers(me, conversationId)
  if (state.state !== 'ok') return state
  const lists = await api.getMemberLists(conversationId, state.version)
  const participants = sorted(lists.participants ?? [])
  if (lists.version === state.version && sameIds(participants, state.members)) return state
  if (lists.version === state.version) {
    const signed = await signList(me, conversationId, state.version + 1, participants)
    if (signed === 'ok') {
      const pin = await getMemberPin(me, conversationId)
      if (pin) await putMemberPin(me, conversationId, withChange(pin, participants, state.version + 1, me, new Date().toISOString()))
    } else if (!signed) {
      throw new Error('This device can’t sign the member list until it’s verified.')
    }
  }
  invalidateMembers(conversationId)
  return loadMembers(me, conversationId)
}

// Who room keys may be sealed to. Null when nobody can be trusted right now:
// a list that doesn't verify, or strict mode without a signed list.
export async function sealableMembers(me: number, conversationId: number, serverIds: number[]): Promise<number[] | null> {
  const state = await loadMembers(me, conversationId).catch(() => null)
  if (state?.state === 'ok') return state.confirmed
  if (state?.state === 'invalid') return null
  return (await getFeatures()).strict ? null : serverIds
}
