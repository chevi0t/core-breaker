// 本物の対戦サーバー、2ブラウザ＋18接続で10対10を検証する。
// npm ci --prefix online && CHROMIUM_PATH=/path/to/chromium node tools/test/online_rooms_check.js
const assert = require("node:assert/strict");
const { createServer } = require("../../online/server.cjs");
const { chromium } = require("../../online/node_modules/playwright");
const { WebSocket } = require("../../online/node_modules/ws");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await delay(50);
  }
  throw Error("時間切れ: " + label);
}
(async () => {
  const app = await createServer({ port: 0, maxRooms: 1 });
  let browser;
  const sockets = [],
    errors = [],
    last = [null, null],
    frames = [0, 0];
  let bytes = 0,
    states = 0;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    const contexts = await Promise.all([
      browser.newContext({ viewport: { width: 960, height: 540 } }),
      browser.newContext({ viewport: { width: 960, height: 540 } }),
    ]);
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    for (const [i, p] of pages.entries()) {
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      p.on("websocket", (ws) =>
        ws.on("framereceived", (ev) => {
          const m = JSON.parse(ev.payload);
          if (m.type === "state") {
            last[i] = m.state;
            frames[i]++;
            if (!i) {
              bytes += ev.payload.length;
              states++;
            }
          }
          if (m.type === "error") errors.push(m.message);
        }),
      );
      await p.goto(app.url, { waitUntil: "domcontentloaded", timeout: 120000 });
      await p.fill("#playerName", i ? "橙の猫" : "青の猫");
      await p.click('[data-page="pgOnline"]');
      await p.waitForSelector("#netCreate:enabled");
    }
    await pages[0].click("#netCreate");
    await pages[0].waitForSelector("#netRoom:not([hidden])");
    const code = await pages[0].textContent("#netRoomCode");
    await pages[1].fill("#netCode", code);
    await pages[1].click("#netJoin");
    await pages[1].waitForSelector("#netRoom:not([hidden])");
    for (let i = 0; i < 18; i++) {
      const ws = new WebSocket(app.url.replace("http:", "ws:") + "/rooms");
      sockets.push(ws);
      let joined = false;
      ws.on("message", (data) => {
        const m = JSON.parse(data);
        if (m.type === "hello")
          ws.send(
            JSON.stringify({
              type: "join",
              code,
              profile: { name: `接続試験${i}` },
            }),
          );
        if (m.type === "room" && !joined) {
          joined = true;
          ws.send(JSON.stringify({ type: "ready", ready: true }));
        }
      });
      await until(() => joined, "20人の参加");
    }
    const room = app.rooms.rooms.get(code);
    await pages[0].selectOption("#netMap", "wide");
    await until(() => room.map === "wide", "マップ変更");
    // マップ変更で全員の準備を取り消すので、改めて準備する。
    for (const ws of sockets)
      ws.send(JSON.stringify({ type: "ready", ready: true }));
    for (const p of pages) await p.click("#netReady");
    await pages[0].click("#netStart");
    await until(
      () => last.every((s) => s?.units.length === 20),
      "試合の初回同期",
      60000,
    );
    for (const p of pages)
      await p.waitForSelector("#overlay[hidden]", { state: "attached" });
    const authority = room.authority,
      page = authority.page;
    assert.equal(last[0].players.length, 20);
    assert.equal(last[0].units.filter((u) => u.team === "B").length, 10);
    assert.equal(last[0].units.filter((u) => u.team === "R").length, 10);
    console.log("20接続・青10対橙10・全員のブラウザ同期: OK");
    for (const ws of sockets) ws.close();
    await until(() => room.players.size === 2, "18人の切断");
    await until(() => last[0].players.length === 2, "BOT引継ぎ");
    assert.equal(last[0].units.filter((u) => u.isPlayer).length, 2);
    console.log("切断した18人の枠をBOTが引継ぎ: OK");
    // 障害物とBOTの乱数を除き、人間同士の操作・ダメージ判定を確かめる。
    await page.evaluate(() => {
      const e = window.__roomAuthorityAdapter.engine;
      for (const u of e.units) {
        u.invulT = 0;
        if (!u.isPlayer) {
          u.alive = false;
          u.downT = 0;
          u.respawnT = 10000;
          u.group.visible = false;
        } else {
          u.pos.set(0, 0, u.team === "B" ? 250 : 225);
          u.vel.set(0, 0, 0);
          u.yaw = u.team === "B" ? 0 : Math.PI;
          u.pitch = -0.08;
          u.switchT = 0;
        }
      }
      for (const t of e.turrets) t.alive = false;
      e.scene.updateMatrixWorld(true);
    });
    await until(
      () =>
        last[0].units.find((u) => u.team === "B" && u.idx === 0).pos[2] > 249,
      "固定位置の同期",
    );
    const before = last[0].units.find((u) => u.team === "B" && u.idx === 0)
      .pos[2];
    await pages[0].keyboard.down("w");
    await delay(900);
    await pages[0].keyboard.up("w");
    await until(
      () =>
        last[0].units.find((u) => u.team === "B" && u.idx === 0).pos[2] <
        before - 1,
      "青プレイヤーの移動",
    );
    const orange = last[0].units.find((u) => u.team === "R" && u.idx === 0);
    assert.ok(Math.abs(orange.pos[2] - 225) < 0.1, "青の入力で橙を動かさない");
    const frame = last[0].frame;
    await until(() => last[1].frame >= frame, "2画面の同期");
    console.log("入力の分離・移動同期: OK");
    await page.evaluate(() => {
      const e = window.__roomAuthorityAdapter.engine;
      for (const team of ["B", "R"]) {
        const u = e.units.find((u) => u.team === team && u.idx === 0);
        e.placeGadget(
          { team, owner: u, spec: e.weapon("sensor").proj },
          u.pos.clone(),
        );
        e.launchDrone(u, e.weapon("drone").drone);
      }
    });
    await until(
      () => last.every((s) => s.gadgets.length >= 2 && s.drones.length >= 2),
      "設置物と偵察機の同期",
    );
    for (const p of pages) await p.keyboard.press("m");
    for (const p of pages) await p.waitForSelector("#bigMap:not([hidden])");
    await delay(200);
    for (const p of pages) await p.keyboard.press("m");
    console.log("センサー・偵察機・全体マップの表示: OK");
    await page.evaluate(() => {
      const e = window.__roomAuthorityAdapter.engine;
      const b = e.units.find((u) => u.team === "B" && u.idx === 0),
        r = e.units.find((u) => u.team === "R" && u.idx === 0);
      b.pos.set(0, 0, 250);
      r.pos.set(0, 0, 225);
      b.yaw = 0;
      b.pitch = -0.08;
      r.hp = 1000;
      r.invulT = 0;
      b.invulT = 0;
      for (const u of [b, r]) {
        u.vel.set(0, 0, 0);
        u.group.position.copy(u.pos);
      }
      e.scene.updateMatrixWorld(true);
    });
    const ammo = last[0].units.find((u) => u.team === "B" && u.idx === 0).slots
      .main.ammo;
    await pages[0].mouse.move(480, 300);
    await pages[0].mouse.down();
    await until(
      () =>
        last[0].units.find((u) => u.team === "B" && u.idx === 0).slots.main
          .ammo < ammo,
      "主武器の射撃",
    );
    await until(
      () => !last[0].units.find((u) => u.team === "R" && u.idx === 0).alive,
      "対人射撃による撃破",
      15000,
    );
    await pages[0].mouse.up();
    await until(
      () => !last[1].units.find((u) => u.team === "R" && u.idx === 0).alive,
      "橙側の撃破同期",
    );
    console.log("対人の射撃・弾薬消費・撃破同期: OK");
    // 撃破待機中の兵装変更が、その人の再出撃にだけ反映される。
    await page.evaluate(() => {
      const r = window.__roomAuthorityAdapter.engine.units.find(
        (u) => u.team === "R" && u.idx === 0,
      );
      r.downT = 0;
      r.respawnT = 4;
    });
    await pages[1].waitForSelector("#rcls:not([hidden])");
    await pages[1].click('#rcls [data-cls="heavy"]');
    await until(
      () =>
        last[0].units.find((u) => u.team === "R" && u.idx === 0).nextCls ===
        "heavy",
      "再出撃の兵装変更",
    );
    await page.evaluate(() => {
      window.__roomAuthorityAdapter.engine.units.find(
        (u) => u.team === "R" && u.idx === 0,
      ).respawnT = 0.1;
    });
    await until(
      () =>
        last.every(
          (s) => s.units.find((u) => u.team === "R" && u.idx === 0).alive,
        ),
      "再出撃の同期",
    );
    const red = last[0].units.find((u) => u.team === "R" && u.idx === 0),
      blue = last[0].units.find((u) => u.team === "B" && u.idx === 0);
    assert.ok(red.hp > 0);
    assert.equal(red.cls, "heavy");
    assert.equal(red.slots.main.w, "gatling");
    assert.equal(blue.cls, "assault");
    assert.equal(blue.slots.main.w, "ar");
    console.log("再出撃・耐久回復・プレイヤー別の兵装と装備: OK");
    // 両陣営の勝敗とコア表示が自軍基準になること。
    await page.evaluate(() => {
      const e = window.__roomAuthorityAdapter.engine;
      e.cores.B.hp = 100;
      e.cores.R.hp = 50;
      e.time = 0.01;
    });
    await until(() => last.every((s) => s.ended), "試合終了");
    await until(
      async () =>
        /勝利/.test(await pages[0].textContent("#ovTitle")) &&
        /敗北/.test(await pages[1].textContent("#ovTitle")),
      "勝敗画面",
    );
    console.log("両軍の勝敗表示: OK");
    await pages[0].click("#start");
    await pages[0].click("#netRematch");
    await until(() => room.phase === "lobby", "再戦の準備");
    for (const p of pages) await p.click("#netReady");
    last[0] = last[1] = null;
    await pages[0].click("#netStart");
    await until(
      () =>
        last.every(
          (s) =>
            s && !s.ended && s.players.length === 2 && s.units.length === 20,
        ),
      "2試合目の開始",
      60000,
    );
    console.log("同じ部屋で2試合目を開始: OK");
    await pages[0]
      .getByRole("button", { name: "オンラインの部屋へ", exact: true })
      .click();
    await pages[0].click("#netLeave");
    await until(
      () =>
        room.players.size === 1 &&
        room.host === room.players.keys().next().value,
      "部屋主の引継ぎ",
    );
    await until(() => last[1].players.length === 1, "部屋主退出後も試合を継続");
    assert.equal(room.phase, "match");
    console.log("部屋主退出後も試合を継続: OK");
    assert.deepEqual(errors, []);
    console.log(
      `ブラウザエラー: 0 / 受信フレーム: ${frames.join(", ")} / 平均スナップショット: ${Math.round(bytes / states)} bytes（圧縮前）`,
    );
  } finally {
    for (const ws of sockets) ws.terminate();
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
