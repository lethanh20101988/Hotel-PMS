# Chạy tunnel foreground — dùng config.yml + credentials JSON (cả mphotel.asia và www)
$config = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
$cred = Join-Path $env:USERPROFILE ".cloudflared\823ff84b-d8f7-495e-85b1-77a8c25cc51f.json"
if (-not (Test-Path $config)) {
  Write-Error "Không thấy $config — chạy repair-tunnel-credentials.ps1 trước"
  exit 1
}
if (-not (Test-Path $cred)) {
  Write-Error "Không thấy $cred — chạy repair-tunnel-credentials.ps1 trước"
  exit 1
}
Write-Host "Tunnel: mphotel.asia + www.mphotel.asia -> http://localhost:3180"
cloudflared tunnel --config $config run mphotel
