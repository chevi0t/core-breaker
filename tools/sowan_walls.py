#!/usr/bin/env python3
"""双湾展示区（sowan）の建物の壁の色を、PLATEAU の3D都市モデルから取る。

  SOWAN_PLATEAU_CACHE=<置き場> python3 tools/sowan_walls.py --fetch   # 目録と、範囲に掛かる区画（約130MB）を取得
  SOWAN_PLATEAU_CACHE=<置き場> python3 tools/sowan_walls.py           # mapdesign/sowan/walls.json を書く
  python3 tools/build_sowan_third.py && python3 tools/build_maps.py     # マップへ入れる

なぜ要るか：点群の色は真上からの写真で付けてあるので、壁に当たった点も屋根と同じ色をしている（壁の色は入っていない）。
壁の色がある公開データは、斜めの航空写真を壁に貼った PLATEAU の建築物モデル（LOD2、テクスチャ付き）だけだった。

出所：国土交通省 3D都市モデル（Project PLATEAU）東京都23区 建築物モデル LOD2（2025年度版、3D Tiles、CC BY 4.0）。
  港区 13103_bldg_lod2、江東区 13108_bldg_lod2、品川区 13109_bldg_lod2（目録 https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets ）。

していること：
  1. 範囲に掛かる区画（b3dm）を読む。形は Draco 圧縮、写真は区画ごとに1枚の WebP。
  2. 立っている面（壁）だけを選び、面積4m²につき1点の割合で写真の色を拾う。
  3. 拾った点を、位置と高さでゲームの建物（terrain.json の volumes）へ割り当てる。
  4. 写真の色かぶり（遠くからの斜めの写真で、全体が青くかすんでいる）を直す。同じ屋根を地面の写真（点群の色）と比べて
     式を決め、壁にも同じ式を使う。
  5. 建物ごとに、明るさの順で55〜95%の所（影の面と窓を除いた、日の当たった外装）を、面積で重みを付けて平均する
     （sRGB を線形に直してから）。窓の並びや模様は取らない（オーナーの指定 2026-11-12）。
  6. 壁を拾えなかった建物（PLATEAU に写真付きの形が無い倉庫など）は null のままにする（マップ側が屋根の色から塗る）。

マップに入るのは建物ごとの色1つだけで、PLATEAU の形・写真そのものは入れない。
道具：numpy・shapely・pyproj・Pillow・DracoPy。
"""

import io
import json
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import sowan_photo as sp  # noqa: E402

CACHE = Path(os.environ.get("SOWAN_PLATEAU_CACHE", str(Path(tempfile.gettempdir()) / "core-breaker-sowan-plateau")))
OUT = ROOT / "mapdesign/sowan/walls.json"
CATALOG = "https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets"
DATASETS = ["13103_bldg_lod2", "13108_bldg_lod2", "13109_bldg_lod2"]
BOUNDS = [-668, -356, 668, 356]  # ゲームの x・z（写真の地面と同じ）
SAMPLE_AREA = 4.0  # 壁の面積（実寸m²）あたり1点
ROOF_SAMPLE_AREA = 16.0  # 屋根は色合わせに使うだけなので粗く
NEAR = 1.5  # 建物の輪郭からこの距離（ゲームm）までの壁を、その建物の壁とみなす
MIN_AREA = 60.0  # これより壁の面積（実寸m²）が少ない建物は、色を決めない
BAND = (0.55, 0.95)  # 明るさの順でこの範囲だけを平均する（暗い側＝影の面と窓、明るすぎる側＝反射を除く）


def transformers():
    from pyproj import Transformer

    return Transformer.from_crs(4978, 6677, always_xy=True), Transformer.from_crs(6677, 4326, always_xy=True)


