const path = require('path')
const { fileURLToPath } = require('url')

/**
 * Turns what someone typed or pasted into the local Files path box into an
 * absolute path: drops the quotes Explorer's "Copy as path" adds, reads
 * file:// URLs, expands ~ and environment variables (%VAR% on Windows, $VAR
 * elsewhere), and resolves relative paths against the folder being shown.
 * Variables that aren't set are left as typed.
 * @param {string} typed
 * @param {{ from?: string, home: string, env?: Record<string, string | undefined>, platform?: string }} ctx
 * @returns {string}
 */
function resolveTypedPath(typed, ctx) {
  const platform = ctx.platform || process.platform
  const win = platform === 'win32'
  const p = win ? path.win32 : path.posix
  const env = ctx.env || process.env
  let s = String(typed || '').trim()
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) s = s.slice(1, -1).trim()
  if (!s) return ''
  if (/^file:/i.test(s)) {
    try { s = fileURLToPath(s) } catch { /* not a usable file URL; resolve it as typed */ }
  }
  if (win) {
    s = s.replace(/%([^%\\/]+)%/g, (whole, name) => {
      // Windows variable names ignore case; a plain env object doesn't.
      const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())
      const value = key ? env[key] : undefined
      return value != null ? value : whole
    })
  } else {
    s = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, braced, bare) => {
      const value = env[braced || bare]
      return value != null ? value : whole
    })
  }
  if (s === '~' || /^~[\\/]/.test(s)) s = ctx.home + s.slice(1)
  // "C:" alone means the drive's current folder to Node; people mean its root.
  if (win && /^[a-zA-Z]:$/.test(s)) s += '\\'
  return p.resolve(ctx.from || ctx.home, s)
}

module.exports = { resolveTypedPath }
