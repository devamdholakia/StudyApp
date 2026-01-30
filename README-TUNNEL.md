# HTTPS Tunnel Setup for Camera/Mic Access

## Quick Start

1. **Start your servers:**
   - WebSocket server: Make sure it's running on port 8080
   - Vite dev server: Run `cd client && npm run dev` (port 5173)

2. **Start the HTTPS tunnel:**
   ```powershell
   .\cloudflared.exe tunnel --url http://localhost:5173
   ```

3. **Copy the HTTPS URL** that appears (looks like: `https://xxxx-xx-xx-xx-xx.trycloudflare.com`)

4. **On the other computer**, open that HTTPS URL in the browser

5. **For WebSocket to work**, you also need to tunnel port 8080. Open a **second terminal** and run:
   ```powershell
   .\cloudflared.exe tunnel --url http://localhost:8080
   ```
   Copy that URL too.

6. **Update the WebSocket URL** in `client/src/Room.jsx` to use the WebSocket tunnel URL, OR use the simpler approach below.

## Simpler Approach (Recommended)

Since tunneling both ports is complex, here's an easier solution:

1. Use cloudflared for the web app (port 5173) - this gives you HTTPS for camera/mic
2. The WebSocket will try to connect, but if it fails, the app will still work for Pomodoro
3. For full WebRTC to work, both computers need to be on the same network and use the local IP

## Alternative: Use ngrok (if you prefer)

1. Sign up for free at https://dashboard.ngrok.com/signup
2. Get your authtoken from the dashboard
3. Run: `.\ngrok.exe config add-authtoken YOUR_TOKEN`
4. Run: `.\ngrok.exe http 5173`
5. Use the HTTPS URL provided
