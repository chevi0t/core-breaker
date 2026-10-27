#!/usr/bin/env python3
import json, math, hashlib
from pathlib import Path
import os, tempfile
import numpy as np
import shapely
from shapely.geometry import shape, box, mapping, Polygon, LineString
from pyproj import Transformer
import mapbox_vector_tile
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

ref = json.loads((ROOT / "research/maps/odaiba-pointcloud-third.json").read_text())
boundary, original_boundary, origin = extent(ref)
trans = Transformer.from_crs(4326, 6677, always_xy=True)
collected = {
    k: [] for k in ["BldA", "RdCL", "RailCL", "RailTrCL", "WA", "RdCompt", "WStrA"]
}
sources = []
tile_paths = [CACHE / "gsi" / "-".join(r["url"].split("/")[-2:]) for r in ref["gsi"]]
for path in sorted(tile_paths):
    x, y = map(int, path.stem.split("-"))
    decoded = mapbox_vector_tile.decode(path.read_bytes())
    used = False
    for name in collected:
        if name not in decoded:
            continue
        extent = decoded[name]["extent"]

        def convert(coords):
            lon = (x + coords[:, 0] / extent) / 65536 * 360 - 180
            lat = np.degrees(
                np.arctan(
                    np.sinh(math.pi * (1 - 2 * (y + 1 - coords[:, 1] / extent) / 65536))
                )
            )
            xx, yy = trans.transform(lon, lat)
            return np.column_stack([xx, yy])

        for f in decoded[name]["features"]:
            g = shape(f["geometry"]).intersection(box(0, 0, extent, extent))
            if g.is_empty:
                continue
            g = shapely.transform(g, convert).intersection(boundary)
            if g.is_empty:
                continue
            collected[name].append({"geometry": g, "properties": f["properties"]})
            used = True
    if used:
        sources.append(
            {
                "url": f'https://maps.gsi.go.jp/xyz/optimal_bvmap-v1/16/{path.stem.replace("-","/")}.pbf',
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
water = shapely.union_all([f["geometry"] for f in collected["WA"]]).intersection(
    boundary
)
bld = shapely.union_all([f["geometry"] for f in collected["BldA"]])


def parts(g):
    if g.geom_type == "Polygon":
        return [g]
    return [p for sub in getattr(g, "geoms", []) for p in parts(sub)]


buildings = [Polygon(p.exterior) for p in parts(bld) if p.area > 30]
result = {
    "coordinateSystem": "EPSG:6677",
    "boundary": mapping(boundary),
    "water": mapping(water),
    "buildings": [mapping(p) for p in buildings],
    "roads": [
        {"geometry": mapping(f["geometry"]), "properties": f["properties"]}
        for f in collected["RdCL"]
    ],
    "rails": [
        {"geometry": mapping(f["geometry"]), "properties": f["properties"]}
        for k in ["RailCL", "RailTrCL"]
        for f in collected[k]
    ],
    "roadCompartments": [
        {"geometry": mapping(f["geometry"]), "properties": f["properties"]}
        for f in collected["RdCompt"]
    ],
    "waterStructures": [mapping(f["geometry"]) for f in collected["WStrA"]],
    "sources": sources,
}
(CACHE / "vectors.json").write_text(
    json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
)
print(
    json.dumps(
        {
            "buildings": len(buildings),
            "roads": len(result["roads"]),
            "rails": len(result["rails"]),
            "sourceTiles": len(sources),
            "waterAreaReal": water.area,
            "boundaryAreaReal": boundary.area,
        }
    )
)
