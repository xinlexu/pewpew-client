Unicode true
ManifestDPIAware true
; Add in `dpiAwareness` `PerMonitorV2` to manifest for Windows 10 1607+ (note this should not affect lower versions since they should be able to ignore this and pick up `dpiAware` `true` set by `ManifestDPIAware true`)
; Currently undocumented on NSIS's website but is in the Docs folder of source tree, see
; https://github.com/kichik/nsis/blob/5fc0b87b819a9eec006df4967d08e522ddd651c9/Docs/src/attributes.but#L286-L300
; https://github.com/tauri-apps/tauri/pull/10106
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  ; Set the compression algorithm. We default to LZMA.
  SetCompressor /SOLID "{{compression}}"
!endif

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!include "utils.nsh"
!include "FileAssociation.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!include "WinVer.nsh"
!include "LogicLib.nsh"
!include "StrFunc.nsh"
${StrCase}
${StrLoc}

!addplugindir "$%AppData%\Local\NSIS\"

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define SHORTDESCRIPTION "{{short_description}}"
!define HOMEPAGE "{{homepage}}"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var WixMode
Var OldMainBinaryName
Var VC_REDIST_URL
Var VC_REDIST_EXE
Var VC_RUNTIME_READY
Var VC_RUNTIME_NEEDED
Var PewPewBlockedFile
Var PewPewLogFile
Var PewPewRestartService
Var PewPewCoreCount
Var PewPewProcessCount
Var PewPewFlushError

; Setup log next to the client logs (%APPDATA%\<bundle id>\logs\installer.log).
; Every line is flushed to disk, so the last stage reached survives a forced power-off.
!macro PewPewInitLog
  SetShellVarContext current
  StrCpy $PewPewLogFile "$APPDATA\${BUNDLEID}\logs\installer.log"
!macroend

!macro PewPewLog TEXT
  !ifdef __UNINSTALL__
    Push `uninstall ${VERSION}: ${TEXT}`
    Call un.PewPewWriteLog
  !else
    Push `setup ${VERSION}: ${TEXT}`
    Call PewPewWriteLog
  !endif
!macroend

!macro PewPewWriteLogFunction PREFIX
Function ${PREFIX}PewPewWriteLog
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  ${If} $PewPewLogFile != ""
    ${GetParent} "$PewPewLogFile" $R1
    CreateDirectory "$R1"
    ClearErrors
    FileOpen $R8 "$PewPewLogFile" a
    ${IfNot} ${Errors}
      FileSeek $R8 0 END $R1
      ${If} $R1 > 1048576
        FileClose $R8
        Delete "$PewPewLogFile.old"
        Rename "$PewPewLogFile" "$PewPewLogFile.old"
        ClearErrors
        FileOpen $R8 "$PewPewLogFile" w
        StrCpy $R1 0
      ${EndIf}
      ${IfNot} ${Errors}
        ${If} $R1 = 0
          FileWriteUTF16LE /BOM $R8 ""
        ${EndIf}
        ${GetTime} "" "L" $R1 $R2 $R3 $R4 $R5 $R6 $R7
        FileWriteUTF16LE $R8 "$R3-$R2-$R1 $R5:$R6:$R7 $R0$\r$\n"
        System::Call 'kernel32::FlushFileBuffers(p R8)'
        FileClose $R8
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd
!macroend

!insertmacro PewPewWriteLogFunction ""
!insertmacro PewPewWriteLogFunction "un."

; Counts running processes by executable name from a process snapshot. No process
; handle is opened, so unrelated and protected processes are never touched.
!macro PewPewCountProcesses NAME
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $PewPewProcessCount 0
  System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) p.r0'
  ${If} $0 P<> -1
    ; PROCESSENTRY32W is 556 bytes in the 32-bit NSIS installer, including on x64 Windows.
    System::Alloc 556
    Pop $1
    ${If} $1 P<> 0
      System::Call '*$1(i 556)'
      System::Call 'kernel32::Process32FirstW(p r0, p r1) i.r2'
      ${While} $2 <> 0
        System::Call '*$1(i, i, i, i, i, i, i, i, i, &w260 .r3)'
        ${If} $3 == "${NAME}"
          IntOp $PewPewProcessCount $PewPewProcessCount + 1
        ${EndIf}
        System::Call 'kernel32::Process32NextW(p r0, p r1) i.r2'
      ${EndWhile}
      System::Free $1
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

Name "${PRODUCTNAME}"
BrandingText "${COPYRIGHT}"
OutFile "${OUTFILE}"

; We don't actually use this value as default install path,
; it's just for nsis to append the product name folder in the directory selector
; https://nsis.sourceforge.io/Reference/InstallDir
!define PLACEHOLDER_INSTALL_DIR "placeholder\${PRODUCTNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${SHORTDESCRIPTION}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

# additional plugins
!if "${ADDITIONALPLUGINSPATH}" != ""
  !addplugindir "${ADDITIONALPLUGINSPATH}"
!endif

; Uninstaller signing command
!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

; Handle install mode, `perUser`, `perMachine` or `both`
!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

; Installer icon
!if "${INSTALLERICON}" != ""
  !define MUI_ICON "${INSTALLERICON}"
!endif

; Installer sidebar image
!if "${SIDEBARIMAGE}" != ""
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"
!endif

; Installer header image
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE_BITMAP  "${HEADERIMAGE}"
!endif

; Define registry key to store installer language
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

; Installer pages, must be ordered as they appear
; 1. Welcome Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_WELCOME

; 2. License Page (if defined)
!if "${LICENSE}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!endif

; 3. Install mode (if it is set to `both`)
!if "${INSTALLMODE}" == "both"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MULTIUSER_PAGE_INSTALLMODE
!endif

