"""平坦な地表を同一の保存精度で分割し、重複した描画面を残さない。"""

import base64

import numpy as np
import shapely


def polygons(g):
    if g.geom_type == "Polygon":
        yield g
    else:
        for child in getattr(g, "geoms", []):
            yield from polygons(child)


def partition(land, roads, grass, transform, step):
    def prepare(g, tolerance):
        g = shapely.make_valid(transform(g.simplify(tolerance, preserve_topology=True)))
        # 保存用の整数座標で境界線を一度だけ接続する。面ごとの丸めはしない。
        g = shapely.make_valid(shapely.transform(g, lambda a: np.rint(a / step)))
        # 丸めで線へ潰れた細片を除き、境界を取得できる面の集合に限定する。
        return shapely.union_all(list(polygons(g)), grid_size=1)

    land = prepare(land, 1.2)
    roads = prepare(roads, 1.5)
    grass = prepare(grass, 2)
    edges = shapely.union_all(
        [land.boundary, roads.boundary, grass.boundary], grid_size=1
    )
    faces = shapely.get_parts(shapely.polygonize(shapely.get_parts(edges)))
    groups = {"pavement": [], "roads": [], "grass": []}
    for p in faces:
        point = p.representative_point()
        if not land.covers(point):
            continue
        key = (
            "roads"
            if roads.covers(point)
            else "grass" if grass.covers(point) else "pavement"
        )
        groups[key].append(p)
    # 共有頂点を持つ面から地表外周も作り、細い端の隙間を残さない。
    groups["land"] = [shapely.union_all([p for ps in groups.values() for p in ps])]

    def encode(g):
        result = []
        for p in polygons(g):
            if p.area <= 0:
                continue
            result.append(
                [
                    base64.b64encode(
                        np.rint(np.asarray(r.coords[:-1])).astype("<i2").tobytes()
                    ).decode()
                    for r in [p.exterior, *p.interiors]
                ]
            )
        return result

    return {k: [rings for p in ps for rings in encode(p)] for k, ps in groups.items()}
