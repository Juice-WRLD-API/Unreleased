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

  const params = new URLSearchParams(location.search)
  const current = params.get('version')
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
  // Opened straight into a state: an install started from inside the app.
  const initial = params.get('status')
  if (initial) onStatus({ type: initial })

  /** @param {string} color computed rgb()/rgba() */
  const hex = (color) => '#' + (color.match(/\d+/g) || []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')

  // What main.js needs to draw the install stand-in over a capture of this
  // window (showInstallStandIn in ../main.js): where the bar is, how the sweep
  // is moving and the colours, in CSS pixels. Resolves once the current state
  // has painted.
  const host = /** @type {any} */ (window)
  host.describeForStandIn = () => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sweepEl = /** @type {HTMLElement} */ (barEl.querySelector('.sweep'))
      const box = barEl.getBoundingClientRect()
      const anim = sweepEl.getAnimations()[0]
      const period = Number(anim?.effect?.getTiming().duration) || 1600
      resolve({
        bar: { x: box.left, y: box.top, width: box.width, height: box.height, radius: parseFloat(getComputedStyle(barEl).borderTopLeftRadius) || 0 },
        sweep: {
          width: sweepEl.offsetWidth,
          period,
          phase: anim ? Number(anim.currentTime) % period : 0,
          at: Date.now(),
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        },
        colors: {
          background: hex(getComputedStyle(document.body).backgroundColor),
          track: hex(getComputedStyle(barEl).backgroundColor),
          accent: hex(getComputedStyle(sweepEl).backgroundColor),
        },
      })
    }))
  })
})()
