<#
  Dang ky tac vu "AZ Server": chay luc khoi dong may, tai khoan SYSTEM, khong can ai dang nhap.
  Chay nen khong cua so. Neu run-server.cmd dung hang chuc lan, Task Scheduler cung tu bat lai.
  Dung: .\install-task.ps1 -AppDir C:\AZServer   (chay PowerShell bang quyen Administrator)
#>
param([Parameter(Mandatory = $true)][string]$AppDir)
$ErrorActionPreference = 'Stop'
$name = 'AZ Server'
# Duong dan tuong doi (vd -AppDir .) khong dung duoc voi tac vu chay bang SYSTEM: doi sang duong dan day du.
if (-not (Test-Path -LiteralPath $AppDir)) { throw "Khong thay thu muc $AppDir" }
$AppDir = (Resolve-Path -LiteralPath $AppDir).Path
$cmd = Join-Path $AppDir 'run-server.cmd'
if (-not (Test-Path -LiteralPath $cmd)) { throw "Khong thay $cmd" }
if (-not (Test-Path -LiteralPath (Join-Path $AppDir 'server.env'))) {
  throw "Chua co server.env: copy server.env.example thanh server.env va dien cau hinh truoc"
}
if (-not (Test-Path -LiteralPath (Join-Path $AppDir 'node.exe')) -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Khong thay Node.js: cai Node 22.5+ (https://nodejs.org) hoac chep node.exe vao $AppDir"
}

$action = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

try {
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal `
    -Settings $settings -Description 'AZ Sentinel Server (may chu chinh tren VPS)' -Force | Out-Null
} catch {
  # Windows cu (Server 2012 R2) doi khi loi o module ScheduledTasks: dung schtasks.exe co san cua he dieu hanh.
  Write-Host "Register-ScheduledTask loi ($($_.Exception.Message)), thu schtasks.exe..."
  $ErrorActionPreference = 'Continue'
  & schtasks.exe /Create /TN $name /TR "`"$cmd`"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($code -ne 0) { throw "Khong dang ky duoc tac vu '$name' (schtasks ma $code)" }
}
try { Start-ScheduledTask -TaskName $name -ErrorAction Stop }
catch { & schtasks.exe /Run /TN $name | Out-Null }
Write-Host "Da dang ky va khoi dong tac vu '$name'. Log: %ProgramData%\AZSentinelServer\logs\server.log"