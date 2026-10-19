#!/usr/bin/env python3
"""マップの平らな所に、ゆるい起伏（hill の小山とくぼみ）を敷き詰めて、prototype/maps/<id>.js の terrain に書き込む。

使い方: python3 tools/gen_rough.py <id> [--seed N] [--dry]
- ユーザーの指摘（2026-10-19「全体的に地面が平面だから横エイムだけでヘッドショット入っちゃう」「地形もうちょいどうにかならんかな」）で作った。
  地面の高さが場所ごとに1〜4mずつ違えば、相手の頭の高さも変わり、縦にも狙いを合わせることになる。
- 書くのは terrain の中の「起伏ここから」〜「起伏ここまで」の行だけ（無ければ terrain: [ の次の行に足す）。何度でも作り直せる。
  作り直す時は、前の起伏を外したマップで場所を決める。
- 置かない所：もとの地形（高台・坂・谷）の上（小山の裾はかかってよい）、プラントの占拠範囲（半径16m。小山とくぼみの裾はかかってよい）、ポッド、カタパルトの台、砲台、
  バリケード、橋と水面の周り、石壁・塔、家の周り（住宅地）、paved に書いた道路・広場、高さ付きの nav の節点、ベースの境目より奥（エンジンがどのみち平らにする）。
  道路や住宅地がでこぼこなのは不自然（ユーザー 2026-10-19「道路とか住宅地とかはデコボコしてたら不自然なので、そこらへん区別しないと」）。
- 小山は高さ1.5〜4m・半径11〜24m、くぼみは深さ1〜2.2m・半径11〜20m。どれも傾き0.4以下（登れない壁は1.1）で、歩いて越えられる。
- 点対称：自軍側（z≥0）にだけ置き、敵軍側はエンジンが点対称に足す。
"""
import json, math, random, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "prototype" / "maps"
BEGIN, END = "// 起伏ここから", "// 起伏ここまで"
PLANT_R = 16

args = sys.argv[1:]
if not args: sys.exit(__doc__)
mid = args[0]
seed = int(args[args.index("--seed") + 1]) if "--seed" in args else sum(map(ord, mid))
dry = "--dry" in args
path = SRC / f"{mid}.js"
text = path.read_text(encoding="utf-8")

# 前の起伏を外す
lines = text.split("\n")
if any(BEGIN in l for l in lines):
    b = next(i for i, l in enumerate(lines) if BEGIN in l)
    e = next(i for i, l in enumerate(lines) if END in l)
    del lines[b:e + 1]
base_text = "\n".join(lines)

js = f"global.window={{}};eval({json.dumps(base_text)});console.log(JSON.stringify(window.MAP_DATA[{json.dumps(mid)}]))"
d = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)

def smooth(t): return 0 if t <= 0 else 1 if t >= 1 else t * t * (3 - 2 * t)
def mirrored(f):
    if f["type"] == "ramp": return {**f, "x0": -f["x1"], "x1": -f["x0"], "z0": -f["z0"], "z1": -f["z1"]}
    if f["type"] == "trench": return {**f, "x": -f["x"], "z0": -f["z1"], "z1": -f["z0"]}
    return {**f, "x": -f["x"], "z": -f["z"]}
fs = [g for f in d["terrain"] for g in ([f] if f.get("x") == 0 and f.get("z") == 0 else [f, mirrored(f)])]
def featureH(f, x, z):  # index.html の featureH と同じ
    t = f["type"]
    if t == "mesa": return f["h"] * (1 - smooth((math.hypot(x - f["x"], z - f["z"]) - f["r"]) / f["slope"]))
    if t == "block":
        dd = math.hypot(max(0, abs(x - f["x"]) - f["hx"]), max(0, abs(z - f["z"]) - f["hz"]))
        return f["h"] * (1 - smooth(dd / f["slope"]))
    if t == "ramp":
        tt = (z - f["z0"]) / (f["z1"] - f["z0"])
        if tt < 0 or tt > 1: return 0
        side = max(0, f["x0"] - x, x - f["x1"])
        return f["h"] * (1 - tt) * (1 - smooth(side / 1.5))
    if t == "hill":
        dd = math.hypot(x - f["x"], z - f["z"])
        return 0 if dd >= f["r"] else f["h"] * (1 + math.cos(math.pi * dd / f["r"])) / 2
    dz = max(0, min(f["z0"], f["z1"]) - z, z - max(f["z0"], f["z1"]))
    return f["h"] * (1 - smooth(math.hypot(max(0, abs(x - f["x"]) - f["w"]), dz) / f["slope"]))
def H(x, z): return sum(abs(featureH(f, x, z)) for f in fs)

mx, mz = d["size"]
L = d["baseLine"]
both = lambda pts: [p for (x, z) in pts for p in ((x, z), (-x, -z))]
circles = []  # (x, z, 半径) 起伏の足元がかかってはいけない円
rects = []    # (x0, x1, z0, z1) 同じく長方形
plant_c = [(p[1], p[2]) for p in d.get("plants", [])]  # 占拠の円には足元の外側（低い所）だけかかってよい
for p in d.get("plantPods", []): circles.append((p[1], p[2], 6))
for x, z in both([tuple(p[:2]) for p in d.get("basePods", [])] + [tuple(p[:2]) for p in d.get("turrets", [])]): circles.append((x, z, 6))
for c in d.get("catapults", []):
    if len(c) > 4: circles.append((c[0], c[1], 8))  # プラントの台は書いたまま
    else:
        for x, z in both([(c[0], c[1])]): circles.append((x, z, 8))
