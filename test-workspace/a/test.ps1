Write-Host "Running test.ps1 inside test-workspace"
Write-Host "Current directory: $(Get-Location)"
$Random = Get-Random
Write-Host "Random value: $Random"

# Simple loop to provide multiple executable lines for integration test breakpoint placement
for ($i = 0; $i -lt 5; $i++) {
	Write-Host "Loop iteration $i"
	Start-Sleep -Milliseconds 150
}

Write-Host "Completed loop"