def curl(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 0:
        return
    subprocess.run(["curl", "-sS", "-f", "-m", "600", "--retry", "3", "-o", str(path), url], check=True)


def tiles(folder):
    """範囲に掛かる、最も細かい区画の一覧。"""
    _, to_ll = transformers()
    x0, z0, x1, z1 = BOUNDS
    ll = np.radians([to_ll.transform(*sp.game_to_real(x, z)) for x, z in [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]])
    w, e, s, n = ll[:, 0].min(), ll[:, 0].max(), ll[:, 1].min(), ll[:, 1].max()

    def hit(r):
        return not (r[0] > e or r[2] < w or r[1] > n or r[3] < s)

    out = []

    def walk(node):
        if not hit(node["boundingVolume"]["region"]):
            return
        content = node.get("content")
        if content and not node.get("children") and hit(content.get("boundingVolume", node["boundingVolume"])["region"]):
            out.append(content["uri"])
        for child in node.get("children", []):
            walk(child)

    walk(json.loads((folder / "tileset.json").read_text())["root"])
    return out


def fetch():
    curl(CATALOG, CACHE / "catalog.json")
    found = {d["id"]: d for d in json.loads((CACHE / "catalog.json").read_text())["datasets"] if d["id"] in DATASETS}
    assert set(found) == set(DATASETS), "目録に建築物 LOD2 が見つかりません"
    record = []
    for name in DATASETS:
        d = found[name]
        assert d["texture"] and str(d["lod"]) == "2" and d["format"] == "3D Tiles", name
        folder = CACHE / name
        curl(d["url"], folder / "tileset.json")
        base = d["url"].rsplit("/", 1)[0] + "/"
        uris = tiles(folder)
        for n, uri in enumerate(uris):
            curl(base + uri, folder / uri)
            print(name, n + 1, "/", len(uris), flush=True)
        record.append({"id": name, "name": d["name"], "year": d["year"], "url": d["url"], "tiles": uris})
    (CACHE / "manifest.json").write_text(json.dumps(record, ensure_ascii=False, indent=1))


# ---- 区画（b3dm）を読む ----
def read_tile(path):
    """壁の上に拾った点：実寸の平面座標 x・y、標高（楕円体高）、線形の色、重み（m²）、建物の番号（区画の中の通し番号）。"""
    import DracoPy
    from PIL import Image

    to_plane, _ = transformers()
    b = path.read_bytes()
    assert b[:4] == b"b3dm"
    ftj, ftb, btj, btb = struct.unpack("<IIII", b[12:28])
    g = b[28 + ftj + ftb + btj + btb:]
    assert g[:4] == b"glTF"
    n = struct.unpack("<I", g[12:16])[0]
    js = json.loads(g[20:20 + n])
    binary = g[28 + n:]
    center = np.array(js["extensions"]["CESIUM_RTC"]["center"])

    def view(i):
        v = js["bufferViews"][i]
        return binary[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]

    images = {}
    rng = np.random.default_rng(1)
    out = []
    for mesh in js["meshes"]:
        for prim in mesh["primitives"]:
            tex = js["materials"][prim["material"]].get("pbrMetallicRoughness", {}).get("baseColorTexture")
            if tex is None:
                continue  # 写真の無い面
            source = js["textures"][tex["index"]]
            source = source.get("extensions", {}).get("EXT_texture_webp", source)["source"]
            if source not in images:
                images[source] = np.asarray(Image.open(io.BytesIO(view(js["images"][source]["bufferView"]))).convert("RGB"))
            image = images[source]
            draco = prim["extensions"]["KHR_draco_mesh_compression"]
            m = DracoPy.decode(view(draco["bufferView"]))
            p = np.asarray(m.points, float)
            p = np.column_stack([p[:, 0], -p[:, 2], p[:, 1]]) + center  # glTF は y が上、3D Tiles は z が上
            x, y, h = to_plane.transform(p[:, 0], p[:, 1], p[:, 2])
            p = np.column_stack([x, y, h])
            uv = np.asarray(m.tex_coord, float)
            batch = np.asarray(m.get_attribute_by_unique_id(draco["attributes"]["_BATCHID"])["data"]).reshape(-1).astype(int)
            f = np.asarray(m.faces)
            a, bb, c = p[f[:, 0]], p[f[:, 1]], p[f[:, 2]]
            normal = np.cross(bb - a, c - a)
            area = np.linalg.norm(normal, axis=1) / 2
            up = np.abs(normal[:, 2]) / np.maximum(area * 2, 1e-9)
            keep = (area > 0.05) & ((up < 0.35) | (up > 0.9))  # 壁と、ほぼ水平な屋根（色合わせ用）
            f, area, roof = f[keep], area[keep], up[keep] > 0.9
            if not len(f):
                continue
            count = np.clip(np.ceil(area / np.where(roof, ROOF_SAMPLE_AREA, SAMPLE_AREA)), 1, 400).astype(int)
            tri = np.repeat(np.arange(len(f)), count)
            r1, r2 = np.sqrt(rng.random(len(tri))), rng.random(len(tri))
            bary = np.column_stack([1 - r1, r1 * (1 - r2), r1 * r2])
            pos = np.einsum("nk,nkd->nd", bary, p[f[tri]])
            st = np.einsum("nk,nkd->nd", bary, uv[f[tri]])
            st -= np.floor(st)
            hh, ww = image.shape[:2]
            # glTF の v は上が0。DracoPy は圧縮前の値をそのまま返す。
            px = image[np.clip((st[:, 1] * hh).astype(int), 0, hh - 1), np.clip((st[:, 0] * ww).astype(int), 0, ww - 1)]
            linear = (px / 255.0) ** 2.2
            out.append(np.column_stack([pos, linear, (area / count)[tri], batch[f[tri, 0]], roof[tri]]))
    return np.concatenate(out) if out else np.empty((0, 9))


def collect():
    record = json.loads((CACHE / "manifest.json").read_text())
    jobs = [CACHE / d["id"] / uri for d in record for uri in d["tiles"]]
    out = []
    for n, path in enumerate(jobs):
        s = read_tile(path)
        if len(s):
            # 建物の足元（その建物の壁の最も低い所）からの高さへ直す
            key = s[:, 7].astype(int)
            base = np.full(key.max() + 1, np.inf)
            np.minimum.at(base, key, s[:, 2])
            s[:, 2] -= base[key]
            out.append(np.delete(s, 7, axis=1))
        print("区画", n + 1, "/", len(jobs), flush=True)
    return np.concatenate(out), record


def calibrate(samples):
    """航空写真の色かぶりを直す倍率（色ごと、線形の値に掛ける）。

    PLATEAU の写真は遠くから撮った斜めの写真で、全体が青く、薄くかすんでいる。同じ屋根を、ゲームの地面の写真
    （mapdesign/sowan/photo.webp。点群の色）と比べ、屋根の色が合うように直す。壁にも同じ式を使う。
    2つの写真は撮った日も影も違うので、6m 四方ごとの平均で比べ、外れた所を除いた平均の比を倍率にする。
    （切片は付けない。地面の写真は影を消してあるので、切片を付けると壁の暗い色まで持ち上がり、建物ごとの差が縮む。）
    """
    from PIL import Image

    roof = samples[samples[:, 7] > 0]
    gx, gz = sp.real_to_game(roof[:, 0], roof[:, 1])
    photo = np.asarray(Image.open(ROOT / "mapdesign/sowan/photo.webp").convert("RGB"))
    h, w = photo.shape[:2]
    x0, z0, x1, z1 = BOUNDS
    u, v = ((gx - x0) / (x1 - x0) * w).astype(int), ((gz - z0) / (z1 - z0) * h).astype(int)
    ok = (u >= 0) & (u < w) & (v >= 0) & (v < h)
    gx, gz, roof, target = gx[ok], gz[ok], roof[ok, 3:6], (photo[v[ok], u[ok]] / 255.0) ** 2.2
    _, cell = np.unique(np.floor(gx / 6).astype(int) * 4096 + np.floor(gz / 6).astype(int), return_inverse=True)
    n = np.bincount(cell)
    fit = []
    for c in range(3):
        x, y = (np.bincount(cell, weights=roof[:, c]) / n)[n >= 8], (np.bincount(cell, weights=target[:, c]) / n)[n >= 8]
        keep = np.ones(len(x), bool)
        for _ in range(10):
            gain = y[keep].mean() / x[keep].mean()
            miss = np.abs(y - gain * x)
            keep = miss < 2 * np.median(miss)
        fit.append(float(gain))
    return fit


def assign(samples, fit):
    """壁の点を、輪郭に近くて高さの合うゲームの建物へ割り当て、建物ごとの色を出す。"""
    import shapely
    from shapely.geometry import Polygon

    volumes = sp.SRC["volumes"]
    rings = []
    for lo, hi, ring, _paint, _kind in volumes:
        q = sp.decode2(ring)
        rings.append(shapely.make_valid(Polygon(np.column_stack([q[:, 0], q[:, 1] + sp.DZ]))))
    samples = samples[samples[:, 7] == 0]
    gx, gz = sp.real_to_game(samples[:, 0], samples[:, 1])
    height = samples[:, 2] / sp.SCALE
    inside = (gx > BOUNDS[0]) & (gx < BOUNDS[2]) & (gz > BOUNDS[1]) & (gz < BOUNDS[3])
    gx, gz, height, samples = gx[inside], gz[inside], height[inside], samples[inside]
    points = shapely.points(gx, gz)
    edges = np.array([shapely.boundary(r) for r in rings])
    tree = shapely.STRtree(edges)
    pi, vi = tree.query(points, predicate="dwithin", distance=NEAR)
    lo = np.array([v[0] for v in volumes])
    hi = np.array([v[1] for v in volumes])
    ok = (height[pi] > lo[vi] - 0.7) & (height[pi] < hi[vi] + 0.7)
    pi, vi = pi[ok], vi[ok]
    dist = shapely.distance(points[pi], edges[vi])
    order = np.lexsort((dist, pi))
    pi, vi = pi[order], vi[order]
    first = np.r_[True, pi[1:] != pi[:-1]]  # 点ごとに、最も近い建物だけ
    pi, vi = pi[first], vi[first]
    weight = samples[pi, 6]
    linear = np.clip(samples[pi, 3:6] * fit, 0, 1)
    luma = linear @ [0.2126, 0.7152, 0.0722]
    area = np.bincount(vi, weights=weight, minlength=len(volumes))
    colors = []
    for k in range(len(volumes)):
        if area[k] < MIN_AREA:
            colors.append(None)
            continue
        m = np.flatnonzero(vi == k)
        m = m[np.argsort(luma[m])]
        share = np.cumsum(weight[m]) / weight[m].sum()
        m = m[(share >= BAND[0]) & (share <= BAND[1])]  # 影の面・窓と、白く飛んだ所を除く
        mean = (linear[m] * weight[m, None]).sum(0) / weight[m].sum()
        colors.append("#" + "".join(f"{v:02x}" for v in np.clip(np.rint(mean ** (1 / 2.2) * 255), 0, 255).astype(int)))
    # 上に載った部分で壁を拾えなかった物は、同じ建物（輪郭が最も重なる、色の決まった部分）の色を使う。
    borrowed = 0
    for k in range(len(volumes)):
        if colors[k] is not None or not rings[k].area:
            continue
        best, share = None, 0.5
        for j in tree.query(rings[k], predicate="intersects"):
            if j != k and colors[j] is not None and area[j] >= MIN_AREA:
                overlap = rings[k].intersection(rings[j]).area / rings[k].area
                if overlap > share:
                    best, share = j, overlap
        if best is not None:
            colors[k] = colors[best]
            borrowed += 1
    return colors, area, len(pi), len(samples), borrowed


def main():
    if "--fetch" in sys.argv:
        fetch()
        return
    samples, record = collect()
    fit = calibrate(samples)
    colors, area, used, total, borrowed = assign(samples, fit)
    found = sum(c is not None for c in colors)
    OUT.write_text(json.dumps({
        "source": "国土交通省 3D都市モデル（Project PLATEAU）建築物モデル LOD2 テクスチャ付き（CC BY 4.0）",
        "datasets": [{k: d[k] for k in ("id", "name", "year", "url")} | {"tiles": len(d["tiles"])} for d in record],
        "note": "建物ごとの壁の色（地面の写真の色合いへ直し、明るさの順で55〜95%の所を、面積で重みを付けて平均）。terrain.json の volumes と同じ順。null は壁を拾えなかった建物。",
        "samples": {"walls": int(total), "assigned": int(used)},
        "colorGain": [round(v, 4) for v in fit],
        "found": found,
        "borrowed": borrowed,
        "colors": colors,
    }, ensure_ascii=False, indent=1) + "\n")
    print(f"壁の色：{found} / {len(colors)} 棟（うち同じ建物から借りた色 {borrowed}。点 {used} / {total}、壁の面積 {area.sum() / 1e4:.1f} ha）→ {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
