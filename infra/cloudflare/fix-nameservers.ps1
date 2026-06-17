# Kiem tra va huong dan sua nameserver mphotel.asia
$ErrorActionPreference = "Continue"

function Get-CloudflareAuth {
  $cert = Join-Path $env:USERPROFILE ".cloudflared\cert.pem"
  if (-not (Test-Path $cert)) {
    throw "Chua dang nhap Cloudflare. Chay: cloudflared tunnel login"
  }
  $raw = Get-Content $cert -Raw
  $b64 = ($raw -replace "-----BEGIN ARGO TUNNEL TOKEN-----", "" -replace "-----END ARGO TUNNEL TOKEN-----", "").Trim() -replace "\s", ""
  return ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)) | ConvertFrom-Json)
}

Write-Host "=== Kiem tra DNS mphotel.asia ===" -ForegroundColor Cyan

$auth = Get-CloudflareAuth
$headers = @{ Authorization = "Bearer $($auth.apiToken)" }
$zone = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$($auth.zoneID)" -Headers $headers
$cfNs = $zone.result.name_servers
$status = $zone.result.status

Write-Host ""
Write-Host "Cloudflare zone status : $status"
Write-Host "Nameserver CAN DUNG (Cloudflare):"
foreach ($ns in $cfNs) { Write-Host "  - $ns" -ForegroundColor Green }

Write-Host ""
Write-Host "Nameserver HIEN TAI (registry WHOIS):"
Write-Host "  - ns1.pavietnam.vn" -ForegroundColor Red
Write-Host "  - ns2.pavietnam.vn" -ForegroundColor Red
Write-Host "  - nsbak.pavietnam.net" -ForegroundColor Red

if ($status -eq "active") {
  Write-Host ""
  Write-Host "DNS da OK. Truy cap: https://mphotel.asia" -ForegroundColor Green
  exit 0
}

Write-Host ""
Write-Host "=== CAN SUA TAI NHA DANG KY PA VIET NAM ===" -ForegroundColor Yellow
Write-Host "1. Dang nhap: https://www.pavietnam.vn/"
Write-Host "2. Vao Quan ly domain -> chon mphotel.asia"
Write-Host "3. Doi Nameserver (DNS) sang Custom/Nameserver khac:"
foreach ($ns in $cfNs) { Write-Host "     $ns" -ForegroundColor Green }
Write-Host "4. Luu va cho 15 phut - 2 gio de DNS cap nhat"
Write-Host ""
Write-Host "Sau khi doi xong, chay lai script nay de kiem tra."
Write-Host "Hoac kiem tra tai: https://dash.cloudflare.com -> mphotel.asia -> Overview"
