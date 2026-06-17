# Chạy PowerShell Administrator — cài dịch vụ cloudflared dùng config.yml + credentials JSON
#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$config = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
$cred = Join-Path $env:USERPROFILE ".cloudflared\823ff84b-d8f7-495e-85b1-77a8c25cc51f.json"

if (-not (Test-Path $config)) {
  throw "Không thấy $config — chạy repair-tunnel-credentials.ps1 trước."
}
if (-not (Test-Path $cred)) {
  throw "Không thấy $cred — chạy repair-tunnel-credentials.ps1 trước."
}

Write-Host "Gỡ dịch vụ cloudflared cũ..."
cloudflared service uninstall 2>$null

Write-Host "Cài dịch vụ cloudflared (config.yml)..."
cloudflared service install

Write-Host "Khởi động dịch vụ..."
Start-Service Cloudflared
Get-Service Cloudflared | Format-List Status, StartType, DisplayName

Write-Host "Hoàn tất. Tunnel trỏ tới http://localhost:3180 (mphotel.asia + www)"
