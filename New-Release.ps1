<#!
.SYNOPSIS
Automates creating a new extension release: prepends release notes to CHANGELOG.md, commits, tags, and creates GitHub release.

.DESCRIPTION
New-Release.ps1 updates CHANGELOG.md by inserting a new version section right after the Unreleased header, commits the change, determines the next semantic version automatically by inspecting existing git tags (pattern: v<Major>.<Minor>.<Build>[.<Revision>]), creates an annotated tag, and invokes `gh release create` with the provided notes.

.PARAMETER ReleaseNotes
Markdown release notes (multiline supported) used for CHANGELOG body and GitHub release.

.PARAMETER Date
Optional override for release date (YYYY-MM-DD). Defaults to current UTC date.

.PARAMETER SkipGitPush
If set, does not push commit/tag to origin.

.PARAMETER DryRun
If set, shows the changes that would be made without applying them.

.EXAMPLE
./New-Release.ps1 -ReleaseNotes "**Added:** Feature X`n**Fixed:** Bug Y"

.EXAMPLE
$notes = @'\n**Added:** Dashboard refresh\n**Changed:** Improved docs\n'@; ./New-Release.ps1 -ReleaseNotes $notes

.NOTES
Requires `gh` CLI authenticated for release creation; if missing, script will warn and skip release step. Version auto-increment strategy: bump patch (Build component). If no existing tags are found, starts at 0.0.1.
#>
[CmdletBinding(SupportsShouldProcess=$true)]
param(
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

function Get-NextVersion {
    # Gather existing tags matching v* and parse into System.Version
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git CLI not available' }
    $rawTags = (& git tag --list 'v*') 2>$null
    $versions = @()
    foreach ($t in $rawTags) {
        $trim = $t.Trim()
        if ($trim -match '^v(\d+(?:\.\d+){0,3})$') {
            $verString = $Matches[1]
            try { $versions += [Version]$verString } catch { }
        }
    }
    if (-not $versions -or $versions.Count -eq 0) {
        return [Version]'0.0.1'
    }
    $current = $versions | Sort-Object -Descending | Select-Object -First 1
    $buildComponent = if ($current.Build -ge 0) { $current.Build + 1 } else { 1 }
    return [Version]::new($current.Major, $current.Minor, $buildComponent)
}

function Add-ChangelogEntry {
    param(
        [string]$Path,
        [Version]$V,
        [string]$Notes,
        [string]$Date
    )
    if (-not (Test-Path $Path)) { throw "CHANGELOG file not found: $Path" }
    $content = Get-Content $Path -Raw
    $header = "## [$($V.ToString())] - $Date" + [Environment]::NewLine + [Environment]::NewLine + $Notes.Trim() + [Environment]::NewLine + [Environment]::NewLine

    # Prefer structural parse via ConvertFrom-Markdown (Markdig) over regex.
    try {
        $md = ConvertFrom-Markdown -InputObject $content -NoHtml -Verbose:$false
        # Find heading token matching level 2 and text [Unreleased]
        $unreleasedToken = $md.Tokens | Where-Object {
            $_.GetType().Name -eq 'HeadingBlock' -and $_.Level -eq 2 -and (
                ($_.Inline | ForEach-Object { $_.ToString() }) -join '' -match '\[Unreleased\]'
            )
        } | Select-Object -First 1
        if ($unreleasedToken) {
            # Use Span to determine insertion point just after heading line
            $spanEnd = $unreleasedToken.Span.End
            # Span.End gives index of last char; find next newline after spanEnd
            $nextNewlineIndex = $content.IndexOf("`n", $spanEnd)
            if ($nextNewlineIndex -lt 0) { $nextNewlineIndex = $content.Length - 1 }
            $insertionIndex = $nextNewlineIndex + 1
            $updated = $content.Substring(0, $insertionIndex) + [Environment]::NewLine + $header + $content.Substring($insertionIndex)
            return $updated
        } else {
            Write-Warning 'Markdown token parse did not locate [Unreleased] heading; falling back to regex.'
        }
    }
    catch {
        Write-Warning "Markdown parse failed ($($_.Exception.Message)); falling back to regex."
    }

    # Fallback regex (should be rare)
    $pattern = "## \[Unreleased\]"
    if ($content -notmatch $pattern) { throw '[Unreleased] heading not found for insertion.' }
    return ($content -replace $pattern, ($pattern + [Environment]::NewLine + [Environment]::NewLine + $header))
}

$Version = Get-NextVersion
$tag = Get-TagName -V $Version
Write-Host "[info] Auto-detected next version: $Version (tag: $tag)" -ForegroundColor Cyan

$changelogPath = Join-Path $PSScriptRoot 'CHANGELOG.md'
$newContent = Add-ChangelogEntry -Path $changelogPath -V $Version -Notes $ReleaseNotes -Date $Date

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
