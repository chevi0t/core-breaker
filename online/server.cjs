"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { WebSocketServer, WebSocket } = require("ws");
const { Rooms } = require("./rooms.cjs");
const { AuthorityPool } = require("./authority.cjs");
const root = path.resolve(__dirname, "../prototype");
const assets = new Set([
  "index.html",
  "maps.js",
  "sounds.js",
  "music.js",
  "three.min.js",
  "online-client.js",
  "online-game.js",
  "SOUND-CREDITS.md",
]);
async function createServer(options = {}) {
  const server = http.createServer((req, res) => {
    const name =
      new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
    if (name === "favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (name === "health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size }));
    }
    if (!assets.has(name)) {
      res.writeHead(404);
      return res.end();
    }
    fs.readFile(
      name === "SOUND-CREDITS.md"
        ? path.resolve(root, "../sounds/CREDITS.md")
        : name === "three.min.js"
          ? path.resolve(root, "../vendor/three-r128/three.min.js")
          : path.join(root, name),
      (err, data) => {
        if (err) {
          res.writeHead(404);
          return res.end();
        }
        res.setHeader(
          "Content-Type",
          name.endsWith(".html")
            ? "text/html; charset=utf-8"
            : name.endsWith(".md")
              ? "text/plain; charset=utf-8"
              : "text/javascript; charset=utf-8",
        );
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (name === "index.html")
          data =
            '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}</style>' +
            data
              .toString()
              .replace(/<link[^>]*https:\/\/fonts[^>]*>/g, "")
              .replace(/https:\/\/[^"']*three[^"']*\.js/g, "/three.min.js");
        res.end(data);
      },
    );
  });
  const pool = new AuthorityPool(
    () => `http://127.0.0.1:${server.address().port}`,
    options,
  );
  const rooms = new Rooms({
    createAuthority:
      options.createAuthority || ((...args) => pool.create(...args)),
    maxRooms: options.maxRooms || Number(process.env.MAX_ROOMS || 2),
  });
  const wss = new WebSocketServer({
    server,
    path: "/rooms",
    maxPayload: 32768,
    perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: 1 } },
  });
  wss.on("connection", (ws, req) => {
    // 同一サイトだけがルームを操作できる。ローカルのCLI試験はOriginなし。
    const origin = req.headers.origin;
    try {
      if (origin && new URL(origin).host !== req.headers.host) {
        ws.close(1008, "origin");
        return;
      }
    } catch {
      ws.close(1008, "origin");
      return;
    }
    let alive = true,
      count = 0,
      since = Date.now();
    const peer = rooms.connect((msg, encoded) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 4 * 1024 * 1024) {
        ws.close(1013, "connection too slow");
        return;
      }
      ws.send(encoded || JSON.stringify(msg));
    });
    ws.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 15000);
    ws.on("message", (data) => {
      if (Date.now() - since > 1000) {
        since = Date.now();
        count = 0;
      }
      if (++count > 100) {
        ws.close(1008, "rate");
        return;
      }
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        rooms.error(peer, "通信の内容を読めません");
        return;
      }
      rooms
        .message(peer, msg)
        .catch((e) => console.error("ルーム処理:", e.message));
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      clearInterval(heartbeat);
      rooms.disconnect(peer).catch(console.error);
    });
  });
  await new Promise((resolve) =>
    server.listen(
      options.port ?? Number(process.env.PORT || 8080),
      options.host || process.env.HOST || "0.0.0.0",
      resolve,
    ),
  );
  return {
    server,
    rooms,
    pool,
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await rooms.close();
      await pool.close();
      await new Promise((r) => wss.close(r));
      await new Promise((r) => server.close(r));
    },
  };
}
if (require.main === module)
  createServer()
    .then((app) => {
      console.log(`対戦サーバー: ${app.url}（10対10、不足分はBOT）`);
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        await app.close();
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
module.exports = { createServer };
