import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Download, Github, Monitor, Apple, Terminal, Smartphone, Share, Plus,
  HardDriveDownload, Library, Globe, Radio, FileAudio, RefreshCw, ArrowDown, Check,
  Home, History,
} from 'lucide-react'
import logo from '../assets/logo.png'
import { IS_ANDROID, IS_IOS, IS_MOBILE } from '../lib/platform'
import { hasPwaInstallPrompt, onPwaInstallPromptChange, showPwaInstallPrompt } from './InstallPrompt'

// Download page for the desktop app (web build only - the sidebar hides the
// entry point inside Electron). Versions, sizes and download URLs come from
// the GitHub Releases API so the page never goes stale between releases; if
// that fetch fails (rate limit, offline) every button falls back to the
// releases page itself.
//
// macOS builds don't ship with every release (they need a Mac to build), so
// the page scans the recent release list and serves the newest release that
// carries .dmg assets - possibly older than the Windows/Linux one.
//
// The Android APK and iOS IPA are each their own release train off their own
// branch (tagged `android-vX.Y.Z` / `ios-vX.Y.Z` - neither is store-listed,
// since both ship `unreleased`-catalog content), interleaved with the desktop
// `vX.Y.Z` tags in the same releases list. Every platform is picked out by
// which asset extensions each release carries, not by tag string. The iOS
// build is unsigned (no Apple Developer account behind it) - installed via
// AltStore/Sideloadly, which re-sign it locally with the user's own free
// Apple ID.

const REPO_URL = 'https://github.com/Juice-WRLD-API/Unreleased'
const LATEST_URL = `${REPO_URL}/releases/latest`

// The original desktop app this project succeeded - unmaintained, but some
// people still ask for it, so it gets a small, clearly-labeled spot here
// rather than the main grid.
const LEGACY_REPO_URL = 'https://github.com/HackinHood/juicewrldapi-desktop'

interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}

interface ReleaseInfo {
  version: string
  publishedAt: string
  htmlUrl: string
  assets: ReleaseAsset[]
}

// One fetch per session - the GitHub API is unauthenticated here (60 req/hr
// per IP), so revisiting the page must not burn another request.
let cachedReleases: ReleaseInfo[] | null = null

