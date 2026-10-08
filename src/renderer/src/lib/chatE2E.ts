import * as api from './chatApi'
import { deviceOwnerId } from './chatApi'
import type { ChatAttachment, ChatDevice, ChatMessage, Conversation, ConversationKeys, Envelope, KeyCommitmentInfo, UploadedFile } from './chatApi'
import {
  decryptBytes, decryptName, decryptText, encryptBytes, encryptName, encryptText,
  generateIdentity, generateRoomKey, openRoomKey, sealRoomKey, toB64,
} from './chatCrypto'
import { allRoomKeys, getRoomKey, loadDevice, putRoomKey, saveDevice, type LocalDevice } from './chatKeyStore'
import {
  aeadDecrypt, aeadEncrypt, attachmentAd, attachmentHash, b64, bytesEqual, commitBytes, envelopeBytes,
  generateSigningKey, keyCommitment, messageAd, messageSigBytes, seal, sign, unb64, verify,
  type SigningKeyPair,
} from './chatV2Crypto'
import {
  ensureIdentity, getFeatures, invalidateTrust, loadUsersTrust, loadUserTrust, resetIdentity,
  type IdentityStatus, type OwnDeviceKeys, type UserTrust,
} from './chatIdentity'

export interface ActiveDevice extends LocalDevice {
  serverId: number
  signing: SigningKeyPair
}

let devicePromise: Promise<ActiveDevice> | null = null
let deviceUserId: number | null = null

export function deviceLabel(): string {
  const ua = navigator.userAgent
  const app = (window as unknown as { electron?: unknown }).electron ? 'Unreleased Desktop' : null
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown'
  return `${app ?? browser} on ${os}`
}

async function setupDevice(userId: number): Promise<ActiveDevice> {
  let local = await loadDevice(userId)
  if (!local) {
    local = {
      userId, deviceId: crypto.randomUUID(), identity: await generateIdentity(),
      signing: await generateSigningKey(), registered: false,
    }
    await saveDevice(local)
  } else if (!local.signing) {
    // Set up before v2: add the device signing key alongside the old one.
    local.signing = await generateSigningKey()
    await saveDevice(local)
  }
  const signing = local.signing!
  const publicKey = await toB64(local.identity.publicKey)
  const signPub = await b64(signing.publicKey)
  const mine = await api.listMyDevices()
  let server = mine.find((d) => d.device_id === local!.deviceId)
  if (server && server.public_key !== publicKey) {
    // The server remembers this device id under another key - a stale record
    // from a wiped key store. Replace it rather than trusting envelopes we
    // could never open.
    await api.revokeDevice(local.deviceId).catch(() => undefined)
    server = undefined
  }
  if (!server || (server.sign_pub ?? '') !== signPub) {
    server = await api.registerDevice({ device_id: local.deviceId, public_key: publicKey, sign_pub: signPub, algorithm: 'x25519', label: deviceLabel() })
  }
  if (!local.registered) {
    local.registered = true
    await saveDevice(local)
  }
  return { ...local, signing, serverId: server.id }
}

export function ensureDevice(userId: number): Promise<ActiveDevice> {
  if (!devicePromise || deviceUserId !== userId) {
    deviceUserId = userId
    devicePromise = setupDevice(userId).catch((err) => {
      devicePromise = null
      throw err
    })
  }
  return devicePromise
}

// This browser's device id, without registering one if it has none yet.
export async function localDeviceId(userId: number): Promise<string | null> {
  return (await loadDevice(userId))?.deviceId ?? null
}

export function resetDevice(): void {
  devicePromise = null
  deviceUserId = null
  resetIdentity()
  invalidateTrust(0)
}

export function ownKeys(device: ActiveDevice): OwnDeviceKeys {
  return { deviceId: device.deviceId, encPub: device.identity.publicKey, signPub: device.signing.publicKey }
}

// v2 identity status for this account on this device ('disabled' until the
// identity phase is switched on server-side).
export async function identityStatus(userId: number): Promise<IdentityStatus> {
  const device = await ensureDevice(userId)
  return ensureIdentity(userId, ownKeys(device))
}

async function v2Active(userId: number): Promise<boolean> {
  return (await identityStatus(userId)) !== 'disabled'
}

// --- storing keys ------------------------------------------------------------------

