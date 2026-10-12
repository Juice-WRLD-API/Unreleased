// Device linking (E2E v2, phase 3). The new device (N) shows a QR code with
// its public keys; an existing device (E) scans it, signs N into the device
// list with the master key, and sends N the master key and every room key in
// a signed, sealed link bundle. Without a camera, N shows its 8-character
// code instead and both screens show a 6-digit number to compare.
import * as api from './chatApi'
import type { LinkSessionInfo } from './chatApi'
import { loadMsk } from './chatKeyStore'
import { b64, b64url, deviceSas, linkSas, unb64, unb64url, bytesEqual } from './chatV2Crypto'
import { invalidateTrust, loadUserTrust, publishDeviceList } from './chatIdentity'
import { deviceLabel, ensureDevice, ownKeys } from './chatE2E'
import { buildLinkBundle, expectLinkBundle, sendLinkBundle } from './chatToDevice'

const QR_PREFIX = 'unrlsd-link:v2:'

// --- new device ------------------------------------------------------------------------------

export interface PendingLink {
  sessionId: string
  expiresAt: string
  qr: string
  sas: string
}

// The number the new device shows for the approve prompt on its other devices.
export async function ownDeviceSas(userId: number): Promise<string> {
  const device = await ensureDevice(userId)
  return deviceSas(device.deviceId, device.identity.publicKey, device.signing.publicKey)
}

export async function startLink(userId: number): Promise<PendingLink> {
  const device = await ensureDevice(userId)
  const encPub = device.identity.publicKey
  const signPub = device.signing.publicKey
  const session = await api.createLinkSession({
    device_id: device.deviceId, enc_pub: await b64(encPub), sign_pub: await b64(signPub), label: deviceLabel(),
  })
  expectLinkBundle(session.session_id)
  return {
    sessionId: session.session_id,
    expiresAt: session.expires_at,
    qr: `${QR_PREFIX}${session.session_id}:${await b64url(encPub)}:${await b64url(signPub)}`,
    sas: await linkSas(session.session_id, encPub, signPub),
  }
}

// --- existing device ---------------------------------------------------------------------------

export interface LinkCandidate {
  session: LinkSessionInfo
  // Scanned: the keys came from N's screen, so nothing to compare. Typed:
  // the keys came from the server, so the person must confirm `sas` matches.
  viaQr: boolean
  sas: string
}

export function parseLinkQr(text: string): { sessionId: string; encPub: string; signPub: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(QR_PREFIX)) return null
  const [sessionId, encPub, signPub] = trimmed.slice(QR_PREFIX.length).split(':')
  return sessionId && encPub && signPub ? { sessionId, encPub, signPub } : null
}

export async function lookupLink(input: { qr?: string; code?: string }): Promise<LinkCandidate> {
  const scanned = input.qr ? parseLinkQr(input.qr) : null
  if (input.qr && !scanned) throw new Error('That is not a device link code.')
  const sessionId = scanned?.sessionId ?? (input.code ?? '').trim()
  if (!sessionId) throw new Error('Enter the code shown on the new device.')
  const session = await api.getLinkSession(sessionId)
  const encPub = await unb64(session.enc_pub)
  const signPub = await unb64(session.sign_pub)
  if (scanned) {
    // The server must hand back exactly the keys on N's screen.
    const same = bytesEqual(encPub, await unb64url(scanned.encPub)) && bytesEqual(signPub, await unb64url(scanned.signPub))
    if (!same) throw new Error('The server returned different keys than the QR code. Linking stopped.')
  }
  if (session.claimed) throw new Error('That code was already used.')
  return { session, viaQr: !!scanned, sas: await linkSas(session.session_id, encPub, signPub) }
}

// Devices on this account that registered but aren't in the signed list, as
// approval candidates. The keys come from the server, so the person must
// compare `sas` with the number the new device shows (see PendingApproval).
export async function pendingDevices(userId: number): Promise<LinkCandidate[]> {
  const [rows, trust, own] = await Promise.all([api.listMyDevices(), loadUserTrust(userId, userId), ensureDevice(userId)])
  if (trust.state !== 'ok') return []
  const listed = new Set(trust.devices.map((d) => d.deviceId))
  const fresh = rows.filter((r) => r.sign_pub && r.device_id !== own.deviceId && !listed.has(r.device_id))
  return Promise.all(fresh.map(async (r) => ({
    session: {
      session_id: '', device_id: r.device_id, enc_pub: r.public_key, sign_pub: r.sign_pub!, label: r.label,
      expires_at: '', claimed: false, claimed_by: null,
    },
    viaQr: false,
    sas: await deviceSas(r.device_id, await unb64(r.public_key), await unb64(r.sign_pub!)),
  })))
}

export async function approveLink(userId: number, candidate: LinkCandidate): Promise<void> {
  const msk = await loadMsk(userId)
  if (!msk) throw new Error('This device does not hold your security key, so it cannot link others.')
  const device = await ensureDevice(userId)
  const { session } = candidate
  await publishDeviceList(userId, (devices) => [
    ...devices.filter((d) => d.device_id !== session.device_id),
    { device_id: session.device_id, enc_pub: session.enc_pub, sign_pub: session.sign_pub },
  ], ownKeys(device))
  invalidateTrust(userId, userId)
  const trust = await loadUserTrust(userId, userId)
  const target = trust.state === 'ok' ? trust.devices.find((d) => d.deviceId === session.device_id) : undefined
  if (!target || target.rowId == null) throw new Error('The new device was signed in, but its keys could not be sent. Try again from it.')
  const keys = await api.getUserKeys(userId)
  await sendLinkBundle(userId, { rowId: target.rowId, deviceId: target.deviceId, encPub: target.encPub },
    await buildLinkBundle(msk, keys.backup_pub ?? ''))
}

// Revoking publishes a list without the device, then every shared
// conversation rotates on its next send (lib/chatE2E onDevicesUpdated).
export async function revokeLinkedDevice(userId: number, deviceId: string): Promise<void> {
  const device = await ensureDevice(userId)
  if (deviceId === device.deviceId) throw new Error('You cannot revoke this device from itself.')
  await publishDeviceList(userId, (devices) => devices.filter((d) => d.device_id !== deviceId), ownKeys(device))
}
