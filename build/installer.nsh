; Custom NSIS hooks compiled into the electron-builder installer/uninstaller
; (wired up via build.nsis.include in package.json).
;
; Installer additions:
;  - customInstallMode: keeps installs per-user (skips the "all users / just
;    me" page) unless a per-machine copy already exists.
;  - customWelcomePage: shown on every interactive install. When the app is
;    already installed it becomes a maintenance page — update/reinstall,
;    uninstall, or switch to any other released version. Fresh installs get a
;    simple intro. Both variants include an optional beta access code field.
;
;    Beta access is validated SERVER-SIDE (build/fetch-releases.ps1 calls the
;    juicewrldapi.com backend — see that script for the full endpoint
;    contract) — there is no code/hash baked into this installer. A valid
;    code unlocks beta versions in the picker and drops a marker containing
;    the code itself in the app's data folder; electron/main.js reads that
;    file both to enable pre-release auto-updates and to authenticate its own
;    update-feed requests. Downloading a beta build (tag contains "-") sends
;    the code as an "X-Beta-Code" header, never in the URL.
;    Skipped for silent installs, auto-updates and elevated inner instances.
;  - customInstall: after an auto-update, restarts the app when it asked for
;    that (the relaunch-after-update marker, see electron/main.js).
;  - customFinishPage: the stock finish page, skipped on auto-updates. The app
;    runs update installers silently behind a stand-in window of its own, and
;    non-silently (only the progress bar) when that window can't come up or
;    the last install failed. Every other page already skips itself for
;    updates, and this plus SetAutoClose in customInstall lets the installer
;    close on its own.

!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "WordFunc.nsh"
!include "nsDialogs.nsh"
; Only used by the installer's maintenance page (never called from the
; uninstaller build pass) — including it unconditionally leaves the function
; unreferenced there, and NSIS's "unreferenced function" warning is fatal
; under electron-builder's strict build.
!ifndef BUILD_UNINSTALLER
  !include "StrContains.nsh"
!endif

!ifndef WS_GROUP
  !define WS_GROUP 0x00020000
!endif
!ifndef BST_CHECKED
  !define BST_CHECKED 1
!endif

; Strip trailing CR/LF from a variable (FileRead keeps the line ending).
; ID must be unique per insertion within a function (used for jump labels).
!macro MAINT_TRIM VAR ID
  trimLoop_${ID}:
    StrCpy $9 ${VAR} 1 -1
    StrCmp $9 "$\r" trimDo_${ID}
    StrCmp $9 "$\n" trimDo_${ID} trimDone_${ID}
    trimDo_${ID}:
      StrCpy ${VAR} ${VAR} -1
      Goto trimLoop_${ID}
  trimDone_${ID}:
!macroend

; Drop the beta marker (the validated code itself — electron/main.js sends it
; back to the backend as a bearer credential on every update check) in the
; app's per-user data folder. Electron user data is always per-user, so
; temporarily leave the "all users" shell context if a per-machine install is
; running (same dance the electron-builder template does for its own
; per-user files).
!macro MAINT_WRITE_BETA_MARKER
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}
  CreateDirectory "$APPDATA\${APP_FILENAME}"
  ClearErrors
  FileOpen $9 "$APPDATA\${APP_FILENAME}\beta-access" w
  ${ifNot} ${errors}
    FileWrite $9 "$BetaCodeValue"
    FileClose $9
  ${endif}
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}
!macroend

!macro customInstallMode
  ; This app has always shipped as a per-user install (the old one-click
  ; installer never asked either), so skip the "all users / just me" page
  ; unless a per-machine copy actually exists and needs proper handling.
  ${if} $hasPerMachineInstallation == "0"
    StrCpy $isForceCurrentInstall "1"
  ${endif}
!macroend

