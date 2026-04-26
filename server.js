const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const rooms = new Map();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function id(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function cleanText(value, fallback, limit = 32) {
  return String(value || fallback)
    .replace(/[^\w .-]/g, "")
    .trim()
    .slice(0, limit) || fallback;
}

function send(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function cleanup() {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    for (const [playerId, player] of room.players) {
      if (now - player.lastSeen > 15000) {
        room.players.delete(playerId);
      }
    }
    if (room.players.size === 0 && now - room.lastActive > 120000) {
      rooms.delete(roomId);
    }
  }
}

function createPlayer(room, username) {
  const player = {
    id: id("p"),
    username: cleanText(username, "Runner"),
    x: 0,
    y: 1.72,
    z: 0,
    yaw: 0,
    caught: false,
    victory: false,
    lastSeen: Date.now(),
  };
  room.players.set(player.id, player);
  room.lastActive = Date.now();
  room.chat.push({ id: id("m"), system: true, username: "System", text: `${player.username} joined.`, time: Date.now() });
  return player;
}

function roomPayload(room) {
  return {
    id: room.id,
    name: room.name,
    createdAt: room.createdAt,
    players: [...room.players.values()],
    chat: room.chat.slice(-50),
  };
}

async function api(req, res, url) {
  cleanup();
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return true;
  }

  if (url.pathname === "/api/rooms" && req.method === "GET") {
    send(res, 200, {
      rooms: [...rooms.values()].map((room) => ({
        id: room.id,
        name: room.name,
        count: room.players.size,
        createdAt: room.createdAt,
      })),
    });
    return true;
  }

  if (url.pathname === "/api/rooms" && req.method === "POST") {
    const body = await readBody(req);
    const room = {
      id: id("r"),
      name: cleanText(body.name, "Island Run"),
      createdAt: Date.now(),
      lastActive: Date.now(),
      players: new Map(),
      chat: [],
    };
    rooms.set(room.id, room);
    const player = createPlayer(room, body.username);
    send(res, 200, { room: roomPayload(room), playerId: player.id });
    return true;
  }

  if (url.pathname === "/api/join" && req.method === "POST") {
    const body = await readBody(req);
    const room = rooms.get(String(body.roomId || ""));
    if (!room) {
      send(res, 404, { error: "Room not found" });
      return true;
    }
    const player = createPlayer(room, body.username);
    send(res, 200, { room: roomPayload(room), playerId: player.id });
    return true;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    const room = rooms.get(String(url.searchParams.get("roomId") || ""));
    if (!room) {
      send(res, 404, { error: "Room not found" });
      return true;
    }
    room.lastActive = Date.now();
    send(res, 200, { room: roomPayload(room) });
    return true;
  }

  if (url.pathname === "/api/state" && req.method === "POST") {
    const body = await readBody(req);
    const room = rooms.get(String(body.roomId || ""));
    const player = room?.players.get(String(body.playerId || ""));
    if (!room || !player) {
      send(res, 404, { error: "Room/player not found" });
      return true;
    }
    player.username = cleanText(body.username, player.username);
    player.x = Number(body.x) || 0;
    player.y = Number(body.y) || 1.72;
    player.z = Number(body.z) || 0;
    player.yaw = Number(body.yaw) || 0;
    player.caught = Boolean(body.caught);
    player.victory = Boolean(body.victory);
    player.lastSeen = Date.now();
    room.lastActive = Date.now();
    send(res, 200, { ok: true, room: roomPayload(room) });
    return true;
  }

  if (url.pathname === "/api/chat" && req.method === "POST") {
    const body = await readBody(req);
    const room = rooms.get(String(body.roomId || ""));
    const player = room?.players.get(String(body.playerId || ""));
    if (!room || !player) {
      send(res, 404, { error: "Room/player not found" });
      return true;
    }
    const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (text) {
      room.chat.push({ id: id("m"), username: player.username, text, time: Date.now() });
      room.chat = room.chat.slice(-50);
      room.lastActive = Date.now();
    }
    send(res, 200, { ok: true, chat: room.chat.slice(-50) });
    return true;
  }

  if (url.pathname === "/api/revive" && req.method === "POST") {
    const body = await readBody(req);
    const room = rooms.get(String(body.roomId || ""));
    const player = room?.players.get(String(body.playerId || ""));
    const target = room?.players.get(String(body.targetId || ""));
    if (!room || !player || !target) {
      send(res, 404, { error: "Room/player not found" });
      return true;
    }
    target.caught = false;
    target.lastSeen = Date.now();
    room.chat.push({ id: id("m"), system: true, username: "System", text: `${player.username} revived ${target.username}.`, time: Date.now() });
    room.chat = room.chat.slice(-50);
    room.lastActive = Date.now();
    send(res, 200, { ok: true, room: roomPayload(room) });
    return true;
  }

  return false;
}

function serveFile(req, res, url) {
  let requested = decodeURIComponent(url.pathname);
  if (requested === "/") {
    requested = "/index.html";
  }
  const fullPath = path.normalize(path.join(ROOT, requested));
  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(fullPath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(fullPath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/") && (await api(req, res, url))) {
    return;
  }
  serveFile(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Black Tide multiplayer server running at http://localhost:${PORT}`);
});
