const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const rooms = new Map();
const HUNTER_IDS = new Set(["epstein", "hawking", "trump"]);
const ITEM_IDS = new Set([
  "key",
  "fuel",
  "files",
  "accessCard",
  "fuse",
  "safeCode",
  "chart",
  "manifest",
  "battery",
  "magnifier",
  "radar",
]);

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
    ensureRoomHost(room);
    if (room.players.size === 0 && now - room.lastActive > 120000) {
      rooms.delete(roomId);
    }
  }
}

function ensureRoomHost(room) {
  if (!room.players.size) {
    room.hostId = "";
    return "";
  }

  const currentHost = room.players.get(room.hostId);
  if (currentHost && !currentHost.caught) {
    return room.hostId;
  }

  const nextHost = [...room.players.values()].find((player) => !player.caught) || [...room.players.values()][0];
  room.hostId = nextHost.id;
  return room.hostId;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanHunters(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 8).map((hunter) => ({
    id: cleanText(hunter.id, "hunter", 20),
    x: numberOr(hunter.x, 0),
    y: numberOr(hunter.y, 0),
    z: numberOr(hunter.z, 0),
    yaw: numberOr(hunter.yaw, 0),
    floorHeight: numberOr(hunter.floorHeight, 0),
    targetFloor: numberOr(hunter.targetFloor, 0),
    mode: cleanText(hunter.mode, "patrol", 20),
    awareness: Math.max(0, Math.min(1, numberOr(hunter.awareness, 0))),
  }));
}

function cleanMultiplier(value, fallback = 1) {
  return Math.max(0.25, Math.min(3, numberOr(value, fallback)));
}

function cleanIdList(value, allowed, fallback) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const ids = value.filter((id) => allowed.has(String(id)));
  return [...new Set(ids)];
}

function cleanGameConfig(value = {}) {
  const radarMode = value.radarMode === "none" ? "none" : "start";
  const requiredItems = cleanIdList(value.requiredItems, ITEM_IDS, ITEM_IDS);
  return {
    speedMultiplier: cleanMultiplier(value.speedMultiplier),
    hearingMultiplier: cleanMultiplier(value.hearingMultiplier),
    sightMultiplier: cleanMultiplier(value.sightMultiplier),
    rangeMultiplier: cleanMultiplier(value.rangeMultiplier ?? value.sightMultiplier),
    hunterIds: cleanIdList(value.hunterIds, HUNTER_IDS, HUNTER_IDS),
    requiredItems: radarMode === "none" ? requiredItems.filter((id) => id !== "radar") : requiredItems,
    radarMode,
    boatOnly: false,
    wallBreaker: false,
    daylight: false,
    custom: true,
    label: "Room Custom",
  };
}

function createPlayer(room, username) {
  const player = {
    id: id("p"),
    username: cleanText(username, "Runner"),
    x: 0,
    y: 1.72,
    z: 0,
    yaw: 0,
    pitch: 0,
    floorHeight: 0,
    sound: 0,
    flashlightOn: true,
    hiding: false,
    caught: false,
    victory: false,
    lastSeen: Date.now(),
  };
  room.players.set(player.id, player);
  if (!room.hostId) {
    room.hostId = player.id;
  }
  room.lastActive = Date.now();
  room.chat.push({ id: id("m"), system: true, username: "System", text: `${player.username} joined.`, time: Date.now() });
  return player;
}

function roomPayload(room) {
  ensureRoomHost(room);
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    createdAt: room.createdAt,
    gameConfig: room.gameConfig,
    players: [...room.players.values()],
    hunters: room.hunters || [],
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
      rooms: [...rooms.values()]
        .filter((room) => room.players.size > 0)
        .map((room) => ({
          id: room.id,
          name: room.name,
          count: room.players.size,
          createdAt: room.createdAt,
          gameConfig: room.gameConfig,
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
      hostId: "",
      gameConfig: cleanGameConfig(body.gameConfig),
      players: new Map(),
      hunters: [],
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
    player.pitch = numberOr(body.pitch, 0);
    player.floorHeight = numberOr(body.floorHeight, 0);
    player.sound = Math.max(0, Math.min(1, numberOr(body.sound, 0)));
    player.flashlightOn = body.flashlightOn !== false;
    player.hiding = Boolean(body.hiding);
    player.caught = Boolean(body.caught);
    player.victory = Boolean(body.victory);
    player.lastSeen = Date.now();
    ensureRoomHost(room);
    if (room.hostId === player.id) {
      room.hunters = cleanHunters(body.hunters);
      if (Array.isArray(body.caughtPlayers)) {
        body.caughtPlayers.slice(0, 8).forEach((targetId) => {
          const target = room.players.get(String(targetId || ""));
          if (target && target.id !== player.id) {
            target.caught = true;
            target.lastSeen = Date.now();
          }
        });
      }
    }
    ensureRoomHost(room);
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
