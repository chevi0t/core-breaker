#!/usr/bin/env python3
"""点群再構築データの予算・量子化後の輪郭・三角形・配置の独立性を検査。"""

import base64
import json
import os
from pathlib import Path
import numpy as np
import shapely
from shapely.geometry import Polygon
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from odaiba_pointcloud_extent import extent
from shapely import affinity
import math

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(
    os.environ.get(
        "ODAIBA_POINTCLOUD_OUTPUT", str(ROOT / "mapdesign/sowan/pointcloud-third")
    )
)
raw = (OUT / "terrain.json").read_bytes()
data = json.loads(raw)
assert len(raw) <= 500000
assert data["scale"] == 1 / 3
config = json.loads((ROOT / "research/maps/odaiba-pointcloud-third.json").read_text())
assert data["sourceFiles"] == len(config["files"])
assert data["bases"] == [] and data["plants"] == []
boundary, original, origin = extent(config)
angle = math.radians(config["rotationDegrees"])
ca, sa, scale = math.cos(angle), math.sin(angle), data["scale"]
converted = affinity.affine_transform(
    boundary,
    [
        ca * scale,
        sa * scale,
        sa * scale,
        -ca * scale,
        -origin[0] * scale,
        -origin[1] * scale,
    ],
)
assert np.allclose(data["bounds"], converted.bounds)
assert np.allclose(data["originProjected"], origin)
assert boundary.covers(original)
assert data["northExtensionGameMeters"] == 100
assert 80 < data["northExtensionCoveredBoundsGameMeters"] <= 100
assert data["sourcePoints"] > 165285697
assert 80 < -309.87909857 - data["bounds"][1] <= 100.01
assert np.allclose(
    [data["bounds"][0], *data["bounds"][2:]],
    [-665.17767417, 665.17767417, 309.87909857],
)
step = data["coordinateStep"]


def ring(s):
    a = (
        np.frombuffer(base64.b64decode(s, validate=True), dtype="<i2").reshape(-1, 2)
        * step
    )
    assert len(a) >= 3 and np.isfinite(a).all()
    return a


for kind in ["boundary", "land", "water", "roads", "grass"]:
    for rs in data[kind]:
        p = Polygon(ring(rs[0]), [ring(r) for r in rs[1:]])
        assert p.is_valid and p.area > 0, (kind, str(shapely.is_valid_reason(p)))
for lo, hi, r, paint, kind in data["volumes"]:
    p = Polygon(ring(r))
    assert p.is_valid and p.area > 0, shapely.is_valid_reason(p)
    assert np.isfinite([lo, hi]).all() and hi > lo
    assert 0 <= paint < len(data["palette"])
triangles = 0
for paint, ps, ids, name in data["meshes"]:
    p = (
        np.frombuffer(base64.b64decode(ps, validate=True), dtype="<i2").reshape(-1, 3)
        * step
    )
    f = np.frombuffer(base64.b64decode(ids, validate=True), dtype="<u2").reshape(-1, 3)
    assert f.size and f.max() < len(p) and np.isfinite(p).all(), name
    a = p[f]
    assert (
        np.linalg.norm(np.cross(a[:, 1] - a[:, 0], a[:, 2] - a[:, 0]), axis=1) > 0
    ).all(), name
    triangles += len(f)
result = {
    "terrainBytes": len(raw),
    "within500KB": True,
    "sourceFiles": data["sourceFiles"],
    "originalOriginRetained": True,
    "northExtensionGameMeters": data["northExtensionGameMeters"],
    "actualBoundsExtensionGameMeters": data["northExtensionCoveredBoundsGameMeters"],
    "volumes": len(data["volumes"]),
    "specialMeshes": len(data["meshes"]),
    "specialTriangles": triangles,
    "quantizedRingsValid": True,
    "finiteAndIndexed": True,
    "noFacilitiesUsedForTerrain": True,
    "gameplayValidated": False,
}
(OUT / "terrain-check.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + "\n"
)
print(json.dumps(result, ensure_ascii=False))