// Every path that learns a room key it didn't have goes through here, so the
// encrypted backup (when set up) gets a copy.
export async function storeRoomKey(userId: number, conversationId: number, version: number, key: Uint8Array): Promise<void> {
  const had = await getRoomKey(conversationId, version)
  await putRoomKey(conversationId, version, key)
  if (had && bytesEqual(had, key)) return
  void import('./chatBackup').then((m) => m.backupRoomKey(userId, conversationId, version, key)).catch(() => undefined)
}

export async function matchesCommitment(conversationId: number, version: number, key: Uint8Array, commitment: string): Promise<boolean> {
  return bytesEqual(await keyCommitment(conversationId, version, key), await unb64(commitment))
}

// --- v1 envelopes -----------------------------------------------------------------------

async function openV1Envelope(userId: number, conversationId: number, version: number): Promise<Uint8Array | null> {
  const device = await ensureDevice(userId)
  const envelopes = await api.listEnvelopes(conversationId, version)
  const mine = envelopes.find((e) => e.recipient_device === device.serverId && e.key_version === version)
  if (!mine) return null
  const key = await openRoomKey(mine.encrypted_key, device.identity)
  await storeRoomKey(userId, conversationId, version, key)
  return key
}

// --- v2 envelopes -----------------------------------------------------------------------

function trustedDevice(trust: UserTrust | undefined, deviceId: string | null | undefined): { signPub: string } | null {
  if (!deviceId || !trust || trust.state !== 'ok') return null
  return trust.devices.find((d) => d.deviceId === deviceId) ?? null
}

function dropEnvelope(reason: string, envelope: Envelope): null {
  console.warn(`[chat] dropped key envelope: ${reason}`, { id: envelope.id, sender: envelope.sender_device_id })
  return null
}

// The recipient checks from the spec, in order; any failure drops it.
async function openV2Envelope(
  userId: number, conversationId: number, version: number, envelope: Envelope,
  commitment: KeyCommitmentInfo, memberIds: Set<number>,
): Promise<Uint8Array | null> {
  if (envelope.format !== 2 || !envelope.signature || envelope.created_by == null) return dropEnvelope('not v2', envelope)
  const device = await ensureDevice(userId)
  const trusts = await loadUsersTrust(userId, [envelope.created_by, commitment.creator_user])
  const sender = trustedDevice(trusts.get(envelope.created_by), envelope.sender_device_id)
  if (!sender) return dropEnvelope('sender device not in their signed list', envelope)
  if (!memberIds.has(envelope.created_by) || !memberIds.has(commitment.creator_user)) return dropEnvelope('not a participant', envelope)
  const creator = trustedDevice(trusts.get(commitment.creator_user), commitment.creator_device)
  if (!creator) return dropEnvelope('commitment creator not in their signed list', envelope)
  const encrypted = await unb64(envelope.encrypted_key)
  const envOk = await verify(
    await unb64(envelope.signature),
    envelopeBytes(conversationId, version, device.deviceId, envelope.sender_device_id!, encrypted),
    await unb64(sender.signPub),
  )
  const commitOk = await verify(
    await unb64(commitment.commit_sig),
    commitBytes(conversationId, version, await unb64(commitment.key_commitment)),
    await unb64(creator.signPub),
  )
  if (!envOk || !commitOk) return dropEnvelope('bad signature', envelope)
  let key: Uint8Array
  try {
    key = await openRoomKey(envelope.encrypted_key, device.identity)
  } catch {
    return dropEnvelope('could not open', envelope)
  }
  if (!await matchesCommitment(conversationId, version, key, commitment.key_commitment)) return dropEnvelope('commitment mismatch', envelope)
  return key
}

async function fetchV2Key(userId: number, conversationId: number, version: number, info: ConversationKeys): Promise<Uint8Array | null> {
  const commitment = info.commitment
  if (!commitment) return null
  const cached = await getRoomKey(conversationId, version)
  if (cached && await matchesCommitment(conversationId, version, cached, commitment.key_commitment)) return cached
  const device = await ensureDevice(userId)
  const envelopes = await api.listEnvelopes(conversationId, version)
  const mine = envelopes.find((e) => e.recipient_device === device.serverId && e.key_version === version)
  if (!mine) return null
  const members = new Set((info.members ?? []).map((m) => m.user_id))
  const key = await openV2Envelope(userId, conversationId, version, mine, commitment, members)
  if (key) await storeRoomKey(userId, conversationId, version, key)
  return key
}

