// The updating window shown at launch (see updateBeforeLaunch in ../main.js).
// It follows the same update-status events as the app's own update UI, plus
// 'starting' once there is nothing left to install and the app is opening.
// Wrapped so its names stay out of the global scope other page scripts share.
(() => {
  /** @typedef {{ type: string, version?: string, percent?: number }} UpdateStatus */
  const bridge = /** @type {{ onStatus: (cb: (s: UpdateStatus) => void) => void } | undefined} */ (/** @type {any} */ (window).updating)

  const titleEl = /** @type {HTMLElement} */ (document.getElementById('title'))
  const detailEl = /** @type {HTMLElement} */ (document.getElementById('detail'))
  const barEl = /** @type {HTMLElement} */ (document.getElementById('bar'))
  const fillEl = /** @type {HTMLElement} */ (document.getElementById('fill'))
  const versionEl = /** @type {HTMLElement} */ (document.getElementById('version'))

  const current = new URLSearchParams(location.search).get('version')
  if (current) versionEl.textContent = `v${current}`

  // The version being downloaded: 'available' names it, progress events don't.
  let incoming = ''

  /** @param {string} title @param {string} detail @param {number | null} percent null for a bar with no end */
  function show(title, detail, percent) {
    titleEl.textContent = title
    detailEl.textContent = detail
    barEl.classList.toggle('indeterminate', percent == null)
    if (percent != null) fillEl.style.setProperty('--progress', String(Math.max(0, Math.min(100, percent)) / 100))
  }

  /** @param {UpdateStatus} s */
  function onStatus(s) {
    if (!s || typeof s.type !== 'string') return
    if (s.version && (s.type === 'available' || s.type === 'downloading')) incoming = s.version
    const name = incoming ? `Version ${incoming}` : ''
    switch (s.type) {
      case 'checking':
        show('Checking for updates…', '', null)
        break
      case 'available':
        show('Downloading update…', name, null)
        break
      case 'downloading': {
        const percent = Math.round(Number(s.percent) || 0)
        show('Downloading update…', name ? `${name} · ${percent}%` : `${percent}%`, percent)
        break
      }
      case 'downloaded':
        show('Installing update…', 'Unreleased reopens when it’s done', null)
        break
      // Up to date, or the check failed: either way the app opens now.
      case 'not-available':
      case 'error':
      case 'starting':
        show('Starting…', '', null)
        break
    }
  }

  bridge?.onStatus(onStatus)
})()
