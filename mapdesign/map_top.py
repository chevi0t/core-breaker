#!/usr/bin/env python3
"""マップを上から見た図にする（ブラウザ不要、数秒）。
使い方: python3 mapdesign/map_top.py <id> [出力.png]
高さを明るさで、登れない斜面を赤、水面（water）の中で-1m以下の所を青、障害物を灰色（高いほど濃い）で描く。
橋の板（茶色）、Botの通り道（水色、番号は節点）、プラント（円は占拠の半径16m）、再出撃位置（×、中心から自軍側へ48m）、ポッド（緑）、カタパルト（黄の矢印）、砲台（橙）、レーダー（紫）も描く。
地形の式は index.html の featureH・terrainShape と同じ（変わったら合わせる）。"""
import json, math, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
mid = sys.argv[1]
base_id, _, variant_id = mid.partition("-")
out = sys.argv[2] if len(sys.argv) > 2 else f"map_{mid}_top.png"
js = f"global.window={{}};eval(require('fs').readFileSync('{ROOT}/prototype/maps/{base_id}.js','utf8'));console.log(JSON.stringify(window.MAP_DATA['{base_id}']))"
d = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
if variant_id: d = {**d, **d["variants"][variant_id]}

def smooth(t): return 0 if t <= 0 else 1 if t >= 1 else t * t * (3 - 2 * t)
def mirrored(f):
    if f["type"] == "ramp": return {**f, "x0": -f["x1"], "x1": -f["x0"], "z0": -f["z0"], "z1": -f["z1"]}
    if f["type"] == "trench": return {**f, "x": -f["x"], "z0": -f["z1"], "z1": -f["z0"]}
    return {**f, "x": -f["x"], "z": -f["z"]}
fs = d["terrain"] if d.get("asym") else [g for f in d["terrain"] for g in ([f] if f.get("x") == 0 and f.get("z") == 0 else [f, mirrored(f)])]
def featureH(f, x, z):
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
def H(x, z):
    up = down = 0
    for f in fs:
        h = featureH(f, x, z)
        if h > 0: up = max(up, h)
        else: down += h
    return (up + down) * (1 - smooth((abs(z) - d["baseLine"]) / 25))

wrs = d.get("water", []) if d.get("asym") else [r for w in d.get("water", []) for r in (w, [-w[0], -w[1]] + w[2:])]
def in_water(x, z): return any(abs(x - w[0]) <= w[2] and abs(z - w[1]) <= w[3] for w in wrs)
mx, mz = d["size"]; S = 2  # 1m = 2px
W, Hh = mx * 2 * S, mz * 2 * S
hs = [[H(-mx + (i + .5) / S, -mz + (j + .5) / S) for i in range(W)] for j in range(Hh)]
img = Image.new("RGB", (W, Hh)); px = img.load()
for j in range(Hh):
    for i in range(W):
        h = hs[j][i]
        g = max(0, min(255, int(120 + h * 6)))
        c = (g, g, int(g * .92))
        if h < -1 and in_water(-mx + (i + .5) / S, -mz + (j + .5) / S): c = (40, 90, 160)
        nb = [hs[j][min(W - 1, i + 1)], hs[min(Hh - 1, j + 1)][i]]
        if any(abs(n - h) * S > 1.1 for n in nb): c = (200, 60, 50)  # 登れない斜面
        px[i, j] = c
dr = ImageDraw.Draw(img, "RGBA")
P = lambda x, z: ((x + mx) * S, (z + mz) * S)
def both(x, z, geometry=True): return [(x, z)] + ([] if x == 0 and z == 0 or geometry and d.get("asym") else [(-x, -z)])
for x, z, w, dd, h, *_ in d["layout"]:
    for X, Z in both(x, z):
        a, b = P(X - w / 2, Z - dd / 2), P(X + w / 2, Z + dd / 2)
        dr.rectangle([a, b], fill=(40, 40, 40, min(255, 90 + int(h * 12))))
for i, (x, z, w, dd, h) in enumerate(d["barricades"]):
    for X, Z in both(x, z):
        dr.rectangle([P(X-w/2, Z-dd/2), P(X+w/2, Z+dd/2)], fill=(245, 202, 63), outline=(80, 60, 10))
        dr.text(P(X+w/2+2, Z-4), f"Cover {i+1}", fill=(255, 225, 90))
