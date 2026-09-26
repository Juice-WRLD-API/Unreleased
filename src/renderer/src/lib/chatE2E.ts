import * as api from './chatApi'
import type { ChatAttachment, ChatDevice, ChatMessage, Conversation, UploadedFile } from './chatApi'
import {
  decryptBytes, decryptName, decryptText, encryptBytes, encryptName, encryptText,
  generateIdentity, generateRoomKey, openRoomKey, sealRoomKey, toB64,
} from './chatCrypto'
import { getRoomKey, loadDevice, putRoomKey, saveDevice, type LocalDevice } from './chatKeyStore'

export interface ActiveDevice extends LocalDevice {
  serverId: number
}

let devicePromise: Promise<ActiveDevice> | null = null
let deviceUserId: number | null = null

function deviceLabel(): string {
  const ua = navigator.userAgent
  const app = (window as unknown as { electron?: unknown }).electron ? 'Unreleased Desktop' : null
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown'
  return `${app ?? browser} on ${os}`
}

async function setupDevice(userId: number): Promise<ActiveDevice> {
  let local = await loadDevice(userId)
  if (!local) {
    local = { userId, deviceId: crypto.randomUUID(), identity: await generateIdentity(), registered: false }
    await saveDevice(local)
  }
  const publicKey = await toB64(local.identity.publicKey)
  const mine = await api.listMyDevices()
  let server = mine.find((d) => d.device_id === local!.deviceId)
  if (server && server.public_key !== publicKey) {
    // The server remembers this device id under another key - a stale record
    // from a wiped key store. Replace it rather than trusting envelopes we
    // could never open.
    await api.revokeDevice(local.deviceId).catch(() => undefined)
    server = undefined
  }
  if (!server) {
    server = await api.registerDevice({ device_id: local.deviceId, public_key: publicKey, algorithm: 'x25519', label: deviceLabel() })
  }
  if (!local.registered) {
    local.registered = true
    await saveDevice(local)
  }
  return { ...local, serverId: server.id }
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
    const device = await ensureDevice(userId)
    const envelopes = await api.listEnvelopes(conversationId, version)
    const mine = envelopes.find((e) => e.recipient_device === device.serverId && e.key_version === version)
    if (!mine) return null
    const key = await openRoomKey(mine.encrypted_key, device.identity)
    await putRoomKey(conversationId, version, key)
    return key
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

// Exactly one device per person is keyed automatically: the oldest one they
// registered, which every participant derives the same way from the shared
// device list. Their other browsers get keys by export/import instead, so a
// room key is never sealed to more devices than it has to be. Revoking the
// oldest device promotes the next one.
export function primaryDevices(devices: ChatDevice[]): ChatDevice[] {
  const best = new Map<number, ChatDevice>()
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

export type KeyResolution =
  | { state: 'ready'; key: Uint8Array; version: number }
  | { state: 'waiting' }

// Current-version key for a conversation: cached or enveloped, otherwise we
// create one - but only when nothing has been said under this version yet,
// since a key someone else already used can't be replaced.
export async function resolveRoomKey(userId: number, conversation: Conversation, hasMessagesAtVersion: boolean): Promise<KeyResolution> {
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

// A participant's primary device needs the key everyone else already has.
// Only that one device is keyed - their other browsers import it - and only
// at the current version, so nobody receives keys from before a rotation.
export async function shareKeyWithUser(userId: number, conversation: Conversation, targetUserId: number): Promise<void> {
  const version = conversation.current_key_version
  const key = await getRoomKey(conversation.id, version)
  if (!key) return
  const device = await ensureDevice(userId)
  const { results } = await api.listConversationDevices(conversation.id)
  const target = primaryDevices(results).find((d) => d.owner === targetUserId)
  if (!target || target.id === device.serverId) return
  await api.postEnvelopes(conversation.id, [{
    recipient_device: target.id,
    key_version: version,
    encrypted_key: await sealRoomKey(key, target.public_key),
  }])
}

// Keys pasted in from another browser of ours - see lib/chatKeyTransfer.
export async function adoptImportedKeys(conversationIds: number[]): Promise<void> {
  for (const id of conversationIds) forgetPendingKeyFetches(id)
}

export async function decryptMessage(userId: number, message: ChatMessage): Promise<string> {
  if (!message.is_encrypted || !message.conversation || message.key_version == null) return message.content
  if (message.deleted_at || !message.ciphertext) return ''
  const key = await fetchRoomKey(userId, message.conversation, message.key_version)
  if (!key) throw new Error('missing-key')
  return decryptText(message.ciphertext, message.nonce, key)
}

export async function encryptForSend(text: string, key: Uint8Array): Promise<{ ciphertext: string; nonce: string }> {
  return encryptText(text, key)
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

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
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
  if (!att.encrypted_name || att.key_version == null) return { name: att.name, mime: att.mime }
  const key = await fetchRoomKey(userId, conversationId, att.key_version)
  if (!key) throw new Error('missing-key')
  const name = await decryptName(att.encrypted_name, key)
  return { name, mime: mimeFromName(name) }
}

export async function decryptAttachment(userId: number, conversationId: number, att: ChatAttachment): Promise<DecryptedAttachment> {
  if (att.key_version == null || !att.nonce) throw new Error('not-encrypted')
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
