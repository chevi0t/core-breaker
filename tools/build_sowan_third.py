#!/usr/bin/env python3
"""お台場原本v1（点群・実寸1/3）を、通常の対戦マップ sowan へ組み立てる。

入力は mapdesign/sowan/pointcloud-third/terrain.json だけ（原本は書き換えない）。
地形は施設の座標を参照せずに変換し、基地の更地化だけを固定の地理条件として行う。
プラント・リペアポッド・カタパルト・再出撃・Botの経路はその後で既存の空地へ置く。
"""

import base64, json, math, pathlib, sys
import numpy as np, shapely
from scipy.ndimage import label
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon, box

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import build_kanto_map as codec  # noqa: E402

SRC = ROOT / "mapdesign/sowan/pointcloud-third/terrain.json"
OUT = ROOT / "mapdesign/sowan"
IN_STEP = 0.05
STEP = 0.04  # 長辺665mをint16へ収める保存格子（build_maps.py の許可値）
codec.STEP = STEP
RADIUS = 1.3

# 原本の座標原点を保ったまま、南北の中心だけを0へ寄せる。
SRC_DATA = json.loads(SRC.read_text())
_b = SRC_DATA["bounds"]
DZ = round(-(_b[1] + _b[3]) / 2 / STEP) * STEP
HALF = math.ceil(max(abs(_b[0]), abs(_b[2]), (_b[3] - _b[1]) / 2) + 5)  # 格子を4m刻みのまま保つため、+1 から4m広げた

# 旧1/2案の提示図の基地・プラント（ユーザー図）を原本v1の座標へ写した点。
# 旧座標×2/3＋(-33, 5) で、科学館・門状ビル・会議棟の3点が3m以内で一致する。
BASE_SITES = {"B": [-420.0, 166.0], "R": [344.0, 155.0]}
PLANT_SITES = [["A", [-380, -105]], ["B", [-86, -168]], ["C", [194, -142]], ["D", [448, -95]]]
BASE_RADIUS = 34


def shift(p):
    return [p[0], p[1] + DZ]


