Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
  # Where to write the act output.
  [string] $LogPath = "/tmp/act-output.log",

  # How many lines to print starting at the first match line (inclusive).
  [int] $After = 100,

  # Re-run act before parsing the log.
  [switch] $RunAct,

  # act workflow/job args (defaults match the repo's current CI invocation).
  [string] $Workflow = ".github/workflows/ci.yml",
  [string] $Job = "playwright-demo",
  [string] $Image = "ghcr.io/catthehacker/ubuntu:full-24.04",
  [string] $Platform = "linux/amd64",
  [switch] $Verbose
)

function Assert-Command([string] $Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Required command '$Name' not found on PATH."
  }
}

function Show-FirstDemoSnippet([string] $Path, [int] $AfterLines) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Log file not found: $Path"
  }

  $match = Select-String -LiteralPath $Path -SimpleMatch "npm run demo:pw" -List
  if (-not $match) {
    throw "Did not find 'npm run demo:pw' in $Path"
  }

  $start = [int] $match.LineNumber
  $count = $AfterLines + 1

  Write-Host "First occurrence at line $start (showing $count lines):" -ForegroundColor Cyan

  # Stream the file and print only the required slice.
  Get-Content -LiteralPath $Path | Select-Object -Skip ($start - 1) -First $count
}

# Default behavior for quick iteration: run act unless user opts out.
if (-not $PSBoundParameters.ContainsKey("RunAct")) {
  $RunAct = $true
}

if ($RunAct) {
  Assert-Command "act"

  $repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  Push-Location $repoRoot
  try {
    $verbosity = @()
    if ($Verbose) {
      $verbosity = @("-v")
    }

    # Use a file redirect to avoid PowerShell pipeline quirks in different shells.
    # (The CI workflow itself runs the equivalent of `... | tee /tmp/act-output.log`.)
    $actArgs = @(
      "-W", $Workflow,
      "-j", $Job,
      "-P", "ubuntu-latest=$Image",
      "--container-architecture", $Platform
    ) + $verbosity

    Write-Host "Running act (this can take a while)..." -ForegroundColor Cyan
    & act @actArgs *>&1 | Tee-Object -FilePath $LogPath | Out-Host
  }
  finally {
    Pop-Location
  }
}

Show-FirstDemoSnippet -Path $LogPath -AfterLines $After
