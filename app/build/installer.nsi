; LiveX Windows installer (NSIS 3, Unicode, per-user, no admin rights needed).
; Built by scripts/build-installer.js:  makensis -DVERSION=x.y.z -DSRC=<win-unpacked> -DOUTFILE=<exe> installer.nsi
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma

!ifndef VERSION
  !error "VERSION not defined"
!endif
!define APPNAME "LiveX"
!define APPEXE "LiveX.exe"
!define PUBLISHER "LiveX"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\LiveX"
!define AUMID "app.livex.desktop"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\LiveX"
InstallDirRegKey HKCU "Software\LiveX" "InstallDir"
RequestExecutionLevel user
BrandingText "LiveX — ONE PLATFORM. EVERY CREATOR."
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "LiveX"
VIAddVersionKey /LANG=1033 "FileDescription" "LiveX Setup"
VIAddVersionKey /LANG=1033 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "© LiveX"

!include "MUI2.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEFINISHPAGE_BITMAP "sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "sidebar.bmp"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPEXE}"
!define MUI_LANGDLL_ALLLANGUAGES

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "license.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Hebrew"
!insertmacro MUI_RESERVEFILE_LANGDLL

LangString MsgRunning ${LANG_ENGLISH} "LiveX is running. It will be closed to continue the installation."
LangString MsgRunning ${LANG_HEBREW} "LiveX פועלת כעת ותיסגר כדי להמשיך בהתקנה."
LangString MsgX64 ${LANG_ENGLISH} "LiveX requires 64-bit Windows 10 or later."
LangString MsgX64 ${LANG_HEBREW} "LiveX דורשת Windows 10 או חדש יותר בגרסת 64 סיביות."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "$(MsgX64)"
    Abort
  ${EndIf}
  !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd

!macro CloseLiveX
  ; Close a running LiveX so files can be replaced (user settings in %APPDATA%\LiveX are untouched).
  nsExec::ExecToStack 'cmd.exe /C tasklist /FI "IMAGENAME eq ${APPEXE}" /NH | find /I "${APPEXE}"'
  Pop $0
  ${If} $0 == 0
    IfSilent +2
    MessageBox MB_OK|MB_ICONINFORMATION "$(MsgRunning)"
    nsExec::Exec 'taskkill /IM ${APPEXE} /T'
    Sleep 1500
    nsExec::Exec 'taskkill /IM ${APPEXE} /T /F'
    Sleep 800
  ${EndIf}
!macroend

Section "LiveX" SecMain
  SectionIn RO
  !insertmacro CloseLiveX
  SetOutPath "$INSTDIR"
  ; Replace program files only. Settings and data live in %APPDATA%\LiveX and are preserved.
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRC}\*.*"

  CreateShortCut "$DESKTOP\LiveX.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0
  CreateShortCut "$SMPROGRAMS\LiveX.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0

  WriteUninstaller "$INSTDIR\Uninstall LiveX.exe"
  WriteRegStr HKCU "Software\LiveX" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "LiveX"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${APPEXE},0"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall LiveX.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall LiveX.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"
SectionEnd

Function un.onInit
  !insertmacro MUI_UNGETLANGUAGE
FunctionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM ${APPEXE} /T /F'
  Sleep 800
  Delete "$DESKTOP\LiveX.lnk"
  Delete "$SMPROGRAMS\LiveX.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\LiveX"
  ; %APPDATA%\LiveX (settings, sounds, voice profiles) is intentionally kept.
SectionEnd
