; Standard per-user NSIS installer. Compile only; no generated executable runs
; during the build. Windows security decisions remain unchanged at install/run.
Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define PRODUCT_ID "com.lifeconnection.easydownload"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\EasyDownload-User"
Name "易下载"
OutFile "${INSTALLER_OUT}"
InstallDir "$LOCALAPPDATA\Programs\EasyDownload"
InstallDirRegKey HKCU "Software\LifeConnection\EasyDownload" "InstallDir"
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "易下载"
VIAddVersionKey /LANG=2052 "FileDescription" "易下载安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Life Connection"
BrandingText "易下载 ${APP_VERSION} · 未签名测试版"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "本向导安装易下载 ${APP_VERSION}。$\r$\n$\r$\n请先退出旧版易下载。安装目录请选择一个专用文件夹。$\r$\n$\r$\n本测试版未配置发行者数字签名，Windows 可能显示未知发布者提示或阻止运行；程序不会修改安全设置。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "易下载文件已安装。$\r$\n$\r$\n请使用桌面上的“易下载 ${APP_VERSION}”快捷方式打开新版。$\r$\n$\r$\n安装完成不代表授权完成：打开后点击右上角输入激活码。"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "易下载需要 64 位 Windows。"
    Abort
  ${EndIf}
FunctionEnd

; Never overwrite an unrelated nonempty directory. Upgrades are accepted only
; when the install marker identifies this product; no recursive cleanup occurs.
Function CheckInstallDirectory
  GetFullPathName $INSTDIR "$INSTDIR"
  ReadINIStr $0 "$INSTDIR\.easy-download-install.ini" "Product" "Id"
  StrCmp $0 "${PRODUCT_ID}" directory_ok
  FindFirst $0 $1 "$INSTDIR\*"
  IfErrors directory_ok
  directory_loop:
    StrCmp $1 "" directory_empty
    StrCmp $1 "." directory_next
    StrCmp $1 ".." directory_next
    FindClose $0
    MessageBox MB_OK|MB_ICONSTOP "安装目录不是空文件夹，也不是本安装器创建的易下载目录。请选择新的专用文件夹，避免覆盖其他文件。"
    Abort
  directory_next:
    FindNext $0 $1
    Goto directory_loop
  directory_empty:
    FindClose $0
  directory_ok:
FunctionEnd

Section "易下载" Main
  Call CheckInstallDirectory
  SetOverwrite on
  ClearErrors
  !include "${INSTALL_FILES}"
  IfErrors install_files_failed
  WriteINIStr "$INSTDIR\.easy-download-install.ini" "Product" "Id" "${PRODUCT_ID}"
  WriteINIStr "$INSTDIR\.easy-download-install.ini" "Product" "Version" "${APP_VERSION}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\易下载 ${APP_VERSION}.lnk" "$INSTDIR\易下载.exe"
  CreateDirectory "$SMPROGRAMS\易下载"
  CreateShortCut "$SMPROGRAMS\易下载\易下载.lnk" "$INSTDIR\易下载.exe"
  WriteRegStr HKCU "Software\LifeConnection\EasyDownload" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "易下载（测试版）"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\易下载.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$"$INSTDIR\Uninstall.exe$"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$"$INSTDIR\Uninstall.exe$" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" ${INSTALLED_KB}
  Goto install_done
  install_files_failed:
    MessageBox MB_OK|MB_ICONSTOP "文件安装失败。请退出正在运行的易下载，检查目录权限和磁盘空间后重试。" /SD IDOK
    SetErrorLevel 1
    Quit
  install_done:
SectionEnd

Function un.onInit
  SetShellVarContext current
  ReadINIStr $0 "$INSTDIR\.easy-download-install.ini" "Product" "Id"
  StrCmp $0 "${PRODUCT_ID}" valid_install
  MessageBox MB_OK|MB_ICONSTOP "无法确认易下载安装目录，已停止卸载，不会删除文件。"
  Abort
  valid_install:
FunctionEnd

Section "Uninstall"
  ; This generated list deletes shipped files only. User downloads, licensing,
  ; cookies and settings under the user's profile are intentionally preserved.
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\.easy-download-install.ini"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  ReadRegStr $0 HKCU "Software\LifeConnection\EasyDownload" "InstallDir"
  StrCmp $0 "$INSTDIR" remove_registration finish_uninstall
  remove_registration:
    Delete "$DESKTOP\易下载 ${APP_VERSION}.lnk"
    Delete "$SMPROGRAMS\易下载\易下载.lnk"
    RMDir "$SMPROGRAMS\易下载"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    DeleteRegKey HKCU "Software\LifeConnection\EasyDownload"
  finish_uninstall:
SectionEnd