!macro customWelcomePage
  Page custom MaintPageCreate MaintPageLeave

  Var MaintDialog
  Var MaintInstalled
  Var MaintInstalledVersion
  Var MaintUninstallString
  Var MaintRadioUpdate
  Var MaintRadioUninstall
  Var MaintRadioOther
  Var MaintCombo
  Var MaintStatus
  Var MaintVersionsLoaded
  Var MaintBetaField
  Var MaintBetaButton
  Var MaintBetaStatus
  Var BetaUnlocked
  ; The validated code itself (not just a flag) — needed as a bearer
  ; credential for the gated /beta/versions and /beta/download calls, and
  ; written into the marker file main.js reads.
  Var BetaCodeValue
  ; Exit code from the last fetch-releases.ps1 run: 0 = ok, 1 = network
  ; error, 2 = the beta code that was passed is invalid.
  Var MaintLastFetchExit

  ; Query the version list (via a bundled PowerShell script — see
  ; fetch-releases.ps1 for the full contract) and fill the dropdown. Stable
  ; versions always come from the public GitHub API; when $BetaCodeValue is
  ; set, the script ALSO validates it against the gated backend and merges in
  ; beta versions if it's accepted. Sets $MaintLastFetchExit for the caller.
  Function MaintFetchVersions
    ${NSD_SetText} $MaintStatus "Fetching version list…"
    File "/oname=$PLUGINSDIR\unreleased-fetch-releases.ps1" "${BUILD_RESOURCES_DIR}\fetch-releases.ps1"
    StrCpy $5 ""
    ${If} $BetaCodeValue != ""
      StrCpy $5 ' -Code "$BetaCodeValue"'
    ${EndIf}
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\unreleased-fetch-releases.ps1" -OutFile "$PLUGINSDIR\unreleased-versions.txt" -ExcludeTag "v${VERSION}"$5`
    Pop $MaintLastFetchExit
    Pop $1
    StrCmp $MaintLastFetchExit "0" 0 fetchFailed
    IfFileExists "$PLUGINSDIR\unreleased-versions.txt" 0 fetchFailed

    SendMessage $MaintCombo ${CB_RESETCONTENT} 0 0
    FileOpen $2 "$PLUGINSDIR\unreleased-versions.txt" r
    StrCmp $2 "" fetchFailed
    popLoop:
      FileRead $2 $3
      IfErrors popDone
      !insertmacro MAINT_TRIM $3 fetchLine
      StrCmp $3 "" popLoop
      ${WordFind} $3 "|" "+1" $4
      ${NSD_CB_AddString} $MaintCombo $4
      Goto popLoop
    popDone:
    FileClose $2
    SendMessage $MaintCombo ${CB_SETCURSEL} 0 0
    StrCpy $MaintVersionsLoaded "1"
    ${NSD_SetText} $MaintStatus ""
    Return

    fetchFailed:
      ${If} $MaintLastFetchExit == "2"
        ${NSD_SetText} $MaintStatus "Beta code rejected by server — showing stable versions only."
      ${Else}
        ${NSD_SetText} $MaintStatus "Couldn't fetch versions. Check your internet connection, then click this option again to retry."
      ${EndIf}
  FunctionEnd

  Function MaintRadioClick
    Pop $0
    ${NSD_GetState} $MaintRadioOther $0
    StrCmp $0 ${BST_CHECKED} otherSelected
    EnableWindow $MaintCombo 0
    Return
    otherSelected:
      EnableWindow $MaintCombo 1
      StrCmp $MaintVersionsLoaded "1" alreadyLoaded
      Call MaintFetchVersions
      alreadyLoaded:
  FunctionEnd

  ; Validates the entered code against the backend (via the same script,
  ; which also re-fetches the merged version list in one round trip) rather
  ; than any local secret — codes can be revoked/added server-side with no
  ; installer rebuild.
  Function MaintBetaUnlockClick
    Pop $0
    ${NSD_GetText} $MaintBetaField $1
    ${StdUtils.TrimStr} $1
    ${If} $1 == ""
      ${NSD_SetText} $MaintBetaStatus "Enter a code first."
      Return
    ${EndIf}

    ${NSD_SetText} $MaintBetaStatus "Checking code…"
    StrCpy $BetaCodeValue "$1"
    StrCpy $MaintVersionsLoaded ""
    Call MaintFetchVersions

    ${If} $MaintLastFetchExit == "0"
      StrCpy $BetaUnlocked "1"
      EnableWindow $MaintBetaField 0
      EnableWindow $MaintBetaButton 0
      ${NSD_SetText} $MaintBetaStatus "Beta access unlocked — beta builds enabled."
    ${ElseIf} $MaintLastFetchExit == "2"
      StrCpy $BetaCodeValue ""
      ${NSD_SetText} $MaintBetaStatus "Invalid code."
    ${Else}
      StrCpy $BetaCodeValue ""
      ${NSD_SetText} $MaintBetaStatus "Couldn't reach the server. Check your connection and try again."
    ${EndIf}
  FunctionEnd

  Function MaintPageCreate
    ; Never interfere with auto-updates or the elevated inner instance;
    ; silent installs never show pages to begin with.
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    ${If} ${UAC_IsInnerInstance}
      Abort
    ${EndIf}

    ; SHELL_CONTEXT follows the install mode initMultiUser detected, so this
    ; reads the registry hive of the existing installation (if any).
    ReadRegStr $MaintInstalledVersion SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    ReadRegStr $MaintUninstallString SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${If} $MaintInstalledVersion == ""
      StrCpy $MaintInstalled "0"
    ${Else}
      StrCpy $MaintInstalled "1"
    ${EndIf}

    ${If} $MaintInstalled == "1"
      !insertmacro MUI_HEADER_TEXT "Already installed" "Choose what to do with the existing ${PRODUCT_NAME} installation."
    ${Else}
      !insertmacro MUI_HEADER_TEXT "Install ${PRODUCT_NAME}" "Version ${VERSION}"
    ${EndIf}

    nsDialogs::Create 1018
    Pop $MaintDialog
    ${If} $MaintDialog == error
      Abort
    ${EndIf}

    ${If} $MaintInstalled == "1"
      ${NSD_CreateLabel} 0u 0u 300u 16u "${PRODUCT_NAME} $MaintInstalledVersion is already installed on this PC. What would you like to do?"
      Pop $0

      ${If} $MaintInstalledVersion == "${VERSION}"
        StrCpy $0 "Reinstall version ${VERSION}  (keeps your settings and library)"
      ${Else}
        StrCpy $0 "Install version ${VERSION}  (keeps your settings and library)"
      ${EndIf}
      ${NSD_CreateRadioButton} 10u 20u 285u 12u "$0"
      Pop $MaintRadioUpdate
      ${NSD_AddStyle} $MaintRadioUpdate ${WS_GROUP}

      ${NSD_CreateRadioButton} 10u 36u 285u 12u "Uninstall ${PRODUCT_NAME} $MaintInstalledVersion"
      Pop $MaintRadioUninstall

      ${NSD_CreateRadioButton} 10u 52u 285u 12u "Switch to a different version:"
      Pop $MaintRadioOther

      ${NSD_CreateDropList} 22u 66u 100u 84u ""
      Pop $MaintCombo
      EnableWindow $MaintCombo 0

      ${NSD_CreateLabel} 130u 67u 165u 24u ""
      Pop $MaintStatus

      ${NSD_CreateLabel} 0u 88u 300u 16u "Note: an older version may update itself back unless auto-download is turned off in the app's Settings."
      Pop $0

      ${NSD_Check} $MaintRadioUpdate
      ${NSD_OnClick} $MaintRadioUpdate MaintRadioClick
      ${NSD_OnClick} $MaintRadioUninstall MaintRadioClick
      ${NSD_OnClick} $MaintRadioOther MaintRadioClick

      StrCpy $1 "106u"
      StrCpy $2 "118u"
    ${Else}
      ${NSD_CreateLabel} 0u 0u 300u 28u "Setup will install ${PRODUCT_NAME} ${VERSION} on this PC. Click Next to continue."
      Pop $0

      StrCpy $1 "44u"
      StrCpy $2 "56u"
    ${EndIf}

    ; ── Beta access (optional) ──
    ${NSD_CreateLabel} 0u $1 300u 10u "Have a beta access code? Enter it to unlock beta versions:"
    Pop $0
    ${NSD_CreateText} 10u $2 100u 12u ""
    Pop $MaintBetaField
    ${NSD_CreateButton} 116u $2 45u 13u "Unlock"
    Pop $MaintBetaButton
    ${NSD_CreateLabel} 168u $2 130u 20u ""
    Pop $MaintBetaStatus
    ${NSD_OnClick} $MaintBetaButton MaintBetaUnlockClick

    ; Already in the beta channel (the app dropped its marker earlier) → unlock
    ; from that code instead of making the user type it in again. The server
    ; still validates it on the version fetch, so a revoked code just reads as
    ; "rejected" there.
    ${If} $BetaUnlocked != "1"
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}
      ClearErrors
      FileOpen $3 "$APPDATA\${APP_FILENAME}\beta-access" r
      ${IfNot} ${Errors}
        FileRead $3 $4
        FileClose $3
        ${StdUtils.TrimStr} $4
        ${If} $4 != ""
          StrCpy $BetaCodeValue "$4"
          StrCpy $BetaUnlocked "1"
        ${EndIf}
      ${EndIf}
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}

    ${If} $BetaUnlocked == "1"
      ; page revisited after unlocking — keep it unlocked
      EnableWindow $MaintBetaField 0
      EnableWindow $MaintBetaButton 0
      ${NSD_SetText} $MaintBetaStatus "Beta access unlocked — beta builds enabled."
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function MaintPageLeave
    ${If} $MaintInstalled == "1"
      ${NSD_GetState} $MaintRadioUninstall $0
      ${If} $0 == ${BST_CHECKED}
        MessageBox MB_YESNO|MB_ICONQUESTION "This removes ${PRODUCT_NAME} $MaintInstalledVersion from this PC (the uninstaller will ask what to do with your data). Continue?" IDYES doUninstall
        Abort
        doUninstall:
        ${If} $MaintUninstallString == ""
          MessageBox MB_OK|MB_ICONEXCLAMATION "Couldn't find the uninstaller for the existing installation."
          Abort
        ${EndIf}
        ; NSIS uninstallers copy themselves to $TEMP on launch, so executing
        ; the installed copy directly is fine.
        Exec '$MaintUninstallString'
        !insertmacro quitSuccess
      ${EndIf}

      ${NSD_GetState} $MaintRadioOther $0
      ${If} $0 == ${BST_CHECKED}
        ${NSD_GetText} $MaintCombo $R1
        ${If} $R1 == ""
          MessageBox MB_OK|MB_ICONEXCLAMATION "Select a version from the list first."
          Abort
        ${EndIf}

        ; Look up the download URL recorded for the chosen tag ("tag|url" lines).
        StrCpy $R2 ""
        StrLen $R4 $R1
        FileOpen $R5 "$PLUGINSDIR\unreleased-versions.txt" r
        StrCmp $R5 "" urlDone
        urlLoop:
          FileRead $R5 $R6
          IfErrors urlClose
          !insertmacro MAINT_TRIM $R6 urlLine
          StrCpy $R7 $R6 $R4
          StrCmp $R7 $R1 0 urlLoop
          StrCpy $R7 $R6 1 $R4
          StrCmp $R7 "|" 0 urlLoop
          IntOp $R8 $R4 + 1
          StrCpy $R2 $R6 "" $R8
        urlClose:
        FileClose $R5
        urlDone:

        ${If} $R2 == ""
          MessageBox MB_OK|MB_ICONEXCLAMATION "No download found for $R1."
          Abort
        ${EndIf}

        ; Beta tags carry a pre-release suffix (e.g. "v1.15.0-beta.1"); their
        ; download URL points at the gated backend and needs the code sent as
        ; a header (never embedded in the URL). Stable tags are a plain
        ; "vMAJOR.MINOR.PATCH" and need no auth at all.
        StrCpy $R9 ""
        ${StrContains} $R9 "-" $R1
        ${If} $R9 != ""
          StrCpy $R9 '/HEADER "X-Beta-Code: $BetaCodeValue"'
        ${EndIf}

        StrCpy $R3 "$TEMP\Unreleased-Setup-$R1.exe"
        inetc::get /CAPTION "${PRODUCT_NAME} $R1" /POPUP "" /RESUME "" $R9 "$R2" "$R3" /END
        Pop $0
        ${If} $0 != "OK"
          Delete "$R3"
          ${If} $0 == "Cancelled"
            Abort
          ${EndIf}
          MessageBox MB_OK|MB_ICONEXCLAMATION "Download failed: $0"
          Abort
        ${EndIf}

        ; The version we hand off to won't know about the beta unlock, so
        ; write the marker now.
        ${If} $BetaUnlocked == "1"
          !insertmacro MAINT_WRITE_BETA_MARKER
        ${EndIf}

        ; The single-instance mutex is keyed on the app id, so the downloaded
        ; installer refuses to start while this one is still exiting — hand the
        ; launch to a short detached delay script instead.
        File "/oname=$TEMP\unreleased-relaunch.ps1" "${BUILD_RESOURCES_DIR}\relaunch.ps1"
        Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$TEMP\unreleased-relaunch.ps1" "$R3"`
        !insertmacro quitSuccess
      ${EndIf}
    ${EndIf}
    ; update/reinstall/fresh install: fall through to the normal install flow,
    ; which silently uninstalls any existing version (keeping app data) first
  FunctionEnd
