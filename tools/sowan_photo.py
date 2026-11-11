#!/usr/bin/env python3
"""双湾展示区（sowan）の「写真の地面」と木を、東京都の公開点群（CC BY 4.0）から作る。

  ODAIBA_POINTCLOUD_CACHE=<置き場> python3 tools/odaiba_pointcloud_fetch.py   # 点群53区画（約4GB）を取得
  ODAIBA_POINTCLOUD_CACHE=<置き場> python3 tools/sowan_photo.py               # photo.webp と trees.npz を書く
  python3 tools/build_sowan_third.py && python3 tools/build_maps.py            # マップへ入れる

書く物（mapdesign/sowan/）：
  photo.webp  真上から見た色（8192×4096、ゲームの x -668〜668・z -356〜356）。本体が地面・屋上・橋の床へ貼る。
  trees.npz   木の位置・高さ・枝の半径・写真の色（int16：x・z は0.04m刻み、高さ・半径は0.01m刻み）。

していること：
  1. 点群（約2.2億点）を実寸0.5mの格子へ。格子ごとに、最も高い点の高さと撮影色、地面クラスの高さ、点数、複数リターンの数。
  2. 焼き込まれた建物の影を消す。点群の色は真上からの写真（正射）なので、撮影時の影が写っている。
     太陽の向きは、高さから計算した影と写真の暗さが最も合う時刻を、東西50mの帯ごとに探した値（下の SUN_HOURS。
     `--fit-sun` で探し直せる）。西の区画は13.7時ごろ、東は9.5時から14.2時へ順に撮られていた（赤緯5度＝4月上旬）。
     計算した影のうち、写真でも実際に暗い所だけを、日なたと影の明るさの比（赤1.84・緑1.71・青1.55）で戻す。
     木の影は消さない（木の足元の影として残す）。
  3. ゲームの座標（40.7度回して1/3）へ写し、彩度と明暗を少し上げて WebP にする。
  4. 木は、複数リターンが多く地面から2m以上で、ゲームの建物と交通構造の外にある4m²以上のかたまり。梢を極大点で分ける。

道具：numpy・scipy・laspy・Pillow（tools/requirements-pointcloud-map.txt）。4コアで3〜4分。
写真・画像はほかの出所から一切使っていない（色はすべて点群の撮影色）。
"""

import base64
import json
import math
import os
import sys
import tempfile
import zipfile
from multiprocessing import Pool
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from odaiba_pointcloud_extent import extent  # noqa: E402

CACHE = Path(os.environ.get("ODAIBA_POINTCLOUD_CACHE", str(Path(tempfile.gettempdir()) / "core-breaker-odaiba-pointcloud")))
OUT = ROOT / "mapdesign/sowan"
CONFIG = json.loads((ROOT / "research/maps/odaiba-pointcloud-third.json").read_text())
SRC = json.loads((OUT / "pointcloud-third/terrain.json").read_text())

STEP = 0.5  # 格子の大きさ（実寸m）
X0, Y0, X1, Y1 = CONFIG["gridBoundsProjected"]
W, H = int((X1 - X0) / STEP), int((Y1 - Y0) / STEP)

# ---- ゲームの座標との行き来（tools/odaiba_pointcloud_terrain.py と build_sowan_third.py と同じ式） ----
_, _, (OX, OZ) = extent(CONFIG)
ANGLE = math.radians(CONFIG["rotationDegrees"])
CA, SA = math.cos(ANGLE), math.sin(ANGLE)
SCALE = 3


def decode2(s):
    return np.frombuffer(base64.b64decode(s), dtype="<i2").reshape(-1, 2) * 0.05


def decode3(s):
    return np.frombuffer(base64.b64decode(s), dtype="<i2").reshape(-1, 3) * 0.05


_b = decode2(SRC["boundary"][0][0])
DZ = round(-(_b[:, 1].min() + _b[:, 1].max()) / 2 / 0.04) * 0.04  # build_sowan_third.py の zShift


