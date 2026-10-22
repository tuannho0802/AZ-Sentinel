<#
  Mo (hoac go) quy tac tuong lua cho cong HTTP cua AZ Server, chi cho mang noi bo/rieng (Private, Domain).
  Chi can khi Server nghe 0.0.0.0 de may khac trong LAN vao truc tiep. Di qua Cloudflare Tunnel thi KHONG can.
  Dung: .\open-firewall.ps1 -Port 8080        (mo)
        .\open-firewall.ps1 -Remove           (go)
#>
param([int]$Port = 8080, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$name = 'AZ Server'
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($Remove) { Write-Host "Da go quy tac tuong lua '$name'."; exit 0 }
New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
  -Profile Private, Domain | Out-Null
Write-Host "Da mo cong TCP $Port cho mang Private/Domain (quy tac '$name')."