def compact(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode()


def parts(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    return [p for v in getattr(g, "geoms", []) for p in parts(v)]


def decode2(s):
    a = np.frombuffer(base64.b64decode(s), dtype="<i2").reshape(-1, 2) * IN_STEP
    a = a.astype(float)
    a[:, 1] += DZ
    return a


def decode3(s):
    a = np.frombuffer(base64.b64decode(s), dtype="<i2").reshape(-1, 3) * IN_STEP
    a = a.astype(float)
    a[:, 2] += DZ
    return a


def polys(entries):
    out = []
    for e in entries:
        p = shapely.make_valid(Polygon(decode2(e[0]), [decode2(r) for r in e[1:]]))
        out.extend(parts(p))
    return shapely.union_all(out) if out else Polygon()


def pack(p):
    """保存格子で位相を整理してから輪郭を符号化する。"""
    out = []
    q = shapely.set_precision(shapely.make_valid(p), STEP)
    for r in parts(q):
        if r.area < 0.5:
            continue
        out.append([codec.encode_ring(np.asarray(x.coords[:-1])) for x in [r.exterior, *r.interiors]])
    return out


def floor(p, y):
    p = shapely.make_valid(p.simplify(0.15)) if not p.is_empty else p
    return codec.floor(p, y) if not p.is_empty else np.empty((0, 3))


def pack_surface(tris):
    a = np.rint(np.asarray(tris, dtype=float).reshape(-1, 3, 3) / STEP) * STEP
    assert np.isfinite(a).all() and (np.abs(a / STEP) <= 32767).all()
    n = np.cross(a[:, 1] - a[:, 0], a[:, 2] - a[:, 0])
    a = a[np.linalg.norm(n, axis=1) > 1e-7]
    return codec.pack_surface(a.reshape(-1, 3))


# ---- 色 ----
# 実際の色は点群の写真色（CC BY、mapdesign/sowan/pointcloud-third/surface-render.js の基準色と terrain.json の palette）から取る。
# 見た目の方向（白〜明るい灰の建物、紺の海、濃い緑）は、ユーザーが見せた航空写真の印象に合わせた判断で、写真から色は取っていない。
GROUND_COLOR = "#83877f"  # 点群のコンクリート [146,151,143] を1割暗く（本体の光で白く飛ぶため）
ROAD_COLOR = "#43494a"  # 点群のアスファルト [67,73,74]（3D の道路は本体の色 #424d58）
GRASS_COLOR = "#435d37"  # 点群の芝 [84,112,68] を2割暗く
WATER_COLOR = "#0f2538"  # 点群に海面の色は無いので、暗い紺を選んだ（本体は透明度0.68で川床に重ねる）
LIFT_TO = np.array([0xe6, 0xe7, 0xe3])


def lift(color):
    """点群の屋根色を白〜明るい灰へ寄せる。暗い色（ガラス・濃い外装）は差し色として少しだけ。"""
    c = np.array([int(color[i:i + 2], 16) for i in (1, 3, 5)])
    k = 0.45 if c.mean() > 110 else 0.15
    m = np.rint(c + (LIFT_TO - c) * k).astype(int)
    return "#" + "".join(f"{v:02x}" for v in m)


# ---- 交通構造（橋・歩道橋・高速道路・新交通） ----
# 地上から歩いて上がれる種類は端を地面へ下ろし、縦勾配0.3以下の坂にする。
WALKABLE = {"footbridge", "promenade", "roadbridge"}
# 下を機体（高さ4m）がくぐれる床の高さ。床の厚さは1m。
CLEARANCE_TOP = {"guideway": 6.5, "expressway": 6.3, "roadbridge": 6.0, "footbridge": 6.0, "promenade": 6.0}
PARAPET = {"guideway": 1.0, "expressway": 1.0, "roadbridge": 0.9}
DECK = 1.0


def profile(kind, pts, land):
    xy = pts[:, [0, 2]]
    seg = np.linalg.norm(np.diff(xy, axis=0), axis=1)
    d = np.concatenate([[0], np.cumsum(seg)])
    total = d[-1]
    h = pts[:, 1].copy()
    if kind == "expresswayGround":
        return np.maximum(h, 0.15)
    top = CLEARANCE_TOP[kind]
    if kind in WALKABLE:
        # 陸にある端だけ地面へ下ろす。取得範囲の切れ目や海上の端は高いまま残す。
        ends = [land.buffer(1).contains(Point(*xy[0])), land.buffer(1).contains(Point(*xy[-1]))]
        h = np.maximum(h, top)
        for i, di in enumerate(d):
            for which, dist in [(0, di), (1, total - di)]:
                if ends[which]:
                    h[i] = min(h[i], 0.1 + dist * 0.3)
    else:
        h = np.maximum(h, top)
    return h


def rdp(pts, tol):
    """3次元の折れ線を間引く（Douglas-Peucker）。残した点の番号を返す。"""
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        ab = b - a
        L = np.dot(ab, ab)
        mid = pts[i + 1:j]
        t = np.clip(((mid - a) @ ab) / L, 0, 1) if L > 0 else np.zeros(len(mid))
        dist = np.linalg.norm(mid - (a + t[:, None] * ab), axis=1)
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return np.flatnonzero(keep)


def ribbon(tris, pts, h, width, kind):
    """床の上面・下面・側面と、高欄。三角形の向きで床と天井を分ける。"""
    xy = pts[:, [0, 2]]
    n = len(xy)
    normals = []
    for i in range(n):
        a = xy[max(0, i - 1)]
        b = xy[min(n - 1, i + 1)]
        t = (b - a) / (np.linalg.norm(b - a) or 1)
        normals.append(np.array([-t[1], t[0]]))
    w = width / 2
    left = [xy[i] + normals[i] * w for i in range(n)]
    right = [xy[i] - normals[i] * w for i in range(n)]

    def v(p, y):
        return [float(p[0]), float(y), float(p[1])]

    def quad_up(a, b, c, d):  # 上向き
        tris.extend([a, b, c, a, c, d])

    for i in range(n - 1):
        l0, l1, r0, r1 = left[i], left[i + 1], right[i], right[i + 1]
        t0, t1 = h[i], h[i + 1]
        b0, b1 = t0 - DECK, t1 - DECK
        top = [v(l0, t0), v(l1, t1), v(r1, t1), v(r0, t0)]
        bot = [v(l0, b0), v(l1, b1), v(r1, b1), v(r0, b0)]
        # 上面は法線が上、下面は下。向きは後で揃える。
        tris.extend([top[0], top[1], top[2], top[0], top[2], top[3]])
        tris.extend([bot[0], bot[2], bot[1], bot[0], bot[3], bot[2]])
        # 側面は高欄の上端まで1枚で立てる（三角形の数を抑える）。
        ph = PARAPET.get(kind, 0)
        for p0, p1 in [(l0, l1), (r0, r1)]:
            tris.extend([v(p0, b0), v(p1, b1), v(p1, t1 + ph), v(p0, b0), v(p1, t1 + ph), v(p0, t0 + ph)])
    # 端面
    for i in [0, n - 1]:
        if h[i] - DECK > 0.05:
            l, r = left[i], right[i]
            tris.extend([v(l, h[i] - DECK), v(r, h[i] - DECK), v(r, h[i]), v(l, h[i] - DECK), v(r, h[i]), v(l, h[i])])
    return left, right


def transport(land):
    routes = SRC_DATA["transport"]["routes"]
    tris, footprints, walk, piers, stats = [], [], [], [], {}
    for r in routes:
        kind = r["kind"]
        pts = decode3(r["path"])
        if len(pts) < 2:
            continue
        h = profile(kind, pts, land)
        dense, dense_h = pts, h
        idx = rdp(np.column_stack([pts[:, 0], h, pts[:, 2]]), 0.25)
        pts, h = pts[idx], h[idx]
        width = max(r["width"], 1.5)
        if kind == "expresswayGround" and h.max() < 0.6:
            # 地上の高速道路は舗装として扱う（床の段差を作らない）。
            line = LineString(pts[:, [0, 2]])
            footprints.append(("ground", line.buffer(width / 2, cap_style=2, join_style=2)))
            continue
        left, right = ribbon(tris, pts, h, width, kind)
        strip = Polygon([*left, *right[::-1]]).buffer(0)
        footprints.append((kind, strip))
        if kind in WALKABLE and width >= 4:
            walk.append((strip, pts[:, [0, 2]].copy(), h.copy()))
        # 橋脚：床の下が2m以上空いていて、原本で「見える場所」とした点だけ。約9m間隔。
        # 間引く前の細かい点で数える（間引いた後だと長い直線に橋脚が立たない）。
        flags = r.get("piers") or []
        last = -1e9
        xy = dense[:, [0, 2]]
        acc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))])
        for i, p in enumerate(xy):
            if i < len(flags) and flags[i] and dense_h[i] - DECK > 2 and acc[i] - last >= 9 and land.contains(Point(*p)):
                size = 1.2 if kind == "footbridge" else 1.8 if kind == "guideway" else 2.2
                piers.append((box(p[0] - size / 2, p[1] - size / 2, p[0] + size / 2, p[1] + size / 2), 0, dense_h[i] - DECK))
                last = acc[i]
        stats[kind] = stats.get(kind, 0) + 1
    return tris, footprints, walk, piers, stats


