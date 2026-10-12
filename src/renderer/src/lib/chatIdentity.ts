// E2E v2 trust: who a user's devices are. A device counts only if the user's
// master signing key (MSK) signed it into their latest device list, and the
// MSK counts only if it's the one this account pinned the first time it saw
// that user. The server's device rows are just addresses.
import * as api from './chatApi'
import type { E2EFeatures, ListDeviceEntry, ServerDeviceRow, UserKeysInfo } from './chatApi'
import {
  b64, generateSigningKey, listBytes, safetyDigits, safetyFingerprint, sign, signingPublicFromSecret, unb64, verify,
} from './chatV2Crypto'
import { clearMsk, getTrust, loadMsk, putTrust, saveMsk } from './chatKeyStore'

// --- rollout flags ----------------------------------------------------------------

const NO_FEATURES: E2EFeatures = { send: false, identity: false, linking: false, backup: false }
let featuresPromise: Promise<E2EFeatures> | null = null
let featuresAt = 0
const FEATURES_TTL_MS = 5 * 60_000

export function getFeatures(): Promise<E2EFeatures> {
  if (!featuresPromise || Date.now() - featuresAt > FEATURES_TTL_MS) {
    featuresAt = Date.now()
    featuresPromise = api.getE2EFeatures()
      .then((f) => ({ ...NO_FEATURES, ...f }))
      // An older server has no flags endpoint: stay on v1.
      .catch(() => NO_FEATURES)
  }
  return featuresPromise
}

export function resetFeatures(): void {
  featuresPromise = null
}

// --- other users' devices -------------------------------------------------------------

export interface VerifiedDevice {
  deviceId: string
  rowId: number | null
  encPub: string
  signPub: string
}

export type UserTrust =
  | { state: 'ok'; userId: number; mskPub: string; listVersion: number; devices: VerifiedDevice[]; verified: boolean }
  // No v2 identity yet: an older client. Callers fall back to v1 rules.
  | { state: 'none'; userId: number; serverDevices: ServerDeviceRow[] }
  // The server shows a different MSK than the pinned one. Nothing is sealed to
  // this user until the viewer accepts the new key.
  | { state: 'changed'; userId: number; pinned: string; current: string; verified: boolean }
  | { state: 'invalid'; userId: number; reason: string }

const trustCache = new Map<string, Promise<UserTrust>>()
const cacheKey = (me: number, them: number): string => `${me}:${them}`

export function invalidateTrust(me: number, them?: number): void {
  if (them === undefined) trustCache.clear()
  else trustCache.delete(cacheKey(me, them))
}

export function loadUserTrust(me: number, userId: number, info?: UserKeysInfo): Promise<UserTrust> {
  const key = cacheKey(me, userId)
  if (!info) {
    const hit = trustCache.get(key)
    if (hit) return hit
  }
  const run = evaluateTrust(me, userId, info).catch((err) => {
    trustCache.delete(key)
    throw err
  })
  trustCache.set(key, run)
  return run
}

export async function loadUsersTrust(me: number, userIds: number[]): Promise<Map<number, UserTrust>> {
  const out = new Map<number, UserTrust>()
  const missing: number[] = []
  for (const id of new Set(userIds)) {
    const hit = trustCache.get(cacheKey(me, id))
    if (hit) out.set(id, await hit)
    else missing.push(id)
  }
  if (missing.length) {
    const infos = await api.getUsersKeys(missing)
    await Promise.all(infos.map(async (info) => out.set(info.user_id, await loadUserTrust(me, info.user_id, info))))
  }
  return out
}

