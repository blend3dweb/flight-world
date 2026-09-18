$ErrorActionPreference = 'Stop'
$flightNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $flightNode) {
    Write-Host 'Install Node.js, then run START.cmd again.'
    Read-Host 'Enter to close'
    exit 1
}
$flightRunning = $false
try {
    $flightPage = Invoke-WebRequest 'http://127.0.0.1:8765/' -UseBasicParsing -TimeoutSec 2
    $flightRunning = $flightPage.Content -match 'flight.js'
    if (-not $flightRunning) { throw 'Port 8765 belongs to another application.' }
} catch {
    if ($_.Exception.Message -eq 'Port 8765 belongs to another application.') { throw }
}
if (-not $flightRunning) {
    $flightServer = Join-Path $PSScriptRoot 'serve.cjs'
    Start-Process -FilePath $flightNode.Source -ArgumentList ('"' + $flightServer + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    Start-Sleep -Milliseconds 800
}
Start-Process 'http://127.0.0.1:8765/'