for x, z, w, dd, *_ in d.get("barricades", []):
    for sx, sz in both([(x, z)]): rects.append((sx - w / 2 - 4, sx + w / 2 + 4, sz - dd / 2 - 4, sz + dd / 2 + 4))
for x, z, w, dd, *_ in d.get("bridges", []):
    for sx, sz in both([(x, z)]): rects.append((sx - w / 2 - 12, sx + w / 2 + 12, sz - dd / 2 - 12, sz + dd / 2 + 12))
for x, z, hx, hz, *_ in d.get("water", []):
    for sx, sz in both([(x, z)]): rects.append((sx - hx - 5, sx + hx + 5, sz - hz - 5, sz + hz + 5))
for o in d.get("layout", []):
    # 石壁・塔は3m、家は通りの分も入れて6m空ける（家の並ぶ所は住宅地なので平ら。ユーザー 2026-10-19）
    m = {"wall": 3, "tower": 3, "house": 6}.get(o[5] if len(o) > 5 else None)
    if m:
        for sx, sz in both([(o[0], o[1])]): rects.append((sx - o[2] / 2 - m, sx + o[2] / 2 + m, sz - o[3] / 2 - m, sz + o[3] / 2 + m))
# 道路・広場など舗装した所 paved: [[x0, x1, z0, z1], …]（自軍側。エンジンは使わず、この道具だけが読む）。足元がかかってもいけない
for x0, x1, z0, z1 in d.get("paved", []):
    rects.append((x0, x1, z0, z1)); rects.append((-x1, -x0, -z1, -z0))
for n in (d.get("nav") or {}).get("nodes", []):
    if len(n) > 2:
        for x, z in both([(n[0], n[1])]): circles.append((x, z, 8))

def blocked(x, z, r, dip):
    if any(math.hypot(x - cx, z - cz) < r * 0.5 + PLANT_R for cx, cz in plant_c): return True
    if any(math.hypot(x - cx, z - cz) < r + cr for cx, cz, cr in circles): return True
    for x0, x1, z0, z1 in rects:
        if math.hypot(max(0, x0 - x, x - x1), max(0, z0 - z, z - z1)) < r: return True
    # もとの地形にかからない。小山は外側（低い所）なら高台や坂の裾にかかってよい（高い方が勝つので形は崩れない）。
    # くぼみは足し合わさるので、足元の外まで平らな所だけ
    if H(x, z) > 0.05: return True
    if dip:
        for k in range(12):
            a = k * math.pi / 6
            if H(x + math.cos(a) * (r + 2), z + math.sin(a) * (r + 2)) > 0.05: return True
    for k in range(8):
        a = k * math.pi / 4
        if H(x + math.cos(a) * r * 0.55, z + math.sin(a) * r * 0.55) > 0.05: return True
    return False

rnd = random.Random(seed)
placed = []  # (x, z, r, h)
for _ in range(6000):
    dip = rnd.random() < 0.35
    r = rnd.uniform(11, 20) if dip else rnd.uniform(11, 24)
    x = rnd.uniform(-mx + 6, mx - 6)
    z = rnd.uniform(0, L)
    if abs(x) + r > mx + 4: continue
    ok = True
    for (px, pz, pr, ph) in placed:
        for qx, qz in ((px, pz), (-px, -pz)):
            dd = math.hypot(x - qx, z - qz)
            need = (pr + r) * (1.0 if dip and ph < 0 else 0.7)
            if dd < need: ok = False; break
        if not ok: break
    if ok and math.hypot(2 * x, 2 * z) < r * 2 * (1.0 if dip else 0.7): ok = False  # 自分の点対称の相手と重ならない
    if not ok or blocked(x, z, r, dip): continue
    if dip: h = -rnd.uniform(1.0, min(2.2, 0.4 * 2 * r / math.pi))
    else: h = rnd.uniform(1.5, min(4, 0.4 * 2 * r / math.pi))
    placed.append((round(x, 1), round(z, 1), round(r, 1), round(h, 1)))

ind = re.match(r"\s*", next(l for l in lines if "terrain: [" in l)).group(0) + "  "
out = [f"{ind}{BEGIN}（tools/gen_rough.py {mid} --seed {seed} が書く。手で直さない。小山{sum(1 for p in placed if p[3] > 0)}・くぼみ{sum(1 for p in placed if p[3] < 0)}、自軍側だけ）"]
row = []
for x, z, r, h in sorted(placed, key=lambda p: (-p[1], p[0])):
    row.append(f"{{ type: 'hill', x: {x:g}, z: {z:g}, r: {r:g}, h: {h:g} }},")
    if len(row) == 3: out.append(ind + " ".join(row)); row = []
if row: out.append(ind + " ".join(row))
out.append(f"{ind}{END}")
ti = next(i for i, l in enumerate(lines) if "terrain: [" in l)
lines[ti + 1:ti + 1] = out
print(f"{mid}: 小山 {sum(1 for p in placed if p[3] > 0)}、くぼみ {sum(1 for p in placed if p[3] < 0)}（seed {seed}）")
if not dry: path.write_text("\n".join(lines), encoding="utf-8")
