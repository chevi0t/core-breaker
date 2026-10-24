#!/usr/bin/env python3
"""西側へ伸ばした街区を半縮尺の地形確認用に再構築する。通常マップは変更しない。"""
import argparse
import base64
import concurrent.futures
import gzip
import hashlib
import json
import math
import pathlib
import struct
import urllib.request

import numpy as np
import shapely
from PIL import Image
from scipy.ndimage import binary_closing, label
from shapely.geometry import LineString, Point, Polygon, box
from shapely.affinity import rotate

from plateau_city_geometry import building_masses, extrusion, parts, projection, rings

ROOT = pathlib.Path(__file__).resolve().parents[1]


def compact(data):
    return json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()


def pack_rings(value, step=.02):
    result = []
    for ring in value:
        a = np.rint(np.array(ring) / step)
        if abs(a).max() >= 32768:
            raise ValueError('輪郭のint16範囲外')
        result.append(base64.b64encode(a.astype('<i2').tobytes()).decode())
    return result


def pack_surface(a, step=.02):
    q = np.rint(a / step).astype(np.int64)
    points, indices = np.unique(q, axis=0, return_inverse=True)
    if abs(q).max(initial=0) >= 32768 or len(points) >= 65536:
        raise ValueError('面の保存範囲外')
    return {'points': base64.b64encode(points.astype('<i2').tobytes()).decode(),
            'indices': base64.b64encode(indices.astype('<u2').tobytes()).decode(), 'step': step}


def floor_mesh(shape, height):
    result = []
    for p in parts(shape):
        a = extrusion(p, height - .2, height, False).reshape(-1, 3, 3)
        result.append(a[np.all(np.isclose(a[:, :, 1], height), axis=1)].reshape(-1, 3))
    return np.concatenate(result) if result else np.empty((0, 3), dtype='<f4')


