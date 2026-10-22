<#
  Sau khi cai: doi AZ Server tra loi /api/health roi bao ket qua. Thoat 0 neu len, 1 neu khong len sau 40 giay.
  Dung: .\check-server.ps1 -Port 8080
#>
param([int]$Port = 8080)
$url = "http://127.0.0.1:$Port/api/health"
Write-Host "Dang cho AZ Server khoi dong tai $url ..."
for ($i = 0; $i -lt 40; $i++) {
  try {
    $r = Invoke-RestMethod -Uri $url -TimeoutSec 2
    if ($r.status -eq 'ok') { Write-Host 'OK: AZ Server dang chay.'; Start-Sleep -Seconds 2; exit 0 }
  } catch { }
  Start-Sleep -Seconds 1
}
$log = Join-Path $env:ProgramData 'AZSentinelServer\logs\server.log'
Write-Host "KHONG THAY AZ Server tra loi sau 40 giay. Xem log: $log"
Write-Host 'Nguyen nhan thuong gap: cong bi chiem, server.env sai (xem dong "Cau hinh khong hop le" trong log).'
Start-Sleep -Seconds 15
exit 1
