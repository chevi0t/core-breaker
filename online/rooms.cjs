"use strict";
// 部屋の参加者と試合の権限を管理する。試合の判定は authority が持つ。
const { randomUUID, randomInt } = require("node:crypto");
const KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "KeyR",
  "KeyQ",
  "KeyE",
  "KeyH",
  "KeyF",
  "KeyZ",
  "KeyX",
  "KeyC",
  "KeyV",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
]);
const CLASSES = ["assault", "heavy", "raid", "support"];
const SLOTS = ["main", "sub", "aux", "sp"];
const word = (value) =>
  typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(value)
    ? value
    : "";
function profileOf(raw = {}) {
  raw = raw && typeof raw === "object" ? raw : {};
  const name =
    Array.from(
      String(raw.name || "あなた")
        .replace(/[\x00-\x1f\x7f]/g, "")
        .trim(),
    )
      .slice(0, 20)
      .join("") || "あなた";
  const mech = Object.fromEntries(
    ["head", "body", "arms", "legs", "color"].map((k) => [
      k,
      word(raw.mech?.[k]),
    ]),
  );
  const loadout = Object.fromEntries(
    CLASSES.map((c) => [
      c,
      Object.fromEntries(SLOTS.map((s) => [s, word(raw.loadout?.[c]?.[s])])),
    ]),
  );
  return {
    name,
    cls: CLASSES.includes(raw.cls) ? raw.cls : "assault",
    mech,
    loadout,
    pilot: word(raw.pilot),
  };
}
function inputOf(raw) {
  if (!raw || !Number.isSafeInteger(raw.seq) || raw.seq < 0) return null;
  const finite = (n, max) =>
    Number.isFinite(n) ? Math.max(-max, Math.min(max, n)) : 0;
  const codes = (list) =>
    Array.isArray(list)
      ? [...new Set(list.filter((k) => KEYS.has(k)))].slice(0, KEYS.size)
      : [];
  const point = (p) =>
    p && Number.isFinite(p.x) && Number.isFinite(p.z)
      ? { x: finite(p.x, 2000), z: finite(p.z, 2000) }
      : null;
  const actions = Array.isArray(raw.actions)
    ? raw.actions
        .slice(0, 12)
        .filter(
          (a) =>
            a &&
            [
              "weapon",
              "class",
              "spawn",
              "artillery",
              "cancelArtillery",
              "chat",
            ].includes(a.type),
        )
        .map((a) => ({
          type: a.type,
          value: word(a.value),
          point: point(a.point),
          index: Number.isInteger(a.index)
            ? Math.max(0, Math.min(7, a.index))
            : 0,
        }))
    : [];
  return {
    seq: raw.seq,
    keys: codes(raw.keys),
    pressed: codes(raw.pressed),
    dx: finite(raw.dx, 2000),
    dy: finite(raw.dy, 2000),
    wheel: Math.sign(finite(raw.wheel, 1)),
    fire: raw.fire === true,
    alt: raw.alt === true,
    actions,
  };
}
class Rooms {
  constructor({ createAuthority, maxRooms = 4 } = {}) {
    this.createAuthority = createAuthority;
    this.maxRooms = maxRooms;
    this.rooms = new Map();
    this.peers = new Map();
  }
  connect(send) {
    const peer = {
      id: randomUUID(),
      send,
      room: null,
      profile: profileOf(),
      seq: -1,
    };
    this.peers.set(peer.id, peer);
    send({ type: "hello", id: peer.id, version: 1 });
    return peer;
  }
  error(peer, message) {
    peer.send({ type: "error", message });
  }
  view(room) {
    return {
      code: room.code,
      host: room.host,
      phase: room.phase,
      map: room.map,
      capacity: 20,
      players: [...room.players.values()].map((p) => ({
        id: p.id,
        name: p.profile.name,
        team: p.slot % 2 ? "R" : "B",
        index: Math.floor(p.slot / 2),
        slot: p.slot,
        ready: p.ready,
      })),
    };
  }
  broadcast(room, msg) {
    const encoded = JSON.stringify(msg);
    for (const p of room.players.values()) p.send(msg, encoded);
  }
  publish(room) {
    this.broadcast(room, { type: "room", room: this.view(room) });
  }
  config(room) {
    return {
      code: room.code,
      map: room.map,
      teamSize: 10,
      players: [...room.players.values()].map((p) => ({
        id: p.id,
        team: p.slot % 2 ? "R" : "B",
        index: Math.floor(p.slot / 2),
        profile: p.profile,
      })),
    };
  }
  async message(peer, msg) {
    if (!msg || typeof msg !== "object")
      return this.error(peer, "通信の内容を読めません");
    if (msg.type === "leave") {
      await this.leave(peer);
      peer.send({ type: "left" });
      return;
    }
    if (msg.type === "create") {
      if (peer.room) return this.error(peer, "いまの部屋から退出してください");
      if (this.rooms.size >= this.maxRooms)
        return this.error(peer, "対戦サーバーが満室です");
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code;
      do {
        code = Array.from(
          { length: 6 },
          () => chars[randomInt(chars.length)],
        ).join("");
      } while (this.rooms.has(code));
      const room = {
        code,
        host: peer.id,
        players: new Map(),
        phase: "lobby",
        map: "city",
        authority: null,
      };
      this.rooms.set(code, room);
      this.join(peer, room, msg.profile);
      return;
    }
    if (msg.type === "join") {
      const code = String(msg.code || "")
          .replace(/\s/g, "")
          .toUpperCase(),
        room = this.rooms.get(code);
      if (peer.room) return this.error(peer, "いまの部屋から退出してください");
      if (!room) return this.error(peer, "その部屋は見つかりません");
      if (room.phase !== "lobby")
        return this.error(peer, "この部屋は試合中です。終了後に参加できます");
      if (room.players.size >= 20)
        return this.error(peer, "この部屋は満員です");
      this.join(peer, room, msg.profile);
      return;
    }
    const room = peer.room;
    if (!room) return this.error(peer, "先に部屋へ入ってください");
    if (msg.type === "ready" && room.phase === "lobby") {
      peer.ready = msg.ready === true;
      if (peer.ready && msg.profile) peer.profile = profileOf(msg.profile);
      this.publish(room);
      return;
    }
    if (msg.type === "map" && room.phase === "lobby" && peer.id === room.host) {
      if (!["city", "wide", "tidal", "tidal-v2", "tidal-v3"].includes(msg.map))
        return this.error(peer, "このマップはオンライン対戦に対応していません");
      room.map = msg.map;
      for (const p of room.players.values()) p.ready = false;
      this.publish(room);
      return;
    }
    if (msg.type === "input") {
      // 終了通知と行き違った最後の入力は捨てる。
      if (room.phase !== "match") return;
      const input = inputOf(msg.input);
      if (!input || input.seq <= peer.seq) return;
      peer.seq = input.seq;
      room.authority?.input(peer.id, input);
      return;
    }
    if (msg.type === "start") {
      if (peer.id !== room.host)
        return this.error(peer, "開始できるのは部屋主だけです");
      if (room.phase !== "lobby") return;
      if (room.players.size < 2)
        return this.error(peer, "2人以上で開始できます");
      if ([...room.players.values()].some((p) => !p.ready))
        return this.error(peer, "全員が準備完了になるまで待ってください");
      room.phase = "loading";
      this.publish(room);
      try {
        const config = this.config(room);
        const authority = await this.createAuthority(
          config,
          (state) => {
            if (this.rooms.get(room.code) !== room) return;
            this.broadcast(room, { type: "state", state });
            if (state.ended && room.phase === "match") {
              room.phase = "finished";
              this.publish(room);
            }
          },
          (message) => {
            this.broadcast(room, { type: "error", message });
            this.stopMatch(room);
          },
        );
        if (this.rooms.get(room.code) !== room) {
          await authority.close();
          return;
        }
        room.authority = authority;
        for (const p of config.players)
          if (!room.players.has(p.id)) authority.disconnect(p.id);
        room.phase = "match";
        for (const p of room.players.values()) p.seq = -1;
        this.broadcast(room, { type: "match", config });
        this.publish(room);
        authority.start();
      } catch (e) {
        room.phase = "lobby";
        this.error(
          peer,
          "試合を開始できませんでした。サーバーの状態を確認してください",
        );
        this.publish(room);
        throw e;
      }
      return;
    }
    if (
      msg.type === "rematch" &&
      peer.id === room.host &&
      room.phase === "finished"
    ) {
      await this.stopMatch(room);
      return;
    }
    this.error(peer, "いまはその操作を受け付けられません");
  }
  join(peer, room, raw) {
    const occupied = new Set([...room.players.values()].map((p) => p.slot));
    let slot = 0;
    while (occupied.has(slot)) slot++;
    Object.assign(peer, { room, slot, ready: false, profile: profileOf(raw) });
    room.players.set(peer.id, peer);
    this.publish(room);
  }
  async stopMatch(room) {
    const authority = room.authority;
    room.authority = null;
    room.phase = "lobby";
    for (const p of room.players.values()) {
      p.ready = false;
      p.seq = -1;
    }
    if (authority) await authority.close();
    this.publish(room);
  }
  async leave(peer) {
    const room = peer.room;
    if (!room) return;
    peer.room = null;
    room.players.delete(peer.id);
    room.authority?.disconnect(peer.id);
    if (!room.players.size) {
      this.rooms.delete(room.code);
      await room.authority?.close();
      return;
    }
    if (room.host === peer.id) room.host = room.players.keys().next().value;
    this.publish(room);
  }
  async disconnect(peer) {
    await this.leave(peer);
    this.peers.delete(peer.id);
  }
  async close() {
    await Promise.all(
      [...this.rooms.values()].map((r) => r.authority?.close()),
    );
    this.rooms.clear();
    this.peers.clear();
  }
}
module.exports = { Rooms, profileOf, inputOf };
