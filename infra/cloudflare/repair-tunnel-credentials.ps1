# Tạo lại credentials/token cho tunnel mphotel (không cần xóa tunnel)
# Chạy: powershell -File repair-tunnel-credentials.ps1
#Requires -Version 5.1
param(
  [string]$TunnelName = "mphotel",
  [string]$TunnelId = "823ff84b-d8f7-495e-85b1-77a8c25cc51f",
  [int]$LocalPort = 3180
)

$ErrorActionPreference = "Stop"
$cloudflaredDir = Join-Path $env:USERPROFILE ".cloudflared"
New-Item -ItemType Directory -Force -Path $cloudflaredDir | Out-Null

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Ensure-Login {
  $cert = Join-Path $cloudflaredDir "cert.pem"
  if (-not (Test-Path $cert)) {
    Write-Host "Đăng nhập Cloudflare (chọn zone mphotel.asia)..." -ForegroundColor Yellow
    cloudflared tunnel login
  }
}

Write-Host "=== Sửa credentials tunnel $TunnelName ===" -ForegroundColor Green
Ensure-Login

Write-Step "Lấy tunnel token từ Cloudflare"
$token = (cloudflared tunnel token $TunnelId 2>&1 | Out-String).Trim()
if ($token -notmatch '^eyJ') {
  throw "Không lấy được token. Output:`n$token"
}

$tokenFile = Join-Path $cloudflaredDir "mphotel.token"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($tokenFile, $token, $utf8NoBom)
Write-Host "Đã lưu token: $tokenFile"

# Tạo credentials JSON đúng định dạng từ token (AccountTag + TunnelSecret + TunnelID)
$pad = '=' * ((4 - ($token.Length % 4)) % 4)
$tokenJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($token + $pad)) | ConvertFrom-Json
$credObj = @{
  AccountTag   = $tokenJson.a
  TunnelSecret = $tokenJson.s
  TunnelID     = $tokenJson.t
}
$credFile = Join-Path $cloudflaredDir "$TunnelId.json"
[System.IO.File]::WriteAllText($credFile, ($credObj | ConvertTo-Json -Compress), $utf8NoBom)
Write-Host "Đã tạo credentials: $credFile"

$config = @"
tunnel: $TunnelId
credentials-file: $($cloudflaredDir -replace '\\','/')/$TunnelId.json

ingress:
  - hostname: mphotel.asia
    service: http://localhost:$LocalPort
  - hostname: www.mphotel.asia
    service: http://localhost:$LocalPort
  - service: http_status:404
"@
$configPath = Join-Path $cloudflaredDir "config.yml"
[System.IO.File]::WriteAllText($configPath, $config, $utf8NoBom)
Write-Host "Đã ghi $configPath"

Write-Step "Đảm bảo DNS route"
foreach ($hostName in @("mphotel.asia", "www.mphotel.asia")) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = (cloudflared tunnel route dns $TunnelName $hostName 2>&1 | Out-String).Trim()
    Write-Host "  $hostName : $out"
  } finally {
    $ErrorActionPreference = $prev
  }
}

$runScript = Join-Path $PSScriptRoot "start-tunnel.ps1"
$runContent = @"
# Chạy tunnel bằng token (credentials JSON lỗi vẫn OK)
`$tokenFile = Join-Path `$env:USERPROFILE ".cloudflared\mphotel.token"
if (-not (Test-Path `$tokenFile)) {
  Write-Error "Chạy repair-tunnel-credentials.ps1 trước"
  exit 1
}
`$token = (Get-Content `$tokenFile -Raw).Trim()
Write-Host "Tunnel: mphotel.asia -> http://localhost:$LocalPort"
cloudflared tunnel run --token `$token
"@
[System.IO.File]::WriteAllText($runScript, $runContent, $utf8NoBom)

Write-Host ""
Write-Host "Hoàn tất." -ForegroundColor Green
Write-Host "1. Chạy tunnel:  .\start-tunnel.ps1"
Write-Host "2. Kiểm tra:     https://mphotel.asia và https://www.mphotel.asia"