def landmark_meshes():
    tris = []
    for paint, pts, faces, name in SRC_DATA["meshes"]:
        p = np.frombuffer(base64.b64decode(pts), dtype="<i2").reshape(-1, 3) * IN_STEP
        p = p.astype(float)
        p[:, 2] += DZ
        f = np.frombuffer(base64.b64decode(faces), dtype="<u2").reshape(-1, 3)
        a = p[f]
        tris.extend(a.reshape(-1, 3).tolist())
        tris.extend(a[:, [0, 2, 1]].reshape(-1, 3).tolist())  # 両面（床と天井の両方を持つ）
    return tris


# ---- 外壁の種類 ----
# 点群の色は真上からの写真なので、壁の色や窓は分からない。高さと広さから種類を決める（実物の建物ごとの再現ではない）。
# 60m以上（ゲームで20m）の高層は全面ガラスか横連窓、低くて広い建物（倉庫・展示棟）は窓の無い板張り、ほかは格子の窓。
GLASS = {"facade": "glass", "landmarkColor": "#8499ad"}  # 本体のガラスの色（青緑）を、青みのある灰色へ寄せる


def facade(poly, top):
    if poly.is_empty:
        return {}
    c = poly.representative_point()
    h = math.sin(round(c.x / 12) * 127.1 + round(c.y / 12) * 311.7) * 43758.5453
    h -= math.floor(h)
    if top >= 20:
        return GLASS if h < 0.45 else {"facade": "bands"}
    if top < 6 and poly.area >= 350:
        return {"facade": "plain"}
    if top >= 8:
        return GLASS if h < 0.22 else {"facade": "bands"} if h < 0.5 else {}
    return {}


# ---- 写真の地面 ----
# 点群の撮影色（CC BY）を真上から見た画像にした物（tools/sowan_photo.py が作る mapdesign/sowan/photo.webp）。
# 本体は地面・屋上・橋の床など上を向いた面へ、水平位置で貼る。画像が無ければ無地の色のまま。
PHOTO = OUT / "photo.webp"
PHOTO_BOUNDS = [-668, -356, 668, 356]
PHOTO_GAIN = 0.7


def photo():
    if not PHOTO.exists():
        return {}
    image = "data:image/webp;base64," + base64.b64encode(PHOTO.read_bytes()).decode()
    return {"photo": {"image": image, "bounds": PHOTO_BOUNDS, "gain": PHOTO_GAIN}}


# ---- 木 ----
# 点群で、複数リターンが多く地面から2m以上・建物と交通構造の外のかたまりを木とした（tools/sowan_photo.py が作る trees.npz）。
# 当たり判定の無い見た目だけの物。基地・プラントの占拠円・水・マップの外は除く。
TREES = OUT / "trees.npz"
TREE_GREEN = np.array([0x35, 0x52, 0x2E])  # 濃い緑（撮影は春先で枝の色が多いので、色は独自に選び、明るさだけ写真から取る）
TREE_PINK = np.array([0xD8, 0xB4, 0xC2])  # 桜（写真で薄い桃色に写っている木）


