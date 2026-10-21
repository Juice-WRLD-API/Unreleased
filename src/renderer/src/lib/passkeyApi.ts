import { routeUrl } from './apiServers'
import { authedRequest } from './apiClient'
import { getToken, type AccountUser } from './userApi'

// Passkeys (WebAuthn): sign in without a password, and the account's list of
// them. See docs/08-accounts.md "Passkeys" in the backend.
//
// Passkeys belong to juicewrldapi.com, and the server only accepts prompts run
// on https://juicewrldapi.com or https://player.juicewrldapi.com. On the
// website the page is already there, so the browser's own prompt runs in place.
// The desktop app loads from file://, so main.js opens a small window that
// Chromium treats as https://player.juicewrldapi.com and runs the prompt there
// (electron/passkey.js). Either way the origin is fixed - the API base from
// Settings → Developer only changes where these requests go, so a server with a
// different relying party ID can't be used for passkeys here. The Android and
// iOS builds load from other origins, so they get the "not here" reason.

const ACCOUNT_BASE = routeUrl('/accounts')

export const PASSKEY_LIMIT = 20

export interface Passkey {
  id: string
  name: string
  /** e.g. ['internal', 'hybrid', 'usb'] */
  transports: string[]
  /** Synced by a password manager or platform keychain. */
  backed_up: boolean
  last_used_at: string | null
  created_at: string | null
}

/** Step 1 of either ceremony: standard WebAuthn options JSON, base64url fields. */
export interface PasskeyChallenge {
  challenge_id: string
  options: Record<string, unknown>
}

/** What `PublicKeyCredential.toJSON()` returns; passed through untouched. */
export type PasskeyCredentialJSON = Record<string, unknown>

export interface PasskeySupport {
  /** Whether this app can show the prompt to add or use a passkey here. */
  ceremonies: boolean
  /** Why not, in a sentence the UI can show. */
  reason: string | null
}

type PromptResult = { ok: true; credential: PasskeyCredentialJSON } | { cancelled: true } | { error: string }

interface PasskeyBridge {
  passkeySupport?: () => Promise<PasskeySupport>
  passkeyCeremony?: (req: { mode: 'create' | 'get'; options: Record<string, unknown> }) => Promise<PromptResult>
}

/** The desktop app's helper window, when this is the desktop app. */
const desktopBridge = (): Required<PasskeyBridge> | null => {
  const b = (window as unknown as { electron?: PasskeyBridge }).electron
  return b?.passkeySupport && b.passkeyCeremony ? (b as Required<PasskeyBridge>) : null
}

const WEB_PASSKEY_HOSTS = new Set(['juicewrldapi.com', 'player.juicewrldapi.com'])

function browserSupport(): PasskeySupport {
  if (!WEB_PASSKEY_HOSTS.has(location.hostname) || !window.isSecureContext) {
    return { ceremonies: false, reason: 'Passkeys only work on player.juicewrldapi.com in a browser.' }
  }
  if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) {
    return { ceremonies: false, reason: 'This browser does not support passkeys.' }
  }
  return { ceremonies: true, reason: null }
}

let supportPromise: Promise<PasskeySupport> | null = null

/** Asked once per launch; the answer depends only on the OS and the page's origin. */
export function getPasskeySupport(): Promise<PasskeySupport> {
  if (!supportPromise) {
    const desktop = desktopBridge()
    supportPromise = desktop
      ? desktop.passkeySupport().catch(() => ({ ceremonies: false, reason: 'Passkeys are not available in this build.' }))
      : Promise.resolve(browserSupport())
  }
  return supportPromise
}

/** Shows the passkey prompt. Resolves null when the user cancels or closes it. */
async function runPasskeyPrompt(mode: 'create' | 'get', options: Record<string, unknown>): Promise<PasskeyCredentialJSON | null> {
  const support = await getPasskeySupport()
  if (!support.ceremonies) throw new Error(support.reason ?? 'Passkeys are not available here.')
  const desktop = desktopBridge()
  if (!desktop) return runBrowserPrompt(mode, options)
  const result = await desktop.passkeyCeremony({ mode, options })
  if ('ok' in result) return result.credential
  if ('error' in result) throw new Error(result.error)
  return null
}

// ── Browser prompt (website) ────────────────────────────────────────────────
// The server sends options as WebAuthn JSON (base64url for binary fields) and
// takes the credential back the same way. Newer browsers convert both ways
// themselves; older Safari and Firefox lack parse*FromJSON / toJSON, so those
// conversions are done by hand.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

function fromB64url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

function toB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const descriptors = (list: Json[] | undefined): PublicKeyCredentialDescriptor[] | undefined =>
  list?.map((d) => ({ ...d, id: fromB64url(d.id) }) as PublicKeyCredentialDescriptor)

interface WebAuthnJsonStatics {
  parseCreationOptionsFromJSON?: (o: Json) => PublicKeyCredentialCreationOptions
  parseRequestOptionsFromJSON?: (o: Json) => PublicKeyCredentialRequestOptions
}

function creationOptions(o: Json): PublicKeyCredentialCreationOptions {
  const parse = (PublicKeyCredential as unknown as WebAuthnJsonStatics).parseCreationOptionsFromJSON
  if (parse) return parse(o)
  return {
    ...o,
    challenge: fromB64url(o.challenge),
    user: { ...o.user, id: fromB64url(o.user.id) },
    excludeCredentials: descriptors(o.excludeCredentials),
  } as PublicKeyCredentialCreationOptions
}