async function evaluateTrust(me: number, userId: number, given?: UserKeysInfo): Promise<UserTrust> {
  const info = given ?? await api.getUserKeys(userId)
  const pinned = await getTrust(me, userId)
  if (!info.msk_pub) {
    // Having pinned a key and then seeing none means the server dropped it,
    // which an identity reset never does (it replaces the key).
    return pinned?.mskPub
      ? { state: 'invalid', userId, reason: 'identity-missing' }
      : { state: 'none', userId, serverDevices: info.server_devices.filter((r) => !r.revoked) }
  }
  if (userId === me) {
    const own = await loadMsk(me)
    if (own && await b64(await signingPublicFromSecret(own)) !== info.msk_pub) {
      return { state: 'invalid', userId, reason: 'own-key-mismatch' }
    }
  }
  let record = pinned ?? { mskPub: '', listVersion: 0, verified: false }
  if (!record.mskPub) {
    record = { ...record, mskPub: info.msk_pub }
    await putTrust(me, userId, record)
  } else if (record.mskPub !== info.msk_pub) {
    if (record.changedTo !== info.msk_pub) await putTrust(me, userId, { ...record, changedTo: info.msk_pub })
    return { state: 'changed', userId, pinned: record.mskPub, current: info.msk_pub, verified: record.verified }
  }
  if (info.list_version < record.listVersion) return { state: 'invalid', userId, reason: 'list-rollback' }
  let devices: VerifiedDevice[] = []
  if (info.list_version > 0) {
    if (!info.list_sig) return { state: 'invalid', userId, reason: 'list-unsigned' }
    const ok = await verify(
      await unb64(info.list_sig),
      await listBytes(userId, info.list_version, info.devices),
      await unb64(info.msk_pub),
    ).catch(() => false)
    if (!ok) return { state: 'invalid', userId, reason: 'list-signature' }
    const rows = new Map(info.server_devices.filter((r) => !r.revoked).map((r) => [r.device_id, r]))
    devices = info.devices.map((d) => {
      const row = rows.get(d.device_id)
      // A row whose keys differ from the signed entry is not that device.
      const matches = row && row.public_key === d.enc_pub && (!row.sign_pub || row.sign_pub === d.sign_pub)
      return { deviceId: d.device_id, rowId: matches ? row.id : null, encPub: d.enc_pub, signPub: d.sign_pub }
    })
  }
  if (info.list_version > record.listVersion) await putTrust(me, userId, { ...record, listVersion: info.list_version })
  return { state: 'ok', userId, mskPub: info.msk_pub, listVersion: info.list_version, devices, verified: record.verified }
}

export async function acceptKeyChange(me: number, userId: number): Promise<void> {
  const record = await getTrust(me, userId)
  const next = record?.changedTo
  if (!record || !next) return
  // A new identity keeps counting list versions server-side, so the pinned
  // high-water mark stays valid.
  await putTrust(me, userId, { mskPub: next, listVersion: record.listVersion, verified: false })
  invalidateTrust(me, userId)
}

export async function setVerified(me: number, userId: number, verified: boolean): Promise<void> {
  const record = await getTrust(me, userId)
  if (!record?.mskPub) return
  await putTrust(me, userId, { ...record, verified })
  invalidateTrust(me, userId)
}

export async function safetyNumber(me: number, userId: number): Promise<{ digits: string[]; fingerprint: Uint8Array } | null> {
  const [mine, theirs] = await Promise.all([loadUserTrust(me, me), loadUserTrust(me, userId)])
  if (mine.state !== 'ok' || theirs.state !== 'ok') return null
  const fp = await safetyFingerprint(
    { userId: me, mskPub: await unb64(mine.mskPub) },
    { userId, mskPub: await unb64(theirs.mskPub) },
  )
  return { digits: safetyDigits(fp), fingerprint: fp }
}

// --- this account's identity --------------------------------------------------------------

export interface OwnDeviceKeys {
  deviceId: string
  encPub: Uint8Array
  signPub: Uint8Array
}

export type IdentityStatus =
  | 'disabled'     // phase 2 not on yet
  | 'ready'        // this device holds the MSK and is in the signed list
  | 'needs-link'   // another device of ours holds the MSK; link this one to it

export async function ownEntry(device: OwnDeviceKeys): Promise<ListDeviceEntry> {
  return { device_id: device.deviceId, enc_pub: await b64(device.encPub), sign_pub: await b64(device.signPub) }
}

let identityPromise: Promise<IdentityStatus> | null = null
let identityUser: number | null = null

export function ensureIdentity(me: number, device: OwnDeviceKeys): Promise<IdentityStatus> {
  if (!identityPromise || identityUser !== me) {
    identityUser = me
    identityPromise = setupIdentity(me, device).catch((err) => {
      identityPromise = null
      throw err
    })
  }
  return identityPromise
}

