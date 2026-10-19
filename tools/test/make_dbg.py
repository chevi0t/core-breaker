#!/usr/bin/env python3
"""試験用の dbg.html を作る（Playwright などのヘッドレスブラウザで中身を調べるため）。

使い方: python3 tools/test/make_dbg.py 出力フォルダ [--src 元にするindex.html]
- prototype/index.html を元に、loop の時間刻みを0.05秒に固定し（window.__dt を入れればその値）、botUpdate の頭に frozen の Bot を止める行を足し、
  末尾で window.__g に中身を公開した dbg.html を作る。three.js は vendor/ の物を読むように書き換える。
- sounds.js・music.js・maps.js・three.min.js も出力フォルダへコピーする。マップを変えたら先に tools/build_maps.py を実行する。
- --src を付けると prototype/index.html の代わりにそのファイルを元にする（エンジン側が置き換える前の版を試すとき）。
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
  equip, selectWeapon, pickClass, destroyTurret, kill, spawn, obstacles, TEAM, terrainH, terrainHit, castFrom, gadgets, drones, spotted, SLOTS,
  physics, damage, radars, SC, impact, keys, blast, shoot, shot, repairTick, MAPS, buildMap, selectMap, showPage, PLANT_R, resetPlants,
  navPath, navNear, clearPath, renderer, get NAV() { return NAV; }, get bridges() { return bridges; }, get waters() { return waters; },
  get curMap() { return curMap; }, get mapId() { return mapId; }, get MATCH() { return MATCH; },
  get timeLeft() { return timeLeft; }, set timeLeft(v) { timeLeft = v; },
  get ARMORY() { return ARMORY; }, get loadout() { return loadout; }, get toggleSp() { return toggleSp; }, get detonateRemotes() { return detonateRemotes; },
  get weaponsTick() { return weaponsTick; }, get slotOf() { return slotOf; },
  get PARTS() { return PARTS; }, get mechCfg() { return mechCfg; }, get mechStats() { return mechStats; }, get MECH_DEFAULT() { return MECH_DEFAULT; },
  get botMech() { return botMech; }, get renderCustom() { return renderCustom; },
  get buildMech() { return buildMech; }, get disposeMech() { return disposeMech; },
  get hittables() { return hittables; }, get fire() { return fire; }, get mechRig() { return mechRig; },
  get specialTick() { return specialTick; }, get barrierAbsorb() { return barrierAbsorb; }, get barrierReady() { return barrierReady; }, get postTick() { return postTick; }, get postFlightTick() { return postFlightTick; }, get postFieldTick() { return postFieldTick; }, get botAct() { return botAct; }, get removeGadget() { return removeGadget; }, get gadgetUpdate() { return gadgetUpdate; }, get revive() { return revive; }, get wreck() { return wreck; }, get canRevive() { return canRevive; }, get downTick() { return downTick; },
  get auxiliaryStatusTick() { return auxiliaryStatusTick; }, get radarToolTick() { return radarToolTick; }, get planarSensorTick() { return planarSensorTick; }, get ammoBoxTick() { return ammoBoxTick; }, get needsAmmo() { return needsAmmo; }, get placeGadget() { return placeGadget; }, get swordTick() { return swordTick; }, get weaponLook() { return weaponLook; }, get camera() { return camera; }, get tagsHud() { return tagsHud; }, get updateCamera() { return updateCamera; },
  get bladeSweep() { return bladeSweep; },
  get mechPose() { return mechPose; }, get resetMechPose() { return resetMechPose; }, get muzzle() { return muzzle; }, get land() { return land; }, get jolt() { return jolt; },
  get heatFields() { return heatFields; }, get chains() { return chains; }, get secondaryBurst() { return secondaryBurst; }, get secondaryUpdate() { return secondaryUpdate; }, get clearSecondaryEffects() { return clearSecondaryEffects; }, get startChain() { return startChain; }, get shellUpdate() { return shellUpdate; }, get scopePower() { return scopePower; }, get wStats() { return wStats; }, get itemNums() { return itemNums; },
  get barrages() { return barrages; }, get artilleryTick() { return artilleryTick; }, get artilleryUpdate() { return artilleryUpdate; }, get artilleryConfirm() { return artilleryConfirm; }, get isArtilleryMode() { return isArtilleryMode; }, get stopArtillery() { return stopArtillery; }, get clearArtillery() { return clearArtillery; }, get artillerySurface() { return artillerySurface; }, get drawBigMap() { return drawBigMap; }, get playerUpdate() { return playerUpdate; }, get mapCur() { return mapCur; }, get startTransfer() { return startTransfer; }, get shortDash() { return shortDash; },
  get barrierAxis() { return barrierAxis; }, get hud() { return hud; }, get running() { return running; }, set running(v) { running = v; } };"""


def rep(s, a, b):
    if s.count(a) != 1:
        sys.exit(f"index.html の形が変わっていて dbg.html を作れません: {a[:50]}")
    return s.replace(a, b)


def main():
    args = sys.argv[1:]
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
    s = rep(s, CDN_TAG, '<script src="three.min.js"></script>')
    (out / "dbg.html").write_text(s, encoding="utf-8")
    for f in ("sounds.js", "music.js", "maps.js"):
        if (P / f).exists():
            shutil.copy(P / f, out / f)
    shutil.copy(ROOT / "vendor" / "three-r128" / "three.min.js", out / "three.min.js")
    print("書き出し:", out / "dbg.html")


if __name__ == "__main__":
    main()