; 4. Custom page to ask user if he wants to reinstall/uninstall
;    only if a previous installation was detected
Var ReinstallPageCheck
Page custom PageReinstall PageLeaveReinstall
Function PageReinstall
  ; Uninstall previous WiX installation if exists.
  ;
  ; A WiX installer stores the installation info in registry
  ; using a UUID and so we have to loop through all keys under
  ; `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`
  ; and check if `DisplayName` and `Publisher` keys match ${PRODUCTNAME} and ${MANUFACTURER}
  ;
  ; This has a potential issue that there maybe another installation that matches
  ; our ${PRODUCTNAME} and ${MANUFACTURER} but wasn't installed by our WiX installer,
  ; however, this should be fine since the user will have to confirm the uninstallation
  ; and they can chose to abort it if doesn't make sense.
  StrCpy $0 0
  wix_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" wix_loop_done ; Exit loop if there is no more keys to loop on
    IntOp $0 $0 + 1
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "Publisher"
    StrCmp "$R0$R1" "${PRODUCTNAME}${MANUFACTURER}" 0 wix_loop
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
    ${StrCase} $R1 $R0 "L"
    ${StrLoc} $R0 $R1 "msiexec" ">"
    StrCmp $R0 0 0 wix_loop_done
    StrCpy $WixMode 1
    StrCpy $R6 "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1"
    Goto compare_version
  wix_loop_done:

  ; Check if there is an existing installation, if not, abort the reinstall page
  ReadRegStr $R0 SHCTX "${UNINSTKEY}" ""
  ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
  ${IfThen} "$R0$R1" == "" ${|} Abort ${|}

  ; Compare this installar version with the existing installation
  ; and modify the messages presented to the user accordingly
  compare_version:
  StrCpy $R4 "$(older)"
  ${If} $WixMode = 1
    ReadRegStr $R0 HKLM "$R6" "DisplayVersion"
  ${Else}
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${EndIf}
  ${IfThen} $R0 == "" ${|} StrCpy $R4 "$(unknown)" ${|}

  nsis_tauri_utils::SemverCompare "${VERSION}" $R0
  Pop $R0
  ; Reinstalling the same version
  ${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(chooseMaintenanceOption)"
  ; Upgrading
  ${ElseIf} $R0 = 1
    StrCpy $R1 "$(olderOrUnknownVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 "$(dontUninstall)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ; Downgrading
  ${ElseIf} $R0 = -1
    StrCpy $R1 "$(newerVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    !if "${ALLOWDOWNGRADES}" == "true"
      StrCpy $R3 "$(dontUninstall)"
    !else
      StrCpy $R3 "$(dontUninstallDowngrade)"
    !endif
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ${Else}
    Abort
  ${EndIf}

  ; Skip showing the page if passive
  ;
  ; Note that we don't call this earlier at the begining
  ; of this function because we need to populate some variables
  ; related to current installed version if detected and whether
  ; we are downgrading or not.
  ${If} $PassiveMode = 1
    Call PageLeaveReinstall
  ${Else}
    nsDialogs::Create 1018
    Pop $R4
    ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

    ${NSD_CreateLabel} 0 0 100% 24u $R1
    Pop $R1

    ${NSD_CreateRadioButton} 30u 50u -30u 8u $R2
    Pop $R2
    ${NSD_OnClick} $R2 PageReinstallUpdateSelection

    ${NSD_CreateRadioButton} 30u 70u -30u 8u $R3
    Pop $R3
    ; Disable this radio button if downgrading and downgrades are disabled
    !if "${ALLOWDOWNGRADES}" == "false"
      ${IfThen} $R0 = -1 ${|} EnableWindow $R3 0 ${|}
    !endif
    ${NSD_OnClick} $R3 PageReinstallUpdateSelection

    ; Check the first radio button if this the first time
    ; we enter this page or if the second button wasn't
    ; selected the last time we were on this page
    ${If} $ReinstallPageCheck <> 2
      SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${Else}
      SendMessage $R3 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${EndIf}

    ${NSD_SetFocus} $R2
    nsDialogs::Show
  ${EndIf}
FunctionEnd
Function PageReinstallUpdateSelection
  ${NSD_GetState} $R2 $R1
  ${If} $R1 == ${BST_CHECKED}
    StrCpy $ReinstallPageCheck 1
  ${Else}
    StrCpy $ReinstallPageCheck 2
  ${EndIf}
FunctionEnd
Function PageLeaveReinstall
  ${NSD_GetState} $R2 $R1

  ; If migrating from Wix, always uninstall
  ${If} $WixMode = 1
    Goto reinst_uninstall
  ${EndIf}

  ; In update mode, always proceeds without uninstalling
  ${If} $UpdateMode = 1
    Goto reinst_done
  ${EndIf}

  ; $R0 holds whether same(0)/upgrading(1)/downgrading(-1) version
  ; $R1 holds the radio buttons state:
  ;   1 => first choice was selected
  ;   0 => second choice was selected
  ${If} $R0 = 0 ; Same version, proceed
    ${If} $R1 = 1              ; User chose to add/reinstall
      Goto reinst_done
    ${Else}                    ; User chose to uninstall
      Goto reinst_uninstall
    ${EndIf}
  ${ElseIf} $R0 = 1 ; Upgrading
    ${If} $R1 = 1              ; User chose to uninstall
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done         ; User chose NOT to uninstall
    ${EndIf}
  ${ElseIf} $R0 = -1 ; Downgrading
    ${If} $R1 = 1              ; User chose to uninstall
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done         ; User chose NOT to uninstall
    ${EndIf}
  ${EndIf}

  reinst_uninstall:
    ; The previous uninstaller terminates a running client; ask for a clean exit first.
    Call PewPewWaitForClientExit
    Pop $R5
    ${If} $R5 <> 0
      !insertmacro PewPewLog "previous version not removed: the client is still running"
      Abort
    ${EndIf}
    HideWindow
    ClearErrors

    ${If} $WixMode = 1
      ReadRegStr $R1 HKLM "$R6" "UninstallString"
      !insertmacro PewPewLog "running previous MSI uninstaller: $R1"
      ExecWait '$R1' $0
    ${Else}
      ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
      ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
      ${IfThen} $UpdateMode = 1 ${|} StrCpy $R1 "$R1 /UPDATE" ${|} ; append /UPDATE
      ${IfThen} $PassiveMode = 1 ${|} StrCpy $R1 "$R1 /P" ${|} ; append /P
      StrCpy $R1 "$R1 _?=$4" ; append uninstall directory
      !insertmacro PewPewLog "running previous uninstaller: $R1"
      ExecWait '$R1' $0
    ${EndIf}

    BringToFront

    ${IfThen} ${Errors} ${|} StrCpy $0 2 ${|} ; ExecWait failed, set fake exit code
    !insertmacro PewPewLog "previous uninstaller exit code $0"

    ${If} $0 <> 0
    ${OrIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
      ; User cancelled wix uninstaller? return to select un/reinstall page
      ${If} $WixMode = 1
      ${AndIf} $0 = 1602
        Abort
      ${EndIf}

      ; User cancelled NSIS uninstaller? return to select un/reinstall page
      ${If} $0 = 1
        Abort
      ${EndIf}

      ; Other erros? show generic error message and return to select un/reinstall page
      MessageBox MB_ICONEXCLAMATION "$(unableToUninstall)"
      Abort
    ${EndIf}
  reinst_done:
    !insertmacro PewPewLog "continuing over the existing installation"
FunctionEnd

; 5. Choose install directory page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_DIRECTORY

; 6. Start menu shortcut page
Var AppStartMenuFolder
!if "${STARTMENUFOLDER}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !define MUI_STARTMENUPAGE_DEFAULTFOLDER "${STARTMENUFOLDER}"
!else
  !define MUI_PAGE_CUSTOMFUNCTION_PRE Skip
!endif
!insertmacro MUI_PAGE_STARTMENU Application $AppStartMenuFolder

; 7. Installation page
!insertmacro MUI_PAGE_INSTFILES

; 8. Finish page
;
; Don't auto jump to finish page after installation page,
; because the installation page has useful info that can be used debug any issues with the installer.
!define MUI_FINISHPAGE_NOAUTOCLOSE
; Use show readme button in the finish page as a button create a desktop shortcut
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(createDesktop)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut
; Show run app after installation.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_FINISH

Function RunMainBinary
  !insertmacro PewPewLog "launching the client from the finish page"
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
FunctionEnd

; Uninstaller Pages
; 1. Confirm uninstall page
Var DeleteAppDataCheckbox
Var DeleteAppDataCheckboxState
!define /ifndef WS_EX_LAYOUTRTL         0x00400000
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ConfirmShow
Function un.ConfirmShow ; Add add a `Delete app data` check box
  ; $1 inner dialog HWND
  ; $2 window DPI
  ; $3 style
  ; $4 x
  ; $5 y
  ; $6 width
  ; $7 height
  FindWindow $1 "#32770" "" $HWNDPARENT ; Find inner dialog
  System::Call "user32::GetDpiForWindow(p r1) i .r2"
  ${If} $(^RTL) = 1
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE} | ${WS_EX_LAYOUTRTL}"
    IntOp $4 50 * $2
  ${Else}
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE}"
    IntOp $4 0 * $2
  ${EndIf}
  IntOp $5 100 * $2
  IntOp $6 400 * $2
  IntOp $7 25 * $2
  IntOp $4 $4 / 96
  IntOp $5 $5 / 96
  IntOp $6 $6 / 96
  IntOp $7 $7 / 96
  System::Call 'user32::CreateWindowEx(i r3, w "${__NSD_CheckBox_CLASS}", w "$(deleteAppData)", i ${__NSD_CheckBox_STYLE}, i r4, i r5, i r6, i r7, p r1, i0, i0, i0) i .s'
  Pop $DeleteAppDataCheckbox
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $1
  SendMessage $DeleteAppDataCheckbox ${WM_SETFONT} $1 1
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ConfirmLeave
Function un.ConfirmLeave
  SendMessage $DeleteAppDataCheckbox ${BM_GETCHECK} 0 0 $DeleteAppDataCheckboxState
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_PRE un.SkipIfPassive
!insertmacro MUI_UNPAGE_CONFIRM

