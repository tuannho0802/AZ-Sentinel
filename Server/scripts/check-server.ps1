<#
  Sau khi cai: bao dam AZ Server (va Quick Tunnel neu bat) len that su, roi bao ket qua ngay tren man hinh.
  - Chua co tac vu "AZ Server" (buoc dang ky bi loi/chay hut): tu dang ky lai va in loi that ra.
  - Doi /api/health toi da 40 giay. Thoat 0 neu len, 1 neu khong.
  - Co AZ_QUICK_TUNNEL=1 trong server.env: doi them toi da 90 giay den khi co dia chi *.trycloudflare.com.
  Dung: .\check-server.ps1 -Port 8080 -AppDir "C:\Program Files\AZSentinel\Server"
#>
param([int]$Port = 8080, [string]$AppDir = $PSScriptRoot)
$data = Join-Path $(if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }) 'AZSentinelServer'
$log = Join-Path $data 'logs\server.log'
$url = "http://127.0.0.1:$Port/api/health"

if (-not (Get-ScheduledTask -TaskName 'AZ Server' -ErrorAction SilentlyContinue)) {
  Write-Host 'Chua thay tac vu "AZ Server": dang dang ky lai...'
  try { & (Join-Path $AppDir 'install-task.ps1') -AppDir $AppDir }
  catch { Write-Host "LOI dang ky tac vu: $($_.Exception.Message)" }
}

Write-Host "Dang cho AZ Server khoi dong tai $url ..."
$up = $false
for ($i = 0; $i -lt 40 -and -not $up; $i++) {
  try {
    $r = Invoke-RestMethod -Uri $url -TimeoutSec 2
    if ($r.status -eq 'ok') { $up = $true }
  } catch { }
  if (-not $up) { Start-Sleep -Seconds 1 }
}
if (-not $up) {
  Write-Host "KHONG THAY AZ Server tra loi sau 40 giay. Xem log: $log"
  Write-Host 'Nguyen nhan thuong gap: cong bi chiem, server.env sai (xem dong "Cau hinh khong hop le" trong log).'
  if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 15 }
  Start-Sleep -Seconds 20
  exit 1
}
Write-Host 'OK: AZ Server dang chay.'

$envFile = Join-Path $AppDir 'server.env'
$quick = $false
if (Test-Path -LiteralPath $envFile) {
  $quick = @(Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*AZ_QUICK_TUNNEL\s*=\s*1\s*$' }).Count -gt 0
}
if (-not $quick) { Start-Sleep -Seconds 2; exit 0 }

Write-Host 'Dang cho Quick Tunnel (toi da 90 giay)...'
$f = Join-Path $data 'tunnel-url.txt'
$addr = $null
for ($i = 0; $i -lt 90 -and -not $addr; $i++) {
  if (Test-Path -LiteralPath $f) { $addr = (Get-Content -LiteralPath $f -ErrorAction SilentlyContinue | Select-Object -First 1) }
  if (-not $addr) { Start-Sleep -Seconds 1 }
}
if ($addr) {
  Write-Host "OK: Quick Tunnel: $addr"
  Write-Host 'Worker se nhan dia chi nay trong it giay. Kiem tra: mo dia chi Worker, huy hieu tren thanh dau phai hien VPS.'
  Start-Sleep -Seconds 4
  exit 0
}
Write-Host 'CHUA CO dia chi Quick Tunnel sau 90 giay. AZ Server van chay binh thuong, Server se tu thu lai.'
Write-Host 'Cac dong log lien quan (neu thay "spawn EFTYPE" hoac "khong chay duoc" la cloudflared khong hop he dieu hanh):'
if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 40 | Where-Object { $_ -match 'tunnel|cloudflared' } | Select-Object -Last 12 }
Write-Host 'Xem lai sau 1-2 phut: .\quick-tunnel.ps1 -Show'
Start-Sleep -Seconds 20
exit 0
