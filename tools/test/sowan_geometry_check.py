#!/usr/bin/env python3
"""書き出した双湾の座標・輪郭・縮尺・500KB上限と長方形の入力検査。"""

import base64, copy, importlib.util, json, pathlib, subprocess, tempfile
import numpy as np
from shapely.geometry import Polygon

ROOT = pathlib.Path(__file__).resolve().parents[2]
js = ROOT / "prototype/maps/sowan.js"
data = json.loads(
    subprocess.check_output(
        [
            "node",
            "-e",
            "global.window={};require(process.argv[1]);console.log(JSON.stringify(window.MAP_DATA.sowan));",
            str(js),
        ]
    )
)
c = data["cityTerrain"]
hx, hz = data["size"]
step = c["ringCoordinateStep"]
assert js.stat().st_size <= 500000 and (hx, hz) == (825, 312.5) and step == 0.05
assert c["halfExtents"] == [hx, hz] and c["half"] == max(hx, hz)
for i, v in enumerate(c["volumes"]):
    rings = [
        np.frombuffer(base64.b64decode(r), dtype="<i2").reshape(-1, 2) * step
        for r in v[3]
    ]
    p = Polygon(rings[0], rings[1:])
    assert p.is_valid and p.area > 0, ("packed footprint", i, p.area)
    points = np.concatenate(rings)
    assert (np.abs(points[:, 0]) <= hx + 0.001).all() and (
        np.abs(points[:, 1]) <= hz + 0.001
    ).all()
for key, s in c["surfaces"].items():
    pts = (
        np.frombuffer(base64.b64decode(s["points"]), dtype="<i2").reshape(-1, 3)
        * s["step"]
    )
    ids = np.frombuffer(base64.b64decode(s["indices"]), dtype="<u2")
    assert len(ids) % 3 == 0 and (ids < len(pts)).all(), key
    assert (np.abs(pts[:, 0]) <= hx + 0.001).all() and (
        np.abs(pts[:, 2]) <= hz + 0.001
    ).all(), key
spec = importlib.util.spec_from_file_location(
    "build_maps", ROOT / "tools/build_maps.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def check(d):
    with tempfile.TemporaryDirectory() as temp:
        path = pathlib.Path(temp) / "sowan.js"
        path.write_text("window.MAP_DATA={sowan:" + json.dumps(d) + "};")
        return json.loads(
            subprocess.check_output(
                ["node", "-e", module.CHECK, json.dumps([["sowan", str(path)]])]
            )
            .decode()
            .strip()
            .splitlines()[-1]
        )


assert not check(data)
for ext in [[825, 825], [825], [825, -312.5], [825, "312.5"]]:
    d = copy.deepcopy(data)
    d["cityTerrain"]["halfExtents"] = ext
    assert check(d), ext
for step in [0.03, 0.1]:
    d = copy.deepcopy(data)
    d["cityTerrain"]["ringCoordinateStep"] = step
    assert check(d)
print(f'500KB上限・長方形・全{len(c["volumes"])}輪郭・面・破損入力6件：成功')

# 原データがある開発環境では、配置変更後も地形の全バイトが一致することを確認する。
if len(__import__("sys").argv) > 1:
    import sys, hashlib

    sys.path.insert(0, str(ROOT / "tools"))
    import build_sowan as builder

    source = pathlib.Path(sys.argv[1])
    ref = json.loads((ROOT / "research/maps/odaiba-reference.json").read_text())
    city, solids, land, roads, bases, report = builder.terrain(source, ref)
    placement = json.loads((ROOT / "mapdesign/sowan/placement.json").read_text())
    before = builder.compact(city)
    original, _ = builder.battle(city, solids, land, roads, bases, placement)
    other = copy.deepcopy(placement)
    other["plants"][1][1][0] += 12
    moved, _ = builder.battle(city, solids, land, roads, bases, other)
    assert original["plants"][1] != moved["plants"][1]
    assert (
        builder.compact(city)
        == before
        == (ROOT / "mapdesign/sowan/layout.json").read_bytes()
        and city == c
    ), "プラント移動で地形を変更しない"
    print(
        "プラントBを12m移動：地形の全バイト一致 " + hashlib.sha256(before).hexdigest()
    )
