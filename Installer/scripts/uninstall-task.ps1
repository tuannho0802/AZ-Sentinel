# Dung va go tac vu "AZ Gateway". Dung khi go cai dat va truoc khi cap nhat.
$name = 'AZ Gateway'
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}
Get-Process -Name 'az-gateway' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Da go tac vu '$name'."
