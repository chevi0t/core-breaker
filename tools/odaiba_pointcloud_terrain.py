#!/usr/bin/env python3
"""点群の高さ・色と地理院の輪郭を使った、実寸1/3の地形確認モデル。"""

import json, math, base64, hashlib
from pathlib import Path
import os, tempfile
import numpy as np, shapely, mapbox_earcut
from shapely.geometry import Polygon, Point, LineString, box, shape, mapping
from shapely import affinity
from scipy import ndimage, signal
from rasterio.features import geometry_mask, shapes
from affine import Affine
from pyproj import Transformer
from odaiba_transport_detail import build_transport
from odaiba_pointcloud_extent import extent

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(
    os.environ.get(
        "ODAIBA_POINTCLOUD_CACHE",
        str(Path(tempfile.gettempdir()) / "core-breaker-odaiba-pointcloud"),
    )
)
OUT = Path(
    os.environ.get(
        "ODAIBA_POINTCLOUD_OUTPUT", str(ROOT / "mapdesign/sowan/pointcloud-third")
    )
)
OUT.mkdir(parents=True, exist_ok=True)

CONFIG = json.loads((ROOT / "research/maps/odaiba-pointcloud-third.json").read_text())
GRID_INFO = json.loads((CACHE / "grid-manifest.json").read_text())
GX0, GY0, GX1, GY1 = GRID_INFO["bounds"]
V = json.loads((CACHE / "vectors.json").read_text())
G = np.load(CACHE / "grid.npz")
TOP = G["top"]
GROUND = G["ground"]
RGB = G["rgb"]
SCALE = 1 / 3
BOUND = shape(V["boundary"])
WATER = shape(V["water"])
LAND = BOUND.difference(WATER)
ANGLE = math.radians(40.7)
CA, SA = math.cos(ANGLE), math.sin(ANGLE)
ROT = affinity.affine_transform(BOUND, [CA, SA, SA, -CA, 0, 0])
_, ORIGINAL_BOUND, (OX, OZ) = extent(CONFIG)
GEOGRAPHIC = Transformer.from_crs(4326, 6677, always_xy=True)
PALETTE = [
    "#b8b9b2",
    "#b1b5b5",
    "#a4afb2",
    "#c8c7bd",
    "#b6aca0",
    "#9daeb1",
    "#c0c5c3",
    "#a2a29a",
    "#4e6c72",
    "#d7dcd7",
    "#c8c6bb",
    "#98b6ba",
    "#323e45",
    "#c9c8c4",
    "#707a7e",
]
volumes = []
meshes = []
report = {
    "unknownHeights": [],
    "buildings": [],
    "landmarks": [],
    "groundOnlyOutlines": [],
    "plateauHeightFallbacks": [],
}
raw_meshes = []
height_reference = json.loads((CACHE / "plateau-height-reference.json").read_text())


def parts(p):
    if p.geom_type == "Polygon":
        return [p]
    return [g for sub in getattr(p, "geoms", []) for g in parts(sub)]


def game(p):
    return affinity.affine_transform(
        p, [CA * SCALE, SA * SCALE, SA * SCALE, -CA * SCALE, -OX * SCALE, -OZ * SCALE]
    )


def realpoint(lon, lat):
    return Point(*GEOGRAPHIC.transform(lon, lat))


def ring(p):
    return [[round(x, 2), round(z, 2)] for x, z in p.exterior.coords[:-1]]


def encode_ring(p):
    a = np.rint(np.array(p.exterior.coords[:-1]) / 0.05).astype("<i2")
    return base64.b64encode(a.tobytes()).decode()


def encode_coords(coords):
    a = np.rint(np.array(coords) / 0.05).astype("<i2")
    return base64.b64encode(a.tobytes()).decode()


def add(poly, lo, hi, paint=0, kind=0):
    if hi - lo < 0.15:
        return
    for p in parts(shapely.make_valid(poly).intersection(BOUND)):
        p = Polygon(p.exterior).simplify(0.8, preserve_topology=True)
        if p.area < 35:
            continue
        quantized = shapely.set_precision(shapely.make_valid(game(p)), 0.05)
        for q in parts(quantized):
            q = Polygon(q.exterior)
            if q.area > 0.1:
                volumes.append(
                    [
                        round(lo * SCALE, 2),
                        round(hi * SCALE, 2),
                        encode_ring(q),
                        paint,
                        kind,
                    ]
                )


