"""交通属性・描画予算・拡張時の位置固定を、保存後のデータで検査する。"""

import base64
import json
import os
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from odaiba_transport_detail import build_transport
from shapely.geometry import LineString, Point, mapping

OUT = Path(
    os.environ.get(
        "ODAIBA_POINTCLOUD_OUTPUT", ROOT / "mapdesign/sowan/pointcloud-third"
    )
)
raw = (OUT / "terrain.json").read_bytes()
data = json.loads(raw)
surface = ROOT / "mapdesign/sowan/pointcloud-third/surface-render.js"
assert len(raw) + surface.stat().st_size <= 500000
routes = data["transport"]["routes"]
assert len([r for r in routes if r["kind"] == "promenade"]) == 1
for route in routes:
    p = (
        np.frombuffer(
            base64.b64decode(route["path"], validate=True), dtype="<i2"
        ).reshape(-1, 3)
        * data["coordinateStep"]
    )
    assert np.isfinite(p).all() and len(p) == len(route["piers"])
    assert route["width"] > 0 and route["sourceLength"] > 0
    distance = np.linalg.norm(np.diff(p[:, [0, 2]], axis=0), axis=1)
    assert (distance > 0).all()
    assert (np.abs(np.diff(p[:, 1])) <= distance * 0.35 + 0.09).all()
    if route["kind"] == "promenade":
        assert 390 < route["sourceLength"] < 410
        assert abs(route["width"] - 40 / 3) < 0.01

# 同じ位置の地上・地下レコードがあっても、地下の属性を高架として採用しない。
line = mapping(LineString([(0, 0), (20, 0)]))
vectors = {
    "boundary": mapping(Point(10, 0).buffer(50)),
    "buildings": [],
    "roads": [{"geometry": line, "properties": {"vt_code": 2704, "vt_motorway": 1}}],
    "rails": [
        {"geometry": line, "properties": {"vt_code": 8201, "vt_railstate": state}}
        for state in ["地下", "橋・高架"]
    ]
    + [{"geometry": line, "properties": {"vt_code": 2801}}],
}
result = build_transport(
    vectors, np.full((50, 50), 20.0), lambda p: p, 1 / 3, 0.05, (-10, -10)
)
assert [r["kind"] for r in result["routes"]] == ["guideway"]
assert result["stats"]["excludedUndergroundOrTunnelFeatures"] == 2
assert result["stats"]["elevatedRailSourceFeatures"] == 1

report = {
    "terrainBytes": len(raw),
    "proceduralRendererBytes": surface.stat().st_size,
    "mapResourceBytes": len(raw) + surface.stat().st_size,
    "maximumBytes": 500000,
    "routeCount": len(routes),
    "noUndergroundRailOrRoadElevation": True,
    "finiteRoutesAndLimitedGrades": True,
    "dreamBridgeSourceShapeRetained": True,
    "gameplayValidated": False,
}
(OUT / "transport-check.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + "\n"
)
print(json.dumps(report, ensure_ascii=False))
