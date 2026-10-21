<#
  Shortcut "AZ Gateway" (Desktop va Start menu): mo giao dien AZ Gateway, va bat Gateway neu dang tat.

  - Gateway dang chay: chi mo trinh duyet, khong hoi quyen quan tri.
  - Gateway dang tat (nguoi dung bam "Tat hoan toan" tren giao dien, hoac chua chay): xin quyen
    Administrator (UAC hien mot lan), xoa co disabled.flag, bat tac vu "AZ Gateway", doi Gateway tra
    loi roi moi mo trinh duyet. Tac vu chay bang tai khoan SYSTEM nen can quyen Administrator de bat.

  Cong mac dinh 47800. Neu doi "port" trong config.json thi them -Port <so> vao shortcut.
  Ten co va thu muc du lieu phai khop voi run-gateway.cmd va Gateway\src\config.ts.
#>
param(
  [int]$Port = 47800,
  # Dung noi bo: lan chay thu hai, da co quyen Administrator.
  [switch]$Elevated
)
$ErrorActionPreference = 'Stop'
$taskName = 'AZ Gateway'
$dataDir = if ($env:AZ_GW_DATA) { $env:AZ_GW_DATA } else { Join-Path $env:ProgramData 'AZSentinel' }
$flag = Join-Path $dataDir 'disabled.flag'
$url = "http://127.0.0.1:$Port/"

function Test-Gateway {
  try { $null = Invoke-RestMethod -Uri "${url}v1/status" -TimeoutSec 2; return $true } catch { return $false }
}
function Show-Error([string]$msg) {
  # Shortcut chay an, khong co console de doc loi nen hien hop thoai.
  try { $null = (New-Object -ComObject WScript.Shell).Popup($msg, 0, 'AZ Gateway', 16) } catch { Write-Host $msg }
}

# 1) Dang chay: mo giao dien la xong.
if (Test-Gateway) { Start-Process $url; exit 0 }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

# 2) Chua co quyen: chay lai chinh script nay voi quyen Administrator, doi no xong roi moi mo trinh duyet
#    (de trinh duyet chay bang quyen nguoi dung thuong, khong phai Administrator).
if (-not $isAdmin) {
  if ($Elevated) { Show-Error 'Khong lay duoc quyen Administrator de bat AZ Gateway.'; exit 1 }
  try {
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', ('"{0}"' -f $PSCommandPath), '-Port', $Port, '-Elevated')
    $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs -WindowStyle Hidden -PassThru -Wait
  } catch {
    exit 0   # nguoi dung bam "No" o hop thoai UAC: khong lam gi
  }
  if ($p.ExitCode -eq 0) { Start-Process $url }
  exit $p.ExitCode
}

# 3) Da la Administrator: bat lai Gateway.
try {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $task) { throw "Chua co tac vu '$taskName'. Hay chay lai bo cai AZ Gateway." }
  if ($task.State -eq 'Disabled') {
    throw "Tac vu '$taskName' dang bi Disable (khong tu chay). Bat lai bang PowerShell Administrator: Enable-ScheduledTask -TaskName '$taskName'"
  }
  if (Test-Path -LiteralPath $flag) { Remove-Item -LiteralPath $flag -Force }
  if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $taskName }

  $up = $false
  for ($i = 0; $i -lt 30 -and -not $up; $i++) { Start-Sleep -Seconds 1; $up = Test-Gateway }
  if (-not $up) { throw "Gateway chua tra loi tai $url sau 30 giay. Xem log: $dataDir\logs\gateway.log va $dataDir\startup-error.txt" }
  exit 0
} catch {
  Show-Error $_.Exception.Message
  exit 1
}
