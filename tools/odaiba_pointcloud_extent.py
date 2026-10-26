"""取得区画と、俯瞰図の上方向への拡張から切り出し範囲を作る。"""

import math

import shapely
from shapely import affinity
from shapely.geometry import Polygon, box


def extent(config):
    all_tiles = shapely.union_all([box(*r["boundsProjected"]) for r in config["files"]])
    setting = config.get("extent", {})
    original_names = set(
        setting.get("originalFiles", [r["file"] for r in config["files"]])
    )
    original = shapely.union_all(
        [
            box(*r["boundsProjected"])
            for r in config["files"]
            if r["file"] in original_names
        ]
    )
    angle = math.radians(config["rotationDegrees"])
    ca, sa = math.cos(angle), math.sin(angle)
    rotated = affinity.affine_transform(original, [ca, sa, sa, -ca, 0, 0])
    origin = [
        (rotated.bounds[0] + rotated.bounds[2]) / 2,
        (rotated.bounds[1] + rotated.bounds[3]) / 2,
    ]
    distance = setting.get("viewNorthExtensionRealMeters", 0)
    dx, dy = -sa * distance, ca * distance
    if distance:
        # 線分との和で上方向へ掃引する。中間点の反復による段差を作らない。
        swept = [original, affinity.translate(original, dx, dy)]
        for poly in getattr(original, "geoms", [original]):
            for a, b in zip(poly.exterior.coords, list(poly.exterior.coords)[1:]):
                q = Polygon([a, b, (b[0] + dx, b[1] + dy), (a[0] + dx, a[1] + dy)])
                if q.area > 0.001:
                    swept.append(q)
        boundary = shapely.union_all(swept).intersection(all_tiles)
    else:
        boundary = original
    return boundary, original, origin
