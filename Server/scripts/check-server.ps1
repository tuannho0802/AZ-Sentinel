<#
  Sau khi cai: bao dam AZ Server (va Quick Tunnel neu bat) len that su, roi bao ket qua ngay tren man hinh.
  - Chua co tac vu "AZ Server" (buoc dang ky bi loi/chay hut): tu dang ky lai va in loi that ra.
  - Doi /api/health toi da 60 giay. Thoat 0 neu len, 1 neu khong.
  - Co AZ_QUICK_TUNNEL=1 trong server.env: doi them toi da 90 giay den khi co dia chi *.trycloudflare.com.
  Dung: .\check-server.ps1 -Port 8080 -AppDir "C:\Program Files\AZSentinel\Server"
#>
param([int]$Port = 8080, [string]$AppDir = $PSScriptRoot)
$data = Join-Path $(if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }) 'AZSentinelServer'
$log = Join-Path $data 'logs\server.log'
$url = "http://127.0.0.1:$Port/api/health"

if (Test-Path -LiteralPath $AppDir) { $AppDir = (Resolve-Path -LiteralPath $AppDir).Path }

function Test-Runs([string]$exe, [string]$arg = '--version') {
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe; $psi.Arguments = $arg
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    if (-not $p.WaitForExit(15000)) { try { $p.Kill() } catch { }; return $false }
    return ($p.ExitCode -eq 0)
  } catch { return $false }
}

# Log cua Server la UTF-8: doc khong chi dinh ma hoa thi PowerShell 4 hien chu tieng Viet thanh ky tu rac.
function Show-Log([string]$pattern, [int]$tail = 40, [int]$last = 12) {
  if (-not (Test-Path -LiteralPath $log)) { return }
  $rows = Get-Content -LiteralPath $log -Tail $tail -Encoding UTF8
  if ($pattern) { $rows = $rows | Where-Object { $_ -match $pattern } }
  $rows | Select-Object -Last $last | ForEach-Object { Write-Host $_ }
}

# Ai dang giu cong (netstat doc lap ngon ngu: socket nghe co dia chi doi tac ket thuc bang :0).
function Show-PortOwner([int]$p) {
  $found = $false
  foreach ($line in @(& netstat.exe -ano -p TCP 2>$null)) {
    if ($line -match "^\s*TCP\s+\S+:$p\s+\S+:0\s+\S+\s+(\d+)\s*$") {
      $found = $true
      $pi = Get-CimInstance Win32_Process -Filter "ProcessId = $($Matches[1])" -ErrorAction SilentlyContinue
      Write-Host ("  Cong $p dang duoc giu boi: " + $(if ($pi) { "$($pi.Name) (PID $($Matches[1]))" } else { "PID $($Matches[1])" }))
    }
  }
  if (-not $found) { Write-Host "  Khong co chuong trinh nao nghe cong $p (Server chua mo duoc cong)." }
}

if (-not (Get-ScheduledTask -TaskName 'AZ Server' -ErrorAction SilentlyContinue)) {
  Write-Host 'Chua thay tac vu "AZ Server": dang dang ky lai...'
  try { & (Join-Path $AppDir 'install-task.ps1') -AppDir $AppDir }
  catch { Write-Host "LOI dang ky tac vu: $($_.Exception.Message)" }
}

Write-Host "Dang cho AZ Server khoi dong tai $url ..."
$up = $false
for ($i = 0; $i -lt 60 -and -not $up; $i++) {
  try {
    $r = Invoke-RestMethod -Uri $url -TimeoutSec 2
    if ($r.status -eq 'ok') { $up = $true }
  } catch { }
  if (-not $up) { Start-Sleep -Seconds 1 }
}
if (-not $up) {
  Write-Host "KHONG THAY AZ Server tra loi sau 60 giay. Xem log: $log"
  $t = Get-ScheduledTask -TaskName 'AZ Server' -ErrorAction SilentlyContinue
  if ($t) {
    $ti = Get-ScheduledTaskInfo -TaskName 'AZ Server' -ErrorAction SilentlyContinue
    Write-Host ("  Tac vu: " + $t.State + $(if ($ti) { ", ma ket qua gan nhat: " + $ti.LastTaskResult } else { '' }))
  }
  $node = Join-Path $AppDir 'node.exe'
  if (-not (Test-Path -LiteralPath $node)) { $node = 'node' }
  $env:NODE_SKIP_PLATFORM_CHECK = '1'
  if (-not (Test-Runs $node '--version')) { Write-Host "  CANH BAO: khong chay duoc Node ($node --version). Windows cu: dam bao la Windows 8.1 / Server 2012 R2 tro len." }
  Show-PortOwner $Port
  Write-Host '  Nguyen nhan thuong gap: cong bi chuong trinh khac chiem, server.env sai (xem dong "Cau hinh khong hop le" trong log).'
  Show-Log '' 15 15
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
$cfExe = Join-Path $data 'cloudflared.exe'
if (Test-Path -LiteralPath $cfExe) {
  if (Test-Runs $cfExe) { Write-Host "cloudflared.exe chay duoc tren may nay (--version OK)." }
  else { Write-Host "cloudflared.exe KHONG chay duoc tren may nay (sai he dieu hanh): xoa $cfExe roi khoi dong lai tac vu, Server se tai dung ban cho Windows cu." }
} else {
  Write-Host 'Chua co cloudflared.exe: Server dang tai (khoang 60 MB). Kiem tra VPS ra Internet duoc toi github.com.'
}
Write-Host 'Cac dong log lien quan:'
Show-Log 'tunnel|cloudflared' 40 12
Write-Host 'Xem lai sau 1-2 phut: .\quick-tunnel.ps1 -Show'
Start-Sleep -Seconds 20
exit 0
