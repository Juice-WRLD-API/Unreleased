import { routeUrl } from './apiServers'
import { authedRequest } from './apiClient'
import { getToken, type AccountUser } from './userApi'

// Passkeys (WebAuthn): sign in without a password, and the account's list of
// them. See docs/08-accounts.md "Passkeys" in the backend.
//
// The browser prompt itself can't run in this window: passkeys belong to
// juicewrldapi.com and the app loads from file://. On desktop, main.js opens a
// small window that Chromium treats as https://player.juicewrldapi.com and runs
// the prompt there (electron/passkey.js). That origin is fixed - the API base
// from Settings → Developer only changes where these requests go, so a server
// with a different relying party ID can't be used for passkeys here.

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

const bridge = (): PasskeyBridge | undefined => (window as unknown as { electron?: PasskeyBridge }).electron

let supportPromise: Promise<PasskeySupport> | null = null

/** Asked once per launch; the answer depends only on the OS. */
export function getPasskeySupport(): Promise<PasskeySupport> {
  if (!supportPromise) {
    const ask = bridge()?.passkeySupport
    supportPromise = ask
      ? ask().catch(() => ({ ceremonies: false, reason: 'Passkeys are not available in this build.' }))
      : Promise.resolve({ ceremonies: false, reason: 'Passkeys are not available in this build.' })
  }
  return supportPromise
}

/** Shows the passkey prompt. Resolves null when the user cancels or closes it. */
async function runPasskeyPrompt(mode: 'create' | 'get', options: Record<string, unknown>): Promise<PasskeyCredentialJSON | null> {
  const run = bridge()?.passkeyCeremony
  const support = await getPasskeySupport()
  if (!run || !support.ceremonies) throw new Error(support.reason ?? 'Passkeys are not available here.')
  const result = await run({ mode, options })
  if ('ok' in result) return result.credential
  if ('error' in result) throw new Error(result.error)
  return null
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