def simplify_background(volumes, playable, boundary, scale, block):
    """通行範囲外だけ、指定区画ごとの単純な棟へまとめる。"""
    groups = {}
    result = [v for v in volumes if v[0] != 2]
    for v in volumes:
        if v[0] != 2:
            continue
        a = np.frombuffer(base64.b64decode(v[3][0]), dtype='<i2').reshape(-1, 2) * .02
        p = Polygon(a)
        key = (int(p.centroid.x // (block*scale)), int(p.centroid.y // (block*scale)))
        groups.setdefault(key, []).append((p, v[2]))
    from shapely.affinity import scale as resize
    outside = resize(boundary, scale, scale, origin=(0, 0)).difference(resize(playable, scale, scale, origin=(0, 0)))
    for values in groups.values():
        p = shapely.union_all([p for p, _ in values]).minimum_rotated_rectangle.intersection(outside)
        top = max(h for _, h in values)
        for q in parts(p):
            if q.area >= 9:
                result.append([2, -.5, top, pack_rings(rings(q)), {'landmarkColor': '#75817f'}])
    return result


def pack_volumes(volumes):
    """文字列とJSON記号の繰り返しを除く。座標・高さは非圧縮の整数列で保存。"""
    colors = [None]
    binary = bytearray()
    for kind, bottom, top, contours, meta in volumes:
        color = meta.get('landmarkColor')
        if color not in colors:
            colors.append(color)
        binary.extend(struct.pack('<BBhhH', kind, colors.index(color), round(bottom*100), round(top*100), len(contours)))
        for ring in contours:
            b = base64.b64decode(ring)
            binary.extend(struct.pack('<H', len(b)//4)); binary.extend(b)
    return base64.b64encode(binary).decode(), colors


def paint_landmarks(volumes, center, scale, rotation):
    """現行の秋葉原側で指定されたランドマーク色を位置照合して引き継ぐ。"""
    from shapely.affinity import translate, scale as resize
    source = json.loads((ROOT / 'research/maps/hoshimichi-west-landmarks.json').read_text())
    dx, dz = local_geo(center, *source['referenceCenter'])
    marks = []
    for m in source['landmarks']:
        p = Polygon(m['rings'][0], m['rings'][1:])
        marks.append((resize(rotate(translate(p, dx, dz), rotation, origin=(0, 0)), scale, scale, origin=(0, 0)), m['color']))
    for v in volumes:
        if v[0] not in [0, 1]:
            continue
        contours = [(np.frombuffer(base64.b64decode(r), dtype='<i2').reshape(-1, 2) * .02).tolist() for r in v[3]]
        p = Polygon(contours[0], contours[1:])
        choices = [(p.intersection(q).area, color) for q, color in marks if p.intersects(q)]
        if choices:
            area, color = max(choices)
            if area >= p.area * .25:
                v[4]['landmarkColor'] = color
    return volumes


def rotate_xz(points, degrees):
    angle = math.radians(degrees)
    ca, sa = math.cos(angle), math.sin(angle)
    return np.asarray(points) @ np.array([[ca, sa], [-sa, ca]])


def local_geo(center, lon, lat, rotation=0):
    # 正確なPLATEAU変換は取得器が行う。表示ラベルと5m標高のサンプリングは局所近似。
    east = (lon - center[0]) * 111319.49 * math.cos(math.radians(center[1]))
    south = (center[1] - lat) * 110940
    return rotate_xz([[east, south]], rotation)[0].tolist()


def river_from_dem(center, half, cache, rotation):
    """地理院5m標高の水域欠測・海抜0m以下から連続した河道を抽出する。"""
    cache.mkdir(parents=True, exist_ok=True)
    xs = np.arange(-half[0] + 2.5, half[0], 5)
    zs = np.arange(-half[1] + 2.5, half[1], 5)
    xx, zz = np.meshgrid(xs, zs)
    angle = math.radians(rotation)
    east = xx * math.cos(angle) + zz * math.sin(angle)
    south = -xx * math.sin(angle) + zz * math.cos(angle)
    lon = center[0] + east / (111319.49 * math.cos(math.radians(center[1])))
    lat = center[1] - south / 110940
    px = ((lon + 180) / 360 * 2**15 * 256).astype(int)
    py = ((1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * 2**15 * 256).astype(int)
    ids = sorted(set(zip((px // 256).ravel().tolist(), (py // 256).ravel().tolist())))

    def fetch(ident):
        x, y = ident
        url = f'https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/15/{x}/{y}.png'
        path = cache / f'{x}-{y}.png'
        if not path.exists():
            with urllib.request.urlopen(url, timeout=30) as r:
                path.write_bytes(r.read())
        return {'url': url, 'file': path.name, 'bytes': path.stat().st_size,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(fetch, ids))
    height = np.full(xx.shape, np.nan)
    for (x, y), record in zip(ids, records):
        rgb = np.array(Image.open(cache / record['file']).convert('RGB'), dtype=np.int32)
        raw = rgb[:, :, 0] * 65536 + rgb[:, :, 1] * 256 + rgb[:, :, 2]
        values = np.where(raw >= 2**23, raw - 2**24, raw).astype(float) / 100
        values[raw == 2**23] = np.nan
        mask = (px // 256 == x) & (py // 256 == y)
        height[mask] = values[py[mask] % 256, px[mask] % 256]
    wet = binary_closing(~np.isfinite(height) | (height <= 0), iterations=1)
    components, count = label(wet)
    river = []
    # 河道に連続する大きい領域を残し、孤立した地下道や建物内の低点を除く。
    for ident in range(1, count + 1):
        cells = np.argwhere(components == ident)
        if len(cells) < 50:
            continue
        river.extend(box(xs[x] - 2.5, zs[z] - 2.5, xs[x] + 2.5, zs[z] + 2.5) for z, x in cells)
    shape = shapely.union_all(river).simplify(4, preserve_topology=True)
    return shape, records


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source', type=pathlib.Path)
    ap.add_argument('output', type=pathlib.Path)
    ap.add_argument('--config', type=pathlib.Path, default=ROOT / 'research/maps/hoshimichi-west-sources.json')
    args = ap.parse_args()
    config = json.loads(args.config.read_text())
    raw = np.load(args.source / 'geometry.npz')
    manifest = json.loads((args.source / 'source-manifest.json').read_text())
    half = config['halfExtents']; active_half = config['playableHalfExtents']; scale = config['scale']
    rotation = config['rotationDegrees']
    if manifest['center'] != config['referenceCenter'] or manifest['halfExtents'] != half or manifest['rotationDegrees'] != rotation:
        raise ValueError('元地形の範囲が設定と一致しない')
    args.output.mkdir(parents=True, exist_ok=True)
    boundary = box(-half[0], -half[1], half[0], half[1])
    playable = box(-active_half[0], -active_half[1], active_half[0], active_half[1])
    river, dem = river_from_dem(config['referenceCenter'], half, args.source / 'dem-cache', rotation)
    print(json.dumps({'riverArea': round(river.area), 'demTiles': len(dem)}), flush=True)
    land = boundary.difference(river)
    triangles = raw['tran'].reshape(-1, 3, 3)
    ground = triangles[triangles[:, :, 1].mean(axis=1) < 5]
    roads = projection(ground.reshape(-1, 3), .15).simplify(.5).intersection(land)
    profile = dict(footprintPrecision=.15, minimumBuildingArea=16, minimumRoofArea=30,
                   roofHeightStep=2, outlineTolerance=.5, tieredBuildingArea=2000)
    _, source_volumes, _, removed = building_masses(raw['bldg'], boundary, roads.buffer(.12), profile, -.5, 6)
    print(json.dumps({'sourceVolumes': len(source_volumes), 'removed': removed}), flush=True)
    # 既存の秋葉原600m四方の範囲。街を複製せず、同じ地理位置を枠で比較する。
    old_center = local_geo(config['referenceCenter'], 139.7734, 35.6986)
    old_frame = box(old_center[0] - 300, old_center[1] - 300, old_center[0] + 300, old_center[1] + 300)
    old_frame = rotate(old_frame, rotation, origin=(0, 0))
    labels = [{**q, 'at': local_geo(config['referenceCenter'], *q['geo'], rotation)} for q in config['display']['labels']]
    labels += [{'text': '御茶ノ水駅', 'at': local_geo(config['referenceCenter'], 139.76518, 35.69945, rotation)}]
    # 高架は旧案の線形を再利用し、西側だけ模式的に延長する。全て実寸m。
    dx = old_center[0]
    lines = [
        {'id': 'local', 'points': [[dx+12,-550],[dx-28,0],[dx-84,550]], 'width': 30, 'top': 12, 'color': '#8db89d'},
        {'id': 'highspeed', 'points': [[dx+52,-550],[dx+12,0],[dx-42,550]], 'width': 16, 'top': 14, 'color': '#a0b7c0'},
        {'id': 'cross', 'points': [[-900,-170],[-640,-125],[-450,-100],[-320,-30],[-30,-5],[dx+24,31],[900,95]], 'width': 18, 'top': 20, 'color': '#d4b789'},
    ]
    rail_shapes = []
    for spec in lines:
        points = np.array(spec['points'], dtype=float)
        # 切り取り方向を変えても、線路が地形の途中で途切れないよう端を延ばしてから切る。
        points[0] += (points[0] - points[1]) * 4
        points[-1] += (points[-1] - points[-2]) * 4
        p = rotate(LineString(points).buffer(spec['width'] / 2, cap_style='flat', join_style='mitre'), rotation, origin=(0, 0))
        rail_shapes.append((spec, p.intersection(boundary)))
    # 線路直下の元データを巨大な建物へ潰さない。地上の道路横断部も空けておく。
    rail_clear = shapely.union_all([p.buffer(.5) for _, p in rail_shapes])
    base_volumes = []
    for v in source_volumes:
        p = Polygon(v['rings'][0], v['rings'][1:])
        if v['kind'] == 'grounded':
            p = p.difference(rail_clear)
        for part in parts(p):
            if part.area >= 16:
                base_volumes.append((v, part))
    attempts = []
    for tolerance in [.6, 1.0, 1.5, 2.0]:
        volumes = []
        for v, source_shape in base_volumes:
            for p in parts(source_shape.intersection(playable)):
                # 簡略化で隣の建物や路地へ張り出すことを防ぐ。
                p = p.simplify(tolerance, preserve_topology=True).intersection(p)
                for q in parts(p):
                    if q.area >= 16:
                        volumes.append([0 if v['kind'] == 'grounded' else 1, round(v['bottom'] * scale, 2),
                                        round(max(3, v['top'] * scale), 2), pack_rings((np.array(r) * scale).tolist() for r in rings(q)), {}])
            for p in parts(source_shape.difference(playable)):
                # 進入範囲外の背景は4角の箱へ近似し、輪郭の細部を保存しない。
                q = p.minimum_rotated_rectangle.intersection(boundary).difference(playable)
                for piece in parts(q):
                    if piece.area >= 36:
                        volumes.append([2, -.5, round(max(3, v['top'] * scale), 1),
                                        pack_rings((np.array(r) * scale).tolist() for r in rings(piece)), {'previewBackground': True, 'landmarkColor': '#75817f'}])
        for spec, p in rail_shapes:
            for piece in parts(p):
                volumes.append([3, spec['top'] * scale - 1, spec['top'] * scale,
                                pack_rings((np.array(r) * scale).tolist() for r in rings(piece)), {'landmarkColor': spec['color']}])
                shops = piece.difference(roads.buffer(2)).difference(river)
                for q in parts(shops):
                    if q.area > 30:
                        volumes.append([0, -.5, spec['top'] * scale - 1,
                                        pack_rings((np.array(r) * scale).tolist() for r in rings(q)), {'landmarkColor': '#6e7375'}])
        # 秋葉原の駅屋根を保持。単純な板でも南北・東西の積層を読み取れるようにする。
        for p, top in [(box(dx-60, -120, dx+5, 142), 8.0), (box(dx-136, -5, dx+101, 65), 13.0)]:
            p = rotate(p, rotation, origin=(0, 0)).intersection(boundary)
            volumes.append([3, top-.6, top, pack_rings((np.array(r)*scale).tolist() for r in rings(p)), {'landmarkColor': '#dce1df'}])
        surfaces = {'dem': floor_mesh(land, 0), 'water': floor_mesh(river, -6), 'bed': floor_mesh(river, -10)}
        data = {'geometryEncoding': 'city-layout-v1', 'half': max(half) * scale, 'halfExtents': [v * scale for v in half],
                'ringCoordinateStep': .02, 'groundMaximum': .1, 'spawns': [],
                'district': {'bases': [], 'roofPads': []}, 'landmarks': [], 'streetRepairs': [], 'heritage': {},
                'river': {'bed': -5, 'water': -3, 'rings': []}, 'volumeKinds': ['grounded', 'upper', 'infill', 'elevated'],
                'volumes': volumes, 'surfaces': {k: pack_surface(a * scale) for k, a in surfaces.items()}, 'decorations': [],
                'packing': {'encoding': 'city-layout-v1', 'layers': {}},
                'preview': {'playable': (np.array(playable.exterior.coords[:-1]) * scale).tolist(),
                            'previous': (np.array(old_frame.exterior.coords[:-1]) * scale).tolist(),
                            'labels': [{'text': q['text'], 'at': (np.array(q['at']) * scale).tolist()} for q in labels],
                            'rotationDegrees': rotation, 'terrainDeformed': False,
                            'drawingExtent': [v*2*scale for v in half], 'playableExtent': [v*2*scale for v in active_half]}}
        data['volumes'] = paint_landmarks(simplify_background(volumes, playable, boundary, scale, config['backgroundBlockMeters']), config['referenceCenter'], scale, rotation)
        count = len(data['volumes'])
        data['volumes'], data['volumeColors'] = pack_volumes(data['volumes'])
        data['volumeEncoding'] = 'kind-u8-color-u8-y01-i16-rings-u16'
        data['volumeCount'] = count
        size = len(compact(data)) + 1
        attempts.append({'toleranceRealMeters': tolerance, 'bytes': size})
        if size <= config['maximumLayoutBytes']:
            break
    (args.output / 'layout.json').write_bytes(compact(data) + b'\n')
    info = {'realExtentMeters': [v*2 for v in half], 'playableRealExtentMeters': [v*2 for v in active_half],
            'gameExtentMeters': [v*2*scale for v in half], 'playableGameExtentMeters': [v*2*scale for v in active_half],
            'scaleXYZ': [scale]*3, 'equivalentRealWorldMechHeightMeters': 4/scale,
            'layoutBytes': size, 'targetBytes': config['maximumLayoutBytes'], 'withinTarget': size <= config['maximumLayoutBytes'],
            'sourceVolumes': len(source_volumes), 'volumes': count, 'attempts': attempts,
            'sourceGeometrySHA256': hashlib.sha256((args.source / 'geometry.npz').read_bytes()).hexdigest(),
            'layoutSHA256': hashlib.sha256((args.output / 'layout.json').read_bytes()).hexdigest(),
            'bases': 0, 'plants': 0, 'playableConnectedToGame': False, 'rotationDegrees': rotation, 'terrainDeformed': False}
    (args.output / 'generation.json').write_text(json.dumps(info, ensure_ascii=False, indent=2)+'\n')
    manifest['dem'] = dem
    (args.output / 'source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    encoded = base64.b64encode(gzip.compress(compact(data), mtime=0)).decode()
    template = (ROOT / 'tools/hoshimichi_west_viewer.html').read_text()
    # 本体の復元器を読み取り専用で再利用する。
    source = (ROOT / 'prototype/index.html').read_text()
    expand = source[source.index('function expandCityLayout('):source.index('// 肩越し視点')]
    html = template.replace('/*__THREE__*/', (ROOT / 'vendor/three-r128/three.min.js').read_text())
    html = html.replace('/*__EXPAND__*/', expand).replace('/*__PAYLOAD__*/', json.dumps(encoded))
    html = html.replace('__LICENSE__', (ROOT / 'vendor/three-r128/LICENSE').read_text())
    (args.output / 'preview.html').write_text(html)
    print(json.dumps(info, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
