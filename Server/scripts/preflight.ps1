<#
  Don dep + quet cong TRUOC khi cai/nang cap AZ Server (bo cai tu chay; co the chay tay).
  1) Dung tac vu "AZ Server" va moi tien trinh cua AZ: vong lap run-server.cmd, node server.mjs, cloudflared Quick Tunnel.
  2) Xoa file tam/hong: *.part, tunnel-url.txt, cloudflared.exe khong chay duoc tren may nay (Server tu tai lai dung ban).
  3) Quet cong -Port: tien trinh con sot cua AZ (node server.mjs) thi tat; chuong trinh KHAC dang chiem thi bao ro
     ten + PID va KHONG tat (khong dong nham dich vu cua nguoi dung).
  Ma thoat: 0 = sach, 2 = cong bi chuong trinh khac chiem. Thong bao chi tiet ghi vao -OutFile (neu co).
  Giu nguyen: server.env, co so du lieu, tai khoan, whitelist IP.
  Dung: .\preflight.ps1 -AppDir "C:\Program Files\AZSentinel\Server" -Port 8080
#>
param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [int]$Port = 8080,
  [string]$OutFile = ''
)
$ErrorActionPreference = 'SilentlyContinue'
if (Test-Path -LiteralPath $AppDir) { $AppDir = (Resolve-Path -LiteralPath $AppDir).Path }
$data = Join-Path $(if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }) 'AZSentinelServer'
$cf = Join-Path $data 'cloudflared.exe'

function Test-Runs([string]$exe) {
  # Chay thu `--version`: tep sai he dieu hanh (vd cloudflared moi tren Server 2012 R2 -> spawn EFTYPE) se bao loi.
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = '--version'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    if (-not $p.WaitForExit(15000)) { try { $p.Kill() } catch { }; return $false }
    return ($p.ExitCode -eq 0)
  } catch { return $false }
}

function Get-PortOwners([int]$p) {
  # netstat doc lap ngon ngu: o socket nghe thi dia chi doi tac ket thuc bang :0.
  $ids = @()
  foreach ($line in @(& netstat.exe -ano -p TCP 2>$null)) {
    if ($line -match "^\s*TCP\s+\S+:$p\s+\S+:0\s+\S+\s+(\d+)\s*$") {
      $id = [int]$Matches[1]
      if ($id -gt 0) { $ids += $id }
    }
  }
  return @($ids | Sort-Object -Unique)
}

function Stop-Az {
  try { Stop-ScheduledTask -TaskName 'AZ Server' -ErrorAction Stop } catch { }
  $stop = Join-Path $PSScriptRoot 'stop-server.ps1'
  if ((Test-Path -LiteralPath $stop) -and (Test-Path -LiteralPath $AppDir)) { & $stop -AppDir $AppDir }
  # cloudflared cua Quick Tunnel (tien trinh con khong tu chet khi node bi tat), chi dung tep trong thu muc du lieu cua AZ.
  Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" | Where-Object {
    $_.ExecutablePath -and ($_.ExecutablePath -ieq $cf)
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

Write-Host '[1/3] Dung AZ Server va tien trinh con...'
Stop-Az

Write-Host '[2/3] Don file tam/hong...'
if (Test-Path -LiteralPath $data) {
  Get-ChildItem -LiteralPath $data -Filter '*.part' -ErrorAction SilentlyContinue | Remove-Item -Force
  Remove-Item -LiteralPath (Join-Path $data 'tunnel-url.txt') -Force
  if ((Test-Path -LiteralPath $cf) -and -not (Test-Runs $cf)) {
    Remove-Item -LiteralPath $cf -Force
    Write-Host '  Da xoa cloudflared.exe khong chay duoc tren may nay (se tai lai dung ban khi Server khoi dong).'
  }
}

Write-Host "[3/3] Quet cong $Port..."
$foreign = $null
for ($round = 0; $round -lt 10; $round++) {
  $foreign = $null
  $owners = Get-PortOwners $Port
  if ($owners.Count -eq 0) { break }
  foreach ($id in $owners) {
    $pi = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
    $cmd = if ($pi -and $pi.CommandLine) { $pi.CommandLine } else { '' }
    $name = if ($pi) { $pi.Name } else { "PID $id" }
    if ($cmd -match 'server\.mjs') {
      Write-Host "  Tat AZ Server con sot: $name (PID $id)"
      Stop-Process -Id $id -Force
    } else {
      $foreign = "$name (PID $id) $cmd"
    }
  }
  if ($foreign) { break }
  Start-Sleep -Seconds 1
}
if (-not $foreign -and (Get-PortOwners $Port).Count -gt 0) { $foreign = 'khong xac dinh duoc chuong trinh dang giu cong' }

if ($foreign) {
  if ($foreign.Length -gt 300) { $foreign = $foreign.Substring(0, 300) }
  Write-Host "CONG $Port BI CHIEM boi: $foreign"
  if ($OutFile) { Set-Content -LiteralPath $OutFile -Value $foreign -Encoding ASCII }
  exit 2
}
Write-Host "OK: cong $Port trong, he thong sach."
exit 0