; 2. Uninstalling Page
!insertmacro MUI_UNPAGE_INSTFILES

;Languages
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

LangString pewpewFilesBusy ${LANG_ENGLISH} "PewPew Cloud could not release an installation file. Exit the old client and retry. If this continues, cancel setup, restart Windows, and install before opening the client. No installation files have been replaced.$\r$\n$\r$\n$PewPewBlockedFile"
LangString pewpewFilesBusy ${LANG_SIMPCHINESE} "安装文件仍被占用或无法写入。请退出旧版 PewPew 云后重试；若仍失败，请取消安装，重启电脑后先安装、再打开客户端。尚未替换安装文件。$\r$\n$\r$\n$PewPewBlockedFile"
LangString pewpewFilesBusy ${LANG_RUSSIAN} "Не удалось освободить файл установки PewPew Cloud. Закройте старый клиент и повторите попытку. Если ошибка повторится, отмените установку, перезагрузите Windows и установите клиент до его запуска. Файлы установки ещё не заменены.$\r$\n$\r$\n$PewPewBlockedFile"

LangString pewpewClientRunning ${LANG_ENGLISH} "PewPew Cloud is still running. Disconnect in the client, choose Exit from its tray icon menu, then click Retry.$\r$\n$\r$\nSetup does not force the client to close, so that the connection can shut down cleanly. If the client is not responding, cancel setup, restart Windows, and run setup before opening the client."
LangString pewpewClientRunning ${LANG_SIMPCHINESE} "PewPew 云客户端仍在运行。请先在客户端中断开连接，再从任务栏托盘图标菜单中选择“退出”，然后点击“重试”。$\r$\n$\r$\n安装程序不会强制结束客户端，以便连接正常关闭。若客户端没有响应，请取消安装，重启电脑后先运行安装程序、再打开客户端。"
LangString pewpewClientRunning ${LANG_RUSSIAN} "PewPew Cloud всё ещё работает. Отключитесь в клиенте, выберите «Выход» в меню значка в области уведомлений и нажмите «Повторить».$\r$\n$\r$\nУстановщик не завершает клиент принудительно, чтобы соединение закрылось корректно. Если клиент не отвечает, отмените установку, перезагрузите Windows и запустите установщик до открытия клиента."
LangString pewpewClientRunningAbort ${LANG_ENGLISH} "PewPew Cloud is still running. Exit it from its tray icon menu and run setup again."
LangString pewpewClientRunningAbort ${LANG_SIMPCHINESE} "PewPew 云客户端仍在运行。请从托盘图标菜单退出客户端后重新运行安装程序。"
LangString pewpewClientRunningAbort ${LANG_RUSSIAN} "PewPew Cloud всё ещё работает. Закройте его через меню значка в области уведомлений и снова запустите установщик."
LangString pewpewFlushFailed ${LANG_ENGLISH} "Setup could not confirm that these installed files were written to disk:$\r$\n$PewPewFlushError$\r$\n$\r$\nClick Retry to try again. If it still fails, cancel setup, restart Windows, and run setup again before opening the client."
LangString pewpewFlushFailed ${LANG_SIMPCHINESE} "安装程序无法确认以下文件已写入磁盘：$\r$\n$PewPewFlushError$\r$\n$\r$\n请点击“重试”。若仍失败，请取消安装，重启电脑后重新运行安装程序，在此之前不要打开客户端。"
LangString pewpewFlushFailed ${LANG_RUSSIAN} "Установщику не удалось убедиться, что эти файлы записаны на диск:$\r$\n$PewPewFlushError$\r$\n$\r$\nНажмите «Повторить». Если ошибка повторится, отмените установку, перезагрузите Windows и снова запустите установщик до открытия клиента."

