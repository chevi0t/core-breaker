"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Rooms, inputOf, profileOf } = require("./rooms.cjs");
function fixture(factory) {
  const calls = { start: 0, closed: 0, input: [], left: [] };
  let emit;
  const authority = {
    start() {
      calls.start++;
    },
    async close() {
      calls.closed++;
    },
    input(...args) {
      calls.input.push(args);
    },
    disconnect(id) {
      calls.left.push(id);
    },
  };
  const rooms = new Rooms({
    createAuthority:
      factory ||
      (async (config, onState) => {
        calls.config = config;
        emit = onState;
        return authority;
      }),
  });
  const add = () => {
    const messages = [];
    const p = rooms.connect((m) => messages.push(m));
    return { p, messages, send: (msg) => rooms.message(p, msg) };
  };
  return { rooms, add, calls, authority, state: (s) => emit(s) };
}
test("20枠を青橙10人ずつに割り当て、21人目と他の部屋の操作を拒む", async () => {
  const f = fixture(),
    host = f.add();
  await host.send({ type: "create", profile: { name: "部屋主" } });
  const code = host.p.room.code;
  const peers = [host];
  for (let i = 1; i < 20; i++) {
    const p = f.add();
    peers.push(p);
    await p.send({ type: "join", code: code.toLowerCase() });
  }
  const view = f.rooms.view(host.p.room);
  assert.equal(view.players.filter((p) => p.team === "B").length, 10);
  assert.equal(view.players.filter((p) => p.team === "R").length, 10);
  assert.equal(
    new Set(view.players.map((p) => `${p.team}:${p.index}`)).size,
    20,
  );
  const extra = f.add();
  await extra.send({ type: "join", code });
  assert.equal(extra.p.room, null);
  assert.match(extra.messages.at(-1).message, /満員/);
  await peers[1].send({ type: "start" });
  assert.equal(f.calls.start, 0);
  await extra.send({ type: "input", input: { seq: 1 } });
  assert.equal(f.calls.input.length, 0);
  await f.rooms.close();
});
test("準備・部屋主権限・重複開始・入力順序・試合終了・再戦", async () => {
  const f = fixture(),
    a = f.add(),
    b = f.add();
  await a.send({ type: "create" });
  await b.send({ type: "join", code: a.p.room.code });
  await a.send({ type: "start" });
  assert.equal(a.p.room.phase, "lobby");
  await b.send({ type: "map", map: "wide" });
  assert.equal(a.p.room.map, "city");
  for (const p of [a, b]) await p.send({ type: "ready", ready: true });
  await b.send({
    type: "ready",
    ready: true,
    profile: { name: "装備変更後", cls: "heavy" },
  });
  await a.send({ type: "start" });
  await a.send({ type: "start" });
  assert.equal(f.calls.start, 1);
  assert.equal(f.calls.config.teamSize, 10);
  assert.equal(f.calls.config.players.length, 2);
  assert.equal(f.calls.config.players[1].profile.name, "装備変更後");
  assert.equal(f.calls.config.players[1].profile.cls, "heavy");
  await b.send({
    type: "input",
    input: { seq: 2, keys: ["KeyW"], hp: 99999, pos: [1, 2, 3] },
  });
  await b.send({ type: "input", input: { seq: 1, keys: ["KeyS"] } });
  assert.equal(f.calls.input.length, 1);
  assert.equal(f.calls.input[0][1].hp, undefined);
  f.state({ ended: true });
  const messageCount = b.messages.length;
  await b.send({ type: "input", input: { seq: 3 } });
  assert.equal(b.messages.length, messageCount);
  assert.equal(a.p.room.phase, "finished");
  await a.send({ type: "rematch" });
  assert.equal(a.p.room.phase, "lobby");
  assert.equal(a.p.ready, false);
  assert.equal(f.calls.closed, 1);
  await f.rooms.close();
});
test("切断した枠をBOTへ戻し、部屋主を移し、最後の退出で試合を破棄", async () => {
  const f = fixture(),
    a = f.add(),
    b = f.add();
  await a.send({ type: "create" });
  const room = a.p.room;
  await b.send({ type: "join", code: room.code });
  for (const p of [a, b]) await p.send({ type: "ready", ready: true });
  await a.send({ type: "start" });
  await f.rooms.disconnect(a.p);
  assert.equal(room.host, b.p.id);
  assert.deepEqual(f.calls.left, [a.p.id]);
  assert.equal(room.phase, "match");
  await f.rooms.disconnect(b.p);
  assert.equal(f.rooms.rooms.size, 0);
  assert.equal(f.calls.closed, 1);
});
test("読込中に全員が退出してもサーバーのページを残さない", async () => {
  let resolve;
  const ready = new Promise((r) => (resolve = r));
  const f = fixture(async () => ready),
    a = f.add(),
    b = f.add();
  await a.send({ type: "create" });
  await b.send({ type: "join", code: a.p.room.code });
  for (const p of [a, b]) await p.send({ type: "ready", ready: true });
  const loading = a.send({ type: "start" });
  await f.rooms.disconnect(a.p);
  await f.rooms.disconnect(b.p);
  resolve(f.authority);
  await loading;
  assert.equal(f.calls.closed, 1);
  assert.equal(f.calls.start, 0);
});
test("名前・入力を正規化し、座標や耐久を受け取らない", () => {
  assert.equal(profileOf({ name: "\n猫\0" }).name, "猫");
  assert.equal(
    Array.from(profileOf({ name: "🐈".repeat(30) }).name).length,
    20,
  );
  assert.equal(profileOf({ cls: "constructor" }).cls, "assault");
  assert.equal(inputOf({ seq: -1 }), null);
  const input = inputOf({
    seq: 3,
    keys: ["KeyW", "KeyW", "KeyP"],
    dx: Infinity,
    dy: 9000,
    fire: 1,
    pos: [0, 1, 2],
    actions: [
      { type: "damage" },
      { type: "artillery", point: { x: 1e20, z: 2 } },
    ],
  });
  assert.deepEqual(input.keys, ["KeyW"]);
  assert.equal(input.dx, 0);
  assert.equal(input.dy, 2000);
  assert.equal(input.fire, false);
  assert.equal(input.pos, undefined);
  assert.equal(input.actions.length, 1);
  assert.equal(input.actions[0].point.x, 2000);
});
