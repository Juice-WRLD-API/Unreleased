// To-device messages (E2E v2, phase 3): the signed, sealed transport for
// device linking and for key requests between one person's own devices.
//   payload   = crypto_box_seal(json, recipient.enc_pub)
//   signature = sign(tbs("unrlsd/todevice/v2", type, sender_device_id, recipient_device_id, payload))
import * as api from './chatApi'
import type { ToDeviceIn } from './chatApi'
import { allRoomKeys, getRoomKey, getTrust, loadMsk, putTrust, saveMsk } from './chatKeyStore'
import { b64, sealOpen, seal, sign, signingPublicFromSecret, toDeviceBytes, unb64, verify } from './chatV2Crypto'
import { getFeatures, invalidateTrust, loadUserTrust, resetIdentity, type VerifiedDevice } from './chatIdentity'
import { ensureDevice, forgetPendingKeyFetches, identityStatus, matchesCommitment, storeRoomKey } from './chatE2E'

// --- events for the store / UI -----------------------------------------------------------

export type ToDeviceEvent =
  | { type: 'key-arrived'; conversation: number; version: number }
  | { type: 'linked' }
  | { type: 'offer-restore'; conversation: number; version: number }

const listeners = new Set<(ev: ToDeviceEvent) => void>()

export function onToDeviceEvent(fn: (ev: ToDeviceEvent) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(ev: ToDeviceEvent): void {
  for (const fn of listeners) {
    try { fn(ev) } catch (err) { console.warn('[chat] to-device listener failed', err) }
  }
}

// --- sending -------------------------------------------------------------------------------

export interface DeviceTarget { rowId: number; deviceId: string; encPub: string }

const PER_REQUEST = 60

export async function sendToDevices(userId: number, type: string, targets: DeviceTarget[], payloads: unknown[]): Promise<void> {
  const device = await ensureDevice(userId)
  const out: api.ToDeviceOut[] = []
  for (const t of targets) {
    for (const body of payloads) {
      const sealed = await seal(new TextEncoder().encode(JSON.stringify(body)), await unb64(t.encPub))
      out.push({
        recipient_device: t.rowId,
        type,
        payload: await b64(sealed),
        signature: await b64(await sign(toDeviceBytes(type, device.deviceId, t.deviceId, sealed), device.signing.secretKey)),
      })
    }
  }
  for (let i = 0; i < out.length; i += PER_REQUEST) {
    await api.sendToDevice(device.deviceId, out.slice(i, i + PER_REQUEST))
  }
}

async function ownOtherDevices(userId: number): Promise<DeviceTarget[]> {
  const device = await ensureDevice(userId)
  const trust = await loadUserTrust(userId, userId)
  if (trust.state !== 'ok') return []
  return trust.devices
    .filter((d): d is VerifiedDevice & { rowId: number } => d.rowId != null && d.deviceId !== device.deviceId)
    .map((d) => ({ rowId: d.rowId, deviceId: d.deviceId, encPub: d.encPub }))
}

// --- key requests ----------------------------------------------------------------------------

interface OpenRequest { id: string; sentAt: number; timer: number | null }
const openRequests = new Map<string, OpenRequest>()
const RESEND_AFTER_MS = 5 * 60_000
const ANSWER_WITHIN_MS = 10_000

// A device missing a room key asks its own user's other devices; any one that
// holds the key answers. At most one open request per (conversation, version),
// re-sent at most every five minutes.
export async function requestRoomKey(userId: number, conversation: number, version: number): Promise<void> {
  if (!(await getFeatures()).linking) return
  if (await identityStatus(userId) !== 'ready') return
  if (await getRoomKey(conversation, version)) return
  const slot = `${conversation}:${version}`
  const open = openRequests.get(slot)
  if (open && Date.now() - open.sentAt < RESEND_AFTER_MS) return
  const targets = await ownOtherDevices(userId)
  const request: OpenRequest = { id: crypto.randomUUID(), sentAt: Date.now(), timer: null }
  openRequests.set(slot, request)
  if (targets.length) {
    await sendToDevices(userId, 'key_request', targets, [{ request_id: request.id, conversation, key_version: version }])
  }
  request.timer = window.setTimeout(() => {
    request.timer = null
    if (openRequests.get(slot) !== request) return
    void import('./chatBackup').then(async (m) => {
      if (await m.backupExists(userId)) emit({ type: 'offer-restore', conversation, version })
    }).catch(() => undefined)
  }, targets.length ? ANSWER_WITHIN_MS : 0)
}

async function answerKeyRequest(userId: number, from: DeviceTarget, body: { request_id?: string; conversation?: number; key_version?: number }): Promise<void> {
  if (typeof body.conversation !== 'number' || typeof body.key_version !== 'number' || typeof body.request_id !== 'string') return
  const key = await getRoomKey(body.conversation, body.key_version)
  if (!key) return
  await sendToDevices(userId, 'key_share', [from], [{
    request_id: body.request_id, conversation: body.conversation, key_version: body.key_version, key: await b64(key),
  }])
}

async function acceptKeyShare(userId: number, body: { request_id?: string; conversation?: number; key_version?: number; key?: string }): Promise<void> {
  if (typeof body.conversation !== 'number' || typeof body.key_version !== 'number' || typeof body.key !== 'string') return
  const slot = `${body.conversation}:${body.key_version}`
  const open = openRequests.get(slot)
  if (!open || open.id !== body.request_id) return
  const key = await unb64(body.key)
  const info = await api.listConversationDevices(body.conversation, body.key_version)
  // Committed versions must match their commitment; uncommitted ones are v1
  // history, which only our own signed devices can send us here anyway.
  if (info.commitment && !await matchesCommitment(body.conversation, body.key_version, key, info.commitment.key_commitment)) {
    console.warn('[chat] key share did not match its commitment', slot)
    return
  }
  if (open.timer !== null) window.clearTimeout(open.timer)
  openRequests.delete(slot)
  await storeRoomKey(userId, body.conversation, body.key_version, key)
  forgetPendingKeyFetches(body.conversation)
  emit({ type: 'key-arrived', conversation: body.conversation, version: body.key_version })
  const others = await ownOtherDevices(userId)
  if (others.length) {
    await sendToDevices(userId, 'key_request_cancel', others, [{ request_id: body.request_id }]).catch(() => undefined)
  }
}

// --- link bundles --------------------------------------------------------------------------------

export interface LinkBundle {
  msk_secret: string
  backup_pub: string
  room_keys: { c: number; kv: number; k: string }[]
}

// Bundles go out in 512 KB parts; each part is its own to-device message.
const CHUNK_CHARS = 512 * 1024
const partials = new Map<string, { parts: (string | undefined)[]; received: number }>()

export async function sendLinkBundle(userId: number, target: DeviceTarget, bundle: LinkBundle): Promise<void> {
  const text = JSON.stringify(bundle)
  const bundleId = crypto.randomUUID()
  const parts = Math.max(1, Math.ceil(text.length / CHUNK_CHARS))
  const payloads = Array.from({ length: parts }, (_, i) => ({
    bundle_id: bundleId, part: i, parts, data: text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS),
  }))
  await sendToDevices(userId, 'link_bundle', [target], payloads)
}