export function resetIdentity(): void {
  identityPromise = null
  identityUser = null
}

async function setupIdentity(me: number, device: OwnDeviceKeys): Promise<IdentityStatus> {
  if (!(await getFeatures()).identity) return 'disabled'
  let msk = await loadMsk(me)
  let info = await api.getUserKeys(me)

  if (!msk) {
    if (info.msk_pub) return 'needs-link'
    // First v2 device on this account: it creates the MSK and signs in only
    // itself. Signing every existing server row would sign in any device the
    // server had injected; the others get linked from here instead.
    const created = await generateSigningKey()
    const res = await api.putIdentity({ msk_pub: await b64(created.publicKey) })
    if (!res.ok) return 'needs-link'
    await saveMsk(me, created.secretKey)
    msk = created.secretKey
    info = res.data
  } else {
    const pub = await b64(await signingPublicFromSecret(msk))
    if (info.msk_pub && info.msk_pub !== pub) {
      // Another device reset the identity; ours is dead.
      await clearMsk(me)
      return 'needs-link'
    }
    if (!info.msk_pub) {
      const res = await api.putIdentity({ msk_pub: pub })
      if (!res.ok) {
        await clearMsk(me)
        return 'needs-link'
      }
      info = res.data
    }
  }

  if (info.list_version === 0) {
    await publishDeviceList(me, () => [], device)
  } else if (!info.devices.some((d) => d.device_id === device.deviceId)) {
    // Holding the MSK but not listed means another device revoked this one.
    await clearMsk(me)
    return 'needs-link'
  }
  invalidateTrust(me, me)
  return 'ready'
}

// Publishes list version + 1 built from the current verified list. `self`,
// when given, is always included (it's the device doing the publishing).
export async function publishDeviceList(
  me: number,
  mutate: (devices: ListDeviceEntry[]) => ListDeviceEntry[],
  self?: OwnDeviceKeys,
): Promise<UserKeysInfo> {
  const msk = await loadMsk(me)
  if (!msk) throw new Error('This device does not hold your security key.')
  const mskPub = await signingPublicFromSecret(msk)
  for (let attempt = 0; attempt < 3; attempt++) {
    const info = await api.getUserKeys(me)
    let current: ListDeviceEntry[] = []
    // An unsigned, empty list at version > 0 is what an identity reset leaves.
    if (info.list_version > 0 && (info.list_sig || info.devices.length)) {
      const ok = await verify(await unb64(info.list_sig), await listBytes(me, info.list_version, info.devices), mskPub)
        .catch(() => false)
      if (!ok) throw new Error('Your device list on the server is not signed by your security key.')
      current = info.devices
    }
    let next = mutate(current.map((d) => ({ ...d })))
    if (self) {
      const entry = await ownEntry(self)
      next = [...next.filter((d) => d.device_id !== entry.device_id), entry]
    }
    const version = info.list_version + 1
    const listSig = await b64(await sign(await listBytes(me, version, next), msk))
    const res = await api.putDeviceList({ list_version: version, devices: next, list_sig: listSig }, self?.deviceId)
    if (res.ok) {
      const record = await getTrust(me, me)
      await putTrust(me, me, {
        mskPub: await b64(mskPub),
        listVersion: Math.max(version, record?.listVersion ?? 0),
        verified: record?.verified ?? false,
      })
      invalidateTrust(me, me)
      return res.data
    }
  }
  throw new Error('Your device list kept changing; try again.')
}

// Identity reset: a brand-new MSK, for when every device and the recovery
// code are gone. Old history becomes unreadable and contacts get a warning.
export async function resetOwnIdentity(me: number, device: OwnDeviceKeys): Promise<void> {
  const created = await generateSigningKey()
  const res = await api.putIdentity({ msk_pub: await b64(created.publicKey), reset: true }, device.deviceId)
  if (!res.ok) throw new Error(res.data?.detail || 'Could not reset your identity.')
  await saveMsk(me, created.secretKey)
  await putTrust(me, me, { mskPub: await b64(created.publicKey), listVersion: res.data.list_version, verified: false })
  await publishDeviceList(me, () => [], device)
  resetIdentity()
}
