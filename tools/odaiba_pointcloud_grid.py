#!/usr/bin/env python3
"""取得区画のLASを順番に読み、1m格子の標高・地面・撮影色へ集約する。"""

import json, zipfile, time, hashlib
from pathlib import Path
import os, tempfile
import laspy, numpy as np

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

manifest = json.loads((CACHE / "manifest.json").read_text())
config = json.loads((ROOT / "research/maps/odaiba-pointcloud-third.json").read_text())
assert {r["file"] for r in manifest["files"]} == {
    r["file"] for r in config["files"]
}, "取得記録と対象区画が一致しません"
X0, Y0, X1, Y1 = config["gridBoundsProjected"]
W, H = X1 - X0, Y1 - Y0
top = np.full(H * W, -np.inf, dtype=np.float32)
color = np.zeros((H * W, 3), dtype=np.uint8)
ground_sum = np.zeros(H * W, dtype=np.float64)
ground_count = np.zeros(H * W, dtype=np.uint32)
point_count = np.zeros(H * W, dtype=np.uint16)
all_records = []
for index, r in enumerate(manifest["files"]):
    start = time.monotonic()
    path = Path(r["localPath"])
    record = {"file": r["file"], "zipSHA256": r["sha256"]}
    with zipfile.ZipFile(path) as archive, archive.open(
        r["lasFile"]
    ) as stream, laspy.open(stream) as reader:
        h = reader.header
        assert h.parse_crs().to_epsg() == 6677
        record.update(
            points=h.point_count,
            min=h.mins.tolist(),
            max=h.maxs.tolist(),
            creationDate=str(h.creation_date),
        )
        for p in reader.chunk_iterator(500000):
            x, y, z = np.asarray(p.x), np.asarray(p.y), np.asarray(p.z)
            ix = np.floor(x - X0).astype(np.int32)
            iy = np.floor(y - Y0).astype(np.int32)
            mask = (
                (ix >= 0)
                & (ix < W)
                & (iy >= 0)
                & (iy < H)
                & np.isfinite(z)
                & (~np.asarray(p.withheld, dtype=bool))
            )
            ids = iy[mask] * W + ix[mask]
            values = z[mask]
            classes = np.asarray(p.classification)[mask]
            unique, counts = np.unique(ids, return_counts=True)
            point_count[unique] = np.minimum(
                65535, point_count[unique].astype(np.uint32) + counts
            ).astype(np.uint16)
            order = np.lexsort((-values, ids))
            sorted_ids = ids[order]
            select = order[np.r_[True, sorted_ids[1:] != sorted_ids[:-1]]]
            cell = ids[select]
            zz = values[select]
            better = zz > top[cell]
            cell = cell[better]
            select = select[better]
            top[cell] = values[select]
            rgb = np.column_stack(
                [
                    np.asarray(getattr(p, k))[mask][select]
                    for k in ["red", "green", "blue"]
                ]
            )
            color[cell] = np.rint(rgb / 257).astype(np.uint8)
            ground = classes == 2
            np.add.at(ground_sum, ids[ground], values[ground])
            np.add.at(ground_count, ids[ground], 1)
    record["seconds"] = round(time.monotonic() - start, 2)
    all_records.append(record)
    print(
        json.dumps(
            {
                "done": index + 1,
                "total": len(manifest["files"]),
                "file": r["file"],
                "points": record["points"],
                "seconds": record["seconds"],
            }
        ),
        flush=True,
    )
g = np.full(H * W, np.nan, dtype=np.float32)
valid = ground_count > 0
g[valid] = ground_sum[valid] / ground_count[valid]
top[~np.isfinite(top)] = np.nan
np.savez_compressed(
    CACHE / "grid.npz",
    top=top.reshape(H, W),
    ground=g.reshape(H, W),
    rgb=color.reshape(H, W, 3),
    count=point_count.reshape(H, W),
)
result = {
    "coordinateSystem": "EPSG:6677",
    "bounds": [X0, Y0, X1, Y1],
    "stepMeters": 1,
    "dimensions": [W, H],
    "sourceFiles": len(all_records),
    "sourcePoints": sum(r["points"] for r in all_records),
    "occupiedCells": int(np.count_nonzero(point_count)),
    "groundCells": int(np.count_nonzero(valid)),
    "files": all_records,
    "gridSHA256": hashlib.sha256((CACHE / "grid.npz").read_bytes()).hexdigest(),
}
(CACHE / "grid-manifest.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + "\n"
)
(OUT / "pointcloud-source-summary.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + "\n"
)
print("COMPLETE", result["sourcePoints"], flush=True)
