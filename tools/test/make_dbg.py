#!/usr/bin/env python3
"""試験用の dbg.html を作る（Playwright などのヘッドレスブラウザで中身を調べるため）。

使い方: python3 tools/test/make_dbg.py 出力フォルダ [--src 元にするindex.html]
- prototype/index.html を元に、loop の時間刻みを0.05秒に固定し（window.__dt を入れればその値）、botUpdate の頭に frozen の Bot を止める行を足し、
  末尾で window.__g に中身を公開した dbg.html を作る。three.js は vendor/ の物を読むように書き換える。
- sounds.js・music.js・maps.js・parts.js・weapons.js・three.min.js も出力フォルダへコピーする（--src のときも今の prototype/ の物）。マップを変えたら先に tools/build_maps.py を実行する。
- --src を付けると prototype/index.html の代わりにそのファイルを元にする（エンジン側が置き換える前の版を試すとき）。
- --trace を付けると対戦の観測用イベントを出す。ゲームの計算や乱数は変更しない。
- __g には本体の行頭で宣言した関数・変数を全部自動で出す（下の EXTRA・SETTERS を参照）。
"""
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
P = ROOT / "prototype"
CDN_TAG = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
# __g に出す名前（2026-11-04 リファクタ）：index.html の本体の <script> で行頭に宣言した関数・const・let・var・class を全部自動で出す。
# 新しい関数や変数を足しても、ここを書き換える必要はない（Codex との並行作業で、この1行に何百個も並べていた所がいつもぶつかっていた）。
# どれも getter なので、読んだときに初めて評価する（古い版を --src で試しても、無い名前を読まなければ止まらない）。
# 自動で拾えない名前（ブロックの中で宣言した物など）は EXTRA に1行1つで足す。値を書き換えたい変数は SETTERS に1行1つで足す。
EXTRA = [
]
SETTERS = [
    "timeLeft",
    "running",
]
ID = r"[A-Za-z_$][\w$]*"


def declared_names(code):
    """行頭（字下げなし）の宣言から名前を拾う。分割代入（const [a, b] = ...、const {a, b} = ...）と、カンマ区切りの複数宣言も拾う。"""
    names = []

    def add(n):
        if n not in names:
            names.append(n)

    for line in code.split("\n"):
        m = re.match(r"(?:async\s+)?function\s*\*?\s*(" + ID + r")\s*\(", line) or re.match(r"class\s+(" + ID + ")", line)
        if m:
            add(m.group(1))
            continue
        m = re.match(r"(?:const|let|var)\s+(.*)", line)
        if not m:
            continue
        rest, k, depth, start = m.group(1), 0, 0, True
        while k < len(rest):
            ch = rest[k]
            if start:
                start = False
                m2 = re.match(r"\s*(" + ID + ")", rest[k:])
                if m2 and depth == 0:
                    add(m2.group(1))
                    k += m2.end()
                    continue
                m2 = re.match(r"\s*[\[{]", rest[k:])
                if m2:  # 分割代入：対応する括弧の中の名前
                    k += m2.end()
                    d, seg = 1, ""
                    while k < len(rest) and d > 0:
                        c = rest[k]
                        d += c in "[{"
                        d -= c in "]}"
                        if d > 0:
                            seg += c
                        k += 1
                    for part in seg.split(","):
                        part = part.split("=")[0].strip()
                        part = (part.split(":")[1] if ":" in part else part).strip().lstrip(".")
                        if re.fullmatch(ID, part):
                            add(part)
                    continue
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth -= 1
            elif ch in "\"'`":  # 文字列の中のカンマは数えない
                k += 1
                while k < len(rest) and rest[k] != ch:
                    k += 2 if rest[k] == "\\" else 1
            elif rest.startswith("//", k):
                break
            elif ch == "," and depth == 0:
                start = True
            elif ch == ";" and depth == 0:
                break
            k += 1
    return names


