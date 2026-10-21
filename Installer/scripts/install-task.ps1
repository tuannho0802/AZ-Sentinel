<#
  Dang ky tac vu "AZ Gateway": chay luc khoi dong may, tai khoan SYSTEM, khong can ai dang nhap.
  Chay nen khong cua so. Neu run-gateway.cmd dung hang chuc lan, Task Scheduler cung tu bat lai.
#>
param([Parameter(Mandatory = $true)][string]$AppDir)
$ErrorActionPreference = 'Stop'
$name = 'AZ Gateway'
$cmd = Join-Path $AppDir 'run-gateway.cmd'
if (-not (Test-Path -LiteralPath $cmd)) { throw "Khong thay $cmd" }

$action = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description 'AZ Sentinel Gateway (cau noi giua MT5 va cloud)' -Force | Out-Null

# Nang cap khi nguoi dung dang de Gateway o trang thai TAT (bam "Tat hoan toan"): dang ky lai tac vu
# nhung KHONG bat, de giu dung y nguoi dung. Bat lai bang shortcut "AZ Gateway".
$dataDir = if ($env:AZ_GW_DATA) { $env:AZ_GW_DATA } else { Join-Path $env:ProgramData 'AZSentinel' }
if (Test-Path -LiteralPath (Join-Path $dataDir 'disabled.flag')) {
  Write-Host "Da dang ky tac vu '$name'. Gateway dang o trang thai tat nen khong khoi dong; bam shortcut AZ Gateway de bat."
} else {
  Start-ScheduledTask -TaskName $name
  Write-Host "Da dang ky va khoi dong tac vu '$name'."
}
