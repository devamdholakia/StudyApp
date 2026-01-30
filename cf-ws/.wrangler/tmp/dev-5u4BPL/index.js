var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/room-do.js
import { DurableObject } from "cloudflare:workers";
function json(obj) {
  return JSON.stringify(obj);
}
__name(json, "json");
var RoomDO = class extends DurableObject {
  static {
    __name(this, "RoomDO");
  }
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.clients = /* @__PURE__ */ new Map();
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
        ws.close(1e3, "Room full");
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
    if (msg.type === "webrtc_offer" || msg.type === "webrtc_answer" || msg.type === "webrtc_ice") {
      this.relayToPeer(ws, msg);
      return;
    }
    if (msg.type === "pomodoro_start") {
      if (!this.pomodoro.isRunning) {
        const durationMs = this.pomodoro.phase === "break" ? 5 * 6e4 : 25 * 6e4;
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
    const durationMs = this.pomodoro.phase === "break" ? 5 * 6e4 : 25 * 6e4;
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
      pomodoro: this.pomodoro
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
      } catch {
      }
    }
  }
};

// src/index.js
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!m) return new Response("Not found", { status: 404 });
    const roomId = m[1];
    const id = env.ROOMS.idFromName(roomId);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-CWWcpi/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-CWWcpi/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  RoomDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