def trees(boundary, water, clear):
    if not TREES.exists():
        return {}
    t = np.load(TREES)["trees"].astype(float)
    x, z, h, r, c = t[:, 0] * 0.04, t[:, 1] * 0.04, t[:, 2] / 100, t[:, 3] / 100, t[:, 4:7]
    keep = shapely.contains_xy(boundary.buffer(-1), x, z) & ~shapely.contains_xy(water.buffer(0.5), x, z) & ~shapely.contains_xy(clear, x, z)
    lum = c @ np.array([0.299, 0.587, 0.114])
    k = np.clip(lum / np.median(lum), 0.7, 1.35)[:, None]
    pink = (c[:, 0] > c[:, 1] * 1.05) & (c[:, 2] > c[:, 1] * 0.93) & (lum > np.median(lum))
    rng = np.random.default_rng(83)
    green = TREE_GREEN * k * (1 + rng.normal(0, 0.06, (len(c), 3)))
    color = np.where(pink[:, None], TREE_PINK * np.clip(k, 0.8, 1.1), green)
    rows = np.zeros(int(keep.sum()), dtype=[("x", "<i2"), ("z", "<i2"), ("h", "u1"), ("r", "u1"), ("c", "u1", 3)])
    rows["x"] = np.rint(x[keep] / STEP)
    rows["z"] = np.rint(z[keep] / STEP)
    rows["h"] = np.clip(np.rint(h[keep] / 0.05), 20, 255)
    rows["r"] = np.clip(np.rint(r[keep] / 0.02), 20, 255)
    rows["c"] = np.clip(np.rint(color[keep]), 0, 255)
    return {"trees": {"step": STEP, "count": len(rows), "data": base64.b64encode(rows.tobytes()).decode()}}


def terrain():
    d = SRC_DATA
    boundary = Polygon(decode2(d["boundary"][0][0]))
    land = polys(d["land"])
    pave = polys(d["pavement"])
    roads = polys(d["roads"])
    grass = polys(d["grass"])
    water = polys(d["water"]).intersection(boundary)
    ground = shapely.union_all([land, pave, roads, grass]).intersection(boundary)
    clearings = shapely.union_all([Point(*shift(p)).buffer(BASE_RADIUS + 4, quad_segs=8) for p in BASE_SITES.values()])

    volume_rows, solids = [], []
    kinds = ["grounded", "upper", "infill", "elevated", "rail-pier"]

    def emit(poly, lo, hi, meta, kind=None):
        if hi - lo < 0.15:
            return
        k = kinds.index(kind) if kind else (0 if lo < 0.3 else 1)
        for q in parts(shapely.make_valid(poly).intersection(boundary)):
            if q.area < 1:
                continue
            rings = pack(q)
            for rr in rings:
                volume_rows.append([k, round(lo, 2), round(hi, 2), rr, meta])
            solids.append((q, lo, hi, meta))

    for lo, hi, ring, paint, kind in d["volumes"]:
        p = Polygon(decode2(ring))
        if not p.is_valid:
            p = shapely.make_valid(p)
        if lo < 0.3:
            p = p.difference(clearings)
        emit(p, lo, hi, {"paint": paint, **facade(p, hi)})

    tris, footprints, walk, piers, tstats = transport(ground)
    for p, lo, hi in piers:
        emit(p.difference(clearings), lo, hi, {}, "rail-pier")  # 窓の模様の無い灰色の柱
    tris.extend(landmark_meshes())

    # 海岸：取得範囲の切れ目を除いた水際だけに、高さ4mの岸壁を付ける。
    banks = []
    edge = boundary.exterior.buffer(0.6)
    for p in parts(shapely.make_valid(water.simplify(0.2))):
        for ring in [p.exterior, *p.interiors]:
            c = list(ring.coords)
            for a, b in zip(c, c[1:]):
                s = LineString([a, b])
                if s.length < 0.05 or edge.contains(s):
                    continue
                banks.extend([[a[0], -4, a[1]], [b[0], -4, b[1]], [a[0], 0, a[1]], [b[0], -4, b[1]], [b[0], 0, b[1]], [a[0], 0, a[1]]])
    brid = np.concatenate([np.asarray(tris, dtype=float).reshape(-1, 3), np.asarray(banks, dtype=float).reshape(-1, 3)])

    ground_free = ground.difference(water)
    road_ground = roads.union(shapely.union_all([g for k, g in footprints if k == "ground"])).intersection(ground_free)
    surfaces = {k: pack_surface(np.empty((0, 3))) for k in ["dem", "tran", "fill", "ramps", "aprons", "plazas", "streets", "historicGround", "brid"]}
    # 舗装（コンクリート・敷石）は地面の色（unifiedGround）でまとめ、緑地は濃い緑の芝（lawns）を上に重ねる。
    # 本体の plazas・aprons は色が決まっている（青灰・薄い緑）ので使わない。
    surfaces["dem"] = pack_surface(floor(ground_free.difference(road_ground), 0))
    surfaces["tran"] = pack_surface(floor(road_ground, 0))
    lawn_area = shapely.make_valid(grass.intersection(ground_free).difference(road_ground).simplify(0.15))
    lawns = [{"rings": rr, "color": GRASS_COLOR} for rr in pack(lawn_area)]
    surfaces["brid"] = pack_surface(brid)

    ring = [[round(x, 2), round(z, 2)] for x, z in list(boundary.exterior.coords)[:-1]]
    data = {
        "geometryEncoding": "city-layout-v1",
        "half": HALF,
        "boundary": ring,
        "ringCoordinateStep": STEP,
        "groundMaximum": 0.1,
        "spawns": [],
        "district": {
            "bases": [{"team": t, "at": shift(p), "height": 0} for t, p in BASE_SITES.items()],
            "roofPads": [],
            "unifiedGround": {"color": GROUND_COLOR},
            "buildingPalette": [lift(c) for c in d["palette"]],
            "roadColor": ROAD_COLOR,
            "lawns": lawns,
            **photo(),
            "facadeScale": 1 / 3,
            "glassTint": True,
            "bridgeColor": "#8f9290",
            "sky": {"zenith": "#4d82c4", "clouds": 0.55, "below": "#5d7689"},
        },
        "landmarks": [],
        "streetRepairs": [],
        "heritage": {},
        "river": {
            "bed": -4,
            "water": -1.2,
            "color": WATER_COLOR,
            "mapColor": "#1d3f5c",
            "sea": {"sky": "#9fb4c4"},
            "rings": [[list(map(lambda q: [round(q[0], 2), round(q[1], 2)], r.coords[:-1])) for r in [p.exterior, *p.interiors]] for p in parts(water)],
            "exits": [],
        },
        "volumeKinds": kinds,
        "volumes": volume_rows,
        "surfaces": surfaces,
        "decorations": [],
        "packing": {"encoding": "city-layout-v1", "layers": {}},
    }
    report = {
        "source": str(SRC.relative_to(ROOT)),
        "zShift": DZ,
        "half": HALF,
        "volumes": len(volume_rows),
        "transport": tstats,
        "piers": len(piers),
        "bridTriangles": len(brid) // 3,
        "plantGeometryCuts": 0,
    }
    return data, solids, ground_free, boundary, footprints, walk, report