!macroend

!macro customInit
  ; Up to 2.4.0 the app restarted itself after an update with a detached
  ; PowerShell watcher (%TEMP%\unreleased-update-relaunch-<pid>.ps1) that
  ; could fire mid-install and start the OLD exe, which then re-ran the
  ; update. When one of those versions hands off to this installer, stop the
  ; watcher before it can; customInstall below sees its leftover script and
  ; relaunches the app properly instead. ProcessId -ne $PID: this command's
  ; own command line matches the pattern too.
  ${if} ${isUpdated}
    ClearErrors
    FindFirst $R0 $R1 "$TEMP\unreleased-update-relaunch-*.ps1"
    ${ifNot} ${Errors}
      nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'powershell.exe' -and $$_.ProcessId -ne $$PID -and $$_.CommandLine -like '*unreleased-update-relaunch-*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
      Pop $R2
    ${endIf}
    FindClose $R0
  ${endIf}
!macroend

!macro customInstall
  ; Valid beta access code entered on the options page → drop the marker
  ; electron/main.js checks to enable pre-release (beta) auto-updates and
  ; uses to authenticate its own update-feed requests.
  ${if} $BetaUnlocked == "1"
    !insertmacro MAINT_WRITE_BETA_MARKER
  ${endif}

  ; Restart the app after an update it asked to restart into. This runs after
  ; the new files are in place, which is the only point that's safe — see
  ; installUpdateAndRestart in electron/main.js, which writes the marker. A
  ; leftover pre-2.4.1 watcher script (see customInit) counts as the same
  ; request.
  ${if} ${isUpdated}
    ; Non-silent update runs (the progress-bar fallback, see customFinishPage)
    ; move past the progress page by themselves instead of waiting on Next.
    SetAutoClose true

    StrCpy $R3 "0"
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    ${if} ${FileExists} "$APPDATA\${APP_FILENAME}\relaunch-after-update"
      Delete "$APPDATA\${APP_FILENAME}\relaunch-after-update"
      StrCpy $R3 "1"
    ${endif}
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}

    ClearErrors
    FindFirst $R0 $R1 "$TEMP\unreleased-update-relaunch-*.ps1"
    ${DoUntil} ${Errors}
      Delete "$TEMP\$R1"
      StrCpy $R3 "1"
      ClearErrors
      FindNext $R0 $R1
    ${Loop}
    FindClose $R0

    ${if} $R3 == "1"
      SetOutPath "$INSTDIR"
      ; An elevated (per-machine) install must not start the app as admin.
      ${if} ${UAC_IsAdmin}
        ${StdUtils.ExecShellAsUser} $R2 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" ""
      ${else}
        Exec `"$INSTDIR\${APP_EXECUTABLE_FILENAME}"`
      ${endif}
    ${endif}
  ${endIf}