def build_expose(html):
    """window.__g を作る1行。本体の <script>（maps.js の後）の中身から名前を拾う。"""
    i = html.index("<script>\n", html.index('src="maps.js"'))
    code = html[i:html.rindex("</script>")]
    names = declared_names(code)
    for n in EXTRA + SETTERS:
        if n not in names:
            names.append(n)
    items = [f"get {n}() {{ return {n}; }}" + (f", set {n}(v) {{ {n} = v; }}" if n in SETTERS else "") for n in names]
    return "window.__g = { " + ", ".join(items) + " };"



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
    EXPOSE = build_expose(s)
    s = rep(s, "const dt = Math.min(0.05, (now - last) / 1000); last = now;", "const dt = window.__dt || 0.05; last = now;")
    s = rep(s, "function botUpdate(u, dt) {\n", "function botUpdate(u, dt) {\n  if (u.frozen) return;\n")
    # Bot戦では選択陣営の1番機も最初から通常Botとして生成し、機体抽選と初動を同じにする。
    # フラグを指定しない通常のデバッグ操作はプレイヤーのまま。
    player_setup = "player = makeUnit(chosenTeam, true, 0);" if "player = makeUnit(chosenTeam, true, 0);" in s else "player = makeUnit('B', true, 0);"
    s = rep(s, player_setup, player_setup.replace("true, 0", "!window.__allBotBattle, 0"))
    # 比較試験では1機ごとの初期乱数を固定し、同じ編成を両陣営へ入れ替える。
    # hook が無い通常の dbg と本体には影響しない。生成・装備・出撃は本体を使う。
    s = rep(s, "function makeUnit(team, isPlayer, idx) {", "function makeUnit(team, isPlayer, idx) {\n  const restoreFixtureRandom = window.__botFixtureRandom?.(team, idx);")
    s = rep(s, "if (isPlayer) spawn(u); else botSpawn(u, true);\n  return u;", "window.__botFixturePhase?.(team, idx, 1);\n  if (isPlayer) spawn(u); else botSpawn(u, true);\n  restoreFixtureRandom?.();\n  return u;")
    s = rep(s, "spawn(u, at);\n  // ベースから出た攻撃役", "spawn(u, at);\n  window.__botFixturePhase?.(u.team, u.idx, 2);\n  // ベースから出た攻撃役")
    s = rep(s, "\nrequestAnimationFrame(loop);\n", "\nrequestAnimationFrame(loop);\n" + EXPOSE + "\n")
    s = rep(s, EXPOSE, EXPOSE + "\nwindow.__allBotSetupVersion = 1;")
    if trace:
        # 元の代入をそのまま残し、前後の実測差と機体の位置だけを読む。
        s = rep(s,
            "if (r.kind === 'core') { scoreCore(by, dmg); r.hp = Math.max(0, r.hp - dmg * CORE_RATE); annCore(r.team); return true; }",
            "if (r.kind === 'core') { const before = r.hp; scoreCore(by, dmg); r.hp = Math.max(0, r.hp - dmg * CORE_RATE); annCore(r.team); window.__battleEvent?.({type:'coreHit', via:'damage', team:r.team, unit:by?.kind === 'unit' ? by.team+(by.idx+1) : null, pos:by?.pos?.toArray(), amount:before-r.hp, raw:dmg}); return true; }")
        s = rep(s,
            "if (ref && ref.kind === 'core' && ref.team !== sh.team && S.core) { scoreCore(sh.owner, S.dmg); ref.hp = Math.max(0, ref.hp - S.dmg * CORE_RATE); annCore(ref.team); hitAny = true; }",
            "if (ref && ref.kind === 'core' && ref.team !== sh.team && S.core) { const before = ref.hp; scoreCore(sh.owner, S.dmg); ref.hp = Math.max(0, ref.hp - S.dmg * CORE_RATE); annCore(ref.team); window.__battleEvent?.({type:'coreHit', via:'blast', team:ref.team, unit:sh.owner?.kind === 'unit' ? sh.owner.team+(sh.owner.idx+1) : null, pos:sh.owner?.pos?.toArray(), amount:before-ref.hp, raw:S.dmg}); hitAny = true; }")
        s = rep(s,
            "cores[v.team].hp = Math.max(0, cores[v.team].hp - (VS ? VS.death : killCore));",
            "const before = cores[v.team].hp;\n  cores[v.team].hp = Math.max(0, cores[v.team].hp - (VS ? VS.death : killCore));\n  window.__battleEvent?.({type:'wreck', team:v.team, unit:v.team+(v.idx+1), pos:v.pos.toArray(), amount:before-cores[v.team].hp});")
        s = rep(s,
            "u.pos.y = terrainH(u.pos.x, u.pos.z);\n}\nfunction spawn(u, at = 'base')",
            "u.pos.y = terrainH(u.pos.x, u.pos.z);\n  window.__battleEvent?.({type:'deploy', unit:u.team+(u.idx+1), team:u.team, at:pl ? pl.id : 'base', reason:u.alive ? 'transfer' : 'respawn', pos:u.pos.toArray()});\n}\nfunction spawn(u, at = 'base')")
        s = rep(s, EXPOSE, EXPOSE + "\nwindow.__battleTraceVersion = 1;")
    s = rep(s, CDN_TAG, '<script src="three.min.js"></script>')
    (out / "dbg.html").write_text(s, encoding="utf-8")
    for f in ("sounds.js", "music.js", "maps.js", "parts.js", "weapons.js"):
        if (P / f).exists():
            shutil.copy(P / f, out / f)
    shutil.copy(ROOT / "vendor" / "three-r128" / "three.min.js", out / "three.min.js")
    print("書き出し:", out / "dbg.html")


if __name__ == "__main__":
    main()
