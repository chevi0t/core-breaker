#!/usr/bin/env python3
"""屋根上面の格子で、6m以下の上りと降下で地上へ戻れるか補助検査する。"""

import pathlib, sys, hashlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
import json, base64, numpy as np, shapely
from shapely.geometry import Polygon
from collections import deque
from scipy.ndimage import label

D = json.load(open(ROOT / "mapdesign/sowan/layout.json"))
dx = 2.5
xs = np.arange(-823, 824, dx)
zs = np.arange(-310.5, 311, dx)
xx, zz = np.meshgrid(xs, zs)
h = np.zeros(xx.shape)
water = shapely.union_all([Polygon(p[0], p[1:]) for p in D["river"]["rings"]])
h[shapely.contains_xy(water, xx, zz)] = -4
for v in sorted(D["volumes"], key=lambda v: v[2]):
    r = [
        np.frombuffer(base64.b64decode(s), dtype="<i2").reshape(-1, 2)
        * D["ringCoordinateStep"]
        for s in v[3]
    ]
    p = Polygon(r[0], r[1:]).buffer(1.3, quad_segs=2)
    x0, z0, x1, z1 = p.bounds
    ix = np.where((xs >= x0) & (xs <= x1))[0]
    iz = np.where((zs >= z0) & (zs <= z1))[0]
    if not len(ix) or not len(iz):
        continue
    mask = shapely.contains_xy(p, xx[np.ix_(iz, ix)], zz[np.ix_(iz, ix)])
    sub = h[np.ix_(iz, ix)]
    sub[mask] = np.maximum(sub[mask], v[2])
    h[np.ix_(iz, ix)] = sub
# 任意メッシュの上向き面も含める。このマップでは会議棟の平らな屋根。
surface = D["surfaces"]["brid"]
pts = (
    np.frombuffer(base64.b64decode(surface["points"]), dtype="<i2").reshape(-1, 3)
    * surface["step"]
)
tri = pts[
    np.frombuffer(base64.b64decode(surface["indices"]), dtype="<u2").reshape(-1, 3)
]
norm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
for t in tri[norm[:, 1] > 0.65 * np.linalg.norm(norm, axis=1)]:
    p = Polygon(t[:, [0, 2]]).buffer(1.3, quad_segs=2)
    x0, z0, x1, z1 = p.bounds
    ix = np.where((xs >= x0) & (xs <= x1))[0]
    iz = np.where((zs >= z0) & (zs <= z1))[0]
    if not len(ix) or not len(iz):
        continue
    mask = shapely.contains_xy(p, xx[np.ix_(iz, ix)], zz[np.ix_(iz, ix)])
    sub = h[np.ix_(iz, ix)]
    sub[mask] = np.maximum(sub[mask], t[:, 1].max())
    h[np.ix_(iz, ix)] = sub
seen = h < 0.1
todo = deque(map(tuple, np.argwhere(seen)))
N, M = h.shape
while todo:
    z, x = todo.popleft()
    for dz, dd in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        qz, qx = z + dz, x + dd
        if (
            0 <= qz < N
            and 0 <= qx < M
            and not seen[qz, qx]
            and h[z, x] - h[qz, qx] <= 6
        ):
            seen[qz, qx] = True
            todo.append((qz, qx))
labels, n = label(~seen)
out = []
for i in range(1, n + 1):
    zzs, xxs = np.where(labels == i)
    j = len(zzs) // 2
    out.append(
        {
            "cells": len(zzs),
            "area": len(zzs) * dx * dx,
            "at": [xs[xxs[j]], float(h[zzs[j], xxs[j]]), zs[zzs[j]]],
            "heightRange": [h[zzs, xxs].min(), h[zzs, xxs].max()],
        }
    )
result = {
    "gridStep": dx,
    "points": h.size,
    "unreachable": out,
    "layoutSHA256": hashlib.sha256(
        (ROOT / "mapdesign/sowan/layout.json").read_bytes()
    ).hexdigest(),
    "note": "屋根上面を半径1.3m拡張、4近傍、6m以下の上昇と降下で地上へ戻れるかの補助検査。橋の下面への移動・機体の連続軌道は含めず、別途実物理で落下と退出を検査する。",
}
output = pathlib.Path(
    sys.argv[1] if len(sys.argv) > 1 else ROOT / "mapdesign/sowan/roof-grid-check.json"
)
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
assert not out, ("退出できない屋根候補", out)
print(f"屋根の2.5m格子{h.size}点：退出不能な候補0")
