# Start Cloudflare Tunnel
Write-Host "Starting HTTPS tunnel..." -ForegroundColor Green
Write-Host "This will create a secure HTTPS URL for your app" -ForegroundColor Yellow
Write-Host ""
Write-Host "The URL will appear below. Use it on the other computer:" -ForegroundColor Cyan
Write-Host ""

.\cloudflared.exe tunnel --url http://localhost:5173