# ---- 施設・再出撃・経路 ----
class Streets:
    def __init__(self, solids, walkable, boundary, decks):
        self.walkable = walkable
        self.solids = solids
        self.boundary = boundary
        self.decks = decks
        self.blocked = (
            shapely.union_all([p for p, lo, hi, _ in solids if lo < 4.1 and hi > 0.3]).buffer(1.65, quad_segs=2)
            .union(box(-HALF, -HALF, HALF, HALF).difference(walkable).buffer(1.65, quad_segs=2))
            .union(box(-HALF, -HALF, HALF, HALF).difference(boundary.buffer(-3)))
        )
        values = np.arange(-HALF + 4, HALF - 3, 4)
        xx, zz = np.meshgrid(values, values)
        pts = np.column_stack([xx.ravel(), zz.ravel()])
        mask = ~shapely.intersects(self.blocked, shapely.points(pts)).reshape(xx.shape)
        labels, _ = label(mask, np.ones((3, 3)))
        sizes = np.bincount(labels.ravel())
        sizes[0] = 0
        self.nodes = pts[(labels == sizes.argmax()).ravel()]
        self.tree = cKDTree(self.nodes)

    def connected(self, p):
        ds, ids = self.tree.query(p, k=8)
        return any(d < 9 and self.clear(p, self.nodes[i]) for d, i in zip(ds, ids))

    def free(self, p, r=2, under_deck_ok=False):
        q = Point(p)
        return (
            self.connected(p)
            and self.boundary.buffer(-r - 3).contains(q)
            and self.walkable.contains(q.buffer(r))
            and (under_deck_ok or not self.decks.intersects(q.buffer(r)))
            and not any(lo < 4.1 and hi > 0.3 and poly.distance(q) < r for poly, lo, hi, _ in self.solids)
        )

    def clear(self, a, b):
        return not self.blocked.intersects(LineString([a, b]))


def seen_from(solids_tree, solids, eye, target):
    """map_check と同じく、ポッドに立つ機体の高さ2.4mと3.9mのどちらかが見えれば「見える」。"""
    if math.dist(eye, target) > 180:
        return False
    return not (sight_blocked(solids_tree, solids, eye, target, target_h=2.4) and sight_blocked(solids_tree, solids, eye, target, target_h=3.9))


def sight_blocked(solids_tree, solids, eye, target, eye_h=4.6, target_h=1.8):
    """視線（目の高さ→ポッドの高さ）の途中に、その高さより高い建物があるか。"""
    line = LineString([eye, target])
    L = line.length
    for i in solids_tree.query(line):
        poly, lo, hi, _ = solids[i]
        if hi < min(eye_h, target_h):
            continue
        inter = poly.intersection(line)
        if inter.is_empty:
            continue
        for g in getattr(inter, "geoms", [inter]):
            for c in g.coords:
                t = Point(eye).distance(Point(c)) / max(L, 1e-6)
                y = eye_h + (target_h - eye_h) * t
                if lo <= y <= hi:
                    return True
    return False


