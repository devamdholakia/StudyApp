# Start Cloudflare Tunnel for both web server and WebSocket
Write-Host "=== Starting HTTPS Tunnel ===" -ForegroundColor Green
Write-Host ""
Write-Host "This will create secure HTTPS URLs for:" -ForegroundColor Yellow
Write-Host "  - Web app (port 5173)" -ForegroundColor Cyan
Write-Host "  - WebSocket server (port 8080)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting tunnel for web app..." -ForegroundColor Green
Write-Host ""

# Start tunnel for web app
$webJob = Start-Job -ScriptBlock {
    cd 'C:\Users\devd4\Desktop\StudyApp'
    .\cloudflared.exe tunnel --url http://localhost:5173 2>&1
}

Start-Sleep -Seconds 3

# Get the web URL
$webOutput = Receive-Job $webJob -ErrorAction SilentlyContinue
$webUrl = ($webOutput | Select-String -Pattern 'https://[^\s]+\.trycloudflare\.com' | Select-Object -First 1).Matches.Value

if ($webUrl) {
    Write-Host "=== YOUR HTTPS URL ===" -ForegroundColor Green
    Write-Host "Web App URL: $webUrl" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Use this URL on the other computer!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Note: WebSocket will use the same domain automatically." -ForegroundColor White
    Write-Host ""
    Write-Host "Press Ctrl+C to stop the tunnel" -ForegroundColor Gray
} else {
    Write-Host "Waiting for tunnel URL..." -ForegroundColor Yellow
    Write-Host "Check the output above for the URL" -ForegroundColor White
}

# Keep the job running
Wait-Job $webJob
