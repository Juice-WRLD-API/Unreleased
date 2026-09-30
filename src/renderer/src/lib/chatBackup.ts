// Encrypted key backup and recovery (E2E v2, phase 4). Room keys and the
// master key are sealed on the server to a public key derived from a random
// recovery code. Every device can add to the backup; only the code reads it.
import * as api from './chatApi'
import { allRoomKeys, loadMsk, putRoomKey, putTrust, saveMsk, getTrust } from './chatKeyStore'
import {
  b64, backupBytes, backupKeyPair, decodeRecoveryCode, encodeRecoveryCode, randomBytes, seal, sealOpen, sign,
  signingPublicFromSecret, unb64, verify,
} from './chatV2Crypto'
import { getFeatures, invalidateTrust, publishDeviceList, resetIdentity } from './chatIdentity'
import { ensureDevice, forgetPendingKeyFetches, matchesCommitment, ownKeys } from './chatE2E'

// --- writing ------------------------------------------------------------------------------------

let backupState: Promise<string | null> | null = null

// The backup key this device writes to, once its signature checks out
// against our own master key; null when there's no (valid) backup.
function currentBackupPub(userId: number): Promise<string | null> {
  if (!backupState) {
    backupState = (async () => {
      const msk = await loadMsk(userId)
      if (!msk) return null
      const backup = await api.getBackup()
      if (!backup?.backup_pub) return null
      const ok = await verify(
        await unb64(backup.backup_sig),
        backupBytes(userId, await unb64(backup.backup_pub)),
        await signingPublicFromSecret(msk),
      )
      return ok ? backup.backup_pub : null
    })().catch(() => {
      backupState = null
      return null
    })
  }
  return backupState
}

export function forgetBackupState(): void {
  backupState = null
}

export async function backupExists(userId: number): Promise<boolean> {
  void userId
  return !!(await api.getBackup().catch(() => null))?.backup_pub
}

const queue: { conversation: number; key_version: number; key: Uint8Array }[] = []
let flushTimer: number | null = null

export async function backupRoomKey(userId: number, conversation: number, version: number, key: Uint8Array): Promise<void> {
  if (!(await getFeatures()).backup) return
  queue.push({ conversation, key_version: version, key })
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flush(userId).catch((err) => console.warn('[chat] backup write failed', err))
  }, 2000)
}

async function flush(userId: number): Promise<void> {
  const pub = await currentBackupPub(userId)
  const items = queue.splice(0)
  if (!pub || !items.length) return
  const pubBytes = await unb64(pub)
  const entries = await Promise.all(items.map(async (i) => ({
    conversation: i.conversation, key_version: i.key_version, sealed: await b64(await seal(i.key, pubBytes)),
  })))
  for (let i = 0; i < entries.length; i += 500) {
    const res = await api.postBackupEntries(pub, entries.slice(i, i + 500))
    if (!res.ok) {
      // The code was changed elsewhere; re-read and let the next write retry.
      forgetBackupState()
      return
    }
  }
}

async function uploadAll(pub: string): Promise<void> {
  const pubBytes = await unb64(pub)
  const keys = await allRoomKeys()
  for (let i = 0; i < keys.length; i += 500) {
    const entries = await Promise.all(keys.slice(i, i + 500).map(async (k) => ({
      conversation: k.conversationId, key_version: k.version, sealed: await b64(await seal(k.key, pubBytes)),
    })))
    await api.postBackupEntries(pub, entries)
  }
}

// --- setup / change ------------------------------------------------------------------------------

async function freshBackup(userId: number, msk: Uint8Array): Promise<{ code: string; pub: string; sig: string; sealedMsk: string; keyPair: { publicKey: Uint8Array; secretKey: Uint8Array } }> {
  const bk = await randomBytes(32)
  const keyPair = await backupKeyPair(bk)
  return {
    code: encodeRecoveryCode(bk),
    pub: await b64(keyPair.publicKey),
    sig: await b64(await sign(backupBytes(userId, keyPair.publicKey), msk)),
    sealedMsk: await b64(await seal(msk, keyPair.publicKey)),
    keyPair,
  }
}