def game_to_real(gx, gz):
    u, v = gx * SCALE + OX, (gz - DZ) * SCALE + OZ
    return CA * u + SA * v, SA * u - CA * v


def real_to_game(x, y):
    return (CA * x + SA * y - OX) / SCALE, (SA * x - CA * y - OZ) / SCALE + DZ


# ---- 1. 点群を格子へ ----
def grid_tile(record):
    import laspy

    with zipfile.ZipFile(record["localPath"]) as archive, archive.open(record["lasFile"]) as stream, laspy.open(stream) as reader:
        h = reader.header
        tx0, ty0 = max(X0, math.floor(h.mins[0])), max(Y0, math.floor(h.mins[1]))
        tx1, ty1 = min(X1, math.ceil(h.maxs[0]) + 1), min(Y1, math.ceil(h.maxs[1]) + 1)
        w, hh = int(round((tx1 - tx0) / STEP)), int(round((ty1 - ty0) / STEP))
        if w <= 0 or hh <= 0:
            return None
        n_cells = w * hh
        top = np.full(n_cells, -np.inf, np.float32)
        top_rgb = np.zeros((n_cells, 3), np.uint8)
        ground_n = np.zeros(n_cells, np.uint32)
        ground_z = np.zeros(n_cells, np.float64)
        count = np.zeros(n_cells, np.uint32)
        multi = np.zeros(n_cells, np.uint32)
        for p in reader.chunk_iterator(2_000_000):
            x, y, z = np.asarray(p.x), np.asarray(p.y), np.asarray(p.z)
            ix = np.floor((x - tx0) / STEP).astype(np.int64)
            iy = np.floor((y - ty0) / STEP).astype(np.int64)
            m = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < hh) & np.isfinite(z) & (~np.asarray(p.withheld, dtype=bool))
            ids = (iy * w + ix)[m]
            z = z[m].astype(np.float32)
            rgb = np.column_stack([np.asarray(getattr(p, k))[m] // 257 for k in ("red", "green", "blue")]).astype(np.uint8)
            ground = np.asarray(p.classification)[m] == 2
            returns = np.asarray(p.number_of_returns)[m]
            count += np.bincount(ids, minlength=n_cells).astype(np.uint32)
            multi += np.bincount(ids[returns > 1], minlength=n_cells).astype(np.uint32)
            ground_n += np.bincount(ids[ground], minlength=n_cells).astype(np.uint32)
            ground_z += np.bincount(ids[ground], weights=z[ground], minlength=n_cells)
            order = np.lexsort((-z, ids))
            sorted_ids = ids[order]
            pick = order[np.r_[True, sorted_ids[1:] != sorted_ids[:-1]]]
            cell = ids[pick]
            better = z[pick] > top[cell]
            cell, pick = cell[better], pick[better]
            top[cell] = z[pick]
            top_rgb[cell] = rgb[pick]
    offset = (int(round((tx0 - X0) / STEP)), int(round((ty0 - Y0) / STEP)), w, hh)
    return offset, top, top_rgb, ground_n, ground_z, count, multi


def grid():
    path = CACHE / "sowan-grid05.npz"
    if path.exists():
        return dict(np.load(path))
    manifest = json.loads((CACHE / "manifest.json").read_text())
    assert {r["file"] for r in manifest["files"]} == {r["file"] for r in CONFIG["files"]}, "取得記録と対象区画が一致しません"
    g = dict(
        top=np.full((H, W), -np.inf, np.float32),
        rgb=np.zeros((H, W, 3), np.uint8),
        ground_n=np.zeros((H, W), np.uint32),
        ground_z=np.zeros((H, W), np.float64),
        count=np.zeros((H, W), np.uint32),
        multi=np.zeros((H, W), np.uint32),
    )
    with Pool(min(4, os.cpu_count() or 1)) as pool:
        for done, r in enumerate(pool.imap_unordered(grid_tile, manifest["files"])):
            if r is None:
                continue
            (ox, oy, w, hh), top, top_rgb, ground_n, ground_z, count, multi = r
            sl = (slice(oy, oy + hh), slice(ox, ox + w))
            top = top.reshape(hh, w)
            better = top > g["top"][sl]
            g["top"][sl][better] = top[better]
            g["rgb"][sl][better] = top_rgb.reshape(hh, w, 3)[better]
            g["ground_n"][sl] += ground_n.reshape(hh, w)
            g["ground_z"][sl] += ground_z.reshape(hh, w)
            g["count"][sl] += count.reshape(hh, w)
            g["multi"][sl] += multi.reshape(hh, w)
            print("点群", done + 1, "/", len(manifest["files"]), flush=True)
    assert int(g["count"].sum()) > 2e8, "点が足りません"
    np.savez(path, **g)
    return g


def prepare(g):
    """地面の高さ（穴は最寄りの地面で埋める）、地面からの高さ、点のある格子。"""
    from scipy import ndimage as ndi

    valid = g["count"] > 0
    ground = np.where(g["ground_n"] > 0, g["ground_z"] / np.maximum(g["ground_n"], 1), np.nan).astype(np.float32)
    idx = ndi.distance_transform_edt(np.isnan(ground), return_distances=False, return_indices=True)
    ground = ndi.uniform_filter(ground[idx[0], idx[1]], 5)
    z = np.where(valid, g["top"], ground).astype(np.float32)
    return valid, ground, z, (z - ground).astype(np.float32), g["multi"] / np.maximum(g["count"], 1)


def structure_masks():
    """ゲームの建物と交通構造（橋・高架・目印の建物）の輪郭を、点群の格子へ描く。"""
    from PIL import Image, ImageDraw

    def cells(points):  # terrain.json の座標 → 格子の座標
        p = np.asarray(points, float)
        x, y = game_to_real(p[:, 0], p[:, 1] + DZ)
        return [tuple(q) for q in np.column_stack([(x - X0) / STEP, (y - Y0) / STEP])]

    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    for _lo, _hi, ring, _paint, _kind in SRC["volumes"]:
        d.polygon(cells(decode2(ring)), fill=1)
    buildings = np.array(img, bool)
    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    for r in SRC["transport"]["routes"]:
        d.line(cells(decode3(r["path"])[:, [0, 2]]), fill=1, width=max(2, int(round(r["width"] * SCALE / STEP))))
    for _paint, pts, faces, _name in SRC["meshes"]:
        c = cells(decode3(pts)[:, [0, 2]])
        for t in np.frombuffer(base64.b64decode(faces), dtype="<u2").reshape(-1, 3):
            d.polygon([c[i] for i in t], fill=1)
    return buildings, np.array(img, bool)


# ---- 2. 影を消す ----
LATITUDE = math.radians(35.63)
DECLINATION = 5  # 太陽の赤緯（度）。2・5・8・11度を試して最も合った値（4月上旬）
COLUMN = 100  # 時刻を決める帯の幅（格子。50m）
# 帯（西から数えた番号）ごとの撮影時刻（地方太陽時）。--fit-sun の結果。西の区画（18番まで）は別の飛行で13.7時ごろ。
SUN_WEST_LAST, SUN_WEST_HOUR = 18, 13.7
SUN_HOURS = {20: 9.6, 21: 9.6, 22: 9.6, 23: 9.7, 24: 9.9, 25: 10.1, 26: 10.1, 27: 10.2, 28: 10.3, 29: 10.4, 30: 10.4, 31: 10.4,
             32: 10.4, 33: 10.7, 34: 10.7, 35: 10.9, 36: 10.9, 37: 10.8, 38: 10.9, 39: 10.9, 40: 11.1, 41: 11.4, 42: 11.5,
             43: 11.4, 44: 11.7, 45: 11.7, 46: 11.8, 47: 11.9, 48: 12.0, 49: 12.2, 50: 12.3, 51: 12.3, 52: 12.4, 53: 12.4,
             54: 12.7, 55: 12.7, 56: 12.8, 57: 12.8, 58: 12.9, 59: 13.0, 60: 13.1, 61: 13.1, 62: 13.6, 63: 13.7, 64: 13.6,
             65: 13.7, 66: 13.6, 67: 13.8, 68: 13.8, 69: 13.7, 70: 14.4, 71: 14.3}
_SLOPE, _INTERCEPT = np.polyfit(list(SUN_HOURS), list(SUN_HOURS.values()), 1)
SHADOW_GAIN = np.array([1.84, 1.71, 1.55], np.float32)  # 影の境目の両側で比べた、日なた÷影の明るさ（中央値）


def sun_position(hour, declination=DECLINATION):
    """方位（北から時計回り、度）と高度（度）。"""
    angle, d = math.radians(15 * (hour - 12)), math.radians(declination)
    elevation = math.asin(math.sin(LATITUDE) * math.sin(d) + math.cos(LATITUDE) * math.cos(d) * math.cos(angle))
    azimuth = math.atan2(-math.sin(angle) * math.cos(d), math.cos(LATITUDE) * math.sin(d) - math.sin(LATITUDE) * math.cos(d) * math.cos(angle))
    return math.degrees(azimuth) % 360, math.degrees(elevation)


def column_hour(c):
    return SUN_WEST_HOUR if c <= SUN_WEST_LAST else float(_SLOPE * min(max(c, 20), 71) + _INTERCEPT)


def cast(z, occluder, azimuth, elevation, cell, reach):
    """各格子で、太陽の方向にある遮る物の高さ（距離ぶん下げた値）の最大から、自分の高さを引いた「影の深さ」。"""
    sx, sy, t = math.sin(math.radians(azimuth)), math.cos(math.radians(azimuth)), math.tan(math.radians(elevation))
    best = np.full(z.shape, -1e9, np.float32)
    h, w = z.shape
    for d in np.concatenate([np.arange(cell, 40, cell), np.arange(40, reach, max(cell, 1.0))]):
        dx, dy = int(round(d * sx / cell)), int(round(d * sy / cell))
        if dx == 0 and dy == 0:
            continue
        ys, yd = slice(max(0, -dy), min(h, h - dy)), slice(max(0, dy), min(h, h + dy))
        xs, xd = slice(max(0, -dx), min(w, w - dx)), slice(max(0, dx), min(w, w + dx))
        np.maximum(best[ys, xs], occluder[yd, xd] - d * t, out=best[ys, xs])
    return best - z


_SHADOW = {}


def _shadow_column(c):
    z, occluder = _SHADOW["z"], _SHADOW["occluder"]
    azimuth, elevation = sun_position(column_hour(c))
    reach = min(400, (float(occluder.max()) + 2) / math.tan(math.radians(elevation)))
    pad = int(abs(math.sin(math.radians(azimuth))) * reach / STEP) + 2
    c0, c1 = c * COLUMN, min(W, (c + 1) * COLUMN)
    a0, a1 = max(0, c0 - pad), min(W, c1 + pad)
    depth = cast(z[:, a0:a1], occluder[:, a0:a1], azimuth, elevation, STEP, reach)[:, c0 - a0 : c1 - a0]
    return c, np.clip(depth, -20, 60).astype(np.float16)


def remove_shadows(g, valid, ground, z, above, multi_ratio, buildings, transport):
    from scipy import ndimage as ndi

    # 影を落とす物：建物・交通構造と、複数リターンの少ない（木でない）2m以上の物。木の影は消さない。
    solid = (above > 2) & (buildings | transport | (multi_ratio < 0.25)) & valid
    solid = ndi.binary_opening(solid, iterations=1) | (buildings & (above > 2))
    _SHADOW.update(z=z, occluder=np.where(solid, z, ground).astype(np.float32))
    depth = np.zeros((H, W), np.float32)
    with Pool(min(4, os.cpu_count() or 1)) as pool:  # fork で _SHADOW を引き継ぐ
        for c, d in pool.imap_unordered(_shadow_column, range(W // COLUMN)):
            depth[:, c * COLUMN : (c + 1) * COLUMN] = d
    rgb = g["rgb"].astype(np.float32)
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    geometric = (depth > 0.3) & valid
    core = ndi.binary_erosion(depth > 1.0, iterations=3) & valid
    weight = ndi.gaussian_filter(core.astype(np.float32), 8)
    shadow_lum = ndi.gaussian_filter(np.where(core, lum, 0), 8) / np.maximum(weight, 1e-4)
    known = weight > 0.03  # 近くに影の芯がある所だけ（細い影は確かめられないので触らない）
    ratio = lum / np.maximum(shadow_lum, 1)
    s = np.where(geometric & known, np.clip((1.5 - ratio) / 0.3, 0, 1), 0.0)  # 影の平均の1.2倍より暗ければ影、1.5倍より明るければ日なた
    s = np.where(ndi.binary_dilation(geometric, iterations=3) & ~geometric & known & (ratio < 1.12), 1.0, s)  # 計算の輪郭が写真より内側だった所
    s = ndi.gaussian_filter(ndi.median_filter(s.astype(np.float32), 3), 0.7)
    gain = 1 + (SHADOW_GAIN - 1) * s[..., None]
    gain = np.maximum(1, np.minimum(gain, 205 / np.maximum(rgb.max(-1, keepdims=True), 1)))  # 白く飛ばさない
    return np.clip(rgb * gain, 0, 255).astype(np.uint8)


def fit_sun(g, valid, z):
    """帯ごとの撮影時刻を探し直す（2m格子。計算した影と写真の暗さの相関が最大の時刻）。結果を表示するだけ。"""
    f = 4
    hh, ww = H // f * f, W // f * f
    z2 = z[:hh, :ww].reshape(hh // f, f, ww // f, f).max((1, 3))
    v = valid[:hh, :ww].reshape(hh // f, f, ww // f, f)
    lum = (g["rgb"].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32))[:hh, :ww]
    lum = np.where(valid[:hh, :ww], lum, 0).reshape(hh // f, f, ww // f, f).sum((1, 3)) / np.maximum(v.sum((1, 3)), 1)
    v2, log_lum, band = v.mean((1, 3)) > 0.9, np.log(np.maximum(lum, 4)), COLUMN // f
    hours = np.arange(8.5, 15.6, 0.1)
    for declination in (2, 5, 8, 11):
        score = np.zeros((len(hours), z2.shape[1] // band), np.float32)
        for k, hour in enumerate(hours):
            shadow = cast(z2, z2, *sun_position(hour, declination), STEP * f, 260) > 1.0
            for x in range(score.shape[1]):
                sl = (slice(None), slice(x * band, (x + 1) * band))
                m = v2[sl]
                a = shadow[sl][m].astype(np.float32)
                if m.sum() >= 4000 and a.std() > 1e-6:
                    score[k, x] = np.corrcoef(a, -log_lum[sl][m])[0, 1]
        print("赤緯", declination, "合計", round(float(score.max(0).sum()), 3))
        print({x: round(float(hours[score[:, x].argmax()]), 1) for x in range(score.shape[1]) if score[:, x].max() > 0})


# ---- 3. ゲームの座標の画像 ----
PHOTO_BOUNDS = [-668, -356, 668, 356]  # build_sowan_third.py の PHOTO_BOUNDS と同じ
PHOTO_SIZE = (8192, 4096)


def write_photo(rgb, valid):
    from PIL import Image, ImageEnhance
    from scipy import ndimage as ndi

    idx = ndi.distance_transform_edt(~valid, return_distances=False, return_indices=True)
    rgb = rgb[idx[0], idx[1]]  # 点の無い所（海など）は最寄りの色で埋める（岸の縁がにじまないように）
    bx0, bz0, bx1, bz1 = PHOTO_BOUNDS
    tw, th = PHOTO_SIZE
    xs = bx0 + (np.arange(tw) + 0.5) * (bx1 - bx0) / tw
    zs = bz0 + (np.arange(th) + 0.5) * (bz1 - bz0) / th
    out = np.zeros((th, tw, 3), np.float32)
    for r0 in range(0, th, 512):
        gx, gz = np.meshgrid(xs, zs[r0 : r0 + 512])
        x, y = game_to_real(gx, gz)
        cx, cy = (x - X0) / STEP - 0.5, (y - Y0) / STEP - 0.5
        for k in range(3):
            out[r0 : r0 + 512, :, k] = ndi.map_coordinates(rgb[..., k].astype(np.float32), [cy, cx], order=1, mode="nearest")
    Image.MAX_IMAGE_PIXELS = None
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    img = ImageEnhance.Contrast(ImageEnhance.Color(img).enhance(1.28)).enhance(1.08)  # 霞んだ写真なので彩度と明暗を少し上げる
    img.save(OUT / "photo.webp", quality=60, method=4)
    print("photo.webp", (OUT / "photo.webp").stat().st_size, flush=True)


# ---- 4. 木 ----
def write_trees(rgb, valid, above, multi_ratio, buildings, transport):
    from scipy import ndimage as ndi
    from scipy.spatial import cKDTree

    near_building = ndi.binary_dilation(buildings, iterations=3) | ndi.binary_dilation(transport, iterations=2)
    canopy = (multi_ratio > 0.3) & (above > 2.0) & (above < 35) & valid & ~near_building
    canopy = ndi.binary_opening(canopy, structure=np.ones((3, 3), bool))
    label, n = ndi.label(canopy)
    canopy &= np.r_[0, ndi.sum(canopy, label, np.arange(1, n + 1))][label] >= 16  # 4m²以上（柱・標識を除く）
    height = np.where(canopy, above, 0).astype(np.float32)
    smooth = ndi.gaussian_filter(height, 1.2)
    ty, tx = np.nonzero((ndi.maximum_filter(smooth, size=13) == smooth) & (smooth > 2.2) & canopy)  # 梢（6.5m四方の極大）
    vy, vx = np.nonzero(canopy)
    dist, owner = cKDTree(np.column_stack([tx, ty])).query(np.column_stack([vx, vy]), distance_upper_bound=14)
    ok = np.isfinite(dist)
    owner, vy, vx = owner[ok], vy[ok], vx[ok]
    cells = np.bincount(owner, minlength=len(ty)).astype(float)
    top = np.zeros(len(ty))
    np.maximum.at(top, owner, above[vy, vx])
    color = np.stack([np.bincount(owner, weights=rgb[vy, vx, k], minlength=len(ty)) / np.maximum(cells, 1) for k in range(3)], 1)
    cx = np.bincount(owner, weights=vx, minlength=len(ty)) / np.maximum(cells, 1)
    cy = np.bincount(owner, weights=vy, minlength=len(ty)) / np.maximum(cells, 1)
    keep = (cells >= 12) & (top > 3)
    gx, gz = real_to_game(X0 + (cx + 0.5) * STEP, Y0 + (cy + 0.5) * STEP)
    radius = np.sqrt(cells * STEP * STEP / np.pi)
    rows = np.column_stack([np.rint(gx / 0.04), np.rint(gz / 0.04), np.rint(top / SCALE * 100), np.rint(radius / SCALE * 100), np.rint(color)])[keep]
    np.savez_compressed(OUT / "trees.npz", trees=rows.astype("<i2"))
    print("trees.npz", len(rows), "本", flush=True)


def main():
    g = grid()
    valid, ground, z, above, multi_ratio = prepare(g)
    if "--fit-sun" in sys.argv:
        return fit_sun(g, valid, z)
    buildings, transport = structure_masks()
    rgb = remove_shadows(g, valid, ground, z, above, multi_ratio, buildings, transport)
    write_photo(rgb, valid)
    write_trees(rgb, valid, above, multi_ratio, buildings, transport)


if __name__ == "__main__":
    main()
