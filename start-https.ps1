# Start all services with HTTPS
Write-Host "=== Starting Services with HTTPS ===" -ForegroundColor Green
Write-Host ""

# Check if certificates exist
if (-not (Test-Path "certs\cert.pem") -or -not (Test-Path "certs\key.pem")) {
    Write-Host "ERROR: Certificates not found in certs/ folder!" -ForegroundColor Red
    Write-Host "Run: .\mkcert.exe -key-file certs\key.pem -cert-file certs\cert.pem localhost 127.0.0.1 100.110.168.172" -ForegroundColor Yellow
    exit 1
}

Write-Host "1. Starting WebSocket server (HTTPS/WSS)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD\server'; node server.js" -WindowStyle Normal

Start-Sleep -Seconds 2

Write-Host "2. Starting Vite dev server (HTTPS)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD\client'; npm run dev" -WindowStyle Normal

Write-Host ""
Write-Host "=== Services Started ===" -ForegroundColor Green
Write-Host ""
Write-Host "Access your app at:" -ForegroundColor Cyan
Write-Host "  https://localhost:5173 (on this computer)" -ForegroundColor White
Write-Host "  https://100.110.168.172:5173 (on other computer)" -ForegroundColor White
Write-Host ""
Write-Host "Check the PowerShell windows for any errors." -ForegroundColor Yellow
Write-Host ""
