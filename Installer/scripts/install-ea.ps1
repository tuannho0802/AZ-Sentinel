<#
  Tim cac terminal MT5 DANG CHAY va chep EA (*.ex5 trong thu muc ea) vao MQL5\Experts\AZ cua tung terminal.

  Cach nhan biet (bai hoc tu spike, Plan 3C muc 0): moi ban cai MT5 co thu muc du lieu
  C:\Users\<user>\AppData\Roaming\MetaQuotes\Terminal\<hash>, file origin.txt trong do (UTF-16 LE)
  chua duong dan cai dat. Chi coi la terminal that khi co terminal64.exe dang chay tu dung duong dan do;
  thu muc mo coi (ban cai da xoa) bi bo qua.

  Moi terminal tim thay, script con tu bat "Allow WebRequest" cho http://127.0.0.1:47800 trong
  <thu muc du lieu>\config\common.ini (khong phai vao Tools > Options bang tay). MT5 chi doc file nay luc
  khoi dong va ghi de luc thoat, nen terminal DANG CHAY phai khoi dong lai mot lan. Dung -RestartTerminals de
  script tu dong dong (nhe nhang, khong ep tat) roi mo lai terminal; khong dung thi chi nhac nguoi dung.
  An toan: sao luu common.ini thanh common.ini.azbak (mot lan), giu nguyen ma hoa file, khong dong vao
  WebRequestUrl neu terminal da co danh sach URL khac (chi bao de them tay).

  Script an toan khi chay lai nhieu lan. Chay lai sau khi mo them terminal moi.
#>
param(
  [string]$EaDir = (Join-Path $PSScriptRoot '..\ea'),
  [string]$LogFile = '',
  [switch]$Pause,
  [switch]$RestartTerminals
)
$ErrorActionPreference = 'Continue'
$out = New-Object System.Collections.Generic.List[string]
function Say([string]$m) { $out.Add($m); Write-Host $m }

$AllowUrl = 'http://127.0.0.1:47800'

# Doc file van ban giu nguyen ma hoa (MT5 hay dung UTF-16 LE co BOM; ban cu co the la UTF-8/ANSI).
function Read-Ini([string]$path) {
  $b = [System.IO.File]::ReadAllBytes($path)
  if ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE) {
    return @{ Text = [System.Text.Encoding]::Unicode.GetString($b, 2, $b.Length - 2); Enc = 'u16' }
  }
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) {
    return @{ Text = [System.Text.Encoding]::UTF8.GetString($b, 3, $b.Length - 3); Enc = 'u8bom' }
  }
  return @{ Text = [System.Text.Encoding]::UTF8.GetString($b); Enc = 'u8' }
}

function Write-Ini([string]$path, [string]$text, [string]$enc) {
  switch ($enc) {
    'u16'   { $bytes = [byte[]](0xFF, 0xFE) + [System.Text.Encoding]::Unicode.GetBytes($text) }
    'u8bom' { $bytes = [byte[]](0xEF, 0xBB, 0xBF) + [System.Text.Encoding]::UTF8.GetBytes($text) }
    default { $bytes = [System.Text.Encoding]::UTF8.GetBytes($text) }
  }
  [System.IO.File]::WriteAllBytes($path, $bytes)
}

# Bat WebRequest + them URL Gateway vao <dir>\config\common.ini. Tra ve 'changed' | 'already' | 'manual' | 'error'.
function Set-WebRequestAllow([string]$dataDir) {
  try {
    $cfgDir = Join-Path $dataDir 'config'
    $ini = Join-Path $cfgDir 'common.ini'
    New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null
    if (-not (Test-Path -LiteralPath $ini)) {
      Write-Ini $ini ("[Experts]`r`nWebRequest=1`r`nWebRequestUrl=$AllowUrl`r`n") 'u16'
      return 'changed'
    }
    $f = Read-Ini $ini
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($l in ($f.Text -split "`r?`n")) { $lines.Add($l) }
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') { $lines.RemoveAt($lines.Count - 1) }

    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -ieq '[Experts]') { $start = $i; break } }
    if ($start -lt 0) { $lines.Add('[Experts]'); $start = $lines.Count - 1 }
    $end = $lines.Count
    for ($i = $start + 1; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -match '^\[.+\]$') { $end = $i; break } }

    $changed = $false
    $manual = $false
    $wrIdx = -1; $urlIdx = -1
    for ($i = $start + 1; $i -lt $end; $i++) {
      if ($lines[$i] -match '^\s*WebRequest\s*=') { $wrIdx = $i }
      elseif ($lines[$i] -match '^\s*WebRequestUrl\s*=') { $urlIdx = $i }
    }
    if ($wrIdx -ge 0) {
      if ($lines[$wrIdx] -notmatch '^\s*WebRequest\s*=\s*1\s*$') { $lines[$wrIdx] = 'WebRequest=1'; $changed = $true }
    } else { $lines.Insert($end, 'WebRequest=1'); $end++; $changed = $true }

    if ($urlIdx -ge 0) {
      $cur = ($lines[$urlIdx] -replace '^\s*WebRequestUrl\s*=', '').Trim()
      if ($cur -eq '') { $lines[$urlIdx] = "WebRequestUrl=$AllowUrl"; $changed = $true }
      elseif ($cur -notlike '*127.0.0.1:47800*') { $manual = $true }   # da co URL khac: khong dam sua, tranh hong danh sach
    } else { $lines.Insert($end, "WebRequestUrl=$AllowUrl"); $changed = $true }

    if ($changed) {
      $bak = "$ini.azbak"
      if (-not (Test-Path -LiteralPath $bak)) { Copy-Item -LiteralPath $ini -Destination $bak -Force }
      Write-Ini $ini (($lines -join "`r`n") + "`r`n") $f.Enc
    }
    if ($manual) { return 'manual' }
    if ($changed) { return 'changed' }
    return 'already'
  } catch {
    Say "LOI  bat WebRequest cho $dataDir : $($_.Exception.Message)"
    return 'error'
  }
}

