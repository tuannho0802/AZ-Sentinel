<#
  Cai cloudflared thanh dich vu Windows tu token Cloudflare Tunnel, de VPS co hostname HTTPS cong khai
  (Gateway cua User va Worker du phong ket noi vao do) ma khong phai mo cong.
  Tao tunnel: Cloudflare Zero Trust > Networks > Tunnels > Create > Cloudflared > chon Windows, chep token;
  tab Public Hostname: them hostname -> HTTP -> localhost:<cong cua AZ Server>.
  Dung: .\setup-tunnel.ps1 -AppDir C:\AZServer -TunnelToken eyJ...   (PowerShell Administrator)
#>
param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][string]$TunnelToken
)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $AppDir 'cloudflared.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -OutFile $exe `
    -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
}
# Da cai dich vu truoc do thi go ra de nhan token moi.
$ErrorActionPreference = 'Continue'
& $exe service uninstall 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'
& $exe service install $TunnelToken
if ($LASTEXITCODE -ne 0) { throw "cloudflared service install loi (ma $LASTEXITCODE)" }
Write-Host 'Da cai dich vu Cloudflare Tunnel (cloudflared).'