// Opens whichever envelope for (conversation, version) is addressed to this
// device, caching the recovered key. Null when none exists for us yet.
const keyFetches = new Map<string, Promise<Uint8Array | null>>()

export function fetchRoomKey(userId: number, conversationId: number, version: number): Promise<Uint8Array | null> {
  const id = `${conversationId}:${version}`
  const inFlight = keyFetches.get(id)
  if (inFlight) return inFlight
  const run = (async () => {
    const cached = await getRoomKey(conversationId, version)
    if (cached) return cached
    if (await v2Active(userId)) {
      const info = await api.listConversationDevices(conversationId, version)
      // A committed version only ever accepts a v2 envelope, so the server
      // can't slip in a v1 one for it.
      if (info.commitment) return fetchV2Key(userId, conversationId, version, info)
    }
    return openV1Envelope(userId, conversationId, version)
  })().finally(() => {
    if (keyFetches.get(id) === run) keyFetches.delete(id)
  })
  keyFetches.set(id, run)
  return run
}

// A lookup already in flight may have listed envelopes before a new one was
// posted; once we hear one exists, the next caller has to ask again rather
// than share that stale answer.
export function forgetPendingKeyFetches(conversationId: number): void {
  for (const id of keyFetches.keys()) {
    if (id.startsWith(`${conversationId}:`)) keyFetches.delete(id)
  }
}

// --- v1 distribution (until the identity phase is on) ------------------------------------

// Exactly one device per person is keyed automatically: the oldest one they
// registered, which every participant derives the same way from the shared
// device list. Their other browsers get keys by export/import instead, so a
// room key is never sealed to more devices than it has to be. Revoking the
// oldest device promotes the next one.
export function primaryDevices(devices: ChatDevice[]): ChatDevice[] {
  const best = new Map<ChatDevice['owner'], ChatDevice>()
  for (const d of devices) {
    const cur = best.get(d.owner)
    if (!cur || olderDevice(d, cur)) best.set(d.owner, d)
  }
  return [...best.values()]
}

function olderDevice(a: ChatDevice, b: ChatDevice): boolean {
  if (a.created_at && b.created_at && a.created_at !== b.created_at) return a.created_at < b.created_at
  return a.id < b.id
}

async function sealForDevices(conversationId: number, version: number, key: Uint8Array): Promise<void> {
  const { results } = await api.listConversationDevices(conversationId)
  const targets = primaryDevices(results)
  if (targets.length === 0) return
  const envelopes = await Promise.all(targets.map(async (d) => ({
    recipient_device: d.id,
    key_version: version,
    encrypted_key: await sealRoomKey(key, d.public_key),
  })))
  await api.postEnvelopes(conversationId, envelopes)
}

// Generates and distributes a fresh key for the conversation's current version.
export async function establishRoomKey(userId: number, conversationId: number): Promise<{ key: Uint8Array; version: number }> {
  await ensureDevice(userId)
  const { current_key_version: version } = await api.listConversationDevices(conversationId)
  const key = await generateRoomKey()
  await sealForDevices(conversationId, version, key)
  await putRoomKey(conversationId, version, key)
  return { key, version }
}

// --- v2 distribution --------------------------------------------------------------------

interface SealTarget { rowId: number; deviceId: string; encPub: string }

// Every signed device of every member (our own other devices included). A
// member with no v2 identity yet is on an older client, so their server rows
// are used as in v1; one whose key changed gets nothing until it's accepted.
async function memberTargets(userId: number, memberIds: number[]): Promise<SealTarget[]> {
  const trusts = await loadUsersTrust(userId, memberIds)
  const out: SealTarget[] = []
  for (const trust of trusts.values()) {
    if (trust.state === 'ok') {
      for (const d of trust.devices) if (d.rowId != null) out.push({ rowId: d.rowId, deviceId: d.deviceId, encPub: d.encPub })
    } else if (trust.state === 'none') {
      for (const r of trust.serverDevices) out.push({ rowId: r.id, deviceId: r.device_id, encPub: r.public_key })
    }
  }
  return out
}

