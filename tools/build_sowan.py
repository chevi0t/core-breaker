#!/usr/bin/env python3
"""お台場の原PLATEAUを半縮尺で再構築。施設配置を地形生成へ渡さない。"""

import argparse, base64, hashlib, json, math, pathlib
import numpy as np, shapely
from scipy.ndimage import label
from scipy.spatial import cKDTree
from shapely.geometry import Polygon, Point, LineString, box, shape
from shapely import affinity
from plateau_city_geometry import parts, building_masses, projection
import build_kanto_map as codec
from plateau_rect_fetch import Frame, ecef

codec.STEP = 0.05
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "mapdesign/sowan"
CONFIG = json.loads((ROOT / "research/maps/odaiba-sources.json").read_text())
SCALE = CONFIG["scale"]
assert SCALE == 0.5
HX, HZ = [
    int(h * SCALE) if (h * SCALE).is_integer() else h * SCALE
    for h in CONFIG["halfExtents"]
]
D = box(-HX, -HZ, HX, HZ)
STEP = 0.05
PALETTE = ["#c9cec8", "#c0bcae", "#9aa6ac", "#cfd4d1", "#869da8", "#abb6b5"]


def compact(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode()


def pack(p):
    return [
        codec.encode_ring(np.array(r.coords[:-1])) for r in [p.exterior, *p.interiors]
    ]


def floor(p, y):
    return codec.floor(p, y)


def pack_surface(vertices):
    # 保存格子へ丸めた後に面積ゼロの三角形を除く。int16の桁あふれは拒否する。
    a = np.rint(np.asarray(vertices).reshape(-1, 3, 3) / STEP) * STEP
    assert np.isfinite(a).all() and (np.abs(a / STEP) <= 32767).all()
    n = np.cross(a[:, 1] - a[:, 0], a[:, 2] - a[:, 0])
    a = a[np.linalg.norm(n, axis=1) > 1e-7]
    return codec.pack_surface(a.reshape(-1, 3))


def geo(lon, lat):
    return (
        Frame(CONFIG["referenceCenter"], CONFIG["rotationDegrees"]).local(
            ecef(math.radians(lon), math.radians(lat), 0), 0
        )[[0, 2]]
        * SCALE
    )


def terrain(source, ref):
    summary = json.loads((source / "summary.json").read_text())
    assert summary["center"] == CONFIG["referenceCenter"]
    assert summary["rotationDegrees"] == CONFIG["rotationDegrees"]
    assert summary["halfExtents"] == CONFIG["halfExtents"]
    assert summary["finiteAndClipped"]
    assert ref["center"] == CONFIG["referenceCenter"] and ref["scale"] == SCALE
    raw = np.load(source / "geometry.npz")
    profile = dict(
        footprintPrecision=0.08,
        minimumBuildingArea=5,
        minimumRoofArea=5,
        roofHeightStep=1,
        outlineTolerance=0.5,
        tieredBuildingArea=700,
    )
    digest = hashlib.sha256((source / "geometry.npz").read_bytes()).hexdigest()
    assert summary["geometrySHA256"] == digest, "原データと取得記録が不一致"
    cached = source / "sowan-masses.json"
    water = shapely.make_valid(shape(ref["water"])).simplify(0.5).intersection(D)
    # 海岸と道路を先に固定。プラントの座標を輪郭加工へ渡さない。
    roads = shapely.union_all(
        [
            LineString(r["points"]).buffer(r["width"] / 2, cap_style=2, join_style=2)
            for r in ref["roads"]
        ]
    ).intersection(D)
    cache_key = hashlib.sha256(
        compact([digest, profile, ref]) + b"road-clearance-8m"
    ).hexdigest()
    if cached.exists() and json.loads(cached.read_text()).get("key") == cache_key:
        rows = json.loads(cached.read_text())["rows"]
    else:
        _, rows, _, _ = building_masses(
            raw["bldg"] * SCALE, D.difference(water), roads, profile, -0.2, 8
        )
        cached.write_bytes(compact({"key": cache_key, "rows": rows}))
    bridge = roads.intersection(water).buffer(0.15).simplify(0.35).intersection(D)
    land = D.difference(water)
    volumes = []
    solids = []
    removed_holes = 0
    # 基地の更地化だけは独立した固定の地理条件。プラント位置は一切読まない。
    base_sites = {"B": [-580, 242], "R": [565, 225]}
    clearings = shapely.union_all(
        [Point(*p).buffer(39, quad_segs=8) for p in base_sites.values()]
    )
    marks = [
        ("science", geo(139.77673236, 35.61922228), 75, "#d9e3e3", False),
        ("telecom", geo(139.78005889, 35.61713885), 67, "#59757b", True),
        ("exhibition", [490, 113], 120, "#d4d2c8", False),
        ("research", [-528, 106], 70, "#acb7b5", False),
        ("bay-studio", [-408, 24], 55, "#bfc3bc", False),
        ("ariake", [355, -75], 50, "#637d8b", True),
    ]

    def emit(p, lo, hi, meta=None, kind=0):
        for q in parts(
            shapely.set_precision(
                shapely.make_valid(p)
                .intersection(D)
                .simplify(0.45, preserve_topology=True),
                STEP,
            )
        ):
            if q.area < 3 or hi - lo < 0.15:
                continue
            volumes.append(
                [
                    kind,
                    round(lo, 2),
                    round(hi, 2),
                    pack(q),
                    meta or {"paint": len(volumes) % len(PALETTE)},
                ]
            )
            solids.append((q, lo, hi, volumes[-1][4]))

    # 元データで箱に簡略化された特徴部分は、同じ敷地内で外形を補完する。
    conference = Point(475, 85).buffer(32)
    telecom = box(-504, 176, -433, 230)
    for row in rows:
        p = Polygon(row["rings"][0])
        removed_holes += len(row["rings"]) - 1
        if row["bottom"] < 1:
            p = p.difference(roads).intersection(land)
        if (
            row["bottom"] >= 6 and p.area < 3500 and conference.contains(p.centroid)
        ) or telecom.covers(p):
            continue
        if p.is_empty:
            continue
        nearest = min(marks, key=lambda m: p.distance(Point(m[1])))
        meta = (
            {
                "landmark": nearest[0],
                "landmarkColor": nearest[3],
                **({"facade": "glass"} if nearest[4] else {}),
            }
            if p.distance(Point(nearest[1])) < nearest[2]
            else None
        )
        emit(
            p.difference(clearings),
            row["bottom"],
            row["top"],
            meta,
            1 if row["bottom"] > 1 else 0,
        )
    # テレコムセンター：2棟＋上部連絡棟。開口は幅24m・高さ32m。
    telecom_color = {
        "landmark": "telecom",
        "landmarkColor": "#667c80",
        "facade": "glass",
    }
    for p in [box(-503, 180, -482, 220), box(-453, 180, -434, 220)]:
        emit(p, -0.2, 54, telecom_color)
    emit(box(-482, 186, -453, 214), 42, 52, telecom_color, 3)
    for p in [box(-503, 180, -482, 220), box(-453, 180, -434, 220)]:
        emit(p.buffer(-1), 54, 54.5, {"landmarkColor": "#b7c1bf"})
    # 会議棟の逆四角錐4基。外周の傾斜と接触面を同じ三角形で保持。
    landmark_faces = []

    def frustum(cx, cz, bottom, top, small, large):
        low = np.array(
            [
                [cx - small, bottom, cz - small],
                [cx + small, bottom, cz - small],
                [cx + small, bottom, cz + small],
                [cx - small, bottom, cz + small],
            ]
        )
        high = low.copy()
        high[:, 0] = cx + (low[:, 0] - cx) * large / small
        high[:, 2] = cz + (low[:, 2] - cz) * large / small
        high[:, 1] = top
        landmark_faces.extend(
            [high[[0, 2, 1]], high[[0, 3, 2]], low[[0, 1, 2]], low[[0, 2, 3]]]
        )
        for i in range(4):
            j = (i + 1) % 4
            landmark_faces.extend(
                [
                    np.array([low[i], high[i], low[j]]),
                    np.array([low[j], high[i], high[j]]),
                ]
            )

    for x in [462, 488]:
        for z in [72, 98]:
            emit(
                box(x - 4, z - 4, x + 4, z + 4),
                6,
                20,
                {"landmark": "conference-support", "landmarkColor": "#adaeaa"},
            )
            frustum(x, z, 20, 32, 5, 12.5)
    # 屋上の中央十字の隙間は屋根直下で閉じる。落下ポケットを残さない。
    for p in [box(473.5, 59.5, 476.5, 110.5), box(449.5, 83.5, 500.5, 86.5)]:
        emit(
            p,
            30.5,
            31.8,
            {"landmark": "conference-roof-link", "landmarkColor": "#b8b8b0"},
            3,
        )
    # 原データが旧施設の時期の区画は、提示画像と施設公式の外観を参考に補う。
    supplements = [
        ("arena", [-60, -157], 88, 62, 20, "#40525b"),
        ("dream-park", [235, -178], 73, 58, 27, "#353c42"),
    ]
    for name, at, w, h, top, color in supplements:
        p = (
            affinity.scale(Point(*at).buffer(1, quad_segs=8), w / 2, h / 2)
            if name == "arena"
            else box(at[0] - w / 2, at[1] - h / 2, at[0] + w / 2, at[1] + h / 2)
        )
        # 新施設の外周内の旧構内道は現況の屋根を分断するので置換する。
        p = p.intersection(land)
        roads = roads.difference(p)
        # 補完する敷地の旧モデルのみ置換。道路は維持し、プラント座標は使わない。
        keep = [
            (v, q, lo, hi, m)
            for v, (q, lo, hi, m) in zip(volumes, solids)
            if not p.intersects(q)
        ]
        cut = [
            (q.difference(p), lo, hi, m, v[0])
            for v, (q, lo, hi, m) in zip(volumes, solids)
            if p.intersects(q)
        ]
        volumes[:] = [v for v, *_ in keep]
        solids[:] = [(q, lo, hi, m) for _, q, lo, hi, m in keep]
        for q, lo, hi, m, k in cut:
            emit(q, lo, hi, m, k)
        emit(
            p, -0.2, top, {"landmark": name, "landmarkColor": color, "facade": "glass"}
        )
        emit(p, top, top + 0.7, {"landmark": name, "landmarkColor": "#e1e3df"})
        if name == "dream-park":
            for y in [8, 15, 22]:
                emit(p, y, y + 2.2, {"landmark": name, "landmarkColor": "#dce1e0"}, 1)
    # ゆりかもめ等の高架は原モデルの上面投影から復元。下に通れる8mの余裕を確保。
    q = raw["brid"].reshape(-1, 3, 3) * SCALE
    n = np.cross(q[:, 1] - q[:, 0], q[:, 2] - q[:, 0])
    mask = (
        (n[:, 1] > 0.7 * np.linalg.norm(n, axis=1))
        & (q[:, :, 1].mean(axis=1) > 5)
        & (q[:, :, 1].mean(axis=1) < 20)
    )
    elevated = (
        projection(q[mask].reshape(-1, 3), 0.1).simplify(0.7).difference(clearings)
    )
    for p in parts(elevated):
        if p.area > 30:
            emit(p, 9, 10, {"landmarkColor": "#b8c2bd"}, 3)
    # 足元半径1.3mで入口が塞がる閉所を高さ別に塞ぐ。通常の路地は広げず残す。
    caps = []
    for h in sorted({round(v[2]) for v in solids if v[2] > 7}, reverse=True):
        tall = shapely.union_all([p for p, lo, hi, _ in solids if lo < 1 and hi >= h])
        expanded = tall.buffer(1.55, quad_segs=2)
        for p in parts(expanded):
            for ring in p.interiors:
                pocket = Polygon(ring)
                if pocket.area < 2 or pocket.area > 5000:
                    continue
                cap = (
                    pocket.buffer(1.6, quad_segs=2)
                    .difference(tall)
                    .intersection(land)
                    .difference(clearings)
                )
                if cap.area > 2:
                    emit(cap, -0.2, h, {"landmarkColor": "#abb5b5"}, 2)
                    caps.append(
                        {
                            "height": h,
                            "area": round(cap.area, 1),
                            "at": list(pocket.representative_point().coords[0]),
                        }
                    )
    # 北西の複層棟：16m/8mの床が24m以上の棟で囲まれ、空から入ると
    # 通常ジャンプで退出できない2箇所を、隣の24m屋根へつなぐ。
    roof_zone = box(-321, -261, -287, -240)
    footprint = shapely.union_all([p for p, lo, hi, _ in solids if lo < 1])
    high_roofs = shapely.union_all([p for p, lo, hi, _ in solids if hi >= 24])
    for cap in parts(roof_zone.intersection(footprint).difference(high_roofs)):
        if cap.area < 3:
            continue
        emit(cap, 8, 24, {"landmarkColor": "#abb5b5"}, 1)
        caps.append(
            {
                "height": 24,
                "area": round(cap.area, 1),
                "at": list(cap.representative_point().coords[0]),
                "reason": "upper-roof-pocket",
            }
        )
    surfaces = {
        k: pack_surface(np.empty((0, 3)))
        for k in [
            "dem",
            "tran",
            "fill",
            "ramps",
            "aprons",
            "plazas",
            "streets",
            "historicGround",
            "brid",
        ]
    }
    surfaces["dem"] = pack_surface(floor(land, 0))
    surfaces["tran"] = pack_surface(floor(roads.intersection(land), 0.02))
    surfaces["streets"] = pack_surface(floor(bridge, 0))
    # 海岸面は見た目と接触を共有。4mの高さなので落下後はジャンプで戻れる。
    banks = np.array(landmark_faces).reshape(-1, 3).tolist()
    for p in parts(water):
        for ring in [p.exterior, *p.interiors]:
            for a, b in zip(ring.coords, list(ring.coords)[1:]):
                edge = LineString([a, b])
                if edge.intersection(bridge.buffer(0.3)).length > 0.1:
                    continue
                banks.extend(
                    [
                        [a[0], -4, a[1]],
                        [b[0], -4, b[1]],
                        [a[0], 0, a[1]],
                        [b[0], -4, b[1]],
                        [b[0], 0, b[1]],
                        [a[0], 0, a[1]],
                    ]
                )
    surfaces["brid"] = pack_surface(np.array(banks).reshape(-1, 3))
    data = {
        "geometryEncoding": "city-layout-v1",
        "half": HX,
        "halfExtents": [HX, HZ],
        "ringCoordinateStep": STEP,
        "groundMaximum": 0.1,
        "spawns": [],
        "district": {
            "bases": [{"team": t, "at": p, "height": 0} for t, p in base_sites.items()],
            "roofPads": [],
            "unifiedGround": {"color": "#858f86"},
            "buildingPalette": PALETTE,
            "roadColor": "#48555d",
            "facadeScale": 0.5,
            "glassTint": True,
        },
        "landmarks": [],
        "streetRepairs": [],
        "heritage": {},
        "river": {
            "bed": -4,
            "water": -2,
            "rings": [
                [list(map(list, r.coords[:-1])) for r in [p.exterior, *p.interiors]]
                for p in parts(water)
            ],
            "exits": [],
        },
        "volumeKinds": ["grounded", "upper", "infill", "elevated"],
        "volumes": volumes,
        "surfaces": surfaces,
        "decorations": [],
        "packing": {"encoding": "city-layout-v1", "layers": {}},
    }
    report = {
        "sourceGeometrySHA256": digest,
        "sourceVolumes": len(rows),
        "volumes": len(volumes),
        "sourceInteriorRings": removed_holes,
        "landingCaps": caps,
        "scale": SCALE,
        "dimensions": [HX * 2, HZ * 2],
        "plantGeometryCuts": 0,
        "supplementalLandmarks": supplements,
    }
    return data, solids, land.union(bridge), roads, base_sites, report


class Streets:
    def __init__(self, solids, land):
        self.land = land
        self.solids = solids
        self.blocked = (
            shapely.union_all([p for p, lo, hi, _ in solids if lo < 4.1 and hi > 0.3])
            .buffer(1.65, quad_segs=2)
            .union(D.difference(land).buffer(1.65))
            .union(box(-HX, -HX, HX, HX).difference(D.buffer(-3)))
        )
        values = np.arange(-HX + 4, HX - 3, 4)
        xx, zz = np.meshgrid(values, values)
        pts = np.column_stack([xx.ravel(), zz.ravel()])
        mask = ~shapely.intersects(self.blocked, shapely.points(pts)).reshape(xx.shape)
        labels, _ = label(mask, np.ones((3, 3)))
        sizes = np.bincount(labels.ravel())
        sizes[0] = 0
        self.nodes = pts[(labels == sizes.argmax()).ravel()]
        self.tree = cKDTree(self.nodes)

    def connected(self, p):
        ds, ids = self.tree.query(p, k=8)
        return any(d < 9 and self.clear(p, self.nodes[i]) for d, i in zip(ds, ids))

    def free(self, p, r=2):
        q = Point(p)
        return (
            self.connected(p)
            and D.buffer(-r).contains(q)
            and self.land.contains(q.buffer(r))
            and not any(
                lo < 4.1 and hi > 0.3 and poly.distance(q) < r
                for poly, lo, hi, _ in self.solids
            )
        )

    def clear(self, a, b):
        return not self.blocked.intersects(LineString([a, b]))


def battle(data, solids, land, roads, bases, placement):
    streets = Streets(solids, land)

    def locate(desired, r, maxdist=65):
        candidates = [np.array(desired)] + [
            np.array(desired) + d * np.array([math.cos(a), math.sin(a)])
            for d in range(4, maxdist + 1, 4)
            for a in np.linspace(0, 2 * math.pi, 48, endpoint=False)
        ]
        return next(
            ([round(float(x), 2) for x in p] for p in candidates if streets.free(p, r)),
            None,
        )

    plants = []
    for name, p in placement["plants"]:
        at = locate(p, 17)
        assert at, ("占拠円の空地なし", name)
        plants.append([name, *at, None])
    respawns = {}
    base_spawns = {}
    anchors = []
    cats = {}
    pods = []
    for t, base in bases.items():
        respawns[t] = {}
        base_spawns[t] = []
        for x in [-16, -6, 6, 16]:
            for z in [-12, 12]:
                p = [base[0] + x, base[1] + z]
                if streets.free(p, 2):
                    base_spawns[t].append(p)
                    anchors.append((f"base-{t}", p))
        for pid, x, z, _ in plants:
            a = math.atan2(base[1] - z, base[0] - x)
            slots = []
            for delta in np.linspace(-1.45, 1.45, 120):
                for r in [46.2, 49, 51.8]:
                    p = [
                        round(x + r * math.cos(a + delta), 2),
                        round(z + r * math.sin(a + delta), 2),
                    ]
                    if streets.free(p, 2) and all(math.dist(p, q) > 7 for q in slots):
                        slots.append(p)
            assert slots, ("再出撃なし", t, pid)
            respawns[t][pid] = slots[:8]
            anchors.extend((f"spawn-{t}-{pid}", p) for p in slots[:8])
        target = plants[0 if t == "B" else -1][1:3]
        cats[t] = []
        for offset in [-23, -8, 8, 23]:
            at = locate([base[0] + offset, base[1] - 19], 3, 16)
            to = locate([target[0] + offset, target[1] + 32], 6)
            assert at and to, (t, offset, at, to)
            cats[t].append([*at, *to])
            anchors.extend([(f"cat-{t}", at), (f"land-{t}", to)])
    for pid, x, z, _ in plants:
        anchors.append((pid, [x + 4, z + 3]))
    routes = []
    for start, end in [(plants[0], plants[1]), (plants[3], plants[2])]:
        at = locate([start[1], start[2] - 27], 4)
        to = locate([end[1], end[2] + 27], 6)
        assert at and to
        routes.append(
            {
                "at": at,
                "exit": to,
                "plant": start[0],
                "targetPlant": end[0],
                "flight": 6.8,
            }
        )
        anchors.extend([(f"cat-{start[0]}", at), (f"land-{end[0]}", to)])
    codec.STEP = 0.05
    nav, stats = codec.navigation(streets, anchors, half=HX, grid_step=4, span=70)
    # 既存の配列形式へ戻す。座標は縮尺と関係なく0.05m格子、節点を整数へ丸めない。
    nav = {
        "nodes": (
            np.frombuffer(base64.b64decode(nav["nodes"]), dtype="<i2").reshape(-1, 2)
            * STEP
        )
        .round(2)
        .tolist(),
        "links": np.frombuffer(base64.b64decode(nav["links"]), dtype="<u2")
        .reshape(-1, 2)
        .tolist(),
    }
    definition = {
        "name": "双湾展示区",
        "subtitle": "港越しの連絡路",
        "order": 83,
        "size": [HX, HZ],
        "team": 10,
        "time": 600,
        "baseZ": 290,
        "baseLine": 240,
        "desc": "湾を囲む展示場と研究街の4プラント戦。基地から前線へカタパルトで展開する。",
        "terrain": [],
        "layout": [],
        "plants": plants,
        "turrets": [[-30, 286], [30, 286]],
        "radar": [-32, 308],
        "catapults": [],
        "basePods": [[-12, 300], [12, 300]],
        "plantPods": pods,
        "barricades": [],
        "asym": True,
        "nav": nav,
        "bases": {
            t: {"at": p, "radius": 32, "catapults": cats[t], "catapultFlight": 6.8}
            for t, p in bases.items()
        },
        "plantCatapults": routes,
        "cityTerrain": data,
        "cityBattle": {
            "nodeReach": 1.5,
            "respawns": respawns,
            "baseSpawns": base_spawns,
        },
        "attribution": "東京都・江東区・港区／国土交通省 Project PLATEAU（2025年度）、国土地理院。CC BY 4.0。半縮尺・建物簡略化・海岸・施設を加工。出典と謝辞：https://github.com/chevi0t/core-breaker/blob/main/mapdesign/sowan/CREDITS.md",
    }
    return definition, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=pathlib.Path)
    ap.add_argument("--terrain-only", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    ref = json.loads((ROOT / "research/maps/odaiba-reference.json").read_text())
    data, solids, land, roads, bases, report = terrain(args.source, ref)
    (OUT / "layout.json").write_bytes(compact(data))
    print("terrain", len(compact(data)), flush=True)
    if not args.terrain_only:
        definition, stats = battle(
            data,
            solids,
            land,
            roads,
            bases,
            json.loads((OUT / "placement.json").read_text()),
        )
        js = (
            "// PLATEAU由来。出典・加工：mapdesign/sowan/CREDITS.md\n(window.MAP_DATA=window.MAP_DATA||{}).sowan=".encode()
            + compact(definition)
            + b";\n"
        )
        assert len(js) <= 500000, ("500KB超過", len(js))
        (ROOT / "prototype/maps/sowan.js").write_bytes(js)
        report.update(
            mapFileBytes=len(js),
            navigation=stats,
            plants=definition["plants"],
            bases=definition["bases"],
        )
        (OUT / "definition.json").write_bytes(
            compact(
                {k: v for k, v in definition.items() if k not in ["cityTerrain", "nav"]}
            )
        )
    report["terrainBytes"] = len(compact(data))
    (OUT / "generation.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    print(
        json.dumps(
            {k: v for k, v in report.items() if k not in ["landingCaps", "bases"]},
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