export async function buildLinkBundle(msk: Uint8Array, backupPub: string): Promise<LinkBundle> {
  const keys = await allRoomKeys()
  return {
    msk_secret: await b64(msk),
    backup_pub: backupPub,
    room_keys: await Promise.all(keys.map(async (k) => ({ c: k.conversationId, kv: k.version, k: await b64(k.key) }))),
  }
}

async function acceptLinkPart(userId: number, body: { bundle_id?: string; part?: number; parts?: number; data?: string }): Promise<void> {
  const { bundle_id: id, part, parts, data } = body
  if (typeof id !== 'string' || typeof part !== 'number' || typeof parts !== 'number' || typeof data !== 'string') return
  if (parts < 1 || parts > 200 || part < 0 || part >= parts) return
  const entry = partials.get(id) ?? { parts: new Array<string | undefined>(parts), received: 0 }
  if (entry.parts[part] === undefined) {
    entry.parts[part] = data
    entry.received++
  }
  partials.set(id, entry)
  if (entry.received < parts) return
  partials.delete(id)
  await acceptLinkBundle(userId, JSON.parse(entry.parts.join('')) as LinkBundle)
}

// Set by startLink on the new device: the session it's waiting on, so the
// bundle is taken only from the device the server says claimed it.
let pendingLinkSession: string | null = null

export function expectLinkBundle(sessionId: string | null): void {
  pendingLinkSession = sessionId
}

