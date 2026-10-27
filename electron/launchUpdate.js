// Holds a launch back while the update check runs (see updateBeforeLaunch in
// main.js). `opened` resolves when the app should open: nothing to install,
// the check failed, or one of the timeouts below gave up waiting. A
// downloaded update calls install() instead, and the app quits into the
// installer without `opened` ever resolving, unless that handoff doesn't
// happen in time either.
//
// Giving up never cancels anything. The check or download carries on in the
// background and ends in main.js's usual "Update ready" prompt, because
// `active` is false by then.

/**
 * @param {{
 *   check: () => Promise<unknown>,
 *   install: () => void,
 *   log?: (msg: string) => void,
 *   checkTimeoutMs: number,
 *   stallTimeoutMs: number,
 *   installTimeoutMs: number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (t: any) => void,
 * }} options
 */
function createLaunchGate({
  check, install, log = () => {},
  checkTimeoutMs, stallTimeoutMs, installTimeoutMs,
  setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  /** @type {() => void} */
  let open = () => {}
  const opened = new Promise((/** @type {(v?: void) => void} */ resolve) => { open = resolve })
  let settled = false
  let installing = false
  /** @type {any} */
  let timer = null

  const finish = () => {
    if (settled) return
    settled = true
    clearTimer(timer)
    open()
  }
  /** @param {number} ms @param {string} why */
  const giveUpAfter = (ms, why) => {
    clearTimer(timer)
    timer = setTimer(() => {
      log(`Launch update: ${why}, opening the app`)
      finish()
    }, ms)
  }

  const gate = {
    opened,
    get active() { return !settled },
    // A sign of life from an update on its way (found, or bytes arriving):
    // the check timeout no longer applies, only a stall does.
    progress() {
      if (!settled && !installing) giveUpAfter(stallTimeoutMs, 'the download stalled')
    },
    // The update is downloaded: hand off to its installer, which quits the
    // app. If the app is still here after installTimeoutMs, open it.
    install() {
      if (settled || installing) return
      installing = true
      giveUpAfter(installTimeoutMs, 'the installer did not take over')
      install()
    },
  }

  giveUpAfter(checkTimeoutMs, 'the update check took too long')
  // Deferred a tick so main.js has stored the gate before any updater event
  // can look for it.
  Promise.resolve()
    .then(check)
    .catch((err) => log(`Launch update check failed: ${err && err.message ? err.message : err}`))
    .finally(() => { if (!installing) finish() })

  return gate
}

module.exports = { createLaunchGate }