def deck_height(xy, h, p):
    """折れ線（床の中心線）に投影した位置の床の高さ。"""
    best = (1e9, 0.0)
    for i in range(len(xy) - 1):
        a, b = xy[i], xy[i + 1]
        ab = b - a
        L = float(ab @ ab)
        t = 0.0 if L == 0 else min(1.0, max(0.0, float((p - a) @ ab) / L))
        d = float(np.linalg.norm(a + t * ab - p))
        if d < best[0]:
            best = (d, float(h[i] + (h[i + 1] - h[i]) * t))
    return best[1]


def deck_nav(nav, walk, ground, streets):
    """橋の上を歩く節点に床の高さを付け、床の中心線にも節点の列を足す。
    本体は往復できない辺を捨てるので、高さの無い節点が海の上にあると、橋で渡る道が切れてしまう。"""
    nodes, links = nav["nodes"], nav["links"]
    land = ground.buffer(-0.5)
    changed = 0
    for i, (x, z) in enumerate(nodes):
        q = Point(x, z)
        for strip, xy, h in walk:
            if strip.contains(q):
                y = deck_height(xy, h, np.array([x, z]))
                if not land.contains(q) or y < 2.5:
                    if y > 0.3:
                        nodes[i] = [x, z, round(y, 2)]
                        changed += 1
                    break
    added = 0
    for strip, xy, h in walk:
        seg = np.linalg.norm(np.diff(xy, axis=0), axis=1)
        d = np.concatenate([[0], np.cumsum(seg)])
        chain = []
        for t in np.arange(0, d[-1] + 0.01, 8.0):
            p = np.array([np.interp(t, d, xy[:, 0]), np.interp(t, d, xy[:, 1])])
            y = float(np.interp(t, d, h))
            chain.append(len(nodes))
            nodes.append([round(float(p[0]), 2), round(float(p[1]), 2), round(y, 2)] if y > 0.3 else [round(float(p[0]), 2), round(float(p[1]), 2)])
            added += 1
        for a, b in zip(chain, chain[1:]):
            links.append([a, b])
        # 列の各点を、近く（12m以内）の節点とつなぐ。高さの合わない組は本体が捨てる。
        base = np.array([n[:2] for n in nodes[:chain[0]]])
        for c in chain:
            pc = np.array(nodes[c][:2])
            dist = np.linalg.norm(base - pc, axis=1)
            for j in np.argsort(dist)[:4]:
                if dist[j] < 12 and streets.clear(pc, base[j]):
                    links.append([c, int(j)])
    return {"lifted": changed, "added": added}


