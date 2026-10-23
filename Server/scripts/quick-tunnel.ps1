<#
  Bat/tat Quick Tunnel (Plan 3G): VPS tu mo dia chi *.trycloudflare.com (mien phi, khong can ten mien) va TU BAO
  dia chi moi cho Worker Cloudflare moi khi VPS khoi dong lai. Nguoi dung chi dung dia chi cua Worker (co dinh).
  Bat:  .\quick-tunnel.ps1            (dung AZ_CLOUD_URL trong server.env; hoac them -WorkerUrl https://... de doi)
  Tat:  .\quick-tunnel.ps1 -Off
  Xem dia chi tunnel hien tai: .\quick-tunnel.ps1 -Show
  Chay PowerShell bang quyen Administrator. Can AZ_CLOUD_URL va AZ_SYNC_TOKEN da co trong server.env.
#>
param(
  [string]$AppDir = $PSScriptRoot,
  [string]$WorkerUrl = '',
  [switch]$Off,
  [switch]$Show
)
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $AppDir 'server.env'
$data = Join-Path $(if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }) 'AZSentinelServer'

if ($Show) {
  $f = Join-Path $data 'tunnel-url.txt'
  if (Test-Path -LiteralPath $f) { Get-Content -LiteralPath $f } else { Write-Host 'Chua co dia chi tunnel (Server chua chay hoac chua bat Quick Tunnel).' }
  exit 0
}
if (-not (Test-Path -LiteralPath $envFile)) { throw "Khong thay $envFile" }

function Set-EnvKey([string[]]$lines, [string]$key, [string]$value) {
  $done = $false
  $out = @()
  foreach ($l in $lines) {
    if ($l -match ('^\s*' + [regex]::Escape($key) + '\s*=')) {
      if (-not $done) { $out += "$key=$value"; $done = $true }
    } else { $out += $l }
  }
  if (-not $done) { $out += "$key=$value" }
  return ,$out
}

$lines = [string[]](Get-Content -LiteralPath $envFile)
if ($Off) {
  $lines = Set-EnvKey $lines 'AZ_QUICK_TUNNEL' ''
} else {
  if ($WorkerUrl -eq '') {
    $m = [regex]::Match(($lines -join "`n"), '(?m)^\s*AZ_CLOUD_URL\s*=\s*(https://[A-Za-z0-9.-]+)')
    if ($m.Success) { $WorkerUrl = $m.Groups[1].Value }
  }
  if ($WorkerUrl -notmatch '^https://[A-Za-z0-9.-]+$') { throw 'Chua co AZ_CLOUD_URL trong server.env: them -WorkerUrl https://ten-worker.tai-khoan.workers.dev (khong co / o cuoi)' }
  $joined = $lines -join "`n"
  if ($joined -notmatch '(?m)^\s*AZ_CLOUD_URL\s*=\s*https://\S+' -or $joined -notmatch '(?m)^\s*AZ_SYNC_TOKEN\s*=\s*\S{32,}') {
    throw 'server.env can AZ_CLOUD_URL va AZ_SYNC_TOKEN (>= 32 ky tu) de bao dia chi tunnel cho Worker'
  }
  $lines = Set-EnvKey $lines 'AZ_QUICK_TUNNEL' '1'
  $lines = Set-EnvKey $lines 'AZ_PUBLIC_URL' $WorkerUrl
}
[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))

# Khoi dong lai Server de nhan cau hinh moi.
& (Join-Path $AppDir 'stop-server.ps1') -AppDir $AppDir
Start-ScheduledTask -TaskName 'AZ Server'
if ($Off) { Write-Host 'Da tat Quick Tunnel va khoi dong lai AZ Server.'; exit 0 }
Write-Host 'Da bat Quick Tunnel, dang khoi dong lai AZ Server. Doi khoang 30-60 giay roi xem dia chi:'
Write-Host '  .\quick-tunnel.ps1 -Show'
Write-Host "Nguoi dung/Gateway dung: $WorkerUrl"
