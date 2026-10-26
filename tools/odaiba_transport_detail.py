"""地図属性で道路・高架・地下を分け、描画用の連続した経路へまとめる。"""

import base64
import math
from collections import defaultdict

import numpy as np
import shapely
from scipy import ndimage
from shapely.geometry import LineString, Point, shape
from shapely.ops import linemerge


def lines(g):
    if g.geom_type == "LineString":
        return [g]
    return [p for c in getattr(g, "geoms", []) for p in lines(c)]


def build_transport(vectors, top, transform, scale, step, grid_origin):
    boundary = shape(vectors["boundary"])
    buildings = shapely.union_all([shape(g) for g in vectors["buildings"]])
    groups = defaultdict(list)
    widths = defaultdict(list)
    dream_parts = []
    underground = 0

    for record in vectors["roads"]:
        props = record["properties"]
        g = shape(record["geometry"])
        code = props.get("vt_code")
        motorway = props.get("vt_motorway") == 1
        if code in [2704, 2714]:
            underground += 1
            continue
        if motorway and code in [2701, 2703]:
            kind = "expressway" if code == 2703 else "expresswayGround"
        elif code == 2713:
            width = props.get("vt_width", 0) / 100
            if width >= 35 and g.distance(Point(-4476.26, -41285.10)) < 250:
                dream_parts.extend(lines(g))
                continue
            kind = "footbridge"
        elif code == 2703:
            kind = "roadbridge"
        else:
            continue
        width = props.get("vt_width", 0) / 100
        if width < 3:
            width = 8 if kind == "footbridge" else 12
        width = min(38, max(4.5, width))
        key = (kind, props.get("vt_lvorder", 0), round(width / 3) * 3)
        groups[key].extend(lines(g))
        widths[key].append(width)

    rail_records = 0
    for record in vectors["rails"]:
        p = record["properties"]
        # RailCLの構造区分を使う。地下のりんかい線や補助線を高架にしない。
        if p.get("vt_code") != 8201:
            continue
        if p.get("vt_railstate") != "橋・高架":
            underground += 1
            continue
        rail_records += 1
        g = shape(record["geometry"])
        key = ("guideway", 1, 9)
        groups[key].extend(lines(g))
        widths[key].append(9)

    def height(x, y, width):
        ix, iy = round(x - grid_origin[0]), round(y - grid_origin[1])
        half = max(2, min(7, round(width * 0.22)))
        a = top[
            max(0, iy - half) : min(top.shape[0], iy + half + 1),
            max(0, ix - half) : min(top.shape[1], ix + half + 1),
        ]
        values = a[np.isfinite(a)]
        return float(np.percentile(values, 45)) if len(values) else np.nan

    records = []
    for key, segments in groups.items():
        merged = shapely.union_all([shapely.set_precision(g, 0.2) for g in segments])
        if merged.geom_type != "LineString":
            merged = linemerge(merged)
        for path in lines(merged):
            if path.length < 7:
                continue
            records.append((key[0], path, float(np.median(widths[key]))))

    dream = None
    if dream_parts:
        g = linemerge(
            shapely.union_all([shapely.set_precision(p, 0.2) for p in dream_parts])
        )
        dream = max(lines(g), key=lambda p: p.length)
        records.append(("promenade", dream, 40))

    routes = []
    count = defaultdict(int)
    lengths = defaultdict(float)
    source_profiles = []
    for kind, path, width in records:
        distances = np.linspace(0, path.length, max(3, math.ceil(path.length / 9) + 1))
        xy = np.array([path.interpolate(d).coords[0] for d in distances])
        h = np.array([height(x, y, width) for x, y in xy])
        good = np.isfinite(h)
        fallback = 19 if kind == "guideway" else 15 if kind != "expresswayGround" else 7
        if good.any():
            h = np.interp(distances, distances[good], h[good])
        else:
            h.fill(fallback)
        h = ndimage.median_filter(h, size=min(5, len(h) // 2 * 2 + 1), mode="nearest")
        h = ndimage.gaussian_filter1d(h, 1.3, mode="nearest") * scale
        # 床0mへ平坦化した街に合わせた描画高さ。実機の通行検査は統合段階で行う。
        minimum = {
            "guideway": 5.8,
            "expressway": 5.3,
            "roadbridge": 4.8,
            "footbridge": 4.6,
            "promenade": 4.5,
            "expresswayGround": 0.15,
        }[kind]
        h = np.maximum(h, minimum)
        # 広い歩道橋は端を平坦地へ接続し、中央へ緩やかに上がる形にする。
        if kind in ["promenade", "footbridge"]:
            ramp = min(30, path.length / 5)
            taper = np.minimum(1, np.minimum(distances, path.length - distances) / ramp)
            h = 0.12 + (h - 0.12) * taper
            if kind == "promenade":
                h += 0.22 * np.sin(np.pi * distances / path.length) ** 2
        # 全経路の縦勾配を制限し、点群の外れ値による局所的な山を残さない。
        for _ in range(2):
            for i in range(1, len(h)):
                delta = np.linalg.norm(xy[i] - xy[i - 1]) * scale * 0.35
                h[i] = np.clip(h[i], h[i - 1] - delta, h[i - 1] + delta)
            for i in range(len(h) - 2, -1, -1):
                delta = np.linalg.norm(xy[i + 1] - xy[i]) * scale * 0.35
                h[i] = np.clip(h[i], h[i + 1] - delta, h[i + 1] + delta)
        points = []
        support = []
        for i, ((x, y), z) in enumerate(zip(xy, h)):
            p = transform(Point(x, y))
            points.append([p.x, z, p.y])
            # 建物内へ橋脚を押し込まず、見える場所の橋脚だけを生成する。
            support.append(buildings.distance(Point(x, y)) > 2)
        a = np.rint(np.array(points) / step)
        if not np.isfinite(a).all() or np.abs(a).max() > 32767:
            raise ValueError("交通モデルの座標範囲")
        routes.append(
            {
                "kind": kind,
                "path": base64.b64encode(a.astype("<i2").tobytes()).decode(),
                "width": round(width * scale, 2),
                "piers": support,
                "sourceLength": round(path.length, 2),
            }
        )
        count[kind] += 1
        lengths[kind] += path.length * scale
        source_profiles.append(
            {
                "kind": kind,
                "lengthReal": round(path.length, 2),
                "minimumGameHeight": round(float(h.min()), 2),
                "maximumGameHeight": round(float(h.max()), 2),
            }
        )

    # 主要な地上道路だけへ簡略な白線を付ける。交差点や標識の実測復元ではない。
    markings = []
    for rec in vectors["roads"]:
        p = rec["properties"]
        g = shape(rec["geometry"])
        if (
            p.get("vt_code") != 2701
            or p.get("vt_motorway") == 1
            or p.get("vt_lvorder", 0) != 0
        ):
            continue
        if (
            p.get("vt_rdctg") not in ["国道", "都道府県道"]
            and p.get("vt_width", 0) < 1300
        ):
            continue
        for line in lines(g.simplify(0.6)):
            if line.length < 25:
                continue
            a = []
            for x, y in line.coords:
                q = transform(Point(x, y))
                a.append([q.x, 0.05, q.y])
            markings.append(
                base64.b64encode(
                    np.rint(np.array(a) / step).astype("<i2").tobytes()
                ).decode()
            )

    bridge_view = None
    if dream is not None:
        p = transform(dream.interpolate(0.5, normalized=True))
        bridge_view = {"at": [p.x, p.y], "range": 150}
    return {
        "routes": routes,
        "markings": markings,
        "bridgeView": bridge_view,
        "stats": {
            "routeCounts": dict(count),
            "gameLengths": {k: round(v, 2) for k, v in lengths.items()},
            "excludedUndergroundOrTunnelFeatures": underground,
            "elevatedRailSourceFeatures": rail_records,
            "profiles": source_profiles,
        },
        "materials": {
            "seed": 39126,
            "asphaltTileMeters": 4,
            "concreteTileMeters": 6,
            "pavingTileMeters": 3,
            "grassTileMeters": 4,
        },
        "heightMethod": "点群の標高を平滑化。平坦な街へ接続する描画高さと端のランプを補完。実機体の通行は未検証。",
    }
