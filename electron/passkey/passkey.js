// The passkey ceremony page. main.js serves it as
// https://player.juicewrldapi.com/desktop-passkey/ on a session of its own
// (see ../passkey.js), so WebAuthn runs for the juicewrldapi.com RP ID. It
// gets the server's options through window.passkeyHost, shows the Windows
// prompt, and hands the credential JSON back. No network, no token.

/**
 * @typedef {{ mode: 'create' | 'get', options: any }} CeremonyRequest
 * @typedef {{ ok: true, credential: unknown } | { cancelled: true } | { error: string }} CeremonyResult
 * @type {{ getRequest: () => Promise<CeremonyRequest | null>, finish: (r: CeremonyResult) => void }}
 */
const host = /** @type {any} */ (window).passkeyHost

const titleEl = /** @type {HTMLElement} */ (document.getElementById('title'))
const statusEl = /** @type {HTMLElement} */ (document.getElementById('status'))
const continueBtn = /** @type {HTMLButtonElement} */ (document.getElementById('continue'))
const cancelBtn = /** @type {HTMLButtonElement} */ (document.getElementById('cancel'))

/** @type {AbortController | null} */
let controller = null
let finished = false

/** @param {CeremonyResult} result */
function finish(result) {
  if (finished) return
  finished = true
  host.finish(result)
}

function cancel() {
  controller?.abort()
  finish({ cancelled: true })
}

cancelBtn.addEventListener('click', cancel)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel() })

/** @param {unknown} err @param {CeremonyRequest['mode']} mode @returns {CeremonyResult} */
function describeError(err, mode) {
  const name = err instanceof DOMException || err instanceof Error ? err.name : ''
  // NotAllowedError covers "closed the prompt" and "timed out": both are a
  // cancel as far as the user is concerned.
  if (name === 'NotAllowedError' || name === 'AbortError') return { cancelled: true }
  if (name === 'InvalidStateError' && mode === 'create') return { error: 'A passkey on this device is already on your account.' }
  if (name === 'SecurityError') return { error: 'This passkey request is not valid for juicewrldapi.com.' }
  if (name === 'NotSupportedError') return { error: 'Nothing on this computer can handle this passkey request.' }
  const message = err instanceof Error && err.message ? err.message : 'The passkey prompt failed.'
  return { error: message }
}

/** @param {CeremonyRequest} req */
async function run(req) {
  continueBtn.hidden = true
  statusEl.textContent = req.mode === 'create'
    ? 'Follow the Windows prompt. You can save the passkey with Windows Hello on this PC, on a security key or on your phone.'
    : 'Follow the Windows prompt. Your passkey can be on this PC, a security key or your phone.'
  controller = new AbortController()
  try {
    const credential = req.mode === 'create'
      ? await navigator.credentials.create({
        publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(req.options),
        signal: controller.signal,
      })
      : await navigator.credentials.get({
        publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(req.options),
        signal: controller.signal,
      })
    if (!(credential instanceof PublicKeyCredential)) { finish({ cancelled: true }); return }
    finish({ ok: true, credential: credential.toJSON() })
  } catch (err) {
    finish(describeError(err, req.mode))
  }
}

host.getRequest().then((req) => {
  if (!req) { finish({ error: 'This passkey request is no longer open.' }); return }
  titleEl.textContent = req.mode === 'create' ? 'Add a passkey' : 'Sign in with a passkey'
  // Chromium refuses WebAuthn from a page without focus, so wait for it if
  // the window opened behind another one.
  let started = false
  const start = () => { if (!started) { started = true; void run(req) } }
  if (document.hasFocus()) { start(); return }
  statusEl.textContent = 'Click Continue to open the Windows prompt.'
  continueBtn.hidden = false
  continueBtn.addEventListener('click', start)
  window.addEventListener('focus', start, { once: true })
}).catch(() => finish({ error: 'Could not read the passkey request.' }))