function requestOptions(o: Json): PublicKeyCredentialRequestOptions {
  const parse = (PublicKeyCredential as unknown as WebAuthnJsonStatics).parseRequestOptionsFromJSON
  if (parse) return parse(o)
  return { ...o, challenge: fromB64url(o.challenge), allowCredentials: descriptors(o.allowCredentials) } as PublicKeyCredentialRequestOptions
}

function credentialJSON(c: PublicKeyCredential): PasskeyCredentialJSON {
  const own = (c as unknown as { toJSON?: () => PasskeyCredentialJSON }).toJSON
  if (typeof own === 'function') return own.call(c)
  const r = c.response
  const response: Json = { clientDataJSON: toB64url(r.clientDataJSON) }
  if (r instanceof AuthenticatorAttestationResponse) {
    response.attestationObject = toB64url(r.attestationObject)
    response.transports = r.getTransports?.() ?? []
  } else {
    const a = r as AuthenticatorAssertionResponse
    response.authenticatorData = toB64url(a.authenticatorData)
    response.signature = toB64url(a.signature)
    response.userHandle = a.userHandle ? toB64url(a.userHandle) : null
  }
  return {
    id: c.id,
    rawId: toB64url(c.rawId),
    type: c.type,
    response,
    authenticatorAttachment: c.authenticatorAttachment ?? null,
    clientExtensionResults: c.getClientExtensionResults(),
  }
}

async function runBrowserPrompt(mode: 'create' | 'get', options: Json): Promise<PasskeyCredentialJSON | null> {
  let credential: Credential | null
  try {
    credential = mode === 'create'
      ? await navigator.credentials.create({ publicKey: creationOptions(options) })
      : await navigator.credentials.get({ publicKey: requestOptions(options) })
  } catch (err) {
    const name = err instanceof DOMException || err instanceof Error ? err.name : ''
    // NotAllowedError covers "closed the prompt" and "timed out": both are a
    // cancel as far as the user is concerned.
    if (name === 'NotAllowedError' || name === 'AbortError') return null
    if (name === 'InvalidStateError' && mode === 'create') throw new Error('A passkey on this device is already on your account.')
    if (name === 'SecurityError') throw new Error('This passkey request is not valid for this site.')
    if (name === 'NotSupportedError') throw new Error('Nothing on this device can handle this passkey request.')
    throw err instanceof Error ? err : new Error('The passkey prompt failed.')
  }
  return credential instanceof PublicKeyCredential ? credentialJSON(credential) : null
}

// ── Sign in ─────────────────────────────────────────────────────────────────

export function startPasskeySignIn(): Promise<PasskeyChallenge> {
  return authedRequest(`${ACCOUNT_BASE}/auth/passkey/options/`, { method: 'POST', body: '{}' }, null)
}

export function finishPasskeySignIn(challengeId: string, credential: PasskeyCredentialJSON): Promise<{ token: string; user: AccountUser }> {
  return authedRequest(`${ACCOUNT_BASE}/auth/passkey/login/`, {
    method: 'POST',
    body: JSON.stringify({ challenge_id: challengeId, credential }),
  }, null)
}

/** The whole sign-in: challenge, prompt, token. Null when the user cancels. */
export async function signInWithPasskey(): Promise<{ token: string; user: AccountUser } | null> {
  const { challenge_id, options } = await startPasskeySignIn()
  const credential = await runPasskeyPrompt('get', options)
  if (!credential) return null
  return finishPasskeySignIn(challenge_id, credential)
}

// ── Manage (session token only; API keys get 401) ───────────────────────────

export async function listPasskeys(): Promise<Passkey[]> {
  const res = await authedRequest<{ passkeys: Passkey[] }>(`${ACCOUNT_BASE}/account/passkeys/`, { method: 'GET' }, getToken())
  return res.passkeys ?? []
}

export function startPasskeyRegistration(): Promise<PasskeyChallenge> {
  return authedRequest(`${ACCOUNT_BASE}/account/passkeys/register/options/`, { method: 'POST', body: '{}' }, getToken())
}

export function finishPasskeyRegistration(challengeId: string, credential: PasskeyCredentialJSON, name?: string): Promise<Passkey> {
  return authedRequest(`${ACCOUNT_BASE}/account/passkeys/register/`, {
    method: 'POST',
    body: JSON.stringify({ challenge_id: challengeId, credential, ...(name?.trim() ? { name: name.trim().slice(0, 100) } : {}) }),
  }, getToken())
}

/** The whole add flow: challenge, prompt, save. Null when the user cancels. */
export async function addPasskey(name?: string): Promise<Passkey | null> {
  const { challenge_id, options } = await startPasskeyRegistration()
  const credential = await runPasskeyPrompt('create', options)
  if (!credential) return null
  return finishPasskeyRegistration(challenge_id, credential, name)
}

export function renamePasskey(id: string, name: string): Promise<Passkey> {
  return authedRequest(`${ACCOUNT_BASE}/account/passkeys/${encodeURIComponent(id)}/`, {
    method: 'PATCH',
    body: JSON.stringify({ name: name.trim().slice(0, 100) }),
  }, getToken())
}

export async function deletePasskey(id: string): Promise<void> {
  await authedRequest(`${ACCOUNT_BASE}/account/passkeys/${encodeURIComponent(id)}/`, { method: 'DELETE' }, getToken())
}