!macroend

!macro customFinishPage
  ; Same as electron-builder's default finish page (assistedInstaller.nsh),
  ; plus a pre-function that skips it for updates — customInstall already
  ; relaunched the app if it asked for that.
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif

  Function SkipFinishPageIfUpdated
    ${if} ${isUpdated}
      Abort
    ${endif}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipFinishPageIfUpdated
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnInstall
  ; Auto-updates also run the old version's uninstaller — guard so an update
  ; never prompts for (or deletes) user data, only a real uninstall does.
  ${ifNot} ${isUpdated}
    ; /SD IDNO: silent uninstalls (e.g. corporate tooling) keep data.
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Also delete all app data?$\r$\n$\r$\nThis removes your settings, library cache, local playlists and offline downloads. Choose No to keep them for a future reinstall." \
      /SD IDNO IDNO keepUserData
      ; userData — settings, library/playlist JSONs, logs, localStorage and
      ; the default offline-audio folder all live under this one directory.
      RMDir /r "$APPDATA\${APP_FILENAME}"
      ; electron-updater's installer download cache (name varies across
      ; versions; removing a nonexistent dir is a no-op).
      RMDir /r "$LOCALAPPDATA\${APP_FILENAME}-updater"
      RMDir /r "$LOCALAPPDATA\unreleased-updater"
    keepUserData:
  ${endIf}
!macroend