async function postV2Envelopes(userId: number, conversationId: number, version: number, key: Uint8Array, targets: SealTarget[]): Promise<void> {
  const device = await ensureDevice(userId)
  const envelopes: Envelope[] = []
  for (const t of targets) {
    if (t.rowId === device.serverId) continue
    const encrypted = await seal(key, await unb64(t.encPub))
    envelopes.push({
      recipient_device: t.rowId,
      key_version: version,
      encrypted_key: await b64(encrypted),
      format: 2,
      sender_device: device.deviceId,
      signature: await b64(await sign(envelopeBytes(conversationId, version, t.deviceId, device.deviceId, encrypted), device.signing.secretKey)),
    })
  }
  for (let i = 0; i < envelopes.length; i += 100) {
    await api.postEnvelopes(conversationId, envelopes.slice(i, i + 100))
  }
}

// First writer wins: commit on the server, and only then hand the key out.
// Null when someone else committed this version first.
async function establishV2(userId: number, conversationId: number, version: number, memberIds: number[]): Promise<Uint8Array | null> {
  const device = await ensureDevice(userId)
  const key = await generateRoomKey()
  const commitment = await keyCommitment(conversationId, version, key)
  const res = await api.establishKey(conversationId, {
    key_version: version,
    key_commitment: await b64(commitment),
    creator_device: device.deviceId,
    commit_sig: await b64(await sign(commitBytes(conversationId, version, commitment), device.signing.secretKey)),
  })
  if (!res.ok) return null
  await storeRoomKey(userId, conversationId, version, key)
  await postV2Envelopes(userId, conversationId, version, key, await memberTargets(userId, memberIds))
  return key
}

// Conversations that must move to a fresh key on their next send: a member's
// device list dropped a device. (A member leaving is rotated by the server.)
const pendingRotation = new Set<number>()
const ROTATE_AFTER_MS = 7 * 24 * 3600_000
const ROTATE_AFTER_MESSAGES = 500

export function markForRotation(conversationId: number): void {
  pendingRotation.add(conversationId)
}

async function rotationDue(conversationId: number, info: ConversationKeys): Promise<boolean> {
  if (pendingRotation.has(conversationId)) return true
  if (!(await getFeatures()).backup) return false
  const created = info.commitment ? Date.parse(info.commitment.created_at) : NaN
  return (Number.isFinite(created) && Date.now() - created > ROTATE_AFTER_MS) || (info.message_count ?? 0) > ROTATE_AFTER_MESSAGES
}

export type KeyResolution =
  | { state: 'ready'; key: Uint8Array; version: number }
  | { state: 'waiting'; reason?: 'needs-link' }

async function resolveV2(userId: number, conversation: Conversation, forSend: boolean, mayRotate = true): Promise<KeyResolution> {
  const info = await api.listConversationDevices(conversation.id)
  const version = info.current_key_version
  const memberIds = (info.members ?? []).map((m) => m.user_id)

  // The first sender after a trigger rotates; a 409 just means someone else
  // already did, and either way we resolve again at the new version.
  const rotate = async (): Promise<KeyResolution> => {
    await api.rotateKey(conversation.id, version)
    pendingRotation.delete(conversation.id)
    forgetPendingKeyFetches(conversation.id)
    return resolveV2(userId, conversation, forSend, false)
  }

  if (info.commitment) {
    const key = await fetchV2Key(userId, conversation.id, version, info)
    if (!key) {
      void import('./chatToDevice').then((m) => m.requestRoomKey(userId, conversation.id, version)).catch(() => undefined)
      return { state: 'waiting' }
    }
    if (forSend && mayRotate && await rotationDue(conversation.id, info)) return rotate()
    return { state: 'ready', key, version }
  }

  // Nothing committed at this version. If it was used under v1, reading
  // stays v1, and the first send moves the conversation to a fresh v2 key.
  const v1Key = await getRoomKey(conversation.id, version)
  if ((info.message_count ?? 0) > 0 || v1Key) {
    if (forSend && mayRotate) return rotate()
    const key = v1Key ?? await openV1Envelope(userId, conversation.id, version)
    return key ? { state: 'ready', key, version } : { state: 'waiting' }
  }

  const created = await establishV2(userId, conversation.id, version, memberIds)
  if (created) return { state: 'ready', key: created, version }
  // Lost the race: take the winner's key once its envelope lands.
  forgetPendingKeyFetches(conversation.id)
  const raced = await fetchV2Key(userId, conversation.id, version, await api.listConversationDevices(conversation.id, version))
  return raced ? { state: 'ready', key: raced, version } : { state: 'waiting' }
}

