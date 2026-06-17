#Requires -Version 5.1
param(
  [string]$TunnelName = "mphotel",
  [string]$Domain = "mphotel.asia",
  [int]$LocalPort = 3180,
  [string]$ProjectRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Cloudflared {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "cloudflared not found. Install from Cloudflare downloads page."
  }
  Write-Host "cloudflared: $(cloudflared --version)"
}

function Ensure-CloudflareLogin {
  $cert = Join-Path $env:USERPROFILE ".cloudflared\cert.pem"
  if (Test-Path $cert) {
    Write-Host "Cloudflare login OK: $cert"
    return
  }

  Write-Step "Cloudflare login - browser will open, select domain $Domain"
  cloudflared tunnel login
  if (-not (Test-Path $cert)) {
    throw "Cloudflare login failed. Run: cloudflared tunnel login"
  }
}

function Get-OrCreate-Tunnel([string]$Name) {
  $list = cloudflared tunnel list 2>&1 | Out-String
  $escapedName = [regex]::Escape($Name)
  $pattern = '(?m)^([0-9a-f-]{36})\s+' + $escapedName + '\s'
  $match = [regex]::Match($list, $pattern)
  if ($match.Success) {
    $id = $match.Groups[1].Value
    Write-Host "Tunnel exists: $Name ($id)"
    return $id
  }

  Write-Step "Create tunnel: $Name"
  $create = cloudflared tunnel create $Name 2>&1 | Out-String
  $idMatch = [regex]::Match($create, "([0-9a-f-]{36})")
  if (-not $idMatch.Success) {
    throw "Cannot create tunnel. Output:`n$create"
  }
  $id = $idMatch.Groups[1].Value
  Write-Host "Created tunnel: $id"
  return $id
}

function Ensure-DnsRoutes([string]$Name, [string]$HostName) {
  foreach ($record in @($HostName, "www.$HostName")) {
    Write-Step "Route DNS: $record"
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $output = & cloudflared tunnel route dns $Name $record 2>&1 | Out-String
      Write-Host $output.Trim()
    } finally {
      $ErrorActionPreference = $prev
    }
  }
}

function Write-TunnelConfig([string]$TunnelId, [int]$Port) {
  $cloudflaredDir = Join-Path $env:USERPROFILE ".cloudflared"
  $credFile = Join-Path $cloudflaredDir "$TunnelId.json"
  if (-not (Test-Path $credFile)) {
    throw "Missing credentials file: $credFile"
  }

  $credPath = $credFile -replace "\\", "/"
  $config = @"
tunnel: $TunnelId
credentials-file: $credPath

ingress:
  - hostname: mphotel.asia
    service: http://localhost:$Port
  - hostname: www.mphotel.asia
    service: http://localhost:$Port
  - service: http_status:404
"@
  $target = Join-Path $cloudflaredDir "config.yml"
  Set-Content -Path $target -Value $config -Encoding UTF8
  Write-Host "Wrote $target"
}

function Ensure-EnvFile([string]$Root, [string]$PublicUrl, [int]$Port) {
  $envFile = Join-Path $Root ".env.sme-hotel"
  $lines = @()
  if (Test-Path $envFile) {
    $lines = Get-Content $envFile
  }

  $newLines = @()
  $hasUrl = $false
  $hasPort = $false
  $hasSecret = $false
  foreach ($line in $lines) {
    if ($line -match "^\s*SME_HOTEL_PUBLIC_URL=") {
      $newLines += "SME_HOTEL_PUBLIC_URL=$PublicUrl"
      $hasUrl = $true
    } elseif ($line -match "^\s*SME_HOTEL_HTTP_PORT=") {
      $newLines += "SME_HOTEL_HTTP_PORT=$Port"
      $hasPort = $true
    } elseif ($line -match "^\s*SME_HOTEL_JWT_SECRET=") {
      $newLines += $line
      $hasSecret = $true
    } else {
      $newLines += $line
    }
  }
  if (-not $hasUrl) { $newLines += "SME_HOTEL_PUBLIC_URL=$PublicUrl" }
  if (-not $hasPort) { $newLines += "SME_HOTEL_HTTP_PORT=$Port" }
  if (-not $hasSecret) {
    $secret = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
    $newLines += "SME_HOTEL_JWT_SECRET=$secret"
  }

  Set-Content -Path $envFile -Value $newLines -Encoding UTF8
  Write-Host "Updated $envFile"
}

function Restart-DockerStack([string]$Root) {
  $compose = Join-Path $Root "docker-compose.sme-hotel.yml"
  if (-not (Test-Path $compose)) {
    Write-Host "Skip Docker restart: $compose not found"
    return
  }

  Write-Step "Restart Docker stack"
  Push-Location $Root
  try {
    docker compose --env-file .env.sme-hotel -f docker-compose.sme-hotel.yml up -d
  } finally {
    Pop-Location
  }
}

Write-Host "=== Cloudflare Tunnel setup for $Domain ===" -ForegroundColor Green
Write-Host "Project: $ProjectRoot"
Write-Host "Local:   http://localhost:$LocalPort"

Ensure-Cloudflared
Ensure-CloudflareLogin
$tunnelId = Get-OrCreate-Tunnel -Name $TunnelName
Ensure-DnsRoutes -Name $TunnelName -HostName $Domain
Write-TunnelConfig -TunnelId $tunnelId -Port $LocalPort
Ensure-EnvFile -Root $ProjectRoot -PublicUrl "https://$Domain" -Port $LocalPort
Restart-DockerStack -Root $ProjectRoot

Write-Host ""
Write-Host "Done. Open https://$Domain after DNS nameservers point to Cloudflare." -ForegroundColor Green
Write-Host "If tunnel service needs update, run install-service-admin.ps1 as Administrator."
Write-Host "Check tunnel: cloudflared tunnel info $TunnelName"
