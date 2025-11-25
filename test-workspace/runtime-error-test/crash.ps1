# PowerShell script that outputs stderr and exits with error code

Write-Error "ERROR: PowerShell script initialization failed"
Write-Error "ERROR: Missing required configuration"
Write-Error "FATAL: Cannot continue - exiting with code 99"

# Simulate some work
Start-Sleep -Milliseconds 100

Write-Error "CRASH: PowerShell terminated with error"
exit 99
