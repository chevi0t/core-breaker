"""上面1m格子の脱出検査。実機体の移動・横幅や上下層を検証するものではない。"""

import json, base64, math, collections
from pathlib import Path
import os
import numpy as np
from scipy import ndimage
from shapely.geometry import Polygon, mapping
from rasterio.features import rasterize
from affine import Affine

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(
    os.environ.get(
        "ODAIBA_POINTCLOUD_OUTPUT", str(ROOT / "mapdesign/sowan/pointcloud-third")
    )
)
d = json.loads((OUT / "terrain.json").read_text())
step = d["coordinateStep"]
xmin, zmin, xmax, zmax = d["bounds"]
X0 = math.floor(xmin)
Z0 = math.floor(zmin)
W = math.ceil(xmax) - X0
H = math.ceil(zmax) - Z0
tr = Affine(1, 0, X0, 0, 1, Z0)


def ring(s):
    return np.frombuffer(base64.b64decode(s), dtype="<i2").reshape(-1, 2) * step


def poly(rs):
    return Polygon(ring(rs[0]), [ring(s) for s in rs[1:]])


valid = rasterize(
    [(mapping(poly(rs)), 1) for rs in d["boundary"]], out_shape=(H, W), transform=tr
).astype(bool)
heights = np.zeros((H, W), dtype=np.float32)
rows = sorted(d["volumes"], key=lambda v: v[1])
shapes = [(mapping(Polygon(ring(v[2]))), v[1]) for v in rows]
heights = rasterize(shapes, out_shape=(H, W), transform=tr, dtype="float32")
for color, ps, ids, name in d["meshes"]:
    p = np.frombuffer(base64.b64decode(ps), dtype="<i2").reshape(-1, 3) * step
    f = np.frombuffer(base64.b64decode(ids), dtype="<u2").reshape(-1, 3)
    for triangle in p[f]:
        xy = triangle[:, [0, 2]]
        area = abs(np.linalg.det(np.column_stack([xy, np.ones(3)])))
        if area < 1e-6:
            continue
        ix0 = max(0, int(math.floor(xy[:, 0].min() - X0)))
        ix1 = min(W, int(math.ceil(xy[:, 0].max() - X0)))
        iy0 = max(0, int(math.floor(xy[:, 1].min() - Z0)))
        iy1 = min(H, int(math.ceil(xy[:, 1].max() - Z0)))
        if ix1 <= ix0 or iy1 <= iy0:
            continue
        a, b, c = np.linalg.solve(np.column_stack([xy, np.ones(3)]), triangle[:, 1])
        mask = rasterize(
            [(mapping(Polygon(xy)), 1)],
            out_shape=(iy1 - iy0, ix1 - ix0),
            transform=Affine(1, 0, X0 + ix0, 0, 1, Z0 + iy0),
        ).astype(bool)
        xx, zz = np.meshgrid(
            np.arange(ix0, ix1) + X0 + 0.5, np.arange(iy0, iy1) + Z0 + 0.5
        )
        y = a * xx + b * zz + c
        view = heights[iy0:iy1, ix0:ix1]
        view[mask] = np.maximum(view[mask], y[mask])
ground = valid & (heights < 0.3)
labels, n = ndimage.label(ground)
sizes = np.bincount(labels.ravel())
edge = valid & ~ndimage.binary_erosion(valid)
border_ids = np.unique(labels[ground & edge])
large = np.flatnonzero(sizes > 500)
seed_labels = np.union1d(border_ids, large)
seed_labels = seed_labels[seed_labels > 0]
seen = np.isin(labels, seed_labels) & valid
todo = collections.deque(map(tuple, np.argwhere(seen)))
JUMP = 6.5
while todo:
    y, x = todo.popleft()
    h = heights[y, x]
    for yy, xx in [(y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)]:
        if (
            0 <= yy < H
            and 0 <= xx < W
            and valid[yy, xx]
            and not seen[yy, xx]
            and h - heights[yy, xx] <= JUMP
        ):
            seen[yy, xx] = True
            todo.append((yy, xx))
unseen = valid & ~seen
labels, n = ndimage.label(unseen)
pockets = []
for i in range(1, n + 1):
    y, x = np.where(labels == i)
    if not len(x):
        continue
    pockets.append(
        {
            "cells": len(x),
            "center": [float(x.mean() + X0 + 0.5), float(y.mean() + Z0 + 0.5)],
            "heightRange": [float(heights[y, x].min()), float(heights[y, x].max())],
        }
    )
result = {
    "gridStepMeters": 1,
    "upwardStepLimitMeters": JUMP,
    "validCells": int(valid.sum()),
    "unreachableTopCells": int(unseen.sum()),
    "pockets": pockets,
    "interpretation": "上面格子による予備検査。機体の横幅・実移動・空中制御・橋の下や門の下を含む多層の到達性は未検証。大きな地表領域と外周接続地表から逆探索。",
}
(OUT / "roof-grid-check.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + "\n"
)
print(json.dumps(result, ensure_ascii=False))