// Current-version key for a conversation: cached or enveloped, otherwise we
// create one - but only when nothing has been said under this version yet,
// since a key someone else already used can't be replaced.
export async function resolveRoomKey(
  userId: number, conversation: Conversation, hasMessagesAtVersion: boolean, opts: { forSend?: boolean } = {},
): Promise<KeyResolution> {
  const status = await identityStatus(userId)
  if (status === 'needs-link') {
    // Not in our own signed list: nobody will accept this device's keys or
    // envelopes until it's linked. v1 keys it already holds still read.
    const cached = await getRoomKey(conversation.id, conversation.current_key_version)
    return cached ? { state: 'ready', key: cached, version: conversation.current_key_version } : { state: 'waiting', reason: 'needs-link' }
  }
  if (status === 'ready') return resolveV2(userId, conversation, !!opts.forSend)

  const version = conversation.current_key_version
  const existing = await fetchRoomKey(userId, conversation.id, version)
  if (existing) return { state: 'ready', key: existing, version }
  if (hasMessagesAtVersion) return { state: 'waiting' }
  // Stagger so two participants opening a fresh DM together rarely both mint
  // a key; the second one re-checks and adopts the first's.
  await new Promise((r) => setTimeout(r, 200 + Math.random() * 900))
  const raced = await fetchRoomKey(userId, conversation.id, version)
  if (raced) return { state: 'ready', key: raced, version }
  const established = await establishRoomKey(userId, conversation.id)
  return { state: 'ready', ...established }
}

// A participant's devices need the key everyone else already has - only at
// the current version, so nobody receives keys from before a rotation.
export async function shareKeyWithUser(userId: number, conversation: Conversation, targetUserId: number): Promise<void> {
  const version = conversation.current_key_version
  const key = await getRoomKey(conversation.id, version)
  if (!key) return
  const device = await ensureDevice(userId)
  const status = await identityStatus(userId)
  if (status === 'ready') {
    await postV2Envelopes(userId, conversation.id, version, key, await memberTargets(userId, [targetUserId]))
    return
  }
  if (status === 'needs-link') return
  const { results } = await api.listConversationDevices(conversation.id)
  const target = primaryDevices(results).find((d) => deviceOwnerId(d) === targetUserId)
  if (!target || target.id === device.serverId) return
  await api.postEnvelopes(conversation.id, [{
    recipient_device: target.id,
    key_version: version,
    encrypted_key: await sealRoomKey(key, target.public_key),
  }])
}

// A member published a new device list. Their new devices get keys: from our
// own devices every key we hold (that's history), from anyone else only each
// shared conversation's current key. A dropped device means those
// conversations rotate on their next send.
export async function onDevicesUpdated(userId: number, changedUser: number, dropped: boolean, conversations: Conversation[]): Promise<void> {
  if (await identityStatus(userId) !== 'ready') {
    invalidateTrust(userId, changedUser)
    return
  }
  const before = await loadUserTrust(userId, changedUser).catch(() => null)
  invalidateTrust(userId, changedUser)
  const after = await loadUserTrust(userId, changedUser)
  const shared = conversations.filter((c) => c.participants.some((p) => p.user.id === changedUser))
  if (dropped) for (const c of shared) markForRotation(c.id)
  if (after.state !== 'ok') return
  const known = new Set(before?.state === 'ok' ? before.devices.map((d) => d.deviceId) : [])
  const fresh = after.devices.filter((d) => !known.has(d.deviceId) && d.rowId != null)
    .map((d) => ({ rowId: d.rowId!, deviceId: d.deviceId, encPub: d.encPub }))
  if (!fresh.length) return
  if (changedUser === userId) {
    // The server drops envelopes for versions that were never committed (v1
    // history); those travel in the link bundle instead.
    const byConversation = new Map<number, { version: number; key: Uint8Array }[]>()
    for (const k of await allRoomKeys()) {
      const list = byConversation.get(k.conversationId) ?? []
      list.push({ version: k.version, key: k.key })
      byConversation.set(k.conversationId, list)
    }
    for (const c of shared) {
      for (const k of byConversation.get(c.id) ?? []) {
        await postV2Envelopes(userId, c.id, k.version, k.key, fresh).catch(() => undefined)
      }
    }
    return
  }
  for (const c of shared) {
    const key = await getRoomKey(c.id, c.current_key_version)
    if (key) await postV2Envelopes(userId, c.id, c.current_key_version, key, fresh).catch(() => undefined)
  }
}