; Waits until the client has exited by itself. Its own exit turns TUN off and
; stops the connection core cleanly; Tauri's CheckIfAppIsRunning would terminate
; it instead. Pushes 0 when no client is running, 1 when it is still running.
!macro PewPewClientExitFunction PREFIX
Function ${PREFIX}PewPewWaitForClientExit
  Push $0
  Push $1
  Push $2
  StrCpy $0 0
  StrCpy $1 10
  ${If} ${Silent}
  ${OrIf} $PassiveMode = 1
    StrCpy $1 40
  ${EndIf}
  StrCpy $2 0
  check_client:
    !insertmacro PewPewCountProcesses "${MAINBINARYNAME}.exe"
    ${If} $PewPewProcessCount = 0
      ${If} $2 > 0
        !insertmacro PewPewLog "client has exited"
      ${EndIf}
      StrCpy $0 0
      Goto client_done
    ${EndIf}
    ${If} $2 = 0
      !insertmacro PewPewLog "client is running ($PewPewProcessCount processes); waiting for it to exit"
    ${EndIf}
    ${If} $2 < $1
      IntOp $2 $2 + 1
      Sleep 500
      Goto check_client
    ${EndIf}
    StrCpy $0 1
    ${If} ${Silent}
    ${OrIf} $PassiveMode = 1
      Goto client_done
    ${EndIf}
    MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "$(pewpewClientRunning)" /SD IDCANCEL IDRETRY retry_client
    Goto client_done
  retry_client:
    StrCpy $1 4
    StrCpy $2 1
    Goto check_client
  client_done:
  Pop $2
  Pop $1
  Exch $0
FunctionEnd
!macroend

!insertmacro PewPewClientExitFunction ""
!insertmacro PewPewClientExitFunction "un."

Function .onInit
  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro PewPewInitLog
  !insertmacro SetContext

  ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"
    ; Set default install location
    !if "${INSTALLMODE}" == "perMachine"
      ${If} ${RunningX64}
        !if "${ARCH}" == "x64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else if "${ARCH}" == "arm64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else
          StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
        !endif
      ${Else}
        StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
      ${EndIf}
    !else if "${INSTALLMODE}" == "currentUser"
      StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
    !endif

    Call RestorePreviousInstallLocation
  ${EndIf}


  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_INIT
  !endif

  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuild"
  ReadRegStr $1 SHCTX "${UNINSTKEY}" "DisplayVersion"
  StrCpy $2 0
  ${If} ${Silent}
    StrCpy $2 1
  ${EndIf}
  !insertmacro PewPewLog "started on Windows build $0; installed version '$1'; install dir $INSTDIR; silent=$2 passive=$PassiveMode update=$UpdateMode; command line $CMDLINE"
FunctionEnd


Function CheckVCRuntime64
  Push $R0
  Push $R1
  StrCpy $VC_RUNTIME_READY "0"
  StrCpy $R1 "$WINDIR\Sysnative"
  IfFileExists "$R1\kernel32.dll" 0 +3
  IfFileExists "$R1\vcruntime140.dll" 0 missing
  IfFileExists "$R1\msvcp140.dll" 0 missing
  Goto found
  StrCpy $R1 "$WINDIR\System32"
  IfFileExists "$R1\vcruntime140.dll" 0 missing
  IfFileExists "$R1\msvcp140.dll" 0 missing
  found:
    StrCpy $VC_RUNTIME_READY "1"
    Goto done
  missing:
    StrCpy $VC_RUNTIME_READY "0"
  done:
    Pop $R1
    Pop $R0
FunctionEnd