def sample(poly, pad=0):
    minx, miny, maxx, maxy = poly.buffer(pad).bounds
    ix0 = max(0, int(math.floor(minx - GX0)))
    ix1 = min(TOP.shape[1], int(math.ceil(maxx - GX0)))
    iy0 = max(0, int(math.floor(miny - GY0)))
    iy1 = min(TOP.shape[0], int(math.ceil(maxy - GY0)))
    if ix1 <= ix0 or iy1 <= iy0:
        return None
    transform = Affine(1, 0, ix0 + GX0, 0, 1, iy0 + GY0)
    mask = geometry_mask(
        [mapping(poly.buffer(pad))],
        out_shape=(iy1 - iy0, ix1 - ix0),
        transform=transform,
        invert=True,
    )
    return (
        mask,
        TOP[iy0:iy1, ix0:ix1],
        GROUND[iy0:iy1, ix0:ix1],
        RGB[iy0:iy1, ix0:ix1],
        transform,
    )


def ground_height(poly):
    s = sample(poly, 3)
    if s is None:
        return 5
    mask, top, g, _, _ = s
    values = g[mask & np.isfinite(g)]
    return float(np.median(values)) if len(values) else 5


def raster_poly(mask, transform):
    if not mask.any():
        return Polygon()
    result = [
        shape(g)
        for g, value in shapes(mask.astype("uint8"), mask=mask, transform=transform)
        if value == 1
    ]
    return shapely.union_all(result)


def nearest_paint(rgb):
    # 屋根の撮影色は量子化し、細かな写真はゲーム用データへ残さない。
    q = np.array([[int(c[i : i + 2], 16) for i in [1, 3, 5]] for c in PALETTE[:8]])
    return int(np.argmin(np.sum((q - rgb) ** 2, axis=1)))


def mesh(vertices, paint, name):
    a = np.asarray(vertices, dtype=float).reshape(-1, 3)
    x, y, z = a.T
    a = np.column_stack(
        ((x * CA + z * SA - OX) * SCALE, y * SCALE, (x * SA - z * CA - OZ) * SCALE)
    )
    pts, inv = np.unique(
        np.rint(a / 0.05).astype(np.int32), axis=0, return_inverse=True
    )
    faces = inv.reshape(-1, 3)
    aa = pts[faces].astype(float)
    area = np.linalg.norm(np.cross(aa[:, 1] - aa[:, 0], aa[:, 2] - aa[:, 0]), axis=1)
    faces = faces[area > 0]
    if len(pts) > 65535 or np.abs(pts).max() > 32767:
        raise ValueError("packing range")
    raw_meshes.append((name, a))
    meshes.append(
        [
            paint,
            base64.b64encode(pts.astype("<i2").tobytes()).decode(),
            base64.b64encode(faces.astype("<u2").tobytes()).decode(),
            name,
        ]
    )


def extrusion_xy(poly, bottom, top):
    xy = np.asarray(poly.exterior.coords[:-1])
    n = len(xy)
    idx = mapbox_earcut.triangulate_float64(
        xy.astype(float), np.array([n], dtype=np.uint32)
    ).reshape(-1, 3)
    upper = np.column_stack([xy[:, 0], np.full(n, top), xy[:, 1]])
    lower = upper.copy()
    lower[:, 1] = bottom
    out = [upper[idx], lower[idx[:, [0, 2, 1]]]]
    for i in range(n):
        j = (i + 1) % n
        out.extend([[lower[i], lower[j], upper[i]], [lower[j], upper[j], upper[i]]])
    return np.concatenate([np.asarray(v).reshape(-1, 3) for v in out])


