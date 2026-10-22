<#
  Dung AZ Server truoc khi cai de (nang cap tai cho): dung tac vu, roi tat dung tien trinh node.exe dang chay
  server.mjs trong thu muc cai (khong dung toi node.exe khac tren may).
  Dung: .\stop-server.ps1 -AppDir "C:\Program Files\AZSentinel\Server"
#>
param([Parameter(Mandatory = $true)][string]$AppDir)
$ErrorActionPreference = 'SilentlyContinue'
Stop-ScheduledTask -TaskName 'AZ Server'
$root = ([IO.Path]::GetFullPath($AppDir)).TrimEnd('\') + '\'
# Vong lap giam sat run-server.cmd (cmd.exe) cung nam trong thu muc cai: tat truoc de no khong bat lai node.
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like "*$($root)run-server.cmd*")
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Milliseconds 800
exit 0
