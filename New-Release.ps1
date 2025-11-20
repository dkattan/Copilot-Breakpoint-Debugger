<#!
.SYNOPSIS
Automates creating a new extension release: prepends release notes to CHANGELOG.md, commits, tags, and creates GitHub release.

.DESCRIPTION
New-Release.ps1 updates CHANGELOG.md by inserting a new version section right after the Unreleased header, commits the change, creates an annotated tag following v<Major>.<Minor>.<Build>[.<Revision>] pattern, and invokes `gh release create` with the provided notes.

.PARAMETER Version
System.Version representing the new version. Tag format derives from all numeric components present.

.PARAMETER ReleaseNotes
String containing markdown release notes (can include multiline text). This will be used both for CHANGELOG entry body and GitHub release notes.

.PARAMETER Date
Optional override for release date (YYYY-MM-DD). Defaults to current UTC date.

.PARAMETER SkipGitPush
If set, does not push commit/tag to origin.

.PARAMETER DryRun
If set, shows the changes that would be made without applying them.

.EXAMPLE
./New-Release.ps1 -Version 0.0.17 -ReleaseNotes "**Added:** New feature X\n**Fixed:** Bug Y"

.EXAMPLE
./New-Release.ps1 -Version 1.2.3.4 -ReleaseNotes (Get-Content RELEASE_NOTES_1.2.3.md -Raw)

.NOTES
Requires `gh` CLI authenticated for release creation; if missing, script will warn and skip release step.
#>
[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [Parameter(Mandatory=$true)][Version]$Version,
    [Parameter(Mandatory=$true)][string]$ReleaseNotes,
    [string]$Date = (Get-Date -AsUTC -Format 'yyyy-MM-dd'),
    [switch]$SkipGitPush,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-TagName {
    param([Version]$V)
    $parts = @($V.Major, $V.Minor, $V.Build)
    if ($V.Revision -ge 0) { $parts += $V.Revision }
    return 'v' + ($parts -join '.')
}

function Insert-ChangelogEntry {
    param(
        [string]$Path,
        [Version]$V,
        [string]$Notes,
        [string]$Date
    )
    if (-not (Test-Path $Path)) { throw "CHANGELOG file not found: $Path" }
    $content = Get-Content $Path -Raw
    $header = "## [$($V.ToString())] - $Date" + [Environment]::NewLine + [Environment]::NewLine + $Notes.Trim() + [Environment]::NewLine + [Environment]::NewLine
    # Insert after first occurrence of Unreleased section
    $pattern = "## \[Unreleased\]";
    if ($content -notmatch $pattern) { throw 'Unreleased section marker not found in CHANGELOG.md' }
    $updated = $content -replace $pattern, ($pattern + [Environment]::NewLine + [Environment]::NewLine + $header)
    return $updated
}

$tag = Get-TagName -V $Version
Write-Host "[info] Target version: $Version (tag: $tag)" -ForegroundColor Cyan

$changelogPath = Join-Path $PSScriptRoot 'CHANGELOG.md'
$newContent = Insert-ChangelogEntry -Path $changelogPath -V $Version -Notes $ReleaseNotes -Date $Date

if ($DryRun) {
    Write-Host "[dry-run] CHANGELOG preview:" -ForegroundColor Yellow
    $newContent | Select-Object -First 40 | ForEach-Object { $_ }
    Write-Host "[dry-run] Tag to create: $tag" -ForegroundColor Yellow
    return
}

# Write updated changelog
Set-Content -Path $changelogPath -Value $newContent -Encoding UTF8
Write-Host "[info] CHANGELOG updated." -ForegroundColor Green

# Git operations
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git CLI not available' }
& git add $changelogPath
& git commit -m "chore(release): $($Version.ToString()) changelog entry"
& git tag -a $tag -m "Release $tag"

if (-not $SkipGitPush) {
    & git push origin HEAD
    & git push origin $tag
    Write-Host "[info] Pushed commit and tag." -ForegroundColor Green
} else {
    Write-Host "[info] SkipGitPush specified; not pushing." -ForegroundColor Yellow
}

# GitHub release creation
if (Get-Command gh -ErrorAction SilentlyContinue) {
    try {
        & gh release create $tag -t $tag -n $ReleaseNotes
        Write-Host "[info] GitHub release created for $tag" -ForegroundColor Green
    }
    catch {
        Write-Warning "Failed to create GitHub release: $($_.Exception.Message)"
    }
} else {
    Write-Warning 'gh CLI not found; skipping release creation.'
}
