#!/usr/bin/env python3
"""公開PLATEAUを回転した長方形で取得・復号・切断する（地面や施設は追加しない）。

例：PLATEAU_DRACO_MODULE=/tmp/plateau-deps/node_modules/draco3d \
    python3 tools/plateau_rect_fetch.py /tmp/city-cache /tmp/city-source \
    --config research/maps/city-sources.json
設定の referenceCenter は経度・緯度、halfExtents はローカル x/z の半幅（m）。
"""

import argparse
import concurrent.futures
import hashlib
import json
import math
import pathlib
import subprocess
import time
import urllib.parse
import urllib.request

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
A = 6378137.0
E2 = 0.0066943799901413165


def ecef(lon, lat, h):
    n = A / np.sqrt(1 - E2 * np.sin(lat) ** 2)
    return np.stack(
        (
            (n + h) * np.cos(lat) * np.cos(lon),
            (n + h) * np.cos(lat) * np.sin(lon),
            (n * (1 - E2) + h) * np.sin(lat),
        ),
        axis=-1,
    )


class Frame:
    def __init__(self, center, rotation):
        lon, lat = map(math.radians, center)
        angle = math.radians(rotation)
        self.ca, self.sa = math.cos(angle), math.sin(angle)
        self.east = np.array([-math.sin(lon), math.cos(lon), 0])
        self.up = np.array(
            [
                math.cos(lat) * math.cos(lon),
                math.cos(lat) * math.sin(lon),
                math.sin(lat),
            ]
        )
        self.north = np.cross(self.up, self.east)
        self.reference = ecef(lon, lat, 0)

    def local(self, v, base):
        q = v - self.reference
        e = q @ self.east
        s = -q @ self.north
        return np.stack(
            (e * self.ca - s * self.sa, q @ self.up - base, e * self.sa + s * self.ca),
            axis=-1,
        )


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def fetch(url, path):
    if not path.exists():
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=40) as response:
                    data = response.read()
                temporary = path.with_suffix(path.suffix + ".part")
                temporary.write_bytes(data)
                temporary.replace(path)
                break
            except (OSError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
    data = path.read_bytes()
    return {
        "url": url,
        "file": path.name,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def clip_rectangle(triangles, half_extents):
    """原三角形を四辺で切断し、境界の外側や退化面だけを除く。"""
    half = np.asarray(half_extents, dtype=float)
    valid = (triangles[:, :, [0, 2]].min(axis=1) <= half).all(axis=1) & (
        triangles[:, :, [0, 2]].max(axis=1) >= -half
    ).all(axis=1)
    triangles = triangles[valid]
    inside = (np.abs(triangles[:, :, [0, 2]]) <= half).all(axis=(1, 2))
    output = [triangles[inside].reshape(-1, 3)]
    for triangle in triangles[~inside]:
        polygon = list(triangle)
        for axis, extent, sign in [
            (0, half[0], 1),
            (0, half[0], -1),
            (2, half[1], 1),
            (2, half[1], -1),
        ]:
            clipped = []
            for i, a in enumerate(polygon):
                b = polygon[(i + 1) % len(polygon)]
                da, db = extent - sign * a[axis], extent - sign * b[axis]
                if da >= 0:
                    clipped.append(a)
                if (da >= 0) != (db >= 0):
                    point = a + (b - a) * (da / (da - db))
                    point[axis] = sign * extent
                    clipped.append(point)
            polygon = clipped
            if len(polygon) < 3:
                break
        if len(polygon) >= 3:
            output.append(
                np.asarray(
                    [
                        [polygon[0], polygon[i], polygon[i + 1]]
                        for i in range(1, len(polygon) - 1)
                    ]
                ).reshape(-1, 3)
            )
    result = np.concatenate(output).reshape(-1, 3, 3)
    area2 = np.linalg.norm(
        np.cross(result[:, 1] - result[:, 0], result[:, 2] - result[:, 0]), axis=1
    )
    return result[area2 > 1e-5].reshape(-1, 3).astype("<f4")


def geographic_bounds(center, rotation, half_extents):
    """回転長方形を囲む経緯度範囲。地球曲率と丸めのため8m余白を持つ。"""
    lon, lat = map(math.radians, center)
    angle = math.radians(rotation)
    ca, sa = abs(math.cos(angle)), abs(math.sin(angle))
    east = half_extents[0] * ca + half_extents[1] * sa + 8
    north = half_extents[0] * sa + half_extents[1] * ca + 8
    radius_e = A / math.sqrt(1 - E2 * math.sin(lat) ** 2)
    radius_n = A * (1 - E2) / (1 - E2 * math.sin(lat) ** 2) ** 1.5
    dl, dp = east / (radius_e * math.cos(lat)), north / radius_n
    return [lon - dl, lat - dp, lon + dl, lat + dp]


def check_source_bounds(points, region, label):
    """公開タイルの経緯度・楕円体高を独立式で照合し、軸やRTCの誤りを検出。"""
    x, y, z = points.T
    b = 6356752.314245179
    ep2 = (A * A - b * b) / (b * b)
    p = np.hypot(x, y)
    q = np.arctan2(z * A, p * b)
    lat = np.arctan2(z + ep2 * b * np.sin(q) ** 3, p - E2 * A * np.cos(q) ** 3)
    lon = np.arctan2(y, x)
    height = p / np.cos(lat) - A / np.sqrt(1 - E2 * np.sin(lat) ** 2)
    if not (
        lon.min() >= region[0] - 2e-7
        and lon.max() <= region[2] + 2e-7
        and lat.min() >= region[1] - 2e-7
        and lat.max() <= region[3] + 2e-7
    ):
        raise ValueError("公開タイルの経緯度範囲と復号座標が一致しません: " + label)
    error = max(region[4] - height.min(), height.max() - region[5], 0)
    if error >= 0.2:
        raise ValueError(
            f"公開タイルの高さ範囲と復号座標が一致しません: {label}: {error}"
        )
    return float(error)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--config", required=True, type=pathlib.Path)
    args = parser.parse_args()
    cache, output = args.cache, args.output
    cache.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    source_bytes = args.config.read_bytes()
    config = json.loads(source_bytes)
    center = config["referenceCenter"]
    rotation = float(config.get("rotationDegrees", 0))
    half = config["halfExtents"]
    if (
        len(center) != 2
        or len(half) != 2
        or not all(math.isfinite(v) for v in [*center, *half, rotation])
        or min(half) <= 0
    ):
        raise ValueError("中心・回転・長方形の寸法が不正です")
    bounds = geographic_bounds(center, rotation, half)
    identity = {
        "center": center,
        "rotationDegrees": rotation,
        "halfExtents": half,
        "tilesetUrls": [item["url"] for item in config["tilesets"]],
    }
    identity_path = cache / "rectangle-identity.json"
    if identity_path.exists() and json.loads(identity_path.read_text()) != identity:
        raise ValueError(
            "取得済みキャッシュの範囲・出典と異なります。別のキャッシュを指定してください。"
        )
    identity_path.write_bytes(compact(identity) + b"\n")
    jobs, tilesets = [], []
    for item in config["tilesets"]:
        kind, url = item["type"], item["url"]
        if kind not in ("bldg", "tran", "brid"):
            raise ValueError("未対応の地物: " + kind)
        ident = item.get("id", kind)
        record = fetch(url, cache / f"{ident}-tileset.json")
        tilesets.append({"kind": kind, **record})
        tree = json.loads((cache / record["file"]).read_bytes())

        def visit(node, refine="REPLACE"):
            if node.get("transform"):
                raise ValueError("未対応のタイル変換行列")
            refine = node.get("refine", refine)
            if refine != "REPLACE":
                raise ValueError("ADD形式では親子の重複を確認してください")
            # 親の範囲が子を完全に覆わないデータがあるため、実contentの末端で判定。
            if node.get("children"):
                for child in node["children"]:
                    visit(child, refine)
            elif node.get("content"):
                content = node["content"]
                region = content.get(
                    "boundingVolume", node.get("boundingVolume", {})
                ).get("region")
                if region is None:
                    raise ValueError("経緯度範囲のないタイル")
                if (
                    region[0] > bounds[2]
                    or region[2] < bounds[0]
                    or region[1] > bounds[3]
                    or region[3] < bounds[1]
                ):
                    return
                uri = content.get("uri", content.get("url"))
                tile_url = urllib.parse.urljoin(url, uri)
                name = (
                    ident
                    + "-"
                    + hashlib.sha256(tile_url.encode()).hexdigest()[:12]
                    + "-"
                    + uri.rsplit("/", 1)[-1]
                )
                jobs.append((kind, tile_url, cache / name, region))

        visit(tree["root"])
    jobs = list({job[1]: job for job in jobs}.values())
    print(
        json.dumps(
            {
                "selectedTiles": len(jobs),
                "geographicBoundsDegrees": list(map(math.degrees, bounds)),
            }
        ),
        flush=True,
    )

    def worker(job):
        kind, url, path, region = job
        return {"kind": kind, "bounds": region, **fetch(url, path)}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        models = list(pool.map(worker, jobs))
    geoid = fetch(
        "https://vldb.gsi.go.jp/sokuchi/surveycalc/geoid/calcgh/cgi/geoidcalc.pl?outputType=json&latitude="
        + str(center[1])
        + "&longitude="
        + str(center[0]),
        cache / "geoid.txt",
    )
    elevation = fetch(
        "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon="
        + str(center[0])
        + "&lat="
        + str(center[1])
        + "&outtype=JSON",
        cache / "gsi-elevation.json",
    )
    manifest = {
        "center": center,
        "rotationDegrees": rotation,
        "halfExtents": half,
        "display": config.get("display", {}),
        "geographicBoundsRadians": bounds,
        "configSHA256": hashlib.sha256(source_bytes).hexdigest(),
        "models": models,
        "tilesets": tilesets,
        "geoid": geoid,
        "referenceElevation": elevation,
        "dem": [],
        "sourceLinks": list(
            {
                item.get("datasetUrl", config.get("officialDatasetUrl")): {
                    "url": item.get("datasetUrl", config.get("officialDatasetUrl")),
                    "label": item.get(
                        "label",
                        config.get("areaName", "")
                        + str(config.get("year", ""))
                        + "年度3D都市モデル",
                    ),
                }
                for item in config["tilesets"]
            }.values()
        ),
    }
    (cache / "inputs.json").write_bytes(compact(manifest) + b"\n")
    print(
        json.dumps(
            {
                "downloadedTiles": len(models),
                "bytes": sum(item["bytes"] for item in models),
            }
        ),
        flush=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tools/plateau_decode.cjs"), str(cache.resolve())],
        check=True,
    )
    frame = Frame(center, rotation)
    gh = float(
        json.loads((cache / "geoid.txt").read_text())["OutputData"]["geoidHeight"]
    )
    value = json.loads((cache / "gsi-elevation.json").read_text())["elevation"]
    reference = float(config.get("referenceElevation", value))
    base = gh + reference
    records = json.loads((cache / "decoded/meshes.json").read_text())
    regions = {item["file"]: item["bounds"] for item in models}
    layers = {kind: [] for kind in ["bldg", "tran", "brid"]}
    worst, decoded_triangles = 0.0, 0
    for record in records:
        folder = cache / "decoded"
        positions = (
            np.fromfile(folder / (record["name"] + ".pos"), dtype="<f4")
            .reshape(-1, 3)
            .astype(float)
        )
        points = positions[:, [0, 2, 1]] * np.array([1, -1, 1]) + record["rtc"]
        if not np.isfinite(points).all():
            raise ValueError("有限値でない頂点: " + record["name"])
        worst = max(
            worst,
            check_source_bounds(points, regions[record["source"]], record["name"]),
        )
        local = frame.local(points, base)
        indices = np.fromfile(folder / (record["name"] + ".idx"), dtype="<u4").reshape(
            -1, 3
        )
        if indices.max(initial=0) >= len(local):
            raise ValueError("頂点番号の範囲外: " + record["name"])
        decoded_triangles += len(indices)
        layers[record["kind"]].append(clip_rectangle(local[indices], half))
    layers = {
        kind: np.concatenate(values) if values else np.empty((0, 3), dtype="<f4")
        for kind, values in layers.items()
    }
    if not len(layers["bldg"]):
        raise ValueError("指定範囲に建物がありません")
    for kind, vertices in layers.items():
        if (
            not np.isfinite(vertices).all()
            or (np.abs(vertices[:, [0, 2]]) > np.asarray(half) + 0.001).any()
        ):
            raise ValueError("切断結果の範囲・有限値が不正: " + kind)
    np.savez_compressed(output / "geometry.npz", **layers)
    stats = {
        kind: {
            "triangles": len(v) // 3,
            "min": v.astype(float).min(axis=0).round(3).tolist() if len(v) else None,
            "max": v.astype(float).max(axis=0).round(3).tolist() if len(v) else None,
        }
        for kind, v in layers.items()
    }
    summary = {
        "center": center,
        "rotationDegrees": rotation,
        "halfExtents": half,
        "dimensionsMeters": [v * 2 for v in half],
        "extentMeters": max(half) * 2,
        "referenceElevation": reference,
        "geoidHeight": gh,
        "display": config.get("display", {}),
        "layers": stats,
        "sourceModelTiles": len(models),
        "decodedMeshes": len(records),
        "decodedTriangles": decoded_triangles,
        "maxHeightOutsideSourceBoundsMeters": worst,
        "geometrySHA256": hashlib.sha256(
            (output / "geometry.npz").read_bytes()
        ).hexdigest(),
        "finiteAndClipped": True,
        "sourceGeometryPreservedExceptBoundaryClipping": True,
        "groundAdded": False,
        "bases": 0,
        "plants": 0,
    }
    (output / "source-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    (output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
