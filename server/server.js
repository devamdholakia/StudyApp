const WebSocket = require("ws");
const crypto = require("crypto");
const https = require("https");
const fs = require("fs");
const path = require("path");

// Load SSL certificates
const certPath = path.join(__dirname, "../certs/cert.pem");
const keyPath = path.join(__dirname, "../certs/key.pem");

let server;
let wss;

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  // Use HTTPS server with SSL certificates
  const options = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };

  server = https.createServer(options);
  wss = new WebSocket.Server({ server });
  
  server.listen(8080, "0.0.0.0", () => {
    console.log("WebSocket server running on wss://localhost:8080 (HTTPS)");
  });
} else {
  // Fallback to HTTP if certificates not found
  wss = new WebSocket.Server({ host: "0.0.0.0", port: 8080 });
  console.log("WebSocket server running on ws://localhost:8080 (HTTP - no certs found)");
}

const WORK_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;

const rooms = new Map(); 
// roomId -> {
//   peers: [ws, ws],
//   pomodoro: { isRunning, phase, endAt },
//   scores: Map(clientId -> points)
// }

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      peers: [],
      pomodoro: { isRunning: false, phase: "work", endAt: null },
      scores: new Map(),
      lastStateUpdate: null,
    });
  }
  return rooms.get(roomId);
}

function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcastRoom(roomId, obj) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.peers.forEach((p) => safeSend(p, obj));
}

function buildParticipants(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return room.peers
    .filter((p) => p && p.clientId && p.name)
    .map((p) => {
      const clientId = p.clientId;
      return {
        id: clientId,
        name: p.name || "Unknown",
        points: room.scores.get(clientId) || 0,
      };
    });
}

function sendRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  broadcastRoom(roomId, {
    type: "room_state",
    participants: buildParticipants(roomId),
    pomodoro: room.pomodoro,
  });
}

function getOtherPeer(roomId, ws) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return room.peers.find((p) => p !== ws);
}

function startPomodoro(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.pomodoro.isRunning = true;
  room.pomodoro.phase = "work";
  room.pomodoro.endAt = Date.now() + WORK_MS;

  sendRoomState(roomId);
}

function resetPomodoro(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.pomodoro.isRunning = false;
  room.pomodoro.phase = "work";   // back to Focus
  room.pomodoro.endAt = null;     // no countdown running

  sendRoomState(roomId);
}

// Tick loop: checks all rooms and advances timer phases
setInterval(() => {
  const now = Date.now();

  for (const [roomId, room] of rooms.entries()) {
    const p = room.pomodoro;
    
    // Send periodic updates for running timers to keep clients in sync
    if (p.isRunning && p.endAt) {
      // Send update every 5 seconds to keep clients synchronized
      if (!room.lastStateUpdate || now - room.lastStateUpdate >= 5000) {
        sendRoomState(roomId);
        room.lastStateUpdate = now;
      }
    }

    if (!p.isRunning || !p.endAt) continue;

    if (now >= p.endAt) {
      // Phase ended
      if (p.phase === "work") {
        // Award 1 point to everyone currently in the room
        room.peers.forEach((peer) => {
          const id = peer.clientId;
          if (id) {
            room.scores.set(id, (room.scores.get(id) || 0) + 1);
          }
        });

        // Switch to break
        p.phase = "break";
        p.endAt = now + BREAK_MS;
      } else {
        // break ended -> back to work
        p.phase = "work";
        p.endAt = now + WORK_MS;
      }

      sendRoomState(roomId);
      if (room.lastStateUpdate) room.lastStateUpdate = now;
    }
  }
}, 1000);

wss.on("connection", (ws) => {
  ws.clientId = crypto.randomUUID();
  ws.roomId = null;
  ws.name = null;

  safeSend(ws, { type: "connected", clientId: ws.clientId });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

// JOIN ROOM
    if (msg.type === "join_room") {
      const roomId = (msg.roomId || "default").trim();
      const name = (msg.name || "").trim();
      if (!name) return;

      const room = getRoom(roomId);

      // Enforce 2-person max
      if (room.peers.length >= 2) {
        safeSend(ws, { type: "room_full" });
        return;
      }

      ws.roomId = roomId;
      ws.name = name;

      // Remove from any previous room first
      if (ws.roomId) {
        const oldRoom = rooms.get(ws.roomId);
        if (oldRoom) {
          oldRoom.peers = oldRoom.peers.filter((p) => p !== ws);
        }
      }

      room.peers.push(ws);

      // init score record
      if (!room.scores.has(ws.clientId)) {
        room.scores.set(ws.clientId, 0);
      }

      // Let everyone know room state + timer
      sendRoomState(roomId);

      // If 2 peers, start WebRTC roles
      if (room.peers.length === 2) {
        const [peerA, peerB] = room.peers;
        // Send ready messages with a small delay to ensure both peers are ready
        setTimeout(() => {
          safeSend(peerA, { type: "ready", role: "offerer" });
          safeSend(peerB, { type: "ready", role: "answerer" });
        }, 100);
      } else {
        safeSend(ws, { type: "waiting_for_peer" });
      }

      return;
    }

    // POMODORO START/RESET (anyone can trigger)
    if (msg.type === "pomodoro_start") {
      if (!ws.roomId) return;
      startPomodoro(ws.roomId);
      return;
    }

    if (msg.type === "pomodoro_reset") {
      if (!ws.roomId) return;
      resetPomodoro(ws.roomId);
      return;
    }

    // RELAY SIGNALING
    if (msg.type === "webrtc_offer" || msg.type === "webrtc_answer" || msg.type === "webrtc_ice") {
      const roomId = ws.roomId;
      if (!roomId) return;

      const other = getOtherPeer(roomId, ws);
      safeSend(other, msg);
      return;
    }
  });

  ws.on("close", () => {
    const roomId = ws.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.peers = room.peers.filter((p) => p !== ws);

    // Notify remaining peer
    broadcastRoom(roomId, { type: "peer_left" });

    // Update state for remaining
    sendRoomState(roomId);

    // Cleanup empty rooms
    if (room.peers.length === 0) {
      rooms.delete(roomId);
    }
  });
});
