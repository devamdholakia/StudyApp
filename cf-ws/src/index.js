import { RoomDO } from "./room-do.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!m) return new Response("Not found", { status: 404 });

    const roomId = m[1];
    const id = env.ROOMS.idFromName(roomId);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  },
};

export { RoomDO };