!macro PewPewPlainPath VAR
  ; Registrations may be quoted or use a `\\?\` path; both name the same file.
  Push $R8
  StrCpy $R8 ${VAR} 1
  ${If} $R8 == '"'
    StrCpy ${VAR} ${VAR} "" 1
    StrCpy $R8 ${VAR} "" -1
    ${If} $R8 == '"'
      StrCpy ${VAR} ${VAR} -1
    ${EndIf}
  ${EndIf}
  StrCpy $R8 ${VAR} 4
  ${If} $R8 == "\\?\"
    StrCpy ${VAR} ${VAR} "" 4
  ${EndIf}
  Pop $R8
!macroend

!macro PewPewServiceAction ACTION
  ; The service identifier is shared with the upstream helper. Only touch our installation.
  SetRegView 64
  ClearErrors
  ReadRegStr $R9 HKLM "SYSTEM\CurrentControlSet\Services\clash_verge_service" "ImagePath"
  !insertmacro PewPewPlainPath $R9
  ${If} $R9 == "$INSTDIR\resources\clash-verge-service.exe"
    !if "${ACTION}" == "start"
      ; Restart the service only when it was running idle. A service that still had a
      ; connection core would restore that core (and TUN) right away during setup.
      ${If} $PewPewRestartService == "1"
        WriteRegStr HKLM "SYSTEM\CurrentControlSet\Services\clash_verge_service" "DisplayName" "PewPew Background Service"
        WriteRegStr HKLM "SYSTEM\CurrentControlSet\Services\clash_verge_service" "Description" "PewPew Background Service"
        SimpleSC::StartService "clash_verge_service" "" 30
        Pop $0
        !insertmacro PewPewLog "background service start: result $0"
      ${Else}
        !insertmacro PewPewLog "background service left stopped; the client starts it when needed"
      ${EndIf}
    !else
      SimpleSC::GetServiceStatus "clash_verge_service"
      Pop $0
      Pop $1
      !insertmacro PewPewLog "background service state $1 (query result $0)"
      !if "${ACTION}" == "stop"
        ${If} $PewPewRestartService == ""
          StrCpy $PewPewRestartService "0"
          ${If} $0 = 0
          ${AndIf} $1 = 4
            !insertmacro PewPewOwnCores 0
            ${If} $PewPewCoreCount = 0
              StrCpy $PewPewRestartService "1"
            ${Else}
              !insertmacro PewPewLog "the service still runs $PewPewCoreCount connection cores; it will not be restarted during setup"
            ${EndIf}
          ${EndIf}
        ${EndIf}
      !endif
      SimpleSC::StopService "clash_verge_service" 1 30
      Pop $0
      !insertmacro PewPewLog "background service stop: result $0"
      !if "${ACTION}" == "stop"
        ${If} $0 != 0
        ${AndIf} $0 != 1060
        ${AndIf} $0 != 1062
          StrCpy $PewPewBlockedFile "$INSTDIR\resources\clash-verge-service.exe ($0)"
        ${EndIf}
      !endif
      !if "${ACTION}" == "remove"
        SimpleSC::RemoveService "clash_verge_service"
        Pop $0
        !insertmacro PewPewLog "background service remove: result $0"
      !endif
    !endif
  ${Else}
    !insertmacro PewPewLog "background service ${ACTION} skipped; registered path '$R9'"
  ${EndIf}
!macroend

; Finds stable/alpha cores that run from $INSTDIR and counts them in
; $PewPewCoreCount. Candidates are picked by executable name from the snapshot,
; so no handle is opened for unrelated processes. A candidate is identified with
; query rights only; with TERMINATE 1, matching cores are then reopened with
; terminate rights, checked again so a recycled PID cannot be hit, terminated
; and waited for. A core that cannot be stopped within 10 s blocks setup.
!macro PewPewOwnCores TERMINATE
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  StrCpy $PewPewCoreCount 0
  GetFullPathName $8 "$INSTDIR\verge-mihomo.exe"
  GetFullPathName $9 "$INSTDIR\verge-mihomo-alpha.exe"
  System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) p.r0'
  ${If} $0 P<> -1
    ; PROCESSENTRY32W is 556 bytes in the 32-bit NSIS installer, including on x64 Windows.
    System::Alloc 556
    Pop $1
    ${If} $1 P<> 0
      System::Call '*$1(i 556)'
      System::Call 'kernel32::Process32FirstW(p r0, p r1) i.r2'
      ${While} $2 <> 0
        System::Call '*$1(i, i, i .r3, i, i, i, i, i, i, &w260 .r5)'
        ${If} $5 == "verge-mihomo.exe"
        ${OrIf} $5 == "verge-mihomo-alpha.exe"
          System::Call 'kernel32::OpenProcess(i 0x1000, i 0, i r3) p.r4'
          ${If} $4 P<> 0
            StrCpy $6 ${NSIS_MAX_STRLEN}
            System::Call 'kernel32::QueryFullProcessImageNameW(p r4, i 0, w .r5, *i r6) i.r7'
            System::Call 'kernel32::CloseHandle(p r4)'
            ${If} $7 <> 0
              GetFullPathName $5 $5
              ${If} $5 == $8
              ${OrIf} $5 == $9
                IntOp $PewPewCoreCount $PewPewCoreCount + 1
                !if "${TERMINATE}" == "1"
                  System::Call 'kernel32::OpenProcess(i 0x101001, i 0, i r3) p.r4 ?e'
                  Pop $7
                  ${If} $4 P<> 0
                    StrCpy $6 ${NSIS_MAX_STRLEN}
                    System::Call 'kernel32::QueryFullProcessImageNameW(p r4, i 0, w .r5, *i r6) i.r7'
                    StrCpy $6 0
                    ${If} $7 <> 0
                      GetFullPathName $5 $5
                      ${If} $5 == $8
                      ${OrIf} $5 == $9
                        StrCpy $6 1
                      ${EndIf}
                    ${EndIf}
                    ${If} $6 = 1
                      !insertmacro PewPewLog "stopping leftover core pid $3: $5"
                      System::Call 'kernel32::TerminateProcess(p r4, i 1) i.r7'
                      System::Call 'kernel32::WaitForSingleObject(p r4, i 10000) i.r7'
                      ${If} $7 = 0
                        !insertmacro PewPewLog "core pid $3 exited"
                      ${Else}
                        StrCpy $PewPewBlockedFile "$5 (pid $3, wait $7)"
                        !insertmacro PewPewLog "core pid $3 did not exit within 10 s (wait $7)"
                      ${EndIf}
                    ${EndIf}
                    System::Call 'kernel32::CloseHandle(p r4)'
                  ${Else}
                    StrCpy $PewPewBlockedFile "$5 (pid $3, error $7)"
                    !insertmacro PewPewLog "core pid $3 cannot be stopped by setup (error $7): $5"
                  ${EndIf}
                !endif
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
        System::Call 'kernel32::Process32NextW(p r0, p r1) i.r2'
      ${EndWhile}
      System::Free $1
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
  ${EndIf}
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro PewPewCheckWritable FILE
  ${If} $PewPewBlockedFile == ""
  ${AndIf} ${FileExists} "${FILE}"
    Push $0
    Push $1
    ; OPEN_EXISTING checks write access without truncating or changing the old file.
    System::Call 'kernel32::CreateFileW(w "${FILE}", i 0x40000000, i 7, p 0, i 3, i 0x80, p 0) p.r0 ?e'
    Pop $1
    ${If} $0 P= -1
      StrCpy $PewPewBlockedFile "${FILE} ($1)"
    ${Else}
      System::Call 'kernel32::CloseHandle(p r0)'
    ${EndIf}
    Pop $1
    Pop $0
  ${EndIf}
!macroend

; Writes a freshly copied file to disk. A file that cannot be opened for writing
; or flushed is added to $PewPewFlushError; PewPewCheckFlush then stops setup.
!macro PewPewFlushFile FILE
  Push $0
  Push $1
  Push $2
  System::Call 'kernel32::CreateFileW(w "${FILE}", i 0x40000000, i 7, p 0, i 3, i 0x80, p 0) p.r0 ?e'
  Pop $1
  ${If} $0 P= -1
    StrCpy $PewPewFlushError "$PewPewFlushError${FILE} (open error $1); "
  ${Else}
    System::Call 'kernel32::FlushFileBuffers(p r0) i.r2 ?e'
    Pop $1
    System::Call 'kernel32::CloseHandle(p r0)'
    ${If} $2 = 0
      StrCpy $PewPewFlushError "$PewPewFlushError${FILE} (flush error $1); "
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend

; Stops setup when a copied file could not be written to disk. RETRY is the label
; that flushes the files again.
!macro PewPewCheckFlush RETRY
  ${If} $PewPewFlushError != ""
    !insertmacro PewPewLog "files could not be written to disk: $PewPewFlushError"
    DetailPrint "$(pewpewFlushFailed)"
    MessageBox MB_ICONSTOP|MB_RETRYCANCEL "$(pewpewFlushFailed)" /SD IDCANCEL IDRETRY ${RETRY}
    !insertmacro PewPewLog "cancelled because files could not be written to disk"
    SetErrorLevel 2
    Abort
  ${EndIf}
  !insertmacro PewPewLog "files written to disk"
!macroend

!macro PewPewPrepareFiles PREFIX
Function ${PREFIX}PewPewPrepareFiles
  retry_prepare:
    StrCpy $PewPewBlockedFile ""
    !insertmacro PewPewLog "preparing installation files"
    !insertmacro PewPewServiceAction "stop"
    ${If} $PewPewBlockedFile == ""
      !insertmacro PewPewOwnCores 1
      !insertmacro PewPewCheckWritable "$INSTDIR\${MAINBINARYNAME}.exe"
      {{#each resources}}
        !insertmacro PewPewCheckWritable "$INSTDIR\\{{this.[1]}}"
      {{/each}}
      {{#each binaries}}
        !insertmacro PewPewCheckWritable "$INSTDIR\\{{this}}"
      {{/each}}
    ${EndIf}
    ${If} $PewPewBlockedFile != ""
      !insertmacro PewPewLog "installation files are busy: $PewPewBlockedFile"
      DetailPrint "$(pewpewFilesBusy)"
      MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "$(pewpewFilesBusy)" /SD IDCANCEL IDRETRY retry_prepare
      !insertmacro PewPewLog "cancelled because installation files are busy"
      SetErrorLevel 2
      Abort
    ${EndIf}
    !insertmacro PewPewLog "installation files are ready"
FunctionEnd
!macroend

!insertmacro PewPewPrepareFiles ""
!insertmacro PewPewPrepareFiles "un."

Section EarlyChecks
  ; Abort silent installer if downgrades is disabled
  !if "${ALLOWDOWNGRADES}" == "false"
  ${If} ${Silent}
    ; If downgrading
    ${If} $R0 = -1
      System::Call 'kernel32::AttachConsole(i -1)i.r0'
      ${If} $0 <> 0
        System::Call 'kernel32::GetStdHandle(i -11)i.r0'
        System::call 'kernel32::SetConsoleTextAttribute(i r0, i 0x0004)' ; set red color
        FileWrite $0 "$(silentDowngrades)"
      ${EndIf}
      Abort
    ${EndIf}
  ${EndIf}
  !endif

SectionEnd

Section CheckAndInstallVSRuntime
  StrCpy $VC_RUNTIME_NEEDED "0"

  ${If} ${IsNativeARM64}
    StrCpy $VC_REDIST_URL "https://aka.ms/vs/17/release/vc_redist.arm64.exe"
    StrCpy $VC_REDIST_EXE "vc_redist.arm64.exe"
    Call CheckVCRuntime64
    ${If} $VC_RUNTIME_READY != "1"
      StrCpy $VC_RUNTIME_NEEDED "1"
    ${EndIf}

  ${ElseIf} ${RunningX64}
    StrCpy $VC_REDIST_URL "https://aka.ms/vs/17/release/vc_redist.x64.exe"
    StrCpy $VC_REDIST_EXE "vc_redist.x64.exe"
    Call CheckVCRuntime64
    ${If} $VC_RUNTIME_READY != "1"
      StrCpy $VC_RUNTIME_NEEDED "1"
    ${EndIf}

  ${Else}
    StrCpy $VC_REDIST_URL "https://aka.ms/vs/17/release/vc_redist.x86.exe"
    StrCpy $VC_REDIST_EXE "vc_redist.x86.exe"

    IfFileExists "$SYSDIR\vcruntime140.dll" 0 filesMissing32
    IfFileExists "$SYSDIR\msvcp140.dll" 0 filesMissing32
    Goto afterFileCheck32
  filesMissing32:
    StrCpy $VC_RUNTIME_NEEDED "1"
  afterFileCheck32:
  ${EndIf}

  ${If} $VC_RUNTIME_NEEDED != "1"
    ${If} ${IsNativeARM64}
      SetRegView 64
      ClearErrors
      ReadRegDword $R0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\arm64" "Installed"
      ${If} ${Errors}
        StrCpy $R0 0
      ${EndIf}
      SetRegView 32
    ${ElseIf} ${RunningX64}
      SetRegView 64
      ClearErrors
      ReadRegDword $R0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\${ARCH}" "Installed"
      ${If} ${Errors}
        StrCpy $R0 0
      ${EndIf}
      SetRegView 32
    ${Else}
      ClearErrors
      ReadRegDword $R0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x86" "Installed"
      ${If} ${Errors}
        StrCpy $R0 0
      ${EndIf}
    ${EndIf}

    ${If} $R0 != "1"
      StrCpy $VC_RUNTIME_NEEDED "1"
    ${EndIf}
  ${EndIf}

  !insertmacro PewPewLog "Visual C++ runtime needed: $VC_RUNTIME_NEEDED"
  ${If} $VC_RUNTIME_NEEDED != "1"
    DetailPrint "已检测到匹配的 Visual C++ Redistributable，跳过安装"
    Goto done_vc
  ${EndIf}

  DetailPrint "正在下载 Visual C++ Redistributable..."
  nsisdl::download "$VC_REDIST_URL" "$TEMP\$VC_REDIST_EXE"
  Pop $0
  !insertmacro PewPewLog "Visual C++ runtime download: $0"
  ${If} $0 == "success"
    DetailPrint "正在安装 Visual C++ Redistributable..."
    ExecWait '"$TEMP\$VC_REDIST_EXE" /quiet /norestart' $0
    !insertmacro PewPewLog "Visual C++ runtime installer exit code $0"
    ${If} $0 == 0
      DetailPrint "Visual C++ Redistributable 安装成功"
    ${Else}
      DetailPrint "Visual C++ Redistributable 安装失败"
    ${EndIf}
    Delete "$TEMP\$VC_REDIST_EXE"
  ${Else}
    DetailPrint "Visual C++ Redistributable 下载失败"
  ${EndIf}

  done_vc:
SectionEnd

Section WebView2
  ; Check if Webview2 is already installed and skip this section
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  !insertmacro PewPewLog "WebView2 runtime version '$4'"

  ${If} $4 == ""
    ; Webview2 installation
    ;
    ; Skip if updating
    ${If} $UpdateMode <> 1
      !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        DetailPrint "$(webview2Downloading)"
        NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Pop $0
        ${If} $0 == "success"
          DetailPrint "$(webview2DownloadSuccess)"
        ${Else}
          DetailPrint "$(webview2DownloadError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2BOOTSTRAPPERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
        Delete "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        Goto install_webview2
      !endif

      Goto webview2_done

      install_webview2:
        DetailPrint "$(installingWebview2)"
        ; $6 holds the path to the webview2 installer
        !insertmacro PewPewLog "installing WebView2 runtime"
        ExecWait "$6 ${WEBVIEW2INSTALLERARGS} /install" $1
        !insertmacro PewPewLog "WebView2 installer exit code $1"
        ${If} $1 = 0
          DetailPrint "$(webview2InstallSuccess)"
        ${Else}
          DetailPrint "$(webview2InstallError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
      webview2_done:
    ${EndIf}
  ${Else}
    !if "${MINIMUMWEBVIEW2VERSION}" != ""
      ${VersionCompare} "${MINIMUMWEBVIEW2VERSION}" "$4" $R0
      ${If} $R0 = 1
        update_webview:
          DetailPrint "$(installingWebview2)"
          ${If} ${RunningX64}
            ReadRegStr $R1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate" "path"
          ${Else}
            ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 == ""
            ReadRegStr $R1 HKCU "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 != ""
            ; Chromium updater docs: https://source.chromium.org/chromium/chromium/src/+/main:docs/updater/user_manual.md
            ; Modified from "HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView\ModifyPath"
            ExecWait `"$R1" /install appguid=${WEBVIEW2APPGUID}&needsadmin=true` $1
            ${If} $1 = 0
              DetailPrint "$(webview2InstallSuccess)"
            ${Else}
              MessageBox MB_ICONEXCLAMATION|MB_ABORTRETRYIGNORE "$(webview2InstallError)" IDIGNORE ignore IDRETRY update_webview
              Quit
              ignore:
            ${EndIf}
          ${EndIf}
      ${EndIf}
    !endif
  ${EndIf}
SectionEnd

Section Install
  SetOutPath $INSTDIR
  !insertmacro PewPewLog "install section started: $INSTDIR"

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif

  ; Tauri's CheckIfAppIsRunning terminates the client. Wait for its own exit instead,
  ; which turns TUN off and stops the connection core cleanly.
  Call PewPewWaitForClientExit
  Pop $0
  ${If} $0 <> 0
    !insertmacro PewPewLog "cancelled: the client is still running"
    SetErrorLevel 2
    Abort "$(pewpewClientRunningAbort)"
  ${EndIf}
  Call PewPewPrepareFiles

  ; Ensure startup folders exist
  CreateDirectory "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"
  DetailPrint "Ensured system startup folder exists"

  SetShellVarContext current
  StrCpy $0 "$SMPROGRAMS\Startup"
  CreateDirectory "$0"
  DetailPrint "Ensured user startup folder exists: $0"

  !insertmacro SetContext

  ; Copy main executable
  !insertmacro PewPewLog "copying the main program"
  File "${MAINBINARYSRCPATH}"

  ; Copy resources
  !insertmacro PewPewLog "copying resources"
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}

  ; Copy external binaries
  !insertmacro PewPewLog "copying connection cores"
  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}

  ; Write the new files to disk before going on. A forced power-off right after
  ; copying once left the last core with its tail unwritten (all zero bytes).
  ; This narrows that window; it cannot rule out damage from a power loss.
  flush_installed_files:
    StrCpy $PewPewFlushError ""
    !insertmacro PewPewLog "files copied; writing them to disk"
    !insertmacro PewPewFlushFile "$INSTDIR\${MAINBINARYNAME}.exe"
    {{#each resources}}
      !insertmacro PewPewFlushFile "$INSTDIR\\{{this.[1]}}"
    {{/each}}
    {{#each binaries}}
      !insertmacro PewPewFlushFile "$INSTDIR\\{{this}}"
    {{/each}}
    !insertmacro PewPewCheckFlush flush_installed_files

  !insertmacro PewPewServiceAction "start"

  ; Create file associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
       !insertmacro APP_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$INSTDIR\${MAINBINARYNAME}.exe,0" "Open with ${PRODUCTNAME}" "$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\""
    {{/each}}
  {{/each}}

  ; Register deep links
  {{#each deep_link_protocols as |protocol| ~}}
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "" "URL:${BUNDLEID} protocol"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  {{/each}}

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"
  !insertmacro PewPewLog "uninstaller written"

  ; Save $INSTDIR in registry for future installations
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR

  !if "${INSTALLMODE}" == "both"
    ; Save install mode to be selected by default for the next installation such as updating
    ; or when uninstalling
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ; Remove old main binary if it doesn't match new main binary name
  ReadRegStr $OldMainBinaryName SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${If} $OldMainBinaryName != ""
  ${AndIf} $OldMainBinaryName != "${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\$OldMainBinaryName"
  ${EndIf}

  ; Save current MAINBINARYNAME for future updates
  WriteRegStr SHCTX "${UNINSTKEY}" "MainBinaryName" "${MAINBINARYNAME}.exe"

  ; Registry information for add/remove programs
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"

  ${GetSize} "$INSTDIR" "/M=uninstall.exe /S=0K /G=0" $0 $1 $2
  IntOp $0 $0 + ${ESTIMATEDSIZE}
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"

  !if "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  !endif

  !insertmacro PewPewLog "registry entries set"

  ; Create start menu shortcut
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    Call CreateOrUpdateStartMenuShortcut
  !insertmacro MUI_STARTMENU_WRITE_END

  ; Create desktop shortcut for silent and passive installers
  ; because finish page will be skipped
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  !insertmacro PewPewLog "install section finished"

  ; Auto close this page for passive mode
  ${If} $PassiveMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function .onInstFailed
  !insertmacro PewPewLog "finished: failed or cancelled"
FunctionEnd

Function .onInstSuccess
  !insertmacro PewPewLog "finished: success"
  ; Check for `/R` flag only in silent and passive installers because
  ; GUI installer has a toggle for the user to (re)start the app
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    ${GetOptions} $CMDLINE "/R" $R0
    ${IfNot} ${Errors}
      ${GetOptions} $CMDLINE "/ARGS" $R0
      !insertmacro PewPewLog "launching the client (/R)"
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "$R0"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro PewPewInitLog
  !insertmacro SetContext

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_UNINIT
  !endif

  !insertmacro MUI_UNGETLANGUAGE

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
  !insertmacro PewPewLog "started; passive=$PassiveMode update=$UpdateMode; command line $CMDLINE"
FunctionEnd

Function un.onUninstFailed
  !insertmacro PewPewLog "finished: failed or cancelled"
FunctionEnd

Function un.onUninstSuccess
  !insertmacro PewPewLog "finished: success"
FunctionEnd

Section Uninstall

  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  !insertmacro PewPewLog "uninstall section started: $INSTDIR"
  Call un.PewPewWaitForClientExit
  Pop $0
  ${If} $0 <> 0
    !insertmacro PewPewLog "cancelled: the client is still running"
    SetErrorLevel 2
    Abort "$(pewpewClientRunningAbort)"
  ${EndIf}
  Call un.PewPewPrepareFiles
  !insertmacro PewPewServiceAction "remove"

  !insertmacro SetContext

  ; Delete the app directory and its content from disk
  ; Copy main executable
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"

  ; Delete resources
  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  ; Delete external binaries
  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  ; Delete app associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro APP_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}

  ; Delete deep links
  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $R7 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}


  ; Delete uninstaller
  Delete "$INSTDIR\uninstall.exe"
  !insertmacro PewPewLog "program files removed"

  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"

  ; Remove shortcuts if not updating
  ${If} $UpdateMode <> 1
    !insertmacro DeleteAppUserModelId

    ; Remove start menu shortcut
    !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
    !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      RMDir "$SMPROGRAMS\$AppStartMenuFolder"
    ${EndIf}
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}

    ; Remove desktop shortcuts
    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}

  ${EndIf}

  ; Remove registry information for add/remove programs
  !if "${INSTALLMODE}" == "both"
    DeleteRegKey SHCTX "${UNINSTKEY}"
  !else if "${INSTALLMODE}" == "perMachine"
    DeleteRegKey HKLM "${UNINSTKEY}"
  !else
    DeleteRegKey HKCU "${UNINSTKEY}"
  !endif

  ; Removes the Autostart entry for ${PRODUCTNAME} from the HKCU Run key if it exists.
  ; This ensures the program does not launch automatically after uninstallation if it exists.
  ; If it doesn't exist, it does nothing.
  ; We do this when not updating (to preserve the registry value on updates)
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${EndIf}

  ; Delete app data if the checkbox is selected
  ; and if not updating
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ; Clear the install location $INSTDIR from registry
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"

    ; Clear the install language from registry
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    SetShellVarContext current
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  !insertmacro PewPewLog "uninstall section finished"

  ; Auto close if passive mode or updating
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function RestorePreviousInstallLocation
  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  StrCmp $4 "" +2 0
    StrCpy $INSTDIR $4
FunctionEnd

Function Skip
  Abort
FunctionEnd

Function SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd
Function un.SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd

Function CreateOrUpdateStartMenuShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  StrCpy $R0 0

  !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  ${If} $R0 = 1
    Return
  ${EndIf}

  ; Skip creating shortcut if in update mode or no shortcut mode
  ; but always create if migrating from wix
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
FunctionEnd

Function CreateOrUpdateDesktopShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Return
  ${EndIf}

  ; Skip creating shortcut if in update mode or no shortcut mode
  ; but always create if migrating from wix
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
FunctionEnd
