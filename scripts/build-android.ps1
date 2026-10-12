$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

# Android Studio's bundled Java and the normal Windows SDK location.
# Keep these scoped to this build terminal, without changing system settings.
if (-not $env:JAVA_HOME -and (Test-Path -LiteralPath 'C:\Program Files\Android\Android Studio\jbr\bin\java.exe')) {
    $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
}
if (-not $env:ANDROID_HOME) {
    if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_HOME = $env:ANDROID_SDK_ROOT }
    else { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
}

& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
& .\node_modules\.bin\cap.cmd sync android
if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
& .\android\gradlew.bat -p android assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'Android APK build failed.' }

Write-Host 'Debug APK ready: android\app\build\outputs\apk\debug\app-debug.apk' -ForegroundColor Green
