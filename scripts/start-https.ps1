$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$certificateDirectory = Join-Path $projectRoot "certs"
$mkcertLink = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\mkcert.exe"

function Find-Mkcert {
  $command = Get-Command mkcert -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  if (Test-Path $mkcertLink) {
    return $mkcertLink
  }
  $packageDirectory = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path $packageDirectory) {
    $installedExecutables = Get-ChildItem -Path $packageDirectory `
      -Directory -Filter "FiloSottile.mkcert_*" -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName "mkcert.exe" } |
      Where-Object { Test-Path $_ }
    if ($installedExecutables) {
      return $installedExecutables | Select-Object -First 1
    }
  }
  return $null
}

$mkcert = Find-Mkcert
if (-not $mkcert) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Write-Error "Install mkcert once with: winget install --id FiloSottile.mkcert"
    exit 1
  }

  Write-Host "Installing the small mkcert helper needed for trusted local HTTPS..."
  & $winget.Source install --id FiloSottile.mkcert --exact --accept-package-agreements --accept-source-agreements
  $installExitCode = $LASTEXITCODE
  $mkcert = Find-Mkcert
  if (-not $mkcert) {
    Write-Error "mkcert installation did not finish. Install it with: winget install --id FiloSottile.mkcert"
    exit $installExitCode
  }
  if ($installExitCode -ne 0) {
    Write-Host "mkcert is already installed; continuing with the existing copy."
  }
}

$addresses = @(
  Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -ne "127.0.0.1" -and
      -not $_.IPAddress.StartsWith("169.254.") -and
      $_.InterfaceAlias -notmatch "Loopback|Virtual|WSL|Hyper-V|vEthernet"
    } |
    Select-Object -ExpandProperty IPAddress -Unique
)

if ($addresses.Count -eq 0) {
  Write-Error "No active local IPv4 address was found. Connect this PC to Wi-Fi or Ethernet and try again."
  exit 1
}

New-Item -ItemType Directory -Force -Path $certificateDirectory | Out-Null
$certificateNames = @("localhost", "127.0.0.1") + $addresses

Write-Host "Trusting the development certificate on this PC..."
& $mkcert -install
if ($LASTEXITCODE -ne 0) {
  Write-Error "mkcert could not install its local certificate authority. Run this command from a normal Windows user account and try again."
  exit $LASTEXITCODE
}

Write-Host "Creating a certificate for this PC and its current local network addresses..."
& $mkcert -cert-file (Join-Path $certificateDirectory "dev-cert.pem") `
  -key-file (Join-Path $certificateDirectory "dev-key.pem") `
  @certificateNames
if ($LASTEXITCODE -ne 0) {
  Write-Error "Could not create the local HTTPS certificate."
  exit $LASTEXITCODE
}

$rootDirectory = (& $mkcert -CAROOT | Select-Object -Last 1).Trim()
$rootCertificate = Join-Path $rootDirectory "rootCA.pem"
if (-not (Test-Path $rootCertificate)) {
  Write-Error "mkcert's public root certificate was not found at $rootCertificate."
  exit 1
}
Copy-Item $rootCertificate (Join-Path $certificateDirectory "rootCA.pem") -Force

Write-Host ""
Write-Host "Local HTTPS is ready. The server will start now."
Write-Host "On the iPhone's first setup, open the local certificate setup link printed by the server, install the profile, then enable full trust in Certificate Trust Settings."
Write-Host "Keep certs\dev-key.pem private; never send it to your phone."
Write-Host ""

Push-Location $projectRoot
try {
  & node server.js --https
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
