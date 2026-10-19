#!/usr/bin/env python3
"""試験用の dbg.html を作る（Playwright などのヘッドレスブラウザで中身を調べるため）。

使い方: python3 tools/test/make_dbg.py 出力フォルダ [--src 元にするindex.html]
- prototype/index.html を元に、loop の時間刻みを0.05秒に固定し（window.__dt を入れればその値）、botUpdate の頭に frozen の Bot を止める行を足し、
  末尾で window.__g に中身を公開した dbg.html を作る。three.js は vendor/ の物を読むように書き換える。
- sounds.js・music.js・maps.js・three.min.js も出力フォルダへコピーする。マップを変えたら先に tools/build_maps.py を実行する。
- --src を付けると prototype/index.html の代わりにそのファイルを元にする（エンジン側が置き換える前の版を試すとき）。
- --trace を付けると対戦の観測用イベントを出す。ゲームの計算や乱数は変更しない。
- Botの通り道を調べる navPath・navNear・clearPath と NAV、橋（bridges）、水面（waters）、renderer も __g に出す。
- 機体カスタマイズ（v0.11）の ARMORY・loadout・toggleSp・detonateRemotes・weaponsTick・slotOf も出す（それより前の版では読むと止まるので getter にしてある）。
"""
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
P = ROOT / "prototype"
CDN_TAG = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
EXPOSE = """window.__g = { get player() { return player; }, units, lock, T, cores, plants, turrets, pods, catapults, shells, barricades, fx, WEAPONS, CLASSES,
  equip, selectWeapon, pickClass, destroyTurret, kill, spawn, setup, loop, get ended() { return ended; }, obstacles, TEAM, terrainH, terrainHit, castFrom, gadgets, drones, spotted, SLOTS,
  physics, damage, radars, SC, impact, keys, blast, shoot, shot, repairTick, MAPS, buildMap, selectMap, showPage, PLANT_R, resetPlants,
  navPath, navNear, clearPath, buildNav, groundAt, botUpdate, launch, renderer, get pathEndH() { return pathEndH; }, get NAV() { return NAV; }, get bridges() { return bridges; }, get waters() { return waters; },
  get curMap() { return curMap; }, get mapId() { return mapId; }, get MATCH() { return MATCH; },
  get timeLeft() { return timeLeft; }, set timeLeft(v) { timeLeft = v; },
  get ARMORY() { return ARMORY; }, get loadout() { return loadout; }, get toggleSp() { return toggleSp; }, get detonateRemotes() { return detonateRemotes; },
  get weaponsTick() { return weaponsTick; }, get slotOf() { return slotOf; },
  get PARTS() { return PARTS; }, get mechCfg() { return mechCfg; }, get mechStats() { return mechStats; }, get MECH_DEFAULT() { return MECH_DEFAULT; },
  get botMech() { return botMech; }, get renderCustom() { return renderCustom; },
  get jumpPads() { return jumpPads; }, get lifts() { return lifts; }, get jumpPadUpdate() { return jumpPadUpdate; }, get liftUpdate() { return liftUpdate; },
  get resetMobility() { return resetMobility; }, get botMobilityGoal() { return botMobilityGoal; },
  get buildMech() { return buildMech; }, get disposeMech() { return disposeMech; },
  get hittables() { return hittables; }, get fire() { return fire; }, get mechRig() { return mechRig; } };"""


def rep(s, a, b):
    if s.count(a) != 1:
        sys.exit(f"index.html の形が変わっていて dbg.html を作れません: {a[:50]}")
    return s.replace(a, b)


def main():
    args = sys.argv[1:]
    trace = "--trace" in args
    if trace:
        args.remove("--trace")
    src = P / "index.html"
    if "--src" in args:
        i = args.index("--src")
        src = pathlib.Path(args[i + 1])
        del args[i:i + 2]
    if not args:
        sys.exit(__doc__)
    out = pathlib.Path(args[0])
    out.mkdir(parents=True, exist_ok=True)
    s = src.read_text(encoding="utf-8")
    s = rep(s, "const dt = Math.min(0.05, (now - last) / 1000); last = now;", "const dt = window.__dt || 0.05; last = now;")
    s = rep(s, "function botUpdate(u, dt) {\n", "function botUpdate(u, dt) {\n  if (u.frozen) return;\n")
    s = rep(s, "\nrequestAnimationFrame(loop);\n", "\nrequestAnimationFrame(loop);\n" + EXPOSE + "\n")
    if trace:
        # 元の代入をそのまま残し、前後の実測差と機体の位置だけを読む。
        s = rep(s,
            "if (r.kind === 'core') { scoreCore(by, dmg); r.hp = Math.max(0, r.hp - dmg * CORE_RATE); annCore(r.team); return true; }",
            "if (r.kind === 'core') { const before = r.hp; scoreCore(by, dmg); r.hp = Math.max(0, r.hp - dmg * CORE_RATE); annCore(r.team); window.__battleEvent?.({type:'coreHit', via:'damage', team:r.team, unit:by?.kind === 'unit' ? by.team+(by.idx+1) : null, pos:by?.pos?.toArray(), amount:before-r.hp, raw:dmg}); return true; }")
        s = rep(s,
            "if (ref && ref.kind === 'core' && ref.team !== sh.team && S.core) { scoreCore(sh.owner, S.dmg); ref.hp = Math.max(0, ref.hp - S.dmg * CORE_RATE); annCore(ref.team); hitAny = true; }",
            "if (ref && ref.kind === 'core' && ref.team !== sh.team && S.core) { const before = ref.hp; scoreCore(sh.owner, S.dmg); ref.hp = Math.max(0, ref.hp - S.dmg * CORE_RATE); annCore(ref.team); window.__battleEvent?.({type:'coreHit', via:'blast', team:ref.team, unit:sh.owner?.kind === 'unit' ? sh.owner.team+(sh.owner.idx+1) : null, pos:sh.owner?.pos?.toArray(), amount:before-ref.hp, raw:S.dmg}); hitAny = true; }")
        s = rep(s,
            "cores[v.team].hp = Math.max(0, cores[v.team].hp - (VS ? VS.death : KILL_CORE));",
            "const before = cores[v.team].hp;\n  cores[v.team].hp = Math.max(0, cores[v.team].hp - (VS ? VS.death : KILL_CORE));\n  window.__battleEvent?.({type:'wreck', team:v.team, unit:v.team+(v.idx+1), pos:v.pos.toArray(), amount:before-cores[v.team].hp});")
        s = rep(s,
            "u.pos.y = terrainH(u.pos.x, u.pos.z);\n}\nfunction spawn(u, at = 'base')",
            "u.pos.y = terrainH(u.pos.x, u.pos.z);\n  window.__battleEvent?.({type:'deploy', unit:u.team+(u.idx+1), team:u.team, at:pl ? pl.id : 'base', reason:u.alive ? 'transfer' : 'respawn', pos:u.pos.toArray()});\n}\nfunction spawn(u, at = 'base')")
        s = rep(s, EXPOSE, EXPOSE + "\nwindow.__battleTraceVersion = 1;")
    s = rep(s, CDN_TAG, '<script src="three.min.js"></script>')
    (out / "dbg.html").write_text(s, encoding="utf-8")
    for f in ("sounds.js", "music.js", "maps.js"):
        if (P / f).exists():
            shutil.copy(P / f, out / f)
    shutil.copy(ROOT / "vendor" / "three-r128" / "three.min.js", out / "three.min.js")
    print("書き出し:", out / "dbg.html")


if __name__ == "__main__":
    main()