// Keys pasted in from another browser of ours - see lib/chatKeyTransfer.
export async function adoptImportedKeys(conversationIds: number[]): Promise<void> {
  for (const id of conversationIds) forgetPendingKeyFetches(id)
}

// --- messages ---------------------------------------------------------------------------

export interface AttachmentManifest {
  name: string
  size: number
  nonce: string
  hash: string
}

interface BodyV2 {
  v: 2
  text: string
  reply_to: string | null
  att: AttachmentManifest[]
}

export interface DecryptedMessage {
  text: string
  // v2 only: the signature, sender device or attachment list didn't check
  // out. The text still shows, with a "couldn't verify" badge.
  unverified?: boolean
}

// Attachment manifests travel inside the v2 body, so an attachment can only
// be named or opened once its message has been decrypted. Callers that ask
// first wait here until it has.
interface ManifestEntry extends AttachmentManifest {
  index: number
  clientId: string
}
interface ManifestSlot {
  promise: Promise<ManifestEntry>
  resolve: (m: ManifestEntry) => void
  reject: (err: Error) => void
}
const manifests = new Map<number, ManifestSlot>()
const bodies = new Map<number, BodyV2>()

function manifestSlot(attachmentId: number): ManifestSlot {
  let slot = manifests.get(attachmentId)
  if (!slot) {
    let resolve!: (m: ManifestEntry) => void
    let reject!: (err: Error) => void
    const promise = new Promise<ManifestEntry>((res, rej) => { resolve = res; reject = rej })
    promise.catch(() => undefined)
    slot = { promise, resolve, reject }
    manifests.set(attachmentId, slot)
  }
  return slot
}

function failManifests(message: ChatMessage, reason: string): void {
  for (const a of message.attachments) {
    manifestSlot(a.id).reject(new Error(reason))
    // A later decrypt (once the key arrives) starts a fresh wait.
    manifests.delete(a.id)
  }
}

const isV2Attachment = (att: ChatAttachment): boolean => !att.encrypted_name && !!att.nonce && att.key_version != null

async function senderSignPub(userId: number, authorId: number, deviceId: string): Promise<string | null> {
  const trust = await loadUserTrust(userId, authorId)
  if (trust.state === 'ok') return trustedDevice(trust, deviceId)?.signPub ?? null
  // Phase 1: the author has no master key yet, so the best available is the
  // server's record of that device's signing key.
  if (trust.state === 'none') return trust.serverDevices.find((r) => r.device_id === deviceId)?.sign_pub || null
  return null
}

async function decryptV2(userId: number, message: ChatMessage, key: Uint8Array): Promise<DecryptedMessage> {
  const ad = messageAd({
    conversationId: message.conversation!, keyVersion: message.key_version!, senderUserId: message.author.id,
    senderDeviceId: message.sender_device ?? '', clientId: message.client_id ?? '', editSeq: message.edit_seq ?? 0,
    mentions: message.mentions,
  })
  const ct = await unb64(message.ciphertext)
  const nonce = await unb64(message.nonce)
  const plain = await aeadDecrypt(ct, ad, nonce, key)
  const body = JSON.parse(new TextDecoder().decode(plain)) as BodyV2
  if (body?.v !== 2) throw new Error('failed')
  const att = Array.isArray(body.att) ? body.att : []
  bodies.set(message.id, { ...body, att })
  const signPub = message.signature ? await senderSignPub(userId, message.author.id, message.sender_device ?? '') : null
  const signed = !!signPub && await verify(await unb64(message.signature!), messageSigBytes(ad, nonce, ct), await unb64(signPub))
  const attOk = att.length === message.attachments.length
  message.attachments.forEach((a, i) => {
    if (att[i]) manifestSlot(a.id).resolve({ ...att[i], index: i, clientId: message.client_id ?? '' })
    else manifestSlot(a.id).reject(new Error('failed'))
  })
  return { text: typeof body.text === 'string' ? body.text : '', unverified: !signed || !attOk || undefined }
}