def rect(center, u, v, half):
    return Polygon(
        [
            center + u * s * half[0] + v * t * half[1]
            for s, t in [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        ]
    )


def roof_rectangle(point, radius, threshold):
    poly = point.buffer(radius, quad_segs=1)
    mask, top, ground, rgb, transform = sample(poly)
    high = mask & np.isfinite(top) & (top > threshold)
    high = ndimage.binary_opening(high, iterations=2)
    labels, n = ndimage.label(high)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    region = labels == int(sizes.argmax())
    outline = raster_poly(region, transform).minimum_rotated_rectangle
    xy = np.array(outline.exterior.coords[:-1])
    center = xy.mean(axis=0)
    u = xy[1] - xy[0]
    v = xy[3] - xy[0]
    if np.linalg.norm(u) < np.linalg.norm(v):
        u, v = v, u
    dims = np.array([np.linalg.norm(u), np.linalg.norm(v)])
    u /= dims[0]
    v /= dims[1]
    base = ground_height(poly)
    bins = np.rint(top[region]).astype(int)
    heights, counts = np.unique(bins, return_counts=True)
    height = float(heights[np.argmax(counts)] - base)
    return center, u, v, dims, base, height


# 高所から落ちても抜けられない小さな中庭を残さない。施設位置は読み込まない。
landmark_locations = {
    "conference": realpoint(139.7937886224444, 35.63004806808523),
    "gate": realpoint(139.77998518461374, 35.61707602034881),
    "science": realpoint(139.77673236, 35.61922228),
}
roof_fits = {
    "conference": roof_rectangle(landmark_locations["conference"], 110, 50),
    "gate": roof_rectangle(landmark_locations["gate"], 110, 85),
}
special_masks = {}
for name, (center, u, v, dims, base, height) in roof_fits.items():
    special_masks[name] = rect(
        center,
        u,
        v,
        dims / 2 + (np.array([8, 8]) if name == "conference" else np.array([2, 17])),
    )
buildings = [Polygon(shape(p).exterior) for p in V["buildings"]]
for i, original in enumerate(buildings):
    poly = original
    for special in special_masks.values():
        poly = poly.difference(special)
    for part in parts(poly):
        if part.area < 35:
            continue
        s = sample(part)
        if s is None:
            continue
        mask, top, g, rgb, transform = s
        base = ground_height(part)
        valid = mask & np.isfinite(top) & (top > base + 3)
        if valid.sum() < max(12, mask.sum() * 0.05):
            observed = mask & np.isfinite(top)
            if observed.sum() > mask.sum() * 0.7:
                # 点群で実際に平らな地面を観測した古い地図の輪郭を、高い箱にしない。
                report["groundOnlyOutlines"].append(
                    {
                        "id": i,
                        "areaReal": round(part.area),
                        "observedCells": int(observed.sum()),
                    }
                )
                continue
            candidates = [
                r for r in height_reference if part.distance(Point(r["xy"])) < 5
            ]
            if candidates:
                ref = min(
                    candidates, key=lambda r: Point(r["xy"]).distance(part.centroid)
                )
                height = float(ref["height"])
                paint = i % 8
                report["plateauHeightFallbacks"].append(
                    {
                        "id": i,
                        "areaReal": round(part.area),
                        "heightReal": height,
                        "gml_id": ref["gml_id"],
                        "source": ref["source"],
                    }
                )
                add(part, 0, height, paint)
                continue
            report["unknownHeights"].append(
                {"id": i, "area": round(part.area), "fallbackHeightReal": None}
            )
            continue
        values = top[valid] - base
        colors = rgb[valid].astype(float)
        color = np.median(colors, axis=0)
        paint = nearest_paint(color)
        if part.distance(landmark_locations["science"]) < 1:
            paint = 9
        bins = np.rint(values / 3).astype(int) * 3
        unique, counts = np.unique(bins, return_counts=True)
        candidates = unique[counts >= max(50, valid.sum() * 0.08)]
        candidates = candidates[candidates >= 5]
        if not len(candidates):
            candidates = np.array([float(np.percentile(values, 75))])
        if part.area < 800:
            height = float(
                candidates[
                    np.argmax(
                        [
                            counts[np.where(unique == v)[0][0]] if v in unique else 0
                            for v in candidates
                        ]
                    )
                ]
            )
            levels = [height]
        else:
            dominant = sorted(
                candidates,
                key=lambda v: int(counts[np.where(unique == v)[0][0]]),
                reverse=True,
            )[:3]
            levels = sorted(set([float(candidates.min()), *map(float, dominant)]))
        add(part, 0, levels[0], paint)
        for height in levels[1:]:
            high = mask & np.isfinite(top) & (top >= base + height - 1.5)
            high = ndimage.binary_closing(high, iterations=2)
            high = ndimage.binary_opening(high, iterations=1)
            upper = (
                raster_poly(high, transform)
                .simplify(1.3, preserve_topology=True)
                .intersection(part)
            )
            for q in parts(upper):
                if q.area < max(100, part.area * 0.025):
                    continue
                add(q, levels[0], height, paint, 1)
        report["buildings"].append(
            {
                "id": i,
                "areaReal": round(part.area),
                "observedCells": int(valid.sum()),
                "levelsReal": [round(v, 2) for v in levels],
            }
        )

# 会議棟：点群で屋根の位置・回転・幅・主要高さを測り、写真で分かる下面を補う。
center, u, v, dims, base, roof = roof_fits["conference"]
conference_mask = rect(center, u, v, dims / 2 + 3)
# 普通の建物抽出へ使った仮の除外領域の外側まで、下面の支柱・逆四角錐を再構成。
all_tri = []
panels = []
for sx, sz in [(-1, -1), (-1, 1), (1, -1), (1, 1)]:
    c = center + u * sx * dims[0] / 4 + v * sz * dims[1] / 4
    upper = rect(c, u, v, dims / 4 - 0.6)
    lower = rect(c, u, v, np.array([8.0, 8.0]))
    topxy = np.array(upper.exterior.coords[:-1])
    lowxy = np.array(lower.exterior.coords[:-1])
    h0 = max(18, roof - 24)
    a = np.column_stack([lowxy[:, 0], np.full(4, h0), lowxy[:, 1]])
    b = np.column_stack([topxy[:, 0], np.full(4, roof), topxy[:, 1]])
    all_tri.extend([b[[0, 1, 2]], b[[0, 2, 3]], a[[0, 2, 1]], a[[0, 3, 2]]])
    for j in range(4):
        k = (j + 1) % 4
        all_tri.extend([[a[j], b[j], a[k]], [a[k], b[j], b[k]]])
        face = np.array([a[j], b[j], b[k], a[k]])
        mid = face.mean(axis=0)
        inset = mid + (face - mid) * 0.75
        normal = np.cross(face[1] - face[0], face[3] - face[0])
        normal /= np.linalg.norm(normal)
        outward = mid - np.array([c[0], mid[1], c[1]])
        outward[1] = 0
        if normal @ outward < 0:
            normal *= -1
        inset += normal * 0.3
        panels.extend([inset[[0, 1, 2]], inset[[0, 2, 3]]])
    add(rect(c, u, v, np.array([4.0, 4.0])), 0, h0, 10, 2)
    # 点群で見える屋上の四つの小棟。屋根の継ぎ目は下の薄い面で閉じる。
    add(rect(c, u, v, np.array([4.5, 4.5])), roof, roof + 8, 9, 2)
mesh(np.array(all_tri).reshape(-1, 3), 10, "conference-inverted-roofs")
mesh(np.array(panels).reshape(-1, 3), 8, "conference-sloped-panels")
add(rect(center, u, v, dims / 2), roof - 0.6, roof - 0.2, 10, 2)
add(rect(center, u, v, dims / 2 + 8), 0, 3, 13, 2)
report["landmarks"].append(
    {
        "id": "conference",
        "method": "点群による主屋根の位置・向き・寸法・高さ＋写真を参照した下面の独自補完",
        "roofDimensionsReal": dims.tolist(),
        "mainRoofHeightReal": roof,
        "openingBottomReal": max(18, roof - 24),
    }
)

# 門状の建物：点群の上部外周と高さを使い、写真で確認できる貫通するアーチを補う。
center, u, v, dims, base, height = roof_fits["gate"]
width, depth = dims
podium = 14
opening_width = width * 0.43
radius = opening_width / 2
arch_center = height - podium - 20 - radius
arc = np.linspace(math.pi, 0, 19)
hole = [
    (-radius, 0),
    (-radius, arch_center),
    *[(radius * math.cos(t), arch_center + radius * math.sin(t)) for t in arc],
    (radius, 0),
]
cross = box(-width / 2, 0, width / 2, height - podium).difference(Polygon(hole))
tri = []
for piece in parts(cross):
    xy = np.asarray(piece.exterior.coords[:-1])
    n = len(xy)
    ids = mapbox_earcut.triangulate_float64(
        xy.astype(float), np.array([n], dtype=np.uint32)
    ).reshape(-1, 3)
    front = np.array(
        [[*(center + u * x + v * (-depth / 2)), y + podium] for x, y in xy]
    )[:, [0, 2, 1]]
    back = np.array([[*(center + u * x + v * (depth / 2)), y + podium] for x, y in xy])[
        :, [0, 2, 1]
    ]
    tri.extend(front[ids])
    tri.extend(back[ids[:, [0, 2, 1]]])
    for j in range(n):
        k = (j + 1) % n
        tri.extend([[front[j], back[j], front[k]], [front[k], back[j], back[k]]])
mesh(np.array(tri).reshape(-1, 3), 8, "gate-arch")
bands = []
for band_y in np.arange(3, height - podium, 3.5):
    strip = cross.intersection(box(-width / 2, band_y, width / 2, band_y + 0.3))
    for part in parts(strip):
        xy = np.asarray(part.exterior.coords[:-1])
        ids = mapbox_earcut.triangulate_float64(
            xy.astype(float), np.array([len(xy)], dtype=np.uint32)
        ).reshape(-1, 3)
        for side in [-1, 1]:
            xyz = np.array(
                [
                    [*(center + u * x + v * side * (depth / 2 + 0.3)), y + podium]
                    for x, y in xy
                ]
            )[:, [0, 2, 1]]
            bands.extend(xyz[ids])
mesh(np.array(bands).reshape(-1, 3), 6, "gate-facade-bands")
add(rect(center, u, v, dims / 2 + np.array([0, 16])), 0, podium, 8, 2)
add(rect(center, u, v, dims / 2), height, height + 0.7, 9, 2)
report["landmarks"].append(
    {
        "id": "gate",
        "method": "点群による上部外周・高さ＋写真を参照した貫通アーチの独自補完",
        "roofDimensionsReal": dims.tolist(),
        "heightReal": height,
        "openingWidthReal": opening_width,
    }
)


def geometry_encoding(polys, tolerance=1):
    out = []
    for p in parts(polys.simplify(tolerance, preserve_topology=True)):
        if p.area > 10:
            qs = shapely.set_precision(shapely.make_valid(game(p)), 0.05)
            for q in parts(qs):
                if q.area > 0.1:
                    out.append(
                        [
                            encode_ring(Polygon(q.exterior)),
                            *[encode_coords(r.coords[:-1]) for r in q.interiors],
                        ]
                    )
    return out


roads = []
for rec in V["roads"]:
    props = rec["properties"]
    g = shape(rec["geometry"])
    code = props.get("vt_code", 0)
    if g.is_empty or g.geom_type not in ["LineString", "MultiLineString"]:
        continue
    if code not in [2701, 2703, 2711, 2713, 2731]:
        continue
    actual = props.get("vt_width", 0) / 100
    width = (
        actual
        if actual >= 3
        else (
            18
            if props.get("vt_rnkwidth") == "13m以上"
            else 9 if props.get("vt_rnkwidth") == "5.5m-13m未満" else 5
        )
    )
    p = g.buffer(width / 2, cap_style=2, join_style=2).intersection(BOUND)
    roads.append(p)
roadshape = shapely.union_all(roads).intersection(LAND)
transport = build_transport(V, TOP, game, SCALE, 0.05, (GX0, GY0))
report["transport"] = transport.pop("stats")

# 草地は撮影色から大きなまとまりだけを抽出し、建物や水面に重ねない。
rgb = RGB[::4, ::4].astype(float)
green = (
    (rgb[:, :, 1] > rgb[:, :, 0] * 1.1)
    & (rgb[:, :, 1] > rgb[:, :, 2] * 1.1)
    & (rgb[:, :, 1] > 65)
)
green = ndimage.binary_closing(green, iterations=2)
green = ndimage.binary_opening(green, iterations=1)
grass = (
    raster_poly(green, Affine(4, 0, GX0, 0, 4, GY0))
    .intersection(LAND)
    .difference(shapely.union_all(buildings))
    .difference(roadshape)
)
grass = shapely.union_all([p for p in parts(grass) if p.area > 800])

views = {
    name: {"at": [game(p).x, game(p).y], "range": 110 if name == "conference" else 130}
    for name, p in landmark_locations.items()
}
views["north"] = {"at": [0, game(ORIGINAL_BOUND).bounds[1] - 45], "range": 780}
if transport["bridgeView"]:
    views["promenade"] = transport["bridgeView"]
for kind, key in [("expressway", "expressway"), ("guideway", "guideway")]:
    candidates = [r for r in transport["routes"] if r["kind"] == kind]
    if candidates:
        route = max(candidates, key=lambda r: r["sourceLength"])
        a = (
            np.frombuffer(base64.b64decode(route["path"]), dtype="<i2").reshape(-1, 3)
            * 0.05
        )
        p = a[len(a) // 2]
        views[key] = {"at": [float(p[0]), float(p[2])], "range": 110}
model = {
    "format": "odaiba-terrain-preview-v1",
    "scale": SCALE,
    "rotationDegrees": 40.7,
    "coordinateStep": 0.05,
    "originProjected": [OX, OZ],
    "bounds": list(game(BOUND).bounds),
    "boundary": geometry_encoding(BOUND, 0.1),
    "originalBoundary": geometry_encoding(ORIGINAL_BOUND, 0.1),
    "northExtensionGameMeters": CONFIG.get("extent", {}).get(
        "viewNorthExtensionRealMeters", 0
    )
    * SCALE,
    "northExtensionCoveredBoundsGameMeters": game(ORIGINAL_BOUND).bounds[1]
    - game(BOUND).bounds[1],
    "land": geometry_encoding(LAND, 1.2),
    "water": geometry_encoding(WATER, 1.2),
    "roads": geometry_encoding(roadshape, 1.5),
    "grass": geometry_encoding(grass, 2),
    "palette": PALETTE,
    "volumes": volumes,
    "meshes": meshes,
    "transport": transport,
    "views": views,
    "sourceFiles": GRID_INFO["sourceFiles"],
    "sourcePoints": GRID_INFO["sourcePoints"],
    "bases": [],
    "plants": [],
    "referenceHeightMeters": 8,
    "note": "地形確認版。点群と地理院建物輪郭から再構築。施設による地形切り欠きなし。点群で欠けるランドマーク下面は写真参照の独自補完。",
}
encoded = json.dumps(model, ensure_ascii=False, separators=(",", ":")).encode()
(OUT / "terrain.json").write_bytes(encoded)
report.update(
    bytes=len(encoded),
    volumes=len(volumes),
    surfaceMeshes=len(meshes),
    ordinarySourceBuildingPolygons=len(buildings),
    sourceAreaReal=BOUND.area,
    areaGame=BOUND.area * SCALE**2,
    boundsGame=model["bounds"],
    gameplayValidated=False,
    plantsUsedForTerrain=False,
    allCourtyardHolesFilled=True,
    maximumBytes=500000,
    withinBudget=len(encoded) <= 500000,
)
(OUT / "terrain-build-report.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + "\n"
)
print(
    json.dumps(
        {
            k: v
            for k, v in report.items()
            if k
            not in [
                "buildings",
                "unknownHeights",
                "groundOnlyOutlines",
                "plateauHeightFallbacks",
            ]
        },
        ensure_ascii=False,
    )
)
print(
    "unknownHeights",
    len(report["unknownHeights"]),
    "groundOnlyOutlines",
    len(report["groundOnlyOutlines"]),
    "plateauHeightFallbacks",
    len(report["plateauHeightFallbacks"]),
)
assert len(encoded) <= 500000, "地形が500KB予算を超過"
