[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [int]$TimeoutMinutes = 10,

  [Parameter(Mandatory = $false)]
  [string]$Remote = "origin",

  [Parameter(Mandatory = $false)]
  [string]$Branch,

  [Parameter(Mandatory = $false)]
  [int]$PollSeconds = 5,

  [Parameter(Mandatory = $false)]
  [switch]$Push
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-CommandExists([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Required command '$Name' was not found in PATH. Install it and try again."
  }
}

function Invoke-Process([string]$File, [string[]]$Arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $File
  $psi.Arguments = ($Arguments | ForEach-Object {
      if ($_ -match "\s") { '"' + ($_ -replace '"', '\\"') + '"' } else { $_ }
    }) -join " "
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi

  [void]$p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()

  return [pscustomobject]@{
    ExitCode = $p.ExitCode
    StdOut   = $stdout
    StdErr   = $stderr
  }
}

function Invoke-ProcessChecked([string]$File, [string[]]$Arguments) {
  $r = Invoke-Process $File $Arguments
  if ($r.ExitCode -ne 0) {
    $details = ($r.StdErr + "`n" + $r.StdOut).Trim()
    if (-not $details) {
      $details = "(no output)"
    }
    throw "Command failed ($File $($Arguments -join ' ')) with exit code $($r.ExitCode). Output: $details"
  }

  return $r.StdOut
}

Assert-CommandExists git
Assert-CommandExists gh

# Determine branch + commit.
if (-not $Branch -or [string]::IsNullOrWhiteSpace($Branch)) {
  $Branch = (Invoke-ProcessChecked git @("rev-parse", "--abbrev-ref", "HEAD")).Trim()
}

$sha = (Invoke-ProcessChecked git @("rev-parse", "HEAD")).Trim()
if ([string]::IsNullOrWhiteSpace($sha)) {
  throw "Could not determine HEAD commit SHA."
}

if ($Push) {
  Write-Host "Pushing $Branch ($sha) to $Remote..."
  [void](Invoke-ProcessChecked git @("push", $Remote, $Branch))
}

$timeout = [TimeSpan]::FromMinutes($TimeoutMinutes)
$deadline = [DateTimeOffset]::UtcNow.Add($timeout)

Write-Host "Watching GitHub Actions runs for commit $sha (timeout: ${TimeoutMinutes}m, poll: ${PollSeconds}s)..."

$activityId = 777
$phase = "Discovering runs"
$knownRunIds = @{}
$lastSummary = ""

while ($true) {
  $now = [DateTimeOffset]::UtcNow
  if ($now -gt $deadline) {
    Write-Progress -Id $activityId -Activity "CI Watch" -Status "Timed out" -Completed
    throw "Timed out after ${TimeoutMinutes} minutes waiting for workflow runs for commit $sha."
  }

  $elapsed = $timeout - ($deadline - $now)
  $percent = [Math]::Min(99, [Math]::Max(0, [int](($elapsed.TotalSeconds / $timeout.TotalSeconds) * 100)))

  # Query runs. We intentionally scope by commit SHA.
  $json = Invoke-ProcessChecked gh @(
    "run",
    "list",
    "--commit",
    $sha,
    "--json",
    "databaseId,name,status,conclusion,htmlUrl,createdAt,updatedAt"
  )

  $runs = @()
  try {
    $runs = $json | ConvertFrom-Json
  }
  catch {
    throw "Failed to parse 'gh run list' JSON output. Raw output: $json"
  }

  if (-not $runs -or $runs.Count -eq 0) {
    Write-Progress -Id $activityId -Activity "CI Watch" -Status "$phase (waiting for workflow to start...)" -PercentComplete $percent
    Start-Sleep -Seconds $PollSeconds
    continue
  }

  foreach ($r in $runs) {
    $knownRunIds["$($r.databaseId)"] = $true
  }

  $total = $runs.Count
  $completed = @($runs | Where-Object { $_.status -eq "completed" }).Count
  $inProgress = @($runs | Where-Object { $_.status -ne "completed" }).Count
  $failed = @($runs | Where-Object { $_.status -eq "completed" -and $_.conclusion -ne "success" -and $_.conclusion -ne "skipped" }).Count

  $phase = "Monitoring runs"
  $statusLine = "$completed/$total completed; $inProgress running; failures: $failed"

  if ($statusLine -ne $lastSummary) {
    Write-Host $statusLine
    $lastSummary = $statusLine
  }

  Write-Progress -Id $activityId -Activity "CI Watch" -Status $statusLine -PercentComplete $percent

  if ($completed -eq $total) {
    Write-Progress -Id $activityId -Activity "CI Watch" -Status "Completed" -Completed

    $failedRuns = @(
      $runs | Where-Object {
        $_.status -eq "completed" -and $_.conclusion -ne "success" -and $_.conclusion -ne "skipped"
      }
    )

    if ($failedRuns.Count -gt 0) {
      Write-Host "\nOne or more workflow runs failed:" -ForegroundColor Red
      foreach ($fr in $failedRuns) {
        Write-Host ("- {0}: {1} ({2})" -f $fr.name, $fr.conclusion, $fr.htmlUrl)
      }
      exit 1
    }

    Write-Host "\nAll workflow runs for $sha completed successfully." -ForegroundColor Green
    exit 0
  }

  Start-Sleep -Seconds $PollSeconds
}