export async function decryptMessageFull(userId: number, message: ChatMessage): Promise<DecryptedMessage> {
  if (!message.is_encrypted || !message.conversation || message.key_version == null) return { text: message.content }
  if (message.deleted_at || !message.ciphertext) return { text: '' }
  const key = await fetchRoomKey(userId, message.conversation, message.key_version)
  if (!key) {
    if (message.format === 2) failManifests(message, 'missing-key')
    void import('./chatToDevice').then((m) => m.requestRoomKey(userId, message.conversation!, message.key_version!)).catch(() => undefined)
    throw new Error('missing-key')
  }
  if (message.format === 2) {
    try {
      return await decryptV2(userId, message, key)
    } catch (err) {
      failManifests(message, 'failed')
      throw err
    }
  }
  return { text: await decryptText(message.ciphertext, message.nonce, key) }
}

export async function decryptMessage(userId: number, message: ChatMessage): Promise<string> {
  return (await decryptMessageFull(userId, message)).text
}

export async function encryptForSend(text: string, key: Uint8Array): Promise<{ ciphertext: string; nonce: string }> {
  return encryptText(text, key)
}

// Whether this client sends format 2 (phase 1 on).
export async function sendsV2(): Promise<boolean> {
  return (await getFeatures()).send
}

export interface SealedV2 {
  ciphertext: string
  nonce: string
  key_version: number
  format: 2
  client_id: string
  sender_device: string
  edit_seq: number
  signature: string
  mentions: number[]
}

export async function sealMessageV2(userId: number, input: {
  conversationId: number
  key: Uint8Array
  version: number
  text: string
  mentions: number[]
  clientId: string
  editSeq: number
  replyTo?: string | null
  att: AttachmentManifest[]
}): Promise<SealedV2> {
  const device = await ensureDevice(userId)
  const mentions = [...new Set(input.mentions)]
  const ad = messageAd({
    conversationId: input.conversationId, keyVersion: input.version, senderUserId: userId,
    senderDeviceId: device.deviceId, clientId: input.clientId, editSeq: input.editSeq, mentions,
  })
  const body: BodyV2 = { v: 2, text: input.text, reply_to: input.replyTo ?? null, att: input.att }
  const { ct, nonce } = await aeadEncrypt(new TextEncoder().encode(JSON.stringify(body)), ad, input.key)
  const signature = await sign(messageSigBytes(ad, nonce, ct), device.signing.secretKey)
  return {
    ciphertext: await b64(ct), nonce: await b64(nonce), key_version: input.version, format: 2,
    client_id: input.clientId, sender_device: device.deviceId, edit_seq: input.editSeq,
    signature: await b64(signature), mentions,
  }
}

// An edit re-seals the same client_id one edit_seq up, under the current key,
// carrying the original attachment list and reply along.
export async function sealEditV2(userId: number, message: ChatMessage, text: string, key: Uint8Array, version: number): Promise<SealedV2> {
  let body = bodies.get(message.id)
  if (!body) {
    await decryptMessageFull(userId, message)
    body = bodies.get(message.id)
  }
  return sealMessageV2(userId, {
    conversationId: message.conversation!, key, version, text, mentions: message.mentions,
    clientId: message.client_id!, editSeq: (message.edit_seq ?? 0) + 1, replyTo: body?.reply_to ?? null, att: body?.att ?? [],
  })
}

export function clientIdOf(message: ChatMessage | undefined): string | null {
  return message?.format === 2 ? message.client_id ?? null : null
}

export async function uploadEncryptedFile(file: File, key: Uint8Array, version: number): Promise<api.AttachmentInput> {
  const plain = new Uint8Array(await file.arrayBuffer())
  const { bytes, nonce } = await encryptBytes(plain, key)
  const uploaded: UploadedFile = await api.uploadChatFile(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }), 'attachment.bin')
  return {
    ...uploaded,
    name: 'attachment.bin',
    mime: 'application/octet-stream',
    size: file.size,
    nonce,
    key_version: version,
    encrypted_name: await encryptName(file.name, key),
  }
}