// Returns the recovery code, to be shown exactly once.
export async function setupBackup(userId: number): Promise<string> {
  const msk = await loadMsk(userId)
  if (!msk) throw new Error('This device does not hold your security key.')
  if (await backupExists(userId)) throw new Error('A backup already exists. Change its recovery code instead.')
  const next = await freshBackup(userId, msk)
  const res = await api.putBackup({ backup_pub: next.pub, backup_sig: next.sig, sealed_msk: next.sealedMsk })
  if (!res.ok) throw new Error(res.data?.detail || 'Could not set up the backup.')
  forgetBackupState()
  await uploadAll(next.pub)
  return next.code
}

async function openWithCode(code: string): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array; backup: { backup_pub: string; backup_sig: string; sealed_msk: string } }> {
  const bk = decodeRecoveryCode(code)
  if (!bk) throw new Error('That recovery code is not valid. It is 52 characters in groups of 4.')
  const kp = await backupKeyPair(bk)
  const backup = await api.getBackup()
  if (!backup) throw new Error('There is no backup to restore from.')
  if (await b64(kp.publicKey) !== backup.backup_pub) throw new Error('That recovery code does not match your backup.')
  return { ...kp, backup }
}

async function allEntries(): Promise<api.BackupEntryIn[]> {
  const out: api.BackupEntryIn[] = []
  let after: number | undefined
  for (;;) {
    const page = await api.listBackupEntries(after)
    out.push(...page.results)
    if (page.next == null) return out
    after = page.next
  }
}

// A new code means a new backup key: every entry is re-sealed to it and the
// server swaps the key and entries in one step.
export async function changeRecoveryCode(userId: number, oldCode: string): Promise<string> {
  const msk = await loadMsk(userId)
  if (!msk) throw new Error('This device does not hold your security key.')
  const old = await openWithCode(oldCode)
  const next = await freshBackup(userId, msk)
  const entries = []
  for (const e of await allEntries()) {
    const key = await sealOpen(await unb64(e.sealed), old.publicKey, old.secretKey)
    entries.push({ conversation: e.conversation, key_version: e.key_version, sealed: await b64(await seal(key, next.keyPair.publicKey)) })
  }
  const res = await api.putBackup({
    backup_pub: next.pub, backup_sig: next.sig, sealed_msk: next.sealedMsk,
    expected_backup_pub: old.backup.backup_pub, entries,
  })
  if (!res.ok) throw new Error(res.data?.detail || 'The backup changed while re-sealing; try again.')
  forgetBackupState()
  return next.code
}

// --- restore -----------------------------------------------------------------------------------

export async function restoreFromCode(userId: number, code: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  const opened = await openWithCode(code)
  const msk = await sealOpen(await unb64(opened.backup.sealed_msk), opened.publicKey, opened.secretKey)
  const mskPub = await signingPublicFromSecret(msk)
  const keys = await api.getUserKeys(userId)
  if (await b64(mskPub) !== keys.msk_pub) throw new Error('The backed-up security key does not match your account.')
  const sigOk = await verify(await unb64(opened.backup.backup_sig), backupBytes(userId, opened.publicKey), mskPub)
  if (!sigOk) throw new Error('The backup is not signed by your security key.')

  await saveMsk(userId, msk)
  const record = await getTrust(userId, userId)
  await putTrust(userId, userId, { mskPub: keys.msk_pub, listVersion: Math.max(keys.list_version, record?.listVersion ?? 0), verified: record?.verified ?? false })
  const device = await ensureDevice(userId)
  await publishDeviceList(userId, (devices) => devices, ownKeys(device))
  resetIdentity()
  invalidateTrust(userId)
  forgetBackupState()

  const entries = await allEntries()
  const commitments = new Map<string, string | null>()
  let restored = 0
  for (const [i, e] of entries.entries()) {
    onProgress?.(i, entries.length)
    try {
      const key = await sealOpen(await unb64(e.sealed), opened.publicKey, opened.secretKey)
      const slot = `${e.conversation}:${e.key_version}`
      if (!commitments.has(slot)) {
        const info = await api.listConversationDevices(e.conversation, e.key_version).catch(() => null)
        commitments.set(slot, info?.commitment?.key_commitment ?? null)
      }
      const commitment = commitments.get(slot)
      if (commitment && !await matchesCommitment(e.conversation, e.key_version, key, commitment)) continue
      // Straight into the store: these came from the backup, no need to
      // write them back to it.
      await putRoomKey(e.conversation, e.key_version, key)
      forgetPendingKeyFetches(e.conversation)
      restored++
    } catch {
      continue
    }
  }
  onProgress?.(entries.length, entries.length)
  return restored
}
