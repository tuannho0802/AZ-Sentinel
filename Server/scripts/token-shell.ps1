<#
  Shortcut "Quan ly token Gateway": mo cua so dong lenh bang quyen Administrator, san sang go
  token.cmd issue|list|reset|revoke. Can quyen Administrator vi co so du lieu chi Administrators/SYSTEM ghi duoc.
  Dung: .\token-shell.ps1 -AppDir "C:\Program Files\AZSentinel\Server"
#>
param([Parameter(Mandatory = $true)][string]$AppDir, [switch]$Elevated)
$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  if ($Elevated) { exit 1 }
  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('"{0}"' -f $PSCommandPath),
      '-AppDir', ('"{0}"' -f $AppDir), '-Elevated')
  } catch { }   # bam "No" o hop thoai UAC: khong lam gi
  exit 0
}
# token.cmd khong tham so in huong dan; cua so o lai (cmd /k) trong thu muc cai nen go `token list`, `token issue 1 Ten`...
Start-Process -FilePath 'cmd.exe' -WorkingDirectory $AppDir -ArgumentList @('/k', 'token.cmd')