def cover_pod(data, solids, tree, eyes, pod, plant, keep_clear):
    """ポッドを見通せる敵側の目の方向に、高さ5.2mのコンクリート塀（窓の模様の無い灰色）を足す。"""
    pod = np.array(pod, dtype=float)
    for n in range(10):
        vis = [np.array(e) for e in eyes if seen_from(tree, solids, e, pod)]
        if not vis:
            break
        d = np.mean([(e - pod) / np.linalg.norm(e - pod) for e in vis], axis=0)
        d /= np.linalg.norm(d)
        perp = np.array([-d[1], d[0]])
        placed = False
        for dist in [4.5, 5.5, 6.5, 3.6]:
            c = pod + d * dist
            corners = [c + perp * sx * 6.1 + d * sz * 1.25 for sx, sz in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
            poly = Polygon(corners)
            if poly.distance(Point(*plant)) < 15 or any(poly.distance(Point(*q)) < 3 for q in keep_clear):
                continue
            if poly.distance(Point(*pod)) < 2.6:
                continue
            meta = {}
            for rr in pack(poly):
                data["volumes"].append([data["volumeKinds"].index("rail-pier"), 0, 5.2, rr, meta])
            solids.append((poly, 0, 5.2, meta))
            tree = shapely.STRtree([q[0] for q in solids])
            placed = True
            break
        if not placed:
            break
    return tree


# 本体で測って動かした着地点（台の位置ごと）。無ければ計算どおり。
_fit = OUT / "catapult-fit.json"
CAT_FIT = {tuple(r["at"]): r["land"] for r in json.loads(_fit.read_text())["moved"]} if _fit.exists() else {}


def battle(data, solids, walkable, boundary, footprints, walk):
    decks = shapely.union_all([g for k, g in footprints if k != "ground"]) if footprints else Polygon()
    nav_land = walkable.union(shapely.union_all([w[0] for w in walk])) if walk else walkable
    streets = Streets(solids, nav_land, boundary, decks)
    tree = shapely.STRtree([s[0] for s in solids])

    def locate(desired, r, maxdist=70, under_deck_ok=False):
        c = [np.array(desired, dtype=float)] + [
            np.array(desired) + dd * np.array([math.cos(a), math.sin(a)])
            for dd in range(3, maxdist + 1, 3)
            for a in np.linspace(0, 2 * math.pi, 48, endpoint=False)
        ]
        return next(([round(float(x), 2) for x in p] for p in c if streets.free(p, r, under_deck_ok)), None)

    bases = {t: shift(p) for t, p in BASE_SITES.items()}
    plants = []
    for name, p in PLANT_SITES:
        at = locate(shift(p), 14)
        assert at, ("占拠円の空地なし", name)
        plants.append([name, *at, None])
    anchors, respawns, base_spawns, cats = [], {}, {}, {}
    for t, base in bases.items():
        respawns[t], base_spawns[t] = {}, []
        for x in [-16, -6, 6, 16]:
            for z in [-12, 12]:
                p = [base[0] + x, base[1] + z]
                if streets.free(p, 2):
                    base_spawns[t].append(p)
                    anchors.append((f"base-{t}", p))
        assert base_spawns[t], ("基地の出撃点なし", t)
        for pid, x, z, _ in plants:
            a = math.atan2(base[1] - z, base[0] - x)
            slots = []
            for delta in np.linspace(-1.45, 1.45, 120):
                for rr in [46.2, 49, 51.8]:
                    p = [round(x + rr * math.cos(a + delta), 2), round(z + rr * math.sin(a + delta), 2)]
                    if streets.free(p, 2) and all(math.dist(p, q) > 7 for q in slots):
                        slots.append(p)
            assert slots, ("再出撃なし", t, pid)
            respawns[t][pid] = slots[:8]
            anchors.extend((f"spawn-{t}-{pid}", p) for p in slots[:8])
        # 基地→いちばん近い外側プラント。左右2基ずつ、低い弾道（30度）。
        target = plants[0 if t == "B" else -1][1:3]
        cats[t] = []
        for off in [-24, -10, 10, 24]:
            at = locate([base[0] + off, base[1] - 22], 3, 18)
            to = locate([target[0] + off * 0.8, target[1] + 30], 6)
            if tuple(at) in CAT_FIT:
                fit = CAT_FIT[tuple(at)]
                to = fit if streets.free(fit, 2) else (locate(fit, 4, 9) or to)
            assert at and to, (t, off, at, to)
            cats[t].append([*at, *to, 30])
            anchors.extend([(f"cat-{t}", at), (f"land-{t}", to)])
    for pid, x, z, _ in plants:
        anchors.append((pid, [x + 4, z + 3]))

    # プラントのリペアポッド。両端（A・D）は敵陣側から見えない建物の陰を選ぶ。
    pods = []
    enemy_eyes = {}
    added_cover = False
    for pid, x, z, _ in plants:
        own = "B" if pid in ["A", "B"] else "R"
        enemy = "R" if own == "B" else "B"
        bx, bz = bases[own]
        # map_check と同じ見方：プラントの中心を通り、自軍ベースと反対側の半分（横も含む）。
        # マップの端から5mの所に揃えた15m格子のうち、ポッドから180m以内の空き地から、目の高さ4.6mで見る。
        back = (bx - x, bz - z)
        eyes = []
        grid = np.arange(-HALF + 5, HALF - 4, 15)
        lows = [s_[0] for s_ in solids if s_[1] < 4]
        low_tree = shapely.STRtree(lows)
        for ex in grid:
            for ez in grid:
                if (ex - x) * back[0] + (ez - z) * back[1] > 0:
                    continue
                if math.hypot(ex - x, ez - z) > 220:
                    continue
                e = [float(ex), float(ez)]
                if nav_land.contains(Point(e)) and not len(low_tree.query(Point(e), predicate="intersects")):
                    eyes.append(e)
        enemy_eyes[pid] = eyes
        toward = math.atan2(bz - z, bx - x)
        best = None
        for rr in range(12, 52, 3):
            for dlt in np.linspace(-1.6, 1.6, 33):
                p = [round(x + rr * math.cos(toward + dlt), 2), round(z + rr * math.sin(toward + dlt), 2)]
                if not streets.free(p, 2.5):
                    continue
                seen = sum(1 for e in eyes if seen_from(tree, solids, e, p)) if pid in ["A", "D"] else 0
                score = (seen if pid in ["A", "D"] else 0, rr)
                if best is None or score < best[0]:
                    best = (score, p, seen)
            if best and best[0][0] == 0 and pid in ["A", "D"]:
                break
        assert best, ("ポッドの置き場なし", pid)
        if pid in ["A", "D"] and best[2] > 0:
            # 建物の陰だけで隠れないときは、敵陣側に高さ5.2mの塀を置いて隠す（RULES の土手の代わり）。
            tree = cover_pod(data, solids, tree, eyes, best[1], [x, z], [q for _, q in anchors])
            added_cover = True
        pods.append([pid, *best[1]])
        anchors.append((f"pod-{pid}", best[1]))

    routes = []
    for start, end in [(plants[0], plants[1]), (plants[3], plants[2])]:
        at = locate([start[1], start[2] - 26], 4)
        to = locate([end[1], end[2] + 26], 6)
        if tuple(at) in CAT_FIT:
            fit = CAT_FIT[tuple(at)]
            to = fit if streets.free(fit, 2) else (locate(fit, 4, 9) or to)
        assert at and to
        routes.append({"at": at, "exit": to, "plant": start[0], "targetPlant": end[0], "angle": 30})
        anchors.extend([(f"cat-{start[0]}", at), (f"land-{end[0]}", to)])

    if added_cover:
        streets = Streets(solids, nav_land, boundary, decks)
    nav, stats = codec.navigation(streets, anchors, half=HALF, grid_step=4, span=70)
    nav = {
        "nodes": (np.frombuffer(base64.b64decode(nav["nodes"]), dtype="<i2").reshape(-1, 2) * STEP).round(2).tolist(),
        "links": np.frombuffer(base64.b64decode(nav["links"]), dtype="<u2").reshape(-1, 2).tolist(),
    }
    stats["deckNodes"] = deck_nav(nav, walk, walkable, streets)
    base_z = 290
    # レーダー（幅約6m）は両基地とも空いている所へ。基地の設備は青の座標で書き、橙は左右前後を反転して置かれる。
    def at_base(t, off):
        bx, bz = bases[t]
        sgn = 1 if t == "B" else -1
        return [bx + sgn * off[0], bz + sgn * (off[1] - base_z)]
    used = [[-24, base_z], [24, base_z], [-12, base_z + 10], [12, base_z - 10]]
    radar = None
    for rr in range(30, 50, 2):
        for a in np.linspace(math.pi, 3 * math.pi, 24, endpoint=False):
            off = [round(rr * math.cos(a)), round(base_z + 0.6 * rr * math.sin(a))]
            if all(math.dist(off, u) > 9 for u in used) and all(streets.free(at_base(t, off), 4.5) for t in bases):
                radar = off
                break
        if radar:
            break
    assert radar, "レーダーの置き場なし"
    definition = {
        "name": "双湾展示区",
        "subtitle": "港越しの連絡路",
        "order": 83,
        "size": [HALF, HALF],
        "team": 10,
        "time": 600,
        "baseZ": base_z,
        "baseLine": 240,
        "desc": "湾を囲む展示場と研究街の4プラント戦。基地から前線へカタパルトで展開する。",
        "terrain": [],
        "layout": [],
        "plants": plants,
        # 基地の設備は基地中心からの左右（x）に並べる。両基地とも敵が北にあるため、前後の差は付けない。
        "turrets": [[-24, base_z], [24, base_z]],
        "radar": radar,
        "catapults": [],
        "basePods": [[-12, base_z + 10], [12, base_z - 10]],
        "plantPods": pods,
        "barricades": [],
        "asym": True,
        "nav": nav,
        "bases": {t: {"at": p, "radius": BASE_RADIUS, "catapults": cats[t]} for t, p in bases.items()},
        "plantCatapults": routes,
        "cityTerrain": data,
        "cityBattle": {"nodeReach": 1.5, "respawns": respawns, "baseSpawns": base_spawns},
        "attribution": "東京都デジタルサービス局「東京都区部点群」、国土地理院、国土交通省 Project PLATEAU。CC BY 4.0。実寸1/3・建物簡略化・海岸・施設を加工。出典と謝辞：https://github.com/chevi0t/core-breaker/blob/main/mapdesign/sowan/CREDITS.md",
    }
    hidden = {pid: sum(1 for e in enemy_eyes[pid] if seen_from(tree, solids, e, [px, pz])) for pid, px, pz in pods}
    return definition, {"nav": stats, "podVisibleFromEnemyEyes": hidden, "enemyEyes": {k: len(v) for k, v in enemy_eyes.items()}}


def main():
    data, solids, walkable, boundary, footprints, walk, report = terrain()
    print("terrain", len(compact(data)), report, flush=True)
    definition, stats = battle(data, solids, walkable, boundary, footprints, walk)
    clear = shapely.union_all(
        [Point(*b["at"]).buffer(BASE_RADIUS + 6) for b in definition["bases"].values()]
        + [Point(*p[1:3]).buffer(17) for p in definition["plants"]]
    )
    water = shapely.union_all([Polygon(r[0], r[1:]) for r in data["river"]["rings"]])
    data["district"].update(trees(boundary, water, clear))
    js = (
        "// 点群・地理院・PLATEAU由来。出典・加工：mapdesign/sowan/CREDITS.md\n(window.MAP_DATA=window.MAP_DATA||{}).sowan=".encode()
        + compact(definition)
        + b";\n"
    )
    geometry = len(js) - len(data["district"].get("photo", {}).get("image", "")) - len(data["district"].get("trees", {}).get("data", ""))
    assert geometry <= 500000, ("写真と木を除いて500KB超過", geometry)
    (ROOT / "prototype/maps/sowan.js").write_bytes(js)
    report.update(mapFileBytes=len(js), **stats, plants=definition["plants"], plantPods=definition["plantPods"],
                  bases={k: {"at": v["at"], "catapults": v["catapults"]} for k, v in definition["bases"].items()},
                  plantCatapults=definition["plantCatapults"])
    (OUT / "generation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k not in ["bases"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
