# Preview the version-group merge, then prompt for a token and apply it.
Set-Location (Split-Path $PSScriptRoot -Parent)
node scripts/merge-version-groups-by-title.mjs
if ($LASTEXITCODE -ne 0) { return }
$secure = Read-Host 'Editor/admin token (blank to stop, input hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$env:JW_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
if (-not $env:JW_TOKEN) { Write-Host 'No token, nothing written.'; return }
node scripts/merge-version-groups-by-title.mjs --apply
Remove-Item Env:JW_TOKEN