// v2: the file is bound to its message and slot by the AD, and its name,
// size and hash ride in the encrypted body instead of encrypted_name.
export async function uploadEncryptedFileV2(
  file: File, key: Uint8Array, conversationId: number, version: number, clientId: string, index: number,
): Promise<{ input: api.AttachmentInput; manifest: AttachmentManifest }> {
  const plain = new Uint8Array(await file.arrayBuffer())
  const { ct, nonce } = await aeadEncrypt(plain, attachmentAd(conversationId, version, clientId, index), key)
  const uploaded = await api.uploadChatFile(new Blob([ct as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }), 'attachment.bin')
  const nonceB64 = await b64(nonce)
  return {
    input: { ...uploaded, name: 'attachment.bin', mime: 'application/octet-stream', size: file.size, nonce: nonceB64, key_version: version },
    manifest: { name: file.name, size: file.size, nonce: nonceB64, hash: await attachmentHash(ct) },
  }
}

// No svg: the name is sender-chosen, and a decrypted blob: URL is same-origin,
// so an image/svg+xml blob opened as a document could run script in the app.
// It falls back to octet-stream and shows as a plain download instead.
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac',
  pdf: 'application/pdf', txt: 'text/plain', json: 'application/json', zip: 'application/zip',
}

export function mimeFromName(name: string, fallback = 'application/octet-stream'): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? fallback
}

export interface DecryptedAttachment {
  name: string
  mime: string
  blob: Blob
}

export async function decryptAttachmentMeta(userId: number, conversationId: number, att: ChatAttachment): Promise<{ name: string; mime: string }> {
  if (isV2Attachment(att)) {
    const entry = await manifestSlot(att.id).promise
    return { name: entry.name, mime: mimeFromName(entry.name) }
  }
  if (!att.encrypted_name || att.key_version == null) return { name: att.name, mime: att.mime }
  const key = await fetchRoomKey(userId, conversationId, att.key_version)
  if (!key) throw new Error('missing-key')
  const name = await decryptName(att.encrypted_name, key)
  return { name, mime: mimeFromName(name) }
}

export async function decryptAttachment(userId: number, conversationId: number, att: ChatAttachment): Promise<DecryptedAttachment> {
  if (att.key_version == null || !att.nonce) throw new Error('not-encrypted')
  if (isV2Attachment(att)) {
    const [entry, key, cipher] = await Promise.all([
      manifestSlot(att.id).promise,
      fetchRoomKey(userId, conversationId, att.key_version),
      api.fetchAttachmentBytes(att.id),
    ])
    if (!key) throw new Error('missing-key')
    // The server handed back a different file than the sender uploaded.
    if (await attachmentHash(cipher) !== entry.hash || entry.nonce !== att.nonce) throw new Error('failed')
    const plain = await aeadDecrypt(cipher, attachmentAd(conversationId, att.key_version, entry.clientId, entry.index), await unb64(att.nonce), key)
    const mime = mimeFromName(entry.name)
    return { name: entry.name, mime, blob: new Blob([plain as Uint8Array<ArrayBuffer>], { type: mime }) }
  }
  const [meta, key, cipher] = await Promise.all([
    decryptAttachmentMeta(userId, conversationId, att),
    fetchRoomKey(userId, conversationId, att.key_version),
    api.fetchAttachmentBytes(att.id),
  ])
  if (!key) throw new Error('missing-key')
  const plain = await decryptBytes(cipher, att.nonce, key)
  return { ...meta, blob: new Blob([plain as Uint8Array<ArrayBuffer>], { type: meta.mime || 'application/octet-stream' }) }
}

// Encrypted uploads all land as `attachment.bin` / application/octet-stream,
// so anything that needs the real name or mime has to decrypt the name first.
// Several callers want the same answer for the same attachment (the preview,
// the context menu), so keep the in-flight promise around; failures are
// dropped so a later retry can pick up a key that has since arrived.
const metaCache = new Map<number, Promise<{ name: string; mime: string }>>()

export function decryptAttachmentMetaCached(userId: number, conversationId: number, att: ChatAttachment): Promise<{ name: string; mime: string }> {
  if (att.id < 0) return decryptAttachmentMeta(userId, conversationId, att)
  const hit = metaCache.get(att.id)
  if (hit) return hit
  const pending = decryptAttachmentMeta(userId, conversationId, att).catch((err) => {
    metaCache.delete(att.id)
    throw err
  })
  metaCache.set(att.id, pending)
  return pending
}
