<#
  Cau hinh phia Cloudflare MOT LAN (chay tren may dev trong thu muc repo, da dang nhap `wrangler login`):
    .\Scripts\setup-cloudflare.ps1 -VpsUrl https://vps.example.com -WorkerUrl https://az-sentinel-api.xxx.workers.dev
  Lam: sinh SYNC_TOKEN, `wrangler secret put SYNC_TOKEN`, ghi VPS_ORIGIN / PRIMARY_URL / FALLBACK_URL vao
  BE/wrangler.jsonc (URL cong khai, khong phai bi mat). Sau do commit + push de workflow deploy chay.
  In ra gia tri can dien o bo cai Server (SYNC_TOKEN, Worker API, URL cong khai).
  Co the dung lai SYNC_TOKEN cu: them -SyncToken <chuoi >= 32 ky tu>.
#>
param(
  [Parameter(Mandatory = $true)][string]$VpsUrl,
  [Parameter(Mandatory = $true)][string]$WorkerUrl,
  [string]$SyncToken = ''
)
$ErrorActionPreference = 'Stop'
$VpsUrl = $VpsUrl.TrimEnd('/'); $WorkerUrl = $WorkerUrl.TrimEnd('/')
foreach ($u in @($VpsUrl, $WorkerUrl)) { if ($u -notmatch '^https://[^\s]+$') { throw "URL phai bat dau bang https://: $u" } }
if ($SyncToken -eq '') {
  $bytes = New-Object byte[] 36
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $SyncToken = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', 'x')
}
if ($SyncToken.Length -lt 32) { throw 'SYNC_TOKEN phai dai it nhat 32 ky tu' }

$repo = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $repo 'BE')
try {
  $SyncToken | pnpm exec wrangler secret put SYNC_TOKEN
  if ($LASTEXITCODE -ne 0) { throw 'wrangler secret put that bai (da wrangler login chua?)' }
} finally { Pop-Location }

$cfg = Join-Path $repo 'BE\wrangler.jsonc'
$text = Get-Content -LiteralPath $cfg -Raw
$vars = '"vars": { "INGEST_DEBUG_META": "1", "VPS_ORIGIN": "' + $VpsUrl + '", "PRIMARY_URL": "' + $VpsUrl + '", "FALLBACK_URL": "' + $WorkerUrl + '" }'
if ($text -notmatch '"vars":\s*\{[^}]*\}') { throw 'Khong thay muc "vars" trong BE/wrangler.jsonc' }
$text = [regex]::Replace($text, '"vars":\s*\{[^}]*\}', [Text.RegularExpressions.MatchEvaluator]{ param($m) $vars })
Set-Content -LiteralPath $cfg -Value $text -NoNewline -Encoding utf8

Write-Host ''
Write-Host 'Xong phia Cloudflare. Viec con lai:' -ForegroundColor Green
Write-Host '  1. git add BE/wrangler.jsonc ; git commit -m "chore: cau hinh VPS_ORIGIN" ; git push  (workflow deploy se chay)'
Write-Host '  2. Khi chay bo cai AZSentinel-Server-Setup.exe, dien:'
Write-Host "       Dia chi Worker API      : $WorkerUrl"
Write-Host "       URL web du phong        : $WorkerUrl"
Write-Host "       URL cong khai cua VPS   : $VpsUrl"
Write-Host "       SYNC_TOKEN              : $SyncToken"
Write-Host '     (luu SYNC_TOKEN o noi an toan; khong commit)'
