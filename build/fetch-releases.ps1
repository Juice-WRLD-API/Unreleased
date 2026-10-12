# Bundled into the installer (see build/installer.nsh). Lists released
# versions of the app as "tag|installer-download-url" lines, newest first,
# for the maintenance page's version picker.
#
# Stable versions come from the public GitHub API, unauthenticated, same as
# always. Beta versions are NEVER public GitHub releases (that was the whole
# point of gating them) — they live behind juicewrldapi.com's own backend,
# which this script calls with the entered code when -Code is passed.
#
# Backend contract (implemented server-side, not in this repo):
#   GET  {BetaApiBase}/versions   header X-Beta-Code: <code>
#        -> 200 JSON array [{ "version": "1.15.0-beta.1", "notes": ...,
#           "published_at": ..., "created_at": ... }, ...], active only, newest
#           first, on a valid code; 403 on an invalid one.
#   GET  {BetaApiBase}/download?version=<version>   header X-Beta-Code: <code>
#        -> the build file as an attachment. <version> is the bare string
#           from /versions (no "v" prefix). 403 invalid code, 404 unknown
#           version or missing file, 400 no version. build/installer.nsh sends
#           the header itself when downloading — this script only needs to
#           embed the endpoint URL.
#
# Exit codes: 0 = success (stable list, plus beta entries if a code was given
# and accepted); 1 = couldn't get the stable list at all (network failure);
# 2 = the beta code that was passed was rejected (401/403) — the stable list is
# NOT written in this case, since build/installer.nsh treats any non-zero
# exit as "don't touch the picker" and simply shows the rejection message.
param(
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$ExcludeTag = "",
  [string]$Code = ""
)

$ErrorActionPreference = 'Stop'
try {
  # Older Windows PowerShell defaults may not offer TLS 1.2, which both
  # GitHub and juicewrldapi.com require.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$BetaApiBase = 'https://juicewrldapi.com/beta'

# ── Stable versions ──────────────────────────────────────────────────────────
try {
  $releases = Invoke-RestMethod -Uri 'https://api.github.com/repos/Juice-WRLD-API/Unreleased/releases?per_page=100' `
    -Headers @{ 'User-Agent' = 'Unreleased-Installer'; 'Accept' = 'application/vnd.github+json' } -TimeoutSec 15
} catch {
  exit 1
}

$lines = @(
  foreach ($r in $releases) {
    if ($r.draft -or $r.prerelease) { continue }
    if ($ExcludeTag -and $r.tag_name -eq $ExcludeTag) { continue }
    $assets = @($r.assets)
    # Prefer the full offline installer (Unreleased-Setup-<ver>.exe; a couple of
    # old releases used dots as separators). Fall back to the web-installer stub,
    # which downloads its own version's package when run.
    $asset = $assets | Where-Object { $_.name -match '^Unreleased[-.]Setup[-.].+\.exe$' } | Select-Object -First 1
    if (-not $asset) { $asset = $assets | Where-Object { $_.name -eq 'Unreleased-Setup.exe' } | Select-Object -First 1 }
    if ($asset) { "$($r.tag_name)|$($asset.browser_download_url)" }
  }
) | Select-Object -First 60

# ── Beta versions (only attempted when a code was supplied) ────────────────
if ($Code) {
  try {
    $betaReleases = Invoke-RestMethod -Uri "$BetaApiBase/versions" `
      -Headers @{ 'X-Beta-Code' = $Code; 'User-Agent' = 'Unreleased-Installer' } -TimeoutSec 15
    foreach ($r in @($betaReleases)) {
      if (-not $r.version) { continue }
      # Picker entries are "v"-prefixed tags like the stable ones (installer.nsh
      # keys the beta download header off the "-" in the tag); the backend
      # wants the bare version string.
      $tag = "v$($r.version)"
      if ($ExcludeTag -and $tag -eq $ExcludeTag) { continue }
      $lines += "$tag|$BetaApiBase/download?version=$([Uri]::EscapeDataString($r.version))"
    }
  } catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -eq 401 -or $status -eq 403) { exit 2 }
    # Any other failure (backend down, timeout, 5xx) just means no beta
    # entries this round — the stable list is still good, so fall through
    # and exit 0 rather than treating it as a hard failure.
  }
}

if (-not $lines) { exit 1 }
Set-Content -LiteralPath $OutFile -Value $lines -Encoding ASCII
exit 0
