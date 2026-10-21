<#
  Tim cac terminal MT5 DANG CHAY va chep EA (*.ex5 trong thu muc ea) vao MQL5\Experts\AZ cua tung terminal.

  Cach nhan biet (bai hoc tu spike, Plan 3C muc 0): moi ban cai MT5 co thu muc du lieu
  C:\Users\<user>\AppData\Roaming\MetaQuotes\Terminal\<hash>, file origin.txt trong do (UTF-16 LE)
  chua duong dan cai dat. Chi coi la terminal that khi co terminal64.exe dang chay tu dung duong dan do;
  thu muc mo coi (ban cai da xoa) bi bo qua.

  Script an toan khi chay lai nhieu lan. Chay lai sau khi mo them terminal moi.
#>
param(
  [string]$EaDir = (Join-Path $PSScriptRoot '..\ea'),
  [string]$LogFile = '',
  [switch]$Pause
)
$ErrorActionPreference = 'Continue'
$out = New-Object System.Collections.Generic.List[string]
function Say([string]$m) { $out.Add($m); Write-Host $m }

$ea = @(Get-ChildItem -LiteralPath $EaDir -Filter '*.ex5' -ErrorAction SilentlyContinue)
if ($ea.Count -eq 0) {
  Say "Chua co file EA (*.ex5) trong $EaDir. Bo cai nay khong kem EA: hay bien dich EA bang MetaEditor roi chep thu cong vao MQL5\Experts\AZ."
} else {
  # Duong dan thu muc cai cua cac terminal64.exe dang chay (moi phien RDP, moi user).
  $running = @(Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath } |
      ForEach-Object { (Split-Path -Parent $_.ExecutablePath).TrimEnd('\').ToLowerInvariant() } |
      Select-Object -Unique)
  if ($running.Count -eq 0) {
    Say 'Khong thay terminal MT5 nao dang chay. Hay mo cac terminal roi chay lai: Start menu > AZ Gateway > Chep EA vao terminal.'
  }

  $found = 0
  $roots = @(Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName 'AppData\Roaming\MetaQuotes\Terminal' } |
      Where-Object { Test-Path -LiteralPath $_ })
  foreach ($root in $roots) {
    foreach ($dir in (Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
      $originFile = Join-Path $dir.FullName 'origin.txt'
      if (-not (Test-Path -LiteralPath $originFile)) { continue }   # thu muc Common, v.v.
      try { $origin = (Get-Content -LiteralPath $originFile -Encoding Unicode -TotalCount 1).Trim().TrimEnd('\') } catch { continue }
      if (-not $origin -or ($running -notcontains $origin.ToLowerInvariant())) { continue }   # mo coi hoac khong chay
      $found++
      $dest = Join-Path $dir.FullName 'MQL5\Experts\AZ'
      try {
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        foreach ($f in $ea) { Copy-Item -LiteralPath $f.FullName -Destination $dest -Force }
        Say "OK   $origin  ->  $dest"
      } catch {
        Say "LOI  $origin : $($_.Exception.Message)"
      }
    }
  }
  if ($running.Count -gt 0 -and $found -eq 0) {
    Say 'Co terminal dang chay nhung khong ghep duoc thu muc du lieu (terminal portable? user khac?). Chep EA thu cong: MT5 > File > Open Data Folder > MQL5\Experts.'
  }
  if ($found -gt 0) {
    Say ''
    Say 'Con 2 viec thu cong moi terminal (mot lan): (1) Tools > Options > Expert Advisors > Allow WebRequest, them http://127.0.0.1:47800 ; (2) keo EA AZ vao mot chart va bat Algo Trading.'
  }
}

if ($LogFile) { try { $out | Set-Content -LiteralPath $LogFile -Encoding UTF8 } catch {} }
if ($Pause) { Read-Host 'Nhan Enter de dong' | Out-Null }
exit 0