for x, z, w, dd, top, th in d.get("bridges", []):  # 橋の板（茶色の枠）
    for X, Z in both(x, z):
        dr.rectangle([P(X - w / 2, Z - dd / 2), P(X + w / 2, Z + dd / 2)], fill=(150, 110, 60, 120), outline=(120, 80, 30), width=2)
nv = d.get("nav")
if nv and '--no-nav' not in sys.argv:  # Botの通り道（水色の線と点）。密な自動生成経路は別図にできる
    def node(r):
        if isinstance(r, str): x, z = nv["nodes"][int(r[1:])][:2]; return (-x, -z)
        return tuple(nv["nodes"][r][:2])
    for a, b in nv["links"]:
        A, B = node(a), node(b)
        for k in ((1,) if d.get("asym") else (1, -1)): dr.line([P(A[0] * k, A[1] * k), P(B[0] * k, B[1] * k)], fill=(0, 220, 255, 170), width=2)
    for i, point in enumerate(nv["nodes"]):
        x, z = point[:2]
        for X, Z in both(x, z): dr.ellipse([P(X - 2, Z - 2), P(X + 2, Z + 2)], fill=(0, 220, 255))
        dr.text(P(x + 2, z + 2), str(i), fill=(0, 90, 120))
for x, z in [(0, d["baseZ"]), (0, -d["baseZ"])]:
    dr.ellipse([P(x - 6, z - 6), P(x + 6, z + 6)], fill=(60, 160, 255) if z > 0 else (255, 140, 40))
for pid, x, z, own in d["plants"]:
    col = {"B": (60, 160, 255), "R": (255, 140, 40)}.get(own, (230, 230, 230))
    dr.ellipse([P(x - 16, z - 16), P(x + 16, z + 16)], outline=col, width=3)
    dr.text(P(x - 2, z - 3), pid, fill=col)
    for sz in (1, -1):  # 自軍・敵軍が持った時の再出撃位置
        # spawn と同じく各ベースへの方向を使う。横へ離れたプラントも z だけにずらさない。
        dx, dz = -x, d["baseZ"] * sz - z
        length = math.hypot(dx, dz) or 1
        X, Z = P(x + dx / length * 48, z + dz / length * 48)
        dr.line([(X - 5, Z - 5), (X + 5, Z + 5)], fill=(255, 255, 0), width=2); dr.line([(X - 5, Z + 5), (X + 5, Z - 5)], fill=(255, 255, 0), width=2)
for _, x, z in d["plantPods"]: dr.ellipse([P(x - 3, z - 3), P(x + 3, z + 3)], fill=(60, 200, 90))
for x, z in d["basePods"]:
    for X, Z in both(x, z, False): dr.ellipse([P(X - 3, Z - 3), P(X + 3, Z + 3)], fill=(60, 200, 90))
for x, z in d["turrets"]:
    for X, Z in both(x, z, False): dr.rectangle([P(X - 2, Z - 2), P(X + 2, Z + 2)], fill=(255, 120, 0))
for X, Z in both(*d["radar"], False): dr.ellipse([P(X - 4, Z - 4), P(X + 4, Z + 4)], fill=(170, 80, 220))
for c in d["catapults"]:
    for k in (1, -1):
        a, b = P(c[0] * k, c[1] * k), P(c[2] * k, c[3] * k)
        dr.line([a, b], fill=(255, 220, 0, 160), width=2); dr.ellipse([b[0] - 4, b[1] - 4, b[0] + 4, b[1] + 4], outline=(255, 220, 0), width=2)
for p in d.get('jumpPads', []):
    x, z, y = p['at']
    for X, Z in both(x, z):
        dr.ellipse([P(X - 3, Z - 3), P(X + 3, Z + 3)], fill=(100, 245, 185))
        dr.text(P(X + 4, Z), 'J', fill=(100, 245, 185))
for lift in d.get('lifts', []):
    for s in ([1] if d.get('asym') else [1, -1]):
        x, z, y = lift['from']; ex, ez, ey = lift['to']
        dr.line([P(x*s,z*s),P(ex*s,ez*s)], fill=(240,200,100),width=4)
        dr.text(P(x*s+4,z*s), 'L', fill=(240,200,100))
img.save(out)
print(out, img.size, "最高", round(max(map(max, hs)), 1), "最低", round(min(map(min, hs)), 1))
