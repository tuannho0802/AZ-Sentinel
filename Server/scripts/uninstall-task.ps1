<# Go tac vu "AZ Server" (dung va xoa). Du lieu trong %ProgramData%\AZSentinelServer khong bi xoa. #>
$ErrorActionPreference = 'Stop'
$name = 'AZ Server'
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*server.mjs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  $cf = Join-Path $(if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }) 'AZSentinelServer\cloudflared.exe'
  Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" |
    Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $cf) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Write-Host "Da go tac vu '$name'."
} else {
  Write-Host "Khong co tac vu '$name'."
}