# Dong nhe nhang roi mo lai terminal dang chay (de MT5 doc lai common.ini). Khong ep tat: neu terminal
# khong dong trong 30 giay thi giu nguyen va bao nguoi dung tu khoi dong lai.
function Restart-Terminal($proc) {
  $exe = $proc.ExecutablePath
  $argText = ''
  if ($proc.CommandLine -match '^\s*(?:"[^"]+"|\S+)\s*(.*)$') { $argText = $Matches[1].Trim() }
  $p = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
  if (-not $p) { return $false }
  [void]$p.CloseMainWindow()
  if (-not $p.WaitForExit(30000)) { return $false }
  if ($argText) { Start-Process -FilePath $exe -ArgumentList $argText -WorkingDirectory (Split-Path -Parent $exe) }
  else { Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) }
  return $true
}

$ea = @(Get-ChildItem -LiteralPath $EaDir -Filter '*.ex5' -ErrorAction SilentlyContinue)
if ($ea.Count -eq 0) {
  Say "Chua co file EA (*.ex5) trong $EaDir. Bo cai nay khong kem EA: hay bien dich EA bang MetaEditor roi chep thu cong vao MQL5\Experts\AZ."
} else {
  # Duong dan thu muc cai cua cac terminal64.exe dang chay (moi phien RDP, moi user).
  $procs = @(Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath })
  $running = @($procs |
      ForEach-Object { (Split-Path -Parent $_.ExecutablePath).TrimEnd('\').ToLowerInvariant() } |
      Select-Object -Unique)
  $needRestart = New-Object System.Collections.Generic.List[string]
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
        switch (Set-WebRequestAllow $dir.FullName) {
          'changed' { Say "OK   WebRequest da bat cho $AllowUrl"; $needRestart.Add($origin.ToLowerInvariant()) }
          'already' { Say 'OK   WebRequest da bat san' }
          'manual'  { Say "LUU Y terminal nay da co danh sach URL WebRequest khac: them tay $AllowUrl (Tools > Options > Expert Advisors)" }
        }
      } catch {
        Say "LOI  $origin : $($_.Exception.Message)"
      }
    }
  }
  if ($running.Count -gt 0 -and $found -eq 0) {
    Say 'Co terminal dang chay nhung khong ghep duoc thu muc du lieu (terminal portable? user khac?). Chep EA thu cong: MT5 > File > Open Data Folder > MQL5\Experts.'
  }
  if ($needRestart.Count -gt 0) {
    if ($RestartTerminals) {
      foreach ($pr in ($procs | Where-Object { $needRestart -contains (Split-Path -Parent $_.ExecutablePath).TrimEnd('\').ToLowerInvariant() })) {
        if (Restart-Terminal $pr) { Say "OK   da khoi dong lai $($pr.ExecutablePath)" }
        else { Say "LUU Y $($pr.ExecutablePath) chua tu dong lai duoc: hay tat va mo lai MT5 mot lan de ap dung WebRequest." }
      }
    } else {
      Say 'Hay tat va mo lai MT5 MOT LAN de ap dung WebRequest (MT5 chi doc cau hinh luc khoi dong).'
    }
  }
  if ($found -gt 0) {
    Say ''
    Say 'Con 1 viec: keo EA AZ (Navigator > Expert Advisors > AZ) vao mot chart cua tai khoan va bat Algo Trading.'
  }
}

if ($LogFile) { try { $out | Set-Content -LiteralPath $LogFile -Encoding UTF8 } catch {} }
if ($Pause) { Read-Host 'Nhan Enter de dong' | Out-Null }
exit 0