async function fetchReleases(): Promise<ReleaseInfo[]> {
  if (cachedReleases) return cachedReleases
  const res = await fetch('https://api.github.com/repos/Juice-WRLD-API/Unreleased/releases?per_page=20', {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const json = await res.json()
  cachedReleases = (Array.isArray(json) ? json : [])
    .filter((r: any) => !r.draft && !r.prerelease)
    .map((r: any): ReleaseInfo => ({
      version: String(r.tag_name ?? '').replace(/^v/, ''),
      publishedAt: r.published_at ?? '',
      htmlUrl: r.html_url ?? LATEST_URL,
      assets: (r.assets ?? []).map((a: any) => ({
        name: a.name, size: a.size, browser_download_url: a.browser_download_url,
      })),
    }))
  return cachedReleases
}

let cachedLegacyRelease: ReleaseInfo | null | undefined // undefined = not fetched yet

async function fetchLegacyRelease(): Promise<ReleaseInfo | null> {
  if (cachedLegacyRelease !== undefined) return cachedLegacyRelease
  try {
    const res = await fetch('https://api.github.com/repos/HackinHood/juicewrldapi-desktop/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const json = await res.json()
    cachedLegacyRelease = {
      version: String(json.tag_name ?? '').replace(/^v/, ''),
      publishedAt: json.published_at ?? '',
      htmlUrl: json.html_url ?? `${LEGACY_REPO_URL}/releases/latest`,
      assets: (json.assets ?? []).map((a: any) => ({
        name: a.name, size: a.size, browser_download_url: a.browser_download_url,
      })),
    }
  } catch {
    cachedLegacyRelease = null
  }
  return cachedLegacyRelease
}

type DetectedOS = 'windows' | 'mac' | 'linux' | 'ios' | 'android'

function detectOS(): DetectedOS {
  if (IS_IOS) return 'ios'
  if (IS_ANDROID) return 'android'
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac'
  if (/Linux|X11/i.test(ua)) return 'linux'
  return 'windows'
}

function fmtMB(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  } catch { return '' }
}

// ── Small building blocks ────────────────────────────────────────────────────

function FeatureCard({ icon, title, desc }: { icon: JSX.Element; title: string; desc: string }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-surface-overlay/40 p-5 transition-colors hover:border-[color:rgb(var(--accent-rgb)/0.45)]">
      <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center mb-3.5">
        {icon}
      </div>
      <p className="text-text-primary text-sm font-semibold mb-1">{title}</p>
      <p className="text-text-secondary text-[13px] leading-relaxed">{desc}</p>
    </div>
  )
}

function AssetButton({ asset, label, primary }: { asset: ReleaseAsset; label: string; primary?: boolean }): JSX.Element {
  return (
    <a
      href={asset.browser_download_url}
      className={primary
        ? 'flex items-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent/90 transition-colors'
        : 'flex items-center gap-2 w-full px-4 py-2 rounded-xl text-xs font-semibold border border-[var(--border)] text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors'}
    >
      <Download size={primary ? 15 : 13} className="shrink-0" />
      {/* Label on its own row, size below it - squeezing both onto one line
          either truncated the label (not enough room next to the size) or
          wrapped unpredictably (mid-word breaks, different heights) once
          label length varied across buttons. Stacking keeps every button
          the same shape regardless of how long its label is. */}
      <span className="flex-1 min-w-0 text-left leading-tight">
        <span className="block truncate">{label}</span>
        <span className={`block text-[11px] font-normal ${primary ? 'text-white/70' : 'text-text-muted'}`}>{fmtMB(asset.size)}</span>
      </span>
    </a>
  )
}

function PlatformCard({ icon, name, requirement, detected, children }: {
  icon: JSX.Element
  name: string
  requirement: string
  detected: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <div className={`relative flex flex-col rounded-2xl border bg-surface-overlay/40 p-5 transition-all hover:-translate-y-0.5 ${
      detected ? 'border-[color:rgb(var(--accent-rgb)/0.5)]' : 'border-[var(--border)] hover:border-[color:rgb(var(--accent-rgb)/0.35)]'
    }`}>
      {detected && (
        <span className="absolute -top-2.5 right-4 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-white text-[10px] font-bold uppercase tracking-wide">
          <Check size={10} strokeWidth={3} /> Your device
        </span>
      )}
      <div className="flex items-center gap-3 mb-1.5">
        <div className="w-10 h-10 rounded-xl bg-surface-raised text-text-primary flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-text-primary text-sm font-semibold">{name}</p>
          {/* min-h reserves room for 2 lines - some requirement strings
              ("macOS · Apple Silicon & Intel") wrap while shorter ones don't,
              which was pushing each card's buttons down by a different
              amount and left them misaligned across the row. */}
          <p className="text-text-muted text-[11px] leading-snug min-h-[28px]">{requirement}</p>
        </div>
      </div>
      <div className="mt-3.5 space-y-2">
        {children}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DownloadAppView(): JSX.Element {
  const [releases, setReleases] = useState<ReleaseInfo[] | null>(cachedReleases)
  const [failed, setFailed] = useState(false)
  const [legacyRelease, setLegacyRelease] = useState<ReleaseInfo | null | undefined>(cachedLegacyRelease)
  const [canInstallPwa, setCanInstallPwa] = useState(hasPwaInstallPrompt())

  const os = useMemo(detectOS, [])

  useEffect(() => {
    if (releases) return
    let alive = true
    fetchReleases()
      .then((r) => { if (alive) setReleases(r) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [releases])

  useEffect(() => {
    if (legacyRelease !== undefined) return
    let alive = true
    fetchLegacyRelease().then((r) => { if (alive) setLegacyRelease(r) })
    return () => { alive = false }
  }, [legacyRelease])

  useEffect(() => onPwaInstallPromptChange(() => setCanInstallPwa(hasPwaInstallPrompt())), [])

  // Release assets by platform. Windows/Linux come off the newest desktop
  // release; the macOS .dmg pair comes from the newest desktop release that
  // has one (Mac builds skip some versions). The web installer is the tiny
  // nsis-web stub that pulls the rest during setup - offered next to the
  // full offline installer.
  const desktopReleases = releases?.filter((r) => r.assets.some((a) => /\.(exe|AppImage|dmg)$/i.test(a.name))) ?? null
  const release = desktopReleases?.[0] ?? null
  const assets = release?.assets ?? []
  const winFull = assets.find((a) => /^Unreleased-Setup-.+\.exe$/i.test(a.name))
  const winWeb = assets.find((a) => a.name === 'Unreleased-Setup.exe')
  const linuxAppImage = assets.find((a) => a.name.endsWith('.AppImage'))

  const macRelease = desktopReleases?.find((r) => r.assets.some((a) => a.name.endsWith('.dmg'))) ?? null
  const macArm = macRelease?.assets.find((a) => a.name.endsWith('-arm64.dmg'))
  const macIntel = macRelease?.assets.find((a) => a.name.endsWith('.dmg') && !a.name.endsWith('-arm64.dmg'))
  const macDmg = macArm ?? macIntel
  const macLagging = !!macRelease && !!release && macRelease.version !== release.version

  // Android ships from its own tag train (`android-vX.Y.Z`) - pick the newest
  // release carrying an .apk regardless of where it falls in the combined list.
  const androidRelease = releases?.find((r) => r.assets.some((a) => a.name.endsWith('.apk'))) ?? null
  const androidApk = androidRelease?.assets.find((a) => a.name.endsWith('.apk'))

  // Same idea for iOS's own `ios-vX.Y.Z` train - an unsigned .ipa, sideloaded
  // via AltStore/Sideloadly rather than the App Store.
  const iosRelease = releases?.find((r) => r.assets.some((a) => a.name.endsWith('.ipa'))) ?? null
  const iosIpa = iosRelease?.assets.find((a) => a.name.endsWith('.ipa'))

  const heroAsset = os === 'windows' ? winFull : os === 'linux' ? linuxAppImage : os === 'mac' ? macDmg : os === 'android' ? androidApk : undefined
  const heroLabel = os === 'windows' ? 'Download for Windows' : os === 'linux' ? 'Download for Linux' : os === 'mac' ? 'Download for macOS' : os === 'android' ? 'Download APK' : 'Download'

  const loading = !releases && !failed

  const heroBtnCls = 'inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-2xl text-[15px] font-bold bg-accent text-white hover:bg-accent/90 shadow-lg shadow-[rgb(var(--accent-rgb)/0.35)] transition-all hover:-translate-y-0.5'
  const heroGhostCls = 'inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl text-sm font-semibold border border-[var(--border)] text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors'

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="relative w-full max-w-5xl mx-auto px-5 md:px-8 pt-12 md:pt-20 pb-16">

        {/* ── Hero ── */}
        <div className="relative text-center">
          {/* Accent glow behind the hero - pure decoration. */}
          <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[540px] max-w-full h-[340px] rounded-full bg-accent/20 blur-[110px]" />

          <div className="relative">
            <img
              src={logo}
              alt=""
              className="w-24 h-24 mx-auto object-contain drop-shadow-2xl mb-6"
            />
            <h1 className="text-text-primary text-4xl md:text-5xl font-extrabold tracking-tight mb-3">
              {os === 'android' ? 'Unreleased for Android' : 'Unreleased for desktop'}
            </h1>
            <p className="text-text-secondary text-base md:text-lg max-w-xl mx-auto leading-relaxed mb-5">
              {os === 'android'
                ? 'Everything from the web player, plus offline downloads, background playback and Discord Rich Presence - in a fast native app.'
                : 'Everything from the web player, plus offline downloads, a local library, audio effects and Discord Rich Presence - in a fast native app.'}
            </p>

            {/* Version pill */}
            <div className="flex items-center justify-center mb-8 h-7">
              {loading ? (
                <div className="w-56 h-7 rounded-full bg-surface-raised animate-pulse" />
              ) : os === 'android' ? (
                androidRelease ? (
                  <a
                    href={androidRelease.htmlUrl}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full border border-[var(--border)] bg-surface-overlay/60 text-xs text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="font-semibold text-text-primary">{androidRelease.version}</span>
                    {androidRelease.publishedAt && <span className="text-text-muted">· {fmtDate(androidRelease.publishedAt)}</span>}
                  </a>
                ) : (
                  <span className="text-text-muted text-xs">Latest version info unavailable - buttons below go to GitHub.</span>
                )
              ) : release ? (
                <a
                  href={release.htmlUrl}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full border border-[var(--border)] bg-surface-overlay/60 text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="font-semibold text-text-primary">v{release.version}</span>
                  {release.publishedAt && <span className="text-text-muted">· {fmtDate(release.publishedAt)}</span>}
                </a>
              ) : (
                <span className="text-text-muted text-xs">Latest version info unavailable - buttons below go to GitHub.</span>
              )}
            </div>

            {/* Primary CTA(s) */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              {heroAsset ? (
                <a href={heroAsset.browser_download_url} className={heroBtnCls}>
                  <Download size={18} /> {heroLabel}
                  <span className="font-medium text-white/70 text-sm">{fmtMB(heroAsset.size)}</span>
                </a>
              ) : IS_MOBILE ? (
                <a href="#mobile-install" className={heroBtnCls}>
                  <Smartphone size={18} /> Install on this phone
                </a>
              ) : (
                <a href={failed ? LATEST_URL : '#all-downloads'} target={failed ? '_blank' : undefined} rel={failed ? 'noopener noreferrer' : undefined} className={heroBtnCls}>
                  <ArrowDown size={18} /> See download options
                </a>
              )}
              <a href="#all-downloads" className={heroGhostCls}>
                All platforms
              </a>
            </div>

            {os === 'mac' && heroAsset && heroAsset === macArm && macIntel && (
              <p className="text-text-muted text-xs mt-4">
                Apple Silicon build - on an Intel Mac, grab the Intel version below.
              </p>
            )}
            {os === 'android' && heroAsset && (
              <p className="text-text-muted text-xs mt-4">
                Sideloaded APK - Android will ask you to allow installs from this source the first time.
              </p>
            )}
          </div>
        </div>

        {/* ── Platform downloads ── */}
        <div id="all-downloads" className="scroll-mt-8 mt-16 md:mt-20">
          <h2 className="text-text-primary text-xl font-bold tracking-tight mb-1">Choose your platform</h2>
          <p className="text-text-muted text-sm mb-6">
            Installers come from the{' '}
            <a href={LATEST_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">latest GitHub release</a>
            {' '}and update themselves automatically after that.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            <PlatformCard icon={<Monitor size={19} />} name="Windows" requirement="Windows 10 / 11 · 64-bit" detected={os === 'windows'}>
              {loading ? (
                <div className="h-[42px] rounded-xl bg-surface-raised animate-pulse" />
              ) : winFull || winWeb ? (
                <>
                  {winFull && <AssetButton asset={winFull} label="Installer" primary />}
                  {winWeb && <AssetButton asset={winWeb} label="Web installer" />}
                  {winWeb && <p className="text-text-muted text-[11px] leading-snug">The web installer is a small stub that fetches the app during setup.</p>}
                </>
              ) : (
                <a href={LATEST_URL} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent/90 transition-colors">
                  <Download size={15} /> Get from GitHub
                </a>
              )}
            </PlatformCard>

            <PlatformCard icon={<Terminal size={19} />} name="Linux" requirement="AppImage · x64" detected={os === 'linux'}>
              {loading ? (
                <div className="h-[42px] rounded-xl bg-surface-raised animate-pulse" />
              ) : linuxAppImage ? (
                <>
                  <AssetButton asset={linuxAppImage} label="AppImage" primary />
                  <p className="text-text-muted text-[11px] leading-snug">Mark it executable (<code className="text-text-secondary">chmod +x</code>), then run - no install step.</p>
                </>
              ) : (
                <a href={LATEST_URL} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent/90 transition-colors">
                  <Download size={15} /> Get from GitHub
                </a>
              )}
            </PlatformCard>

            <PlatformCard icon={<Apple size={19} />} name="macOS" requirement="macOS · Apple Silicon & Intel" detected={os === 'mac'}>
              {loading ? (
                <div className="h-[42px] rounded-xl bg-surface-raised animate-pulse" />
              ) : macArm || macIntel ? (
                <>
                  {macArm && <AssetButton asset={macArm} label="Apple Silicon" primary />}
                  {macIntel && <AssetButton asset={macIntel} label="Intel" primary={!macArm} />}
                  {macLagging && (
                    <p className="text-text-muted text-[11px] leading-snug">
                      Latest Mac build is v{macRelease!.version} - it updates itself when the next one ships.
                    </p>
                  )}
                </>
              ) : (
                <a href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent/90 transition-colors">
                  <Download size={15} /> Get from GitHub
                </a>
              )}
            </PlatformCard>

            <PlatformCard icon={<Smartphone size={19} />} name="Android" requirement={androidRelease ? `APK · ${androidRelease.version}` : 'Sideloaded APK'} detected={os === 'android'}>
              {loading ? (
                <div className="h-[42px] rounded-xl bg-surface-raised animate-pulse" />
              ) : androidApk ? (
                <>
                  <AssetButton asset={androidApk} label="Download APK" primary />
                  <p className="text-text-muted text-[11px] leading-snug">
                    Not on the Play Store - you&rsquo;ll need to allow installs from this source when prompted.
                  </p>
                </>
              ) : (
                <a href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent/90 transition-colors">
                  <Download size={15} /> Get from GitHub
                </a>
              )}
            </PlatformCard>

            <PlatformCard icon={<Smartphone size={19} />} name="iOS" requirement={iosRelease ? `IPA · ${iosRelease.version}` : 'Sideloaded IPA'} detected={os === 'ios'}>
              {loading ? (
                <div className="h-[42px] rounded-xl bg-surface-raised animate-pulse" />
              ) : iosIpa ? (
                <>
                  <AssetButton asset={iosIpa} label="Download IPA" primary />
                  <p className="text-text-muted text-[11px] leading-snug">
                    Unsigned - install with <a href="https://altstore.io" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">AltStore</a> or <a href="https://sideloadly.io" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Sideloadly</a>.
                  </p>
                </>
              ) : (
                <a href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent/90 transition-colors">
                  <Download size={15} /> Get from GitHub
                </a>
              )}
            </PlatformCard>
          </div>

          {/* ── Phone / PWA - the web-app-to-home-screen route. The lighter
              alternative to sideloading on both Android (no "unknown sources"
              prompt) and iOS (no AltStore/Sideloadly + re-signing needed). ── */}
          <div id="mobile-install" className="scroll-mt-8 mt-4 rounded-2xl border border-[var(--border)] bg-surface-overlay/40 p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-5">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
                <Home size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-text-primary text-sm font-semibold mb-0.5">
                  {os === 'android' ? 'Prefer the web app?' : 'On your phone?'}
                </p>
                <p className="text-text-secondary text-[13px] leading-relaxed">
                  {os === 'android'
                    ? 'Skip the APK and install the web app to your home screen instead - same look, updates itself, no "unknown sources" prompt.'
                    : 'Install the web app to your home screen for a fullscreen, app-like experience - no app store needed.'}
                  {!IS_MOBILE && ' Open this site on your phone to install it there.'}
                </p>
              </div>
            </div>
            {IS_IOS ? (
              <div className="shrink-0 text-[13px] text-text-secondary space-y-1.5">
                <p className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-raised border border-[var(--border)]"><Share size={12} /> Share</span>
                  <span>in Safari, then</span>
                </p>
                <p className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-raised border border-[var(--border)]"><Plus size={12} /> Add to Home Screen</p>
              </div>
            ) : IS_MOBILE && canInstallPwa ? (
              <button
                onClick={() => { showPwaInstallPrompt() }}
                className="shrink-0 inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent/90 transition-colors"
              >
                <Download size={15} /> Install
              </button>
            ) : null}
          </div>
        </div>

        {/* ── Why the desktop app ── */}
        <div className="mt-16 md:mt-20">
          <h2 className="text-text-primary text-xl font-bold tracking-tight mb-1">Built for the desktop</h2>
          <p className="text-text-muted text-sm mb-6">What you get on top of the web player.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              icon={<HardDriveDownload size={19} />}
              title="Offline downloads"
              desc="Save songs and entire playlists to your device and keep listening with no connection at all."
            />
            <FeatureCard
              icon={<Library size={19} />}
              title="Local library"
              desc="Point the app at your own folders - browse, search and tag-edit your files right next to the catalog."
            />
            <FeatureCard
              icon={<Globe size={19} />}
              title="URL import"
              desc="Drop in a direct file link - or a link from around 1,800 supported sites - and it lands in your library."
            />
            <FeatureCard
              icon={<FileAudio size={19} />}
              title="Format conversion"
              desc="Convert local files between MP3, FLAC, WAV, OGG and more with the bundled converter."
            />
            <FeatureCard
              icon={<Radio size={19} />}
              title="Discord Rich Presence"
              desc="Show what you're playing on your Discord profile, cover art included."
            />
            <FeatureCard
              icon={<RefreshCw size={19} />}
              title="Automatic updates"
              desc="New releases download in the background and install on the next launch - you're always current."
            />
          </div>
        </div>

        {/* ── Legacy app ── */}
        {legacyRelease && (
          <div className="mt-10 rounded-2xl border border-dashed border-[var(--border)] bg-surface-overlay/20 p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-surface-raised text-text-muted flex items-center justify-center shrink-0">
                <History size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-text-primary text-sm font-semibold mb-0.5">Looking for the old app?</p>
                <p className="text-text-secondary text-[13px] leading-relaxed">
                  Before Unreleased there was the original{' '}
                  <a href={LEGACY_REPO_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">JuiceWRLD API Desktop</a>
                  {' '}app. It&rsquo;s no longer maintained, but it&rsquo;s still here if you want it.
                </p>
              </div>
            </div>
            {(() => {
              const legacyExe = legacyRelease.assets.find((a) => a.name.endsWith('.exe'))
              return legacyExe ? (
                <a
                  href={legacyExe.browser_download_url}
                  className="shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border)] text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                >
                  <Download size={13} /> Windows · v{legacyRelease.version}
                  <span className="text-text-muted">· {fmtMB(legacyExe.size)}</span>
                </a>
              ) : (
                <a
                  href={`${LEGACY_REPO_URL}/releases/latest`} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border)] text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                >
                  <Download size={13} /> Get from GitHub
                </a>
              )
            })()}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-14 pt-6 border-t border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-text-muted text-xs">
            Free & open source · Fan-made project, not affiliated with any label.
          </p>
          <div className="flex items-center gap-4">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors">
              <Github size={14} /> Source on GitHub
            </a>
            <a href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors">
              All releases
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
