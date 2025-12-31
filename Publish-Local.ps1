# Publishes (packages) and installs this VS Code extension locally.
#
# Behavior:
# - Keeps original package.json content in memory (no on-disk backup files)
# - Temporarily sets version major=1 (keeps existing minor/patch)
# - Temporarily sets manifest preview=true
# - Packages using vsce
# - Installs the resulting .vsix into local VS Code
# - Restores the original package.json even if packaging/install fails

[CmdletBinding()]
param(
  # VS Code CLI command to use for installing the VSIX.
  # Common values: 'code' (Stable) or 'code-insiders'.
  [Parameter()]
  [ValidateNotNullOrEmpty()]
  [string] $CodeCommand = 'code',

  # Output directory for the packaged VSIX.
  [Parameter()]
  [ValidateNotNullOrEmpty()]
  [string] $OutDir = (Join-Path -Path $PSScriptRoot -ChildPath '.local-vsix')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-CommandExists {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name,

    [Parameter(Mandatory = $true)]
    [string] $InstallHint
  )

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Required command '$Name' was not found on PATH. $InstallHint"
  }
}

function Get-TempManifest {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject] $Manifest
  )

  if (-not $Manifest.version) {
    throw "package.json is missing a 'version' field."
  }

  $versionText = [string]$Manifest.version
  $parts = $versionText.Split('.')
  if ($parts.Length -ne 3) {
    throw "package.json version '$versionText' is not in 'x.y.z' format."
  }

  $minor = $parts[1]
  $patch = $parts[2]

  $Manifest.version = "1.$minor.$patch"
  # package.json may not already have a preview field; add/update safely.
  $Manifest | Add-Member -MemberType NoteProperty -Name 'preview' -Value $true -Force

  return $Manifest
}

Assert-CommandExists -Name $CodeCommand -InstallHint "Ensure the VS Code 'code' command is installed (Command Palette: 'Shell Command: Install 'code' command in PATH'), or pass -CodeCommand 'code-insiders'."
Assert-CommandExists -Name 'npm' -InstallHint "Install Node.js (which provides npm): https://nodejs.org/"
Assert-CommandExists -Name 'npx' -InstallHint "npx is included with modern Node.js/npm installs. Install Node.js: https://nodejs.org/"

$repoRoot = $PSScriptRoot
$packageJsonPath = Join-Path -Path $repoRoot -ChildPath 'package.json'
if (-not (Test-Path -LiteralPath $packageJsonPath)) {
  throw "Could not find package.json at: $packageJsonPath"
}

$originalPackageJsonText = Get-Content -LiteralPath $packageJsonPath -Raw

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

try {
  # Apply temporary manifest changes
  $manifest = $originalPackageJsonText | ConvertFrom-Json
  $manifest = Get-TempManifest -Manifest $manifest

  # Write a temporary package.json (it will be restored in finally)
  $manifest | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $packageJsonPath -Encoding UTF8

  # Build/package and install locally
  Write-Host "Building extension (npm run vscode:prepublish)..." -ForegroundColor Cyan
  & npm run vscode:prepublish | Out-Host

  $vsixName = "{0}-{1}.vsix" -f $manifest.publisher, $manifest.name
  $vsixPath = Join-Path -Path $OutDir -ChildPath $vsixName

  Write-Host "Packaging VSIX via npx (@vscode/vsce)..." -ForegroundColor Cyan
  # Use npx so contributors don't need a global vsce install.
  & npx --yes @vscode/vsce package --out $vsixPath | Out-Host

  if (-not (Test-Path -LiteralPath $vsixPath)) {
    throw "vsce reported success, but VSIX was not found at: $vsixPath"
  }

  Write-Host "Installing VSIX into VS Code ($CodeCommand)..." -ForegroundColor Cyan
  & $CodeCommand --install-extension $vsixPath --force | Out-Host

  Write-Host "Done." -ForegroundColor Green
  Write-Host "Installed: $vsixPath" -ForegroundColor Green
}
finally {
  # Always restore original package.json to avoid leaving the repo dirty.
  if ($null -ne $originalPackageJsonText -and $originalPackageJsonText.Length -gt 0) {
    $originalPackageJsonText | Set-Content -LiteralPath $packageJsonPath -Encoding UTF8
  }
}
