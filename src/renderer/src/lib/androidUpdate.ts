// Update check for the sideloaded Android build.
//
// The desktop app has electron-updater; the Android wrap has nothing, because
// it isn't on the Play Store (unreleased-music content) and a sideloaded APK
// gets no store update channel. This fills that gap: ask GitHub what the
// newest `android-v*` release is, compare it to what's installed, and hand
// the APK to the system installer if it's newer.
//
// Two traps this module exists to avoid, both easy to get wrong:
//
//  1. The installed version is NOT `APP_VERSION`. That define comes from
//     package.json (1.19.3 at time of writing), while the APK's real version
//     is `versionName` in android/app/build.gradle (2.0.0) — scripts/python/
//     release_android.py bumps the two independently. Comparing against
//     APP_VERSION would report a bogus "update available" forever. The only
//     truthful source is the native package info, via App.getInfo().
//
//  2. The release feed is NOT /releases/latest. release_android.py publishes
//     every Android release with `prerelease: true` *on purpose*, so it can
//     never be picked up as "latest" by the desktop auto-updater sharing this
//     repo. /releases/latest excludes prereleases, so it would return the
//     desktop release (or 404) and never an Android one. We list /releases
//     and filter by the `android-v` tag prefix instead.

const REPO = 'Juice-WRLD-API/Unreleased'
const TAG_PREFIX = 'android-v'
// Unauthenticated GitHub API allows 60 requests/hour/IP. One page is plenty:
// Android releases are frequent enough to appear well within 30 entries, and
// this only runs on an explicit check or once per app start.
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=30`

export interface AndroidRelease {
  /** Bare version, tag prefix stripped — e.g. "2.1.0". */
  version: string
  /** Direct .apk download, or null for a release published without one. */
  apkUrl: string | null
  notes: string
  htmlUrl: string
}

export interface UpdateCheck {
  installed: string
  latest: AndroidRelease | null
  updateAvailable: boolean
}

/** True only inside the Capacitor Android wrap — not the web build, not Electron. */
export function isAndroidApp(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor
  return !!cap?.isNativePlatform?.() && cap.getPlatform?.() === 'android'
}

export { shareOrigin } from './platform'

/**
 * Numeric semver compare. Returns >0 when `a` is newer than `b`.
 *
 * Any `-suffix` is dropped before comparing rather than ordered: release
 * versions here are plain x.y.z, and treating an unexpected suffix as equal
 * is the safe failure (no phantom update) versus guessing prerelease order.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v.trim().replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** The APK's own versionName, straight from the installed package. */
export async function getInstalledVersion(): Promise<string> {
  const { App } = await import('@capacitor/app')
  const info = await App.getInfo()
  return info.version
}

/** Newest `android-v*` release on GitHub, or null if none is published yet. */
export async function fetchLatestAndroidRelease(): Promise<AndroidRelease | null> {
  const resp = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } })
  if (!resp.ok) {
    throw new Error(resp.status === 403
      ? 'GitHub rate limit reached — try again later.'
      : `GitHub returned ${resp.status}.`)
  }
  const all = await resp.json() as {
    tag_name: string; draft: boolean; body: string | null; html_url: string
    assets: { name: string; browser_download_url: string }[]
  }[]

  const candidates = all
    .filter((r) => !r.draft && r.tag_name?.startsWith(TAG_PREFIX))
    .map((r) => ({
      version: r.tag_name.slice(TAG_PREFIX.length),
      apkUrl: r.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'))?.browser_download_url ?? null,
      notes: (r.body ?? '').trim(),
      htmlUrl: r.html_url,
    }))
  if (!candidates.length) return null

  // Sort by version rather than trusting feed order — /releases is ordered by
  // creation date, and a re-published or backfilled tag would sort wrong.
  candidates.sort((x, y) => compareVersions(y.version, x.version))
  return candidates[0]
}

export async function checkForAndroidUpdate(): Promise<UpdateCheck> {
  const [installed, latest] = await Promise.all([
    getInstalledVersion(),
    fetchLatestAndroidRelease(),
  ])
  return {
    installed,
    latest,
    updateAvailable: !!latest && compareVersions(latest.version, installed) > 0,
  }
}

/**
 * Fallback path: hand the URL to the browser so the system Download Manager
 * fetches it and the user taps the file to install. Used when the native
 * installer plugin isn't present (an older APK that predates it) — see
 * downloadAndInstall.
 */
export function openApkDownload(url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ── Native in-app installer (ApkInstallerPlugin) ─────────────────────────────

/**
 * Terminal outcome of an install session, or `confirming` while the system's
 * confirm dialog is up. `success` is best-effort: a successful self-update
 * kills this process, so in practice the app disappears rather than reporting
 * it. The failure states are the point — before the plugin used a
 * PackageInstaller session there was no outcome at all, and a rejected install
 * looked exactly like one still running.
 */
export type InstallState = 'confirming' | 'success' | 'cancelled' | 'failed'

export interface InstallStatus {
  state: InstallState
  message?: string
}

interface ApkInstallerPlugin {
  canInstall(): Promise<{ value: boolean }>
  openInstallSettings(): Promise<void>
  downloadAndInstall(options: { url: string }): Promise<void>
  addListener(
    event: 'downloadProgress',
    fn: (p: { percent: number; bytes: number; total: number }) => void,
  ): Promise<{ remove: () => void }>
  addListener(
    event: 'installStatus',
    fn: (s: InstallStatus) => void,
  ): Promise<{ remove: () => void }>
}

function plugin(): ApkInstallerPlugin | null {
  const cap = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
  return (cap?.Plugins?.ApkInstaller as ApkInstallerPlugin | undefined) ?? null
}

/**
 * True when this build can install an update itself. False on an APK built
 * before the plugin existed — those can still update via openApkDownload,
 * which is what makes this upgrade path self-bootstrapping.
 */
export function canInstallInApp(): boolean {
  return isAndroidApp() && !!plugin()
}

/** Whether the user has granted "install unknown apps" to this app. */
export async function hasInstallPermission(): Promise<boolean> {
  const p = plugin()
  if (!p) return false
  return (await p.canInstall()).value
}

/** Opens the system screen where "install unknown apps" is granted. */
export async function openInstallSettings(): Promise<void> {
  await plugin()?.openInstallSettings()
}

/**
 * Download the APK and commit an install session, reporting progress.
 *
 * Resolves once the session has been *committed*, not once the install
 * finishes — the system installer takes it from there in another process.
 * `onStatus` is how that outcome comes back, and the subscription deliberately
 * outlives this promise: the interesting statuses (blocked, out of storage,
 * cancelled at the confirm dialog) all arrive after the commit resolves. Call
 * the returned unsubscribe when the caller stops caring.
 *
 * Rejects with 'PERMISSION_REQUIRED' when the user hasn't granted
 * install-unknown-apps yet, which the caller should handle by sending them to
 * openInstallSettings() rather than showing it as an error.
 */
export async function downloadAndInstall(
  url: string,
  onProgress?: (percent: number) => void,
  onStatus?: (s: InstallStatus) => void,
): Promise<() => void> {
  const p = plugin()
  if (!p) throw new Error('In-app install is not available in this build.')
  const progressSub = onProgress
    ? await p.addListener('downloadProgress', (e) => onProgress(e.percent))
    : null
  const statusSub = onStatus ? await p.addListener('installStatus', onStatus) : null
  try {
    await p.downloadAndInstall({ url })
  } catch (err) {
    statusSub?.remove()
    throw err
  } finally {
    progressSub?.remove()
  }
  return () => statusSub?.remove()
}
