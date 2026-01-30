import { DurableObject } from "cloudflare:workers";

function json(obj) {
  return JSON.stringify(obj);
}

export class RoomDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;

    this.clients = new Map();
    this.pomodoro = { isRunning: false, phase: "work", endAt: null };
    this.pointsByName = {};
    this._loaded = false;
  }

  async loadStateOnce() {
    if (this._loaded) return;
    this._loaded = true;
    const saved = await this.ctx.storage.get(["pomodoro", "pointsByName"]);
    if (saved?.pomodoro) this.pomodoro = saved.pomodoro;
    if (saved?.pointsByName) this.pointsByName = saved.pointsByName;
  }

  async fetch(request) {
    await this.loadStateOnce();

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    const id = crypto.randomUUID();
    this.clients.set(server, { id, name: null });

    this.pushRoomState();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.loadStateOnce();

    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    const meta = this.clients.get(ws);
    if (!meta) return;

    if (msg.type === "join_room") {
      meta.name = String(msg.name || "").trim() || "Guest";

      if (this.pointsByName[meta.name] == null) {
        this.pointsByName[meta.name] = 0;
        await this.ctx.storage.put("pointsByName", this.pointsByName);
      }

      const joined = this.getParticipants();
      if (joined.length > 2) {
        ws.send(json({ type: "room_full" }));
        ws.close(1000, "Room full");
        return;
      }

      if (joined.length === 1) {
        ws.send(json({ type: "waiting_for_peer" }));
      } else if (joined.length === 2) {
        const sockets = this.getConnectedSockets();
        sockets[0].send(json({ type: "ready", role: "offerer" }));
        sockets[1].send(json({ type: "ready", role: "answerer" }));
      }

      this.pushRoomState();
      return;
    }

    if (
      msg.type === "webrtc_offer" ||
      msg.type === "webrtc_answer" ||
      msg.type === "webrtc_ice"
    ) {
      this.relayToPeer(ws, msg);
      return;
    }

    if (msg.type === "pomodoro_start") {
      if (!this.pomodoro.isRunning) {
        const durationMs =
          this.pomodoro.phase === "break" ? 5 * 60_000 : 25 * 60_000;
        this.pomodoro.isRunning = true;
        this.pomodoro.endAt = Date.now() + durationMs;

        await this.ctx.storage.put("pomodoro", this.pomodoro);
        await this.ctx.storage.setAlarm(this.pomodoro.endAt);
        this.pushRoomState();
      }
      return;
    }

    if (msg.type === "pomodoro_reset") {
      this.pomodoro = { isRunning: false, phase: "work", endAt: null };
      await this.ctx.storage.put("pomodoro", this.pomodoro);
      await this.ctx.storage.setAlarm(Date.now());
      this.pushRoomState();
      return;
    }
  }

  async alarm() {
    await this.loadStateOnce();

    if (!this.pomodoro.isRunning || !this.pomodoro.endAt) return;

    const now = Date.now();
    if (now < this.pomodoro.endAt) {
      await this.ctx.storage.setAlarm(this.pomodoro.endAt);
      return;
    }

    if (this.pomodoro.phase === "work") {
      for (const { name } of this.getParticipants()) {
        if (!name) continue;
        this.pointsByName[name] = (this.pointsByName[name] || 0) + 1;
      }
      await this.ctx.storage.put("pointsByName", this.pointsByName);
    }

    this.pomodoro.phase = this.pomodoro.phase === "work" ? "break" : "work";
    const durationMs =
      this.pomodoro.phase === "break" ? 5 * 60_000 : 25 * 60_000;
    this.pomodoro.endAt = Date.now() + durationMs;

    await this.ctx.storage.put("pomodoro", this.pomodoro);
    await this.ctx.storage.setAlarm(this.pomodoro.endAt);
    this.pushRoomState();
  }

  async webSocketClose(ws) {
    this.clients.delete(ws);
    this.broadcast({ type: "peer_left" });
    this.pushRoomState();
  }

  getConnectedSockets() {
    return [...this.clients.keys()];
  }

  getParticipants() {
    const arr = [];
    for (const { id, name } of this.clients.values()) {
      if (!name) continue;
      arr.push({ id, name, points: this.pointsByName[name] || 0 });
    }
    return arr;
  }

  pushRoomState() {
    this.broadcast({
      type: "room_state",
      participants: this.getParticipants(),
      pomodoro: this.pomodoro,
    });
  }

  relayToPeer(fromWs, msg) {
    for (const ws of this.clients.keys()) {
      if (ws === fromWs) continue;
      ws.send(json(msg));
    }
  }

  broadcast(msg) {
    const data = json(msg);
    for (const ws of this.clients.keys()) {
      try {
        ws.send(data);
      } catch {}
    }
  }
}
