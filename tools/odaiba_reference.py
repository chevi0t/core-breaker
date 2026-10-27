"""PLATEAU街区再構築用に、地理院の道路・水面・地上鉄道を同じ切り取り座標へ取り込む。"""

import argparse, concurrent.futures, hashlib, json, math, pathlib, urllib.request
import mapbox_vector_tile
import numpy as np
import shapely
from shapely.geometry import box, shape, mapping
from plateau_rect_fetch import Frame, ecef

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cache", type=pathlib.Path)
    ap.add_argument("output", type=pathlib.Path)
    args = ap.parse_args()
    config = json.loads((ROOT / "research/maps/odaiba-sources.json").read_text())
    center = config["referenceCenter"]
    angle = config["rotationDegrees"]
    scale = config["scale"]
    frame = Frame(center, angle)
    hx, hz = [h * scale for h in config["halfExtents"]]
    boundary = box(-hx, -hz, hx, hz)
    args.cache.mkdir(parents=True, exist_ok=True)
    lon, lat = center
    x = (lon + 180) / 360 * 65536
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 65536
    jobs = [
        (a, b)
        for a in range(math.floor(x) - 4, math.floor(x) + 5)
        for b in range(math.floor(y) - 4, math.floor(y) + 5)
    ]

    def fetch(job):
        x, y = job
        url = f"https://maps.gsi.go.jp/xyz/optimal_bvmap-v1/16/{x}/{y}.pbf"
        path = args.cache / f"{x}-{y}.pbf"
        if not path.exists():
            path.write_bytes(urllib.request.urlopen(url, timeout=25).read())
        return x, y, path, url

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        tiles = list(pool.map(fetch, jobs))
    roads = []
    rails = []
    water = []
    sources = []

    def components(g):
        if g.geom_type in ["LineString", "Polygon"]:
            yield g
        elif hasattr(g, "geoms"):
            for p in g.geoms:
                yield from components(p)

    for x, y, path, url in tiles:
        decoded = mapbox_vector_tile.decode(path.read_bytes())
        used = False
        for layer in ["RdCL", "RailTrCL", "WA"]:
            if layer not in decoded:
                continue
            extent = decoded[layer]["extent"]

            def transform(coords):
                lon = ((x + coords[:, 0] / extent) / 65536 * 360 - 180) * math.pi / 180
                lat = np.arctan(
                    np.sinh(math.pi * (1 - 2 * (y + 1 - coords[:, 1] / extent) / 65536))
                )
                return (
                    frame.local(ecef(lon, lat, np.zeros(len(lon))), 0)[:, [0, 2]]
                    * scale
                )

            for feature in decoded[layer]["features"]:
                props = feature["properties"]
                code = props.get("vt_code")
                if layer == "RailTrCL" and code not in [2801, 2802, 2803]:
                    continue
                if layer == "RdCL" and (
                    code not in [2701, 2703, 2711] or props.get("vt_motorway") == 1
                ):
                    continue
                geometry = shape(feature["geometry"]).intersection(
                    box(0, 0, extent, extent)
                )
                geometry = shapely.transform(geometry, transform).intersection(boundary)
                for p in components(geometry):
                    if layer == "WA":
                        if p.geom_type == "Polygon" and p.area > 1:
                            water.append(p)
                            used = True
                    elif p.geom_type == "LineString" and p.length > 1:
                        points = np.round(np.array(p.simplify(0.3).coords), 2).tolist()
                        if layer == "RailTrCL":
                            rails.append({"points": points, "code": code})
                        else:
                            rank = props.get("vt_rnkwidth", "")
                            actual = props.get("vt_width", 0) / 100
                            width = (
                                11
                                if rank == "13m以上"
                                else (
                                    7.5
                                    if rank == "5.5m-13m未満"
                                    else 5.5 if actual >= 6 else 4.5
                                )
                            )
                            roads.append(
                                {
                                    "points": points,
                                    "width": width,
                                    "rank": rank,
                                    "actualWidth": actual,
                                    "code": code,
                                }
                            )
                        used = True
        if used:
            sources.append(
                {"url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            )
    water = shapely.union_all(water).intersection(boundary)
    result = {
        "source": "国土地理院最適化ベクトルタイルを加工",
        "center": center,
        "rotationDegrees": angle,
        "scale": scale,
        "coordinateSystem": "PLATEAU取得器Frame.localと同じXZを1/2にしたゲームm",
        "layers": ["RdCL", "RailTrCL", "WA"],
        "roads": roads,
        "rails": rails,
        "water": mapping(water),
        "sources": sources,
        "license": "国土地理院コンテンツ利用規約・CC BY 4.0互換",
        "references": [
            "https://maps.gsi.go.jp/development/vt.html",
            "https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    )
    print(
        json.dumps(
            {
                "roads": len(roads),
                "rails": len(rails),
                "waterArea": round(water.area),
                "sourceTiles": len(sources),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
