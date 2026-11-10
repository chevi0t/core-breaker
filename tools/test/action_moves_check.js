// #226：仮置きのアクションを、実際の入力・物理・被害処理で確かめる。
// node tools/test/action_moves_check.js [dbg]
const { check } = require('./lib');
check('タックルと蹴り', async ({ page, ev, ok, sortie }) => {
  const saved = await ev(() => {
    const g = __g, ids = ['crouch', 'tackle', 'kick'];
    const before = g.buildRecord();
    document.querySelector('[data-page="pgCustom"]').click();
    for (let i = 0; i < ids.length; i++) {
      g.switchBuild(i); g.renderCustom();
      document.querySelector('#cuActions [data-action="' + ids[i] + '"]').click();
    }
    const record = JSON.parse(localStorage.getItem('coreBreakerBuilds'));
    return { before, record, selected: g.selectedAction };
  });
  ok(saved.record.list.map(b => b.actionId).join() === 'crouch,tackle,kick' && saved.selected === 'kick', '画面で選んだアクションを3構成ごとに保存');
  ok(saved.record.list.every((b, i) => JSON.stringify(b.mech) === JSON.stringify(saved.before.list[i].mech) && JSON.stringify(b.loadout) === JSON.stringify(saved.before.list[i].loadout)), 'アクション選択で既存の機体・武器設定を変えない');
  await page.reload();
  ok(await ev(() => __g.selectedAction === 'kick' && __g.builds.list.map(b => b.actionId).join() === 'crouch,tackle,kick'), '再読み込みしても3構成のアクションを保持');
  ok(await ev(() => {
    const g = __g, record = g.buildRecord();
    for (const b of record.list) delete b.actionId;
    const valid = g.validBuildImport(record);
    g.applyBuildRecord(record, false);
    return valid && g.selectedAction === 'crouch' && g.builds.list.every(b => b.actionId === 'crouch');
  }), 'アクション項目の無い古い設定を読み込むと全構成しゃがみ');
  ok(await ev(() => { const r = __g.buildRecord(); r.list[0].actionId = '__proto__'; return !__g.validBuildImport(r); }), '不正なアクションを含む設定ファイルを拒否');
  await sortie('dock');
  const results = await ev(() => {
    const g = __g, T = g.T, p = g.player, checks = [], stop = new T.Vector3();
    const yes = (value, name) => { if (!value) throw Error(name + '：' + JSON.stringify({ pos: p.pos.toArray(), move: p.actionMove, recovery: p.actionRecoverT, cooldown: p.actionCd, stun: p.stun })); checks.push(name); };
    const near = (a, b, eps = .025) => Math.abs(a - b) <= eps;
    const enemies = g.units.filter(u => u.team !== p.team), ally = g.units.find(u => u !== p && u.team === p.team);
    g.obstacles.length = 0;
    // 元マップの起伏・水・施設から離れた平らな試験台。
    g.obstacles.push({ minX: -150, maxX: 150, minZ: -150, maxZ: 150, top: 200 });
    g.waters.length = 0;
    function reset(id = 'tackle', legs = 'standard', actor = p) {
      for (const u of g.units) { u.alive = false; u.pos.set(10000, 0, 10000); }
      actor.mech = { ...g.MECH_DEFAULT, legs }; g.equip(actor, 'assault'); g.spawn(actor);
      Object.assign(actor, { actionId: id, alive: true, hp: actor.maxHp, invulT: 0, yaw: 0, pitch: 0,
        onGround: true, actionHeld: false, actionWasHeld: false, actionHeldTime: 0, actionCd: 0,
        actionMove: null, actionRecoverT: 0, actionLandMiss: false, actionPush: null, crouching: false,
        downT: 0, stun: '', stunT: 0, electricT: 0, shockT: 0, recoverT: 0, swing: null,
        repairing: false, transfer: null, planted: false, flying: false, zip: null,
        lungeT: 0, dashT: 0, slideT: 0, longDash: false, charging: false, jumpBuf: 0,
        ctrlLockT: 0, overheat: false, boost: actor.maxBoost, switchT: 0, weapon: 'main' });
      actor.stats = { ...actor.stats, weight: 5000 }; actor.pos.set(0, 200, 20); actor.vel.set(0, 0, 0);
      for (const k in g.keys) g.keys[k] = false;
      return actor;
    }
    function target(u, x, z, weight = 5000, y = 200) {
      Object.assign(u, { alive: true, hp: u.maxHp, invulT: 0, downT: 0, stun: '', stunT: 0,
        electricT: 0, shockT: 0, recovering: false, repairing: false, planted: false,
        flying: false, catLaunch: null, transfer: null, zip: null, swing: null, recoverT: 0,
        actionMove: null, actionRecoverT: 0, actionPush: null, onGround: true, barrierOn: false });
      u.stats = { ...u.stats, weight }; u.pos.set(x, y, z); u.vel.set(0, 0, 0); return u;
    }
    function tick(seconds, hz = 120, actor = p, wish = stop) {
      for (let t = 0; t < seconds - 1e-9;) { const dt = Math.min(1 / hz, seconds - t); g.physics(actor, wish, false, false, dt); t += dt; }
    }
    function finish(actor = p, hz = 120) {
      let n = 0; while (actor.actionMove && n++ < hz * 3) tick(1 / hz, hz, actor);
      yes(n < hz * 3, actor.actionId + 'の動作が終了する');
    }
    yes(['crouch', 'tackle', 'kick'].every(id => g.ACTIONS[id]), '3種類のアクションを定義');
    yes(g.normalizeAction(undefined) === 'crouch' && g.normalizeAction('unknown') === 'crouch' && g.normalizeAction('__proto__') === 'crouch', '未設定・不正なアクションはしゃがみ');
    for (const hz of [30, 60, 120]) {
      reset(); const initial = p.boost;
      yes(g.actionMoveStart(p) && near(initial - p.boost, 20) && near(p.actionCd, 3), hz + 'Hz：タックルは20消費・再使用3秒');
      tick(.35, hz);
      yes(near(p.pos.z, 12) && near(p.pos.x, 0) && !p.actionMove, hz + 'Hz：0.35秒で8m進む');
      yes(near(p.actionRecoverT, .9, 1 / hz + .01), hz + 'Hz：空振り硬直0.9秒');
      const at = p.pos.clone(); tick(.4, hz, p, new T.Vector3(1, 0, 0));
      yes(p.pos.distanceTo(at) < .01, hz + 'Hz：硬直中は移動しない');
    }
    reset(); g.actionMoveStart(p); p.yaw = Math.PI / 2; tick(.35);
    yes(near(p.pos.x, 0) && near(p.pos.z, 12), 'タックルは発動時の方向を維持');
    for (const ratio of [.1, .81, 1, 1.249, 1.25, 4]) {
      reset(); p.stats.weight = 5000 * ratio; const e = target(enemies[0], 0, 16);
      const hp = e.hp, expected = 2000 * Math.max(.7, Math.min(1.4, Math.sqrt(ratio))) * g.armorMult(e);
      g.actionMoveStart(p); finish();
      yes(near(hp - e.hp, expected), 'タックル重量比 ' + ratio + '：平方根と0.7〜1.4倍の威力');
      yes(e.stun === (ratio >= 1.25 ? 'down' : 'stagger'), 'タックル重量比 ' + ratio + '：よろけ／ダウン');
      yes(near(p.actionRecoverT, .5), '命中時の硬直0.5秒');
    }
    for (const state of ['electricT', 'shockT']) {
      reset(); const e = target(enemies[0], 0, 16); e[state] = 1;
      g.actionMoveStart(p); finish(); yes(e.stun === 'down', state + '中の相手は重量比によらずダウン');
    }
    reset(); const first = target(enemies[0], 0, 16), second = target(enemies[1], 0, 13), friend = target(ally, 0, 18);
    const hps = [first.hp, second.hp, friend.hp]; g.actionMoveStart(p); finish();
    yes(first.hp < hps[0] && second.hp === hps[1] && friend.hp === hps[2], '味方を無視し、最初の敵1機だけに当たる');
    reset(); g.obstacles.push({ minX: -10, maxX: 10, minZ: 14, maxZ: 15, top: 220 });
    g.actionMoveStart(p); finish(); yes(p.pos.z > 15, 'タックルは壁を通り抜けない'); g.obstacles.pop();
    for (const id of ['tackle', 'kick']) {
      for (const state of [{ boost: id === 'tackle' ? 19 : 9 }, { overheat: true }, { repairing: true },
        { planted: true }, { transfer: {} }, { downT: 1 }, { alive: false }, { stun: 'stagger' },
        { electricT: 1 }, { swing: {} }, { recoverT: .5 }, { lungeT: 1 }, { flying: true }, { zip: {} }, { actionCd: 1 }]) {
        reset(id); Object.assign(p, state); const fuel = p.boost;
        yes(!g.actionMoveStart(p) && p.boost === fuel, id + '：' + Object.keys(state)[0] + 'では発動・消費しない');
      }
      reset(id); g.actionMoveStart(p);
      const sl = p.slots.main, ammo = sl.ammo;
      g.weaponsTick(p, .01, true, p.pos.clone().add(new T.Vector3(0, 2, -50)), 0);
      yes(sl.ammo === ammo, id + 'の動作中は射撃不可');
      p.weapon = 'aux'; g.weaponsTick(p, .01, true, p.pos.clone().add(new T.Vector3(0, 2, -50)), 0);
      yes(!p.swing, id + 'の動作中は格闘武器も振れない'); p.weapon = 'main'; finish();
      g.weaponsTick(p, .01, true, p.pos.clone().add(new T.Vector3(0, 2, -50)), 0);
      yes(sl.ammo === ammo && !g.shortDash(p, new T.Vector3(1, 0, 0)), id + 'の硬直中は射撃・ダッシュ不可');
      yes(!g.actionMoveStart(p), id + 'の再使用中は連発不可');
      tick(4); yes(g.actionMoveStart(p), id + 'の再使用時間後は再発動可能');
    }
    reset(); p.onGround = false; p.pos.y = 230; yes(!g.actionMoveStart(p), '空中ではタックル不可');
    reset('kick'); const e = target(enemies[0], 0, 17.5), hp = e.hp, z = e.pos.z, fuel = p.boost;
    yes(g.actionMoveStart(p) && near(fuel - p.boost, 10) && near(p.actionCd, 1.5), '蹴りは10消費・再使用1.5秒');
    tick(.19); yes(e.hp === hp, '蹴りの発生前0.19秒では当たらない'); tick(.02);
    yes(near(hp - e.hp, 1200 * g.armorMult(e)) && e.stun === 'stagger', '蹴りは0.2秒で1200・必ずよろけ');
    tick(.3, 120, e);
    yes(near(z - e.pos.z, 6), '蹴りは6m押し出す');
    finish(); yes(near(p.actionRecoverT, .4, .02), '蹴りの硬直0.4秒');
    reset('kick'); const hit = [target(enemies[0], -1, 18), target(enemies[1], 1, 18)], friendly = target(ally, 0, 18);
    const all = [...hit, friendly], before = all.map(u => u.hp); g.actionMoveStart(p); tick(.21);
    yes(hit.every((u, i) => u.hp < before[i]) && friendly.hp === before[2], '蹴りの扇は複数の前方敵に当たり、味方には当たらない');
    for (const [x, z, label] of [[0, 22, '後方'], [0, 14, '3mより遠方'], [2.5, 19, '全幅90度の扇の外']]) {
      reset('kick'); const outside = target(enemies[0], x, z), outsideHp = outside.hp;
      g.actionMoveStart(p); tick(.21); yes(outside.hp === outsideHp, '蹴りは' + label + 'に当たらない');
    }
    for (const id of ['tackle', 'kick']) {
      reset(id, 'skimmer'); const e = target(enemies[0], 0, id === 'kick' ? 18 : 16), hp = e.hp;
      g.actionMoveStart(p); finish();
      yes(near(hp - e.hp, (id === 'tackle' ? 2000 : 1200) * .8 * g.armorMult(e)), 'ホバーの' + id + 'は威力0.8倍');
    }
    reset('tackle', 'skimmer'); g.actionMoveStart(p); tick(.35); yes(near(20 - p.pos.z, 10.4), 'ホバーのタックルは距離1.3倍');
    reset('kick'); p.onGround = false; p.pos.y = 230; g.actionMoveStart(p); tick(.2); const from = p.pos.clone(); finish();
    const delta = p.pos.clone().sub(from);
    yes(near(delta.length(), 6, .12) && near(-delta.y, -delta.z, .12), '空中蹴りは約45度下へ6m進む');
    yes(p.actionLandMiss, '空中蹴りの空振りは着地待ち');
    let landed = false; for (let i = 0; i < 500; i++) { tick(1 / 120); if (p.onGround) { landed = true; break; } }
    yes(landed && near(p.actionRecoverT, .6, .03), '空振り着地で0.6秒の硬直');
    reset('kick'); p.onGround = false; p.pos.y = 206; const airEnemy = target(enemies[0], 0, 16, 5000, 202);
    g.actionMoveStart(p); finish(); yes(airEnemy.stun === 'down' && !p.actionLandMiss, '空中蹴りの命中はダウン、着地失敗硬直なし');
    reset(); p.actionHeld = true; tick(.01); yes(!!p.actionMove, 'Cの押下から物理処理で発動');
    tick(4); yes(!p.actionMove && p.actionCd === 0, 'Cを押し続けても再使用後に連発しない');
    p.actionHeld = false; tick(.01); p.actionHeld = true; tick(.01); yes(!!p.actionMove, 'Cを離して押し直すと再発動');
    // コア・施設・設置物が射程内にあっても損傷させない。
    for (const id of ['tackle', 'kick']) {
      reset(id);
      const gadget = { gadget: true, kind: 'mine', team: p.team === 'B' ? 'R' : 'B', alive: true, hp: 1000, pos: p.pos.clone() };
      g.gadgets.push(gadget);
      const props = [...Object.values(g.cores), ...g.turrets, ...g.radars, ...g.gadgets].filter(o => o?.pos);
      const saved = props.map(o => ({ o, pos: o.pos.clone(), hp: o.hp }));
      for (const o of props) o.pos.copy(p.pos).add(new T.Vector3(0, 0, -2));
      g.actionMoveStart(p); finish();
      yes(saved.every(s => s.o.hp === s.hp), id + 'はコア・施設・設置物に損傷を与えない');
      for (const s of saved) s.o.pos.copy(s.pos);
      g.gadgets.splice(g.gadgets.indexOf(gadget), 1);
    }
    for (const id of ['tackle', 'kick']) {
      reset(id, 'skimmer'); p.onGround = false; p.pos.y = 280;
      // 再使用中でも長押しの急降下は使える。蹴り移動と重力を分けて調べる。
      p.actionCd = 2; p.actionHeld = true; tick(.24);
      yes(p.vel.y >= -6.01, id + '選択のホバーはCを0.24秒押しても急降下しない');
      tick(.15); yes(p.vel.y < -6.1, id + '選択のホバーは0.25秒以上の長押しで急降下');
      p.actionHeld = false; tick(.1); yes(p.vel.y >= -6.01, id + '選択でもCを離すと降下上限に戻る');
    }
    // 別の操作で攻撃を中断し、必要な硬直だけを踏み倒せない。
    for (const id of ['tackle', 'kick']) {
      reset(id); p.invulT = 5;
      yes(g.actionMoveStart(p) && p.invulT === 0, id + 'の発動で出撃直後の無敵を解除');
      const move = p.actionMove, fuel = p.boost;
      p.slots.sp = g.slotOf('cannon'); g.selectWeapon(p, 'sp');
      yes(p.weapon === 'main' && !p.planted && p.actionMove === move, id + '中は構える武器への切替で中断できない');
      p.slots.sp = g.slotOf('charger');
      const spCd = p.slots.sp.cd;
      g.toggleSp(p);
      yes(!p.chargerOn && p.slots.sp.cd === spCd && p.actionMove === move, id + '中は特別装備の切替で中断できない');
      const line = { bottom: p.pos.clone(), dir: new T.Vector3(0, 1, 0), len: 20 };
      g.ziplines.push(line); p.zipCd = 0;
      yes(!!g.zipNear(p) && !g.zipGrab(p) && !p.zip && p.actionMove === move, id + '中は掴める綱があってもジップラインへ移れない');
      g.ziplines.splice(g.ziplines.indexOf(line), 1);
      yes(!g.startTransfer(p, 'base') && !p.transfer && p.actionMove === move && p.boost === fuel, id + '中は転送で動作・費用を取り消せない');
      finish(); yes(p.actionRecoverT > 0, id + 'は操作による中断を試みても所定の硬直に入る');
      reset(id); target(enemies[0], 0, 18); g.actionMoveStart(p); finish();
      const hitRecovery = p.actionRecoverT, ammo = p.slots.main.ammo;
      p.actionCd = 0; // 再使用時間とは独立に、命中硬直自体が再発動を止める。
      g.weaponsTick(p, .01, true, p.pos.clone().add(new T.Vector3(0, 2, -50)), 0);
      yes(hitRecovery > 0 && p.slots.main.ammo === ammo && !g.actionMoveStart(p), id + 'の命中後硬直は射撃・新アクションを止める');
    }
    reset('kick'); const pushed = target(enemies[0], 0, 17.5), pushedFrom = pushed.pos.z;
    g.obstacles.push({ minX: -10, maxX: 10, minZ: 13, maxZ: 14, top: 220 });
    g.actionMoveStart(p); tick(.21); tick(.3, 120, pushed);
    yes(pushed.pos.z > 14 && pushed.pos.z < pushedFrom && pushedFrom - pushed.pos.z < 6 && !pushed.actionPush, '蹴りの押し出しは壁で止まり、壁を越えない');
    g.obstacles.pop();
    reset('kick'); p.onGround = false; p.pos.y = 206; g.actionMoveStart(p); finish();
    p.jumpBuf = .3;
    let bufferedLanding = false;
    for (let i = 0; i < 500; i++) { tick(1 / 120); if (p.onGround) { bufferedLanding = true; break; } }
    yes(bufferedLanding && near(p.actionRecoverT, .6, .03), 'ジャンプ先行入力があっても空振り着地の0.6秒硬直は消えない');
    for (const id of ['tackle', 'kick']) {
      reset(id); const e = target(enemies[0], 0, 17);
      p.slots.sub = g.slotOf('missile'); p.weapon = 'sub';
      const sl = p.slots.sub, entry = { target: e, life: e.lifeId || 0 };
      sl.missileLocks = [entry]; sl.missileQueue = [entry, entry]; sl.bn = 2; sl.cd = 0;
      const ammo = sl.ammo, shells = g.shells.length;
      g.actionMoveStart(p); g.weaponsTick(p, .05, true, e.pos.clone(), 0);
      yes(sl.ammo === ammo && g.shells.length === shells && !sl.bn && !sl.missileQueue.length && !sl.missileLocks.length, id + '中は既存ミサイル斉射予約と捕捉を消して同時発射しない');
    }
    reset('kick'); g.actionMoveStart(p);
    Object.assign(p, { actionHeld: true, actionPressed: true, actionWasHeld: true, actionHeldTime: 1,
      actionLandMiss: true, actionRecoverT: .4, actionPush: { x: 1, z: 0, left: 6, time: .3 } });
    g.kill(p, p, false);
    yes(!p.alive && !p.actionMove && !p.actionHitUnits && !p.actionPush && !p.actionRecoverT && !p.actionLandMiss && !p.actionHeld && !p.actionWasHeld && !p.actionPressed && !p.actionHeldTime, '死亡時にアクション動作・入力・押し出し・着地待ちを解除');
    Object.assign(p, { actionCd: 2, actionRecoverT: .6, actionHeld: true, actionPressed: true, actionWasHeld: true,
      actionHeldTime: 1, actionMove: { id: 'kick' }, actionHitUnits: new Set(), actionLandMiss: true,
      actionPush: { x: 1, z: 0, left: 6, time: .3 } });
    g.spawn(p);
    yes(p.alive && !p.actionCd && !p.actionMove && !p.actionHitUnits && !p.actionPush && !p.actionRecoverT && !p.actionLandMiss && !p.actionHeld && !p.actionWasHeld && !p.actionPressed && !p.actionHeldTime, '再出撃時に再使用時間を含む全アクション状態を初期化');
    const bot = enemies[0], victim = p, random = Math.random;
    try {
      for (const id of ['tackle', 'kick']) {
        reset(id, 'standard', bot); target(victim, 0, 18); victim.planted = true; bot.target = victim;
        Math.random = () => 0;
        g.botActionMove(bot, .1);
        yes(!!bot.actionMove && bot.boost < bot.maxBoost, 'Botは隙のある射程内の敵に' + id + 'を同じ消費で使う');
        reset(id, 'standard', bot); target(victim, 0, -30); victim.planted = true; bot.target = victim;
        g.botActionMove(bot, .1); yes(!bot.actionMove, 'Botは射程外で' + id + 'を使わない');
        reset(id, 'standard', bot); target(victim, 0, 18); victim.planted = true; bot.target = victim; bot.boost = 0;
        g.botActionMove(bot, .1); yes(!bot.actionMove, 'Botもブースト不足では' + id + 'を使えない');
        reset(id, 'standard', bot); target(victim, 0, 18); victim.planted = true; bot.target = victim;
        Math.random = () => .999999;
        g.botActionMove(bot, .1); yes(!bot.actionMove, 'Botの' + id + '発動には確率制限がある');
      }
      reset('crouch', 'standard', bot); target(victim, 0, 18); victim.planted = true; bot.target = victim; Math.random = () => 0;
      g.botActionMove(bot, .1); yes(!bot.actionMove && !bot.actionHeld && !bot.crouching, 'しゃがみを選んだBotは自発的に使わない');
    } finally { Math.random = random; }
    return checks;
  });
  for (const name of results) ok(true, name);
});