async function fromClaimer(senderDeviceId: string): Promise<boolean> {
  if (!pendingLinkSession) return true
  const session = await api.getLinkSession(pendingLinkSession).catch(() => null)
  return session?.claimed_by?.device_id === senderDeviceId
}

// The new device's checks: the signer is in our list (done by the caller),
// the MSK matches the server's msk_pub, and the list includes this device.
async function acceptLinkBundle(userId: number, bundle: LinkBundle): Promise<void> {
  const device = await ensureDevice(userId)
  invalidateTrust(userId, userId)
  const trust = await loadUserTrust(userId, userId)
  if (trust.state !== 'ok') throw new Error('link: own identity not trusted')
  const msk = await unb64(bundle.msk_secret)
  if (await b64(await signingPublicFromSecret(msk)) !== trust.mskPub) throw new Error('link: MSK does not match')
  if (!trust.devices.some((d) => d.deviceId === device.deviceId)) throw new Error('link: this device is not in the list')
  await saveMsk(userId, msk)
  const record = await getTrust(userId, userId)
  await putTrust(userId, userId, { mskPub: trust.mskPub, listVersion: trust.listVersion, verified: record?.verified ?? false })
  for (const k of bundle.room_keys ?? []) {
    if (typeof k.c !== 'number' || typeof k.kv !== 'number' || typeof k.k !== 'string') continue
    await storeRoomKey(userId, k.c, k.kv, await unb64(k.k))
    forgetPendingKeyFetches(k.c)
  }
  pendingLinkSession = null
  resetIdentity()
  invalidateTrust(userId)
  emit({ type: 'linked' })
}

// --- inbox ------------------------------------------------------------------------------------------

let inboxRun: Promise<void> | null = null

export function processInbox(userId: number): Promise<void> {
  if (!inboxRun) {
    inboxRun = drainInbox(userId).finally(() => { inboxRun = null })
  }
  return inboxRun
}

async function drainInbox(userId: number): Promise<void> {
  if (!(await getFeatures()).linking) return
  const device = await ensureDevice(userId)
  for (let round = 0; round < 10; round++) {
    const batch = await api.fetchToDevice(device.deviceId)
    if (!batch.length) return
    for (const m of batch) {
      try {
        await handle(userId, m)
      } catch (err) {
        console.warn('[chat] dropped to-device message', m.type, err)
      }
    }
    // Everything is acked, handled or not: a bad message never gets better.
    await api.ackToDevice(batch.map((m) => m.id))
  }
}

async function handle(userId: number, m: ToDeviceIn): Promise<void> {
  // Devices never act on another user's key traffic; linking and key
  // requests are strictly between one person's own devices.
  if (m.sender_user !== userId) return
  const device = await ensureDevice(userId)
  if (m.type === 'link_bundle') invalidateTrust(userId, userId)
  let trust = await loadUserTrust(userId, userId)
  if (trust.state === 'ok' && !trust.devices.some((d) => d.deviceId === m.sender_device)) {
    // Maybe linked since we last looked (a missed devices.updated): re-read once.
    invalidateTrust(userId, userId)
    trust = await loadUserTrust(userId, userId)
  }
  if (trust.state !== 'ok') return
  const sender = trust.devices.find((d) => d.deviceId === m.sender_device)
  if (!sender) return
  const payload = await unb64(m.payload)
  const ok = await verify(await unb64(m.signature), toDeviceBytes(m.type, m.sender_device, device.deviceId, payload), await unb64(sender.signPub))
  if (!ok) return
  const body = JSON.parse(new TextDecoder().decode(await sealOpen(payload, device.identity.publicKey, device.identity.secretKey)))
  switch (m.type) {
    case 'link_bundle':
      // Only a device still waiting to be linked takes a bundle, and only
      // from the device that claimed its session.
      if (await loadMsk(userId)) throw new Error('link: this device is already linked')
      if (!await fromClaimer(m.sender_device)) throw new Error('link: bundle is not from the device that claimed the session')
      await acceptLinkPart(userId, body)
      return
    case 'key_request':
      if (sender.rowId == null) return
      await answerKeyRequest(userId, { rowId: sender.rowId, deviceId: sender.deviceId, encPub: sender.encPub }, body)
      return
    case 'key_share':
      await acceptKeyShare(userId, body)
      return
    case 'key_request_cancel':
      // We answer straight away, so there's nothing queued to cancel.
      return
  }
}
