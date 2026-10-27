"""既存PLATEAU試作の輪郭再構築を再利用する。路地を埋める処理は含めない。"""

import numpy as np
import mapbox_earcut
import shapely
from shapely.geometry import Polygon
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components


def index_mesh(vertices):
    points, inverse = np.unique(
        np.round(vertices.astype(float), 3), axis=0, return_inverse=True
    )
    faces = inverse.reshape(-1, 3).astype(np.int32)
    t = points[faces]
    valid = (
        np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1) > 1e-7
    )
    return points, faces[valid]


def remove_small_components(points, faces):
    a = faces.ravel()
    b = faces[:, [1, 2, 0]].ravel()
    graph = coo_matrix(
        (np.ones(len(a)), (a, b)), shape=(len(points), len(points))
    ).tocsr()
    count, labels = connected_components(graph, directed=False)
    lo = np.full((count, 3), np.inf)
    hi = np.full((count, 3), -np.inf)
    np.minimum.at(lo, labels, points)
    np.maximum.at(hi, labels, points)
    size = hi - lo
    small = (np.maximum(size[:, 0], size[:, 2]) < 3) | (
        (size[:, 1] < 2.5) & (size[:, 0] * size[:, 2] < 64)
    )
    keep = ~small[labels[faces[:, 0]]]
    return faces[keep], {
        "removedComponents": int(
            np.count_nonzero(small[np.unique(labels[faces[:, 0]])])
        ),
        "removedTriangles": int(np.count_nonzero(~keep)),
    }


def projection(vertices, precision=0.02, coverage=False):
    t = vertices.reshape(-1, 3, 3)[:, :, [0, 2]].astype(float)
    area = np.abs(
        (t[:, 1, 0] - t[:, 0, 0]) * (t[:, 2, 1] - t[:, 0, 1])
        - (t[:, 2, 0] - t[:, 0, 0]) * (t[:, 1, 1] - t[:, 0, 1])
    )
    polygons = shapely.polygons(t[area > 1e-5])
    polygons = shapely.set_precision(polygons, precision)
    return shapely.make_valid(
        shapely.coverage_union_all(polygons)
        if coverage
        else shapely.union_all(polygons)
    )


def parts(geometry):
    if isinstance(geometry, Polygon):
        return [geometry]
    return [p for g in getattr(geometry, "geoms", []) for p in parts(g)]


def extrusion(polygon, bottom, top, floor=True):
    rings = [np.array(r.coords[:-1]) for r in [polygon.exterior, *polygon.interiors]]
    xy = np.concatenate(rings).astype(float)
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    idx = mapbox_earcut.triangulate_float64(xy, ends).reshape(-1, 3)
    upper = np.column_stack((xy[:, 0], np.full(len(xy), top), xy[:, 1]))
    lower = upper.copy()
    lower[:, 1] = bottom
    roof = upper[idx]
    flip = np.cross(roof[:, 1] - roof[:, 0], roof[:, 2] - roof[:, 0])[:, 1] < 0
    roof[flip] = roof[flip][:, [0, 2, 1]]
    base = lower[idx]
    flip = np.cross(base[:, 1] - base[:, 0], base[:, 2] - base[:, 0])[:, 1] > 0
    base[flip] = base[flip][:, [0, 2, 1]]
    # 地中に埋まる底面は描画しない。橋のような高架部分の下面は保持。
    triangles = [roof, base] if floor else [roof]
    for ring in rings:
        for a, b in zip(ring, np.roll(ring, -1, axis=0)):
            triangles.append(
                np.array(
                    [
                        [[a[0], bottom, a[1]], [b[0], bottom, b[1]], [a[0], top, a[1]]],
                        [[b[0], bottom, b[1]], [b[0], top, b[1]], [a[0], top, a[1]]],
                    ]
                )
            )
    return np.concatenate(triangles).reshape(-1, 3).astype("<f4")


def rings(p):
    return [
        [[round(x, 3), round(z, 3)] for x, z in r.coords[:-1]]
        for r in [p.exterior, *p.interiors]
    ]


