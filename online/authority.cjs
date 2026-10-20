"use strict";
const { chromium } = require("playwright");
class AuthorityPool {
  constructor(origin, options = {}) {
    this.origin = origin;
    this.options = options;
    this.browser = null;
  }
  async getBrowser() {
    if (!this.browser)
      this.browser = chromium
        .launch({
          headless: true,
          executablePath: process.env.CHROMIUM_PATH || undefined,
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--disable-dev-shm-usage",
          ],
        })
        .then((browser) => {
          browser.on("disconnected", () => {
            this.browser = null;
          });
          return browser;
        })
        .catch((error) => {
          this.browser = null;
          throw error;
        });
    return this.browser;
  }
  async create(config, onState, onError) {
    const browser = await this.getBrowser(),
      context = await browser.newContext({
        viewport: { width: 960, height: 540 },
      });
    const page = await context.newPage();
    let timer = null,
      closed = false,
      failure = null;
    const inputs = new Map();
    try {
      await page.addInitScript(() => {
        window.__roomAuthority = true;
        window.requestAnimationFrame = () => 0;
        window.AudioContext = undefined;
        window.webkitAudioContext = undefined;
      });
      page.on("pageerror", (e) => {
        console.error("対戦エンジン:", e.message);
        failure = e;
        if (!closed && timer) onError("対戦エンジンでエラーが発生しました");
      });
      await page.goto(this.origin(), {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForFunction(() => !!window.__roomAuthorityAdapter, {
        timeout: 30000,
      });
      await page.evaluate(
        (c) => window.__roomAuthorityAdapter.start(c),
        config,
      );
      if (failure) throw failure;
    } catch (e) {
      await context.close();
      throw e;
    }
    const authority = {
      input(id, input) {
        const prev = inputs.get(id);
        if (prev) {
          input.pressed = [...new Set([...prev.pressed, ...input.pressed])];
          input.dx += prev.dx;
          input.dy += prev.dy;
          input.actions = [...prev.actions, ...input.actions].slice(0, 24);
        }
        inputs.set(id, input);
      },
      disconnect(id) {
        if (!closed)
          page
            .evaluate((id) => window.__roomAuthorityAdapter.disconnect(id), id)
            .catch(() => {});
      },
      start() {
        if (timer || closed) return;
        // 1回の処理が50msをわずかに越えても、次の区間を丸ごと捨てない。
        const step = async () => {
          if (closed) return;
          const began = Date.now(),
            batch = [...inputs];
          inputs.clear();
          let ended = false;
          try {
            const state = await page.evaluate(
              (batch) => window.__roomAuthorityAdapter.tick(batch),
              batch,
            );
            ended = state.ended;
            if (!closed) onState(state);
          } catch (error) {
            ended = true;
            if (!closed) {
              console.error(error);
              onError("対戦サーバーとの同期が止まりました");
            }
          }
          if (!closed && !ended)
            timer = setTimeout(step, Math.max(0, 50 - (Date.now() - began)));
        };
        timer = setTimeout(step, 0);
      },
      async close() {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        await context.close();
      },
      // サーバー内の統合試験からだけ使う。HTTP/WSには公開しない。
      page,
    };
    return authority;
  }
  async close() {
    if (this.browser) await (await this.browser).close();
    this.browser = null;
  }
}
module.exports = { AuthorityPool };