def building_masses(vertices, land, roads, profile, bottom, road_ceiling):
    """外周と面積のある屋根から箱を組む。細部のQEMによる屋根の崩れを避ける。"""
    points, faces = index_mesh(vertices)
    faces, removed = remove_small_components(points, faces)
    triangles = points[faces]
    normals = np.cross(
        triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]
    )
    roof = triangles[
        (normals[:, 1] > 0.7 * np.linalg.norm(normals, axis=1)) & (normals[:, 1] > 1e-4)
    ]
    area = np.cross(roof[:, 1] - roof[:, 0], roof[:, 2] - roof[:, 0])[:, 1] / 2
    centers = roof.mean(axis=1)
    heights = centers[:, 1]
    outlines = parts(
        projection(triangles.reshape(-1, 3), profile["footprintPrecision"])
    )
    tree = shapely.STRtree(outlines)
    matches = tree.query(shapely.points(centers[:, [0, 2]]), predicate="within")
    assignments = [[] for _ in outlines]
    for face, outline in matches.T:
        assignments[outline].append(face)
    meshes = []
    volumes = []
    grounded = []

    def add(shape, lo, hi, kind):
        if hi - lo < 0.1:
            return
        for p in parts(shapely.make_valid(shape)):
            if p.area < profile["minimumBuildingArea"]:
                continue
            meshes.append(extrusion(p, lo, hi, kind != "grounded"))
            volumes.append(
                {
                    "rings": rings(p),
                    "bottom": round(lo, 3),
                    "top": round(hi, 3),
                    "kind": kind,
                }
            )
            if kind == "grounded":
                grounded.append(p)

    for outline, ids in zip(outlines, assignments):
        if (
            not ids
            or outline.area < profile["minimumBuildingArea"]
            or outline.buffer(-1.3).is_empty
        ):
            continue
        ids = np.array(ids)
        a = area[ids]
        h = heights[ids]
        # 低層の庇と屋上の小物ではなく、面積のある高さを優先する。
        band = np.rint(h / profile["roofHeightStep"]) * profile["roofHeightStep"]
        levels = np.unique(band)
        weights = np.array([a[band == v].sum() for v in levels])
        meaningful = levels[
            weights >= max(profile["minimumRoofArea"], outline.area * 0.025)
        ]
        if not len(meaningful):
            meaningful = np.array([levels[np.argmax(weights)]])
        meaningful = meaningful[meaningful > road_ceiling - 2]
        if not len(meaningful):
            continue
        if outline.area < profile["tieredBuildingArea"]:
            # 小さな棟は単純な角柱にまとめる。面積の大きい屋根の高さを採用。
            base = float(
                max(meaningful, key=lambda v: weights[np.where(levels == v)[0][0]])
            )
            levels_used = [base]
        else:
            base = float(meaningful.min())
            chosen = sorted(
                meaningful,
                key=lambda v: weights[np.where(levels == v)[0][0]],
                reverse=True,
            )[:3]
            levels_used = sorted(
                set([base, float(meaningful.max()), *map(float, chosen)])
            )
        shape = outline.simplify(profile["outlineTolerance"], preserve_topology=True)
        # 小さな中庭は塞ぐが、大きな中庭は残す。
        shape = Polygon(
            shape.exterior, [r for r in shape.interiors if Polygon(r).area >= 64]
        )
        add(shape.intersection(land).difference(roads), bottom, base, "grounded")
        add(shape.difference(land.difference(roads)), road_ceiling, base, "elevated")
        for height in levels_used[1:]:
            selected = roof[ids[band >= height]]
            if not len(selected):
                continue
            mask = (
                projection(selected.reshape(-1, 3), profile["footprintPrecision"])
                .simplify(profile["outlineTolerance"], preserve_topology=True)
                .intersection(shape)
            )
            if base < road_ceiling:
                # 低い基壇の上は基壇へ接続。道路・川の上だけ頭上空間を確保。
                add(mask.intersection(land).difference(roads), base, height, "upper")
                add(
                    mask.difference(land.difference(roads)),
                    road_ceiling,
                    height,
                    "elevated",
                )
            else:
                add(mask, base, height, "upper")
    return np.concatenate(meshes), volumes, shapely.union_all(grounded), removed
