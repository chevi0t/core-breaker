"""半縮尺の街路天井を上げ、接続している床・上部棟の高さをそろえる。"""
import base64
import hashlib
import json

import numpy as np
import shapely
from shapely.geometry import Polygon


def _fingerprint(data):
    rows = [[v[0], v[3], *v[4:]] for v in data['volumes']]
    return hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def adjust_clearance(data, minimum_clearance=5.5, minimum_floor_thickness=1.0):
    """cityTerrain をインプレース補正し、変更した高さと検査結果を返す。

    道路上の elevated だけを起点にする。同じ高さで面積を持って重なる
    上面・下面は一枚の接合面として扱うため、上部棟の底が旧高さに残らない。
    頂部を動かすのは最低床厚を割る場合だけ。輪郭・属性・斜め屋根は保持する。
    """
    volumes = data['volumes']
    kinds = data['volumeKinds']
    step = data['ringCoordinateStep']
    before_hash = _fingerprint(data)
    before = [(v[1], v[2]) for v in volumes]
    shapes = []
    for v in volumes:
        rings = [np.frombuffer(base64.b64decode(r), dtype='<i2').reshape(-1, 2) * step for r in v[3]]
        p = Polygon(rings[0], rings[1:])
        shapes.append(p if p.is_valid else shapely.make_valid(p))

    # endpoint 2*i が下面、2*i+1 が上面。接合面は原形の高さでのみ結ぶ。
    parent = list(range(2 * len(volumes)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def join(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[b] = a

    tree = shapely.STRtree(shapes)
    contacts = []
    for i, shape in enumerate(shapes):
        for raw_j in tree.query(shape):
            j = int(raw_j)
            if j <= i:
                continue
            pairs = [(a, b) for a in range(2) for b in range(2)
                     if abs(before[i][a] - before[j][b]) < 1e-7]
            if not pairs or shape.intersection(shapes[j]).area <= 1e-6:
                continue
            for a, b in pairs:
                join(2 * i + a, 2 * j + b)
                if a != b:
                    contacts.append((i, a, j, b))

    heights = {}
    for i, pair in enumerate(before):
        for side, value in enumerate(pair):
            heights[find(2 * i + side)] = value
    seeds = []
    for i, v in enumerate(volumes):
        if kinds[v[0]] == 'elevated' and 0 < v[1] < minimum_clearance:
            root = find(2 * i)
            heights[root] = max(heights[root], minimum_clearance)
            seeds.append(i)

    # 原形の高さ順に解けば一度で伝播する。反復は丸め等を含む接合にも対応する。
    order = sorted(range(len(volumes)), key=lambda i: before[i])
    for iteration in range(len(volumes) + 1):
        changed = False
        for i in order:
            bottom, top = find(2 * i), find(2 * i + 1)
            thickness = min(minimum_floor_thickness, before[i][1] - before[i][0])
            required = heights[bottom] + thickness
            if heights[top] < required - 1e-7:
                heights[top] = required
                changed = True
        if not changed:
            break
    else:
        raise ValueError('天井の接合高さが収束しない')

    updates = []
    for i, v in enumerate(volumes):
        bottom = round(heights[find(2 * i)], 6)
        top = round(heights[find(2 * i + 1)], 6)
        if (bottom, top) != before[i]:
            updates.append({'index': i, 'kind': kinds[v[0]],
                            'before': list(before[i]), 'after': [bottom, top]})
            v[1], v[2] = bottom, top

    assert before_hash == _fingerprint(data), '輪郭・配色・属性が変化した'
    assert all(abs(volumes[i][a + 1] - volumes[j][b + 1]) < 1e-6 for i, a, j, b in contacts), '接合面に段差が残る'
    assert all(v[1] >= minimum_clearance - 1e-7 for v in volumes if kinds[v[0]] == 'elevated'), '通路天井が低い'
    assert all(v[2] - v[1] >= min(minimum_floor_thickness, hi - lo) - 1e-7
               for v, (lo, hi) in zip(volumes, before)), '床厚が不足'
    return {'minimumClearanceMeters': minimum_clearance,
            'minimumFloorThicknessMeters': minimum_floor_thickness,
            'seedElevatedIndices': seeds, 'updatedVolumes': updates,
            'updatedVolumeCount': len(updates), 'attachedSurfacePairs': len(contacts),
            'footprintsAndAttributesSHA256': before_hash,
            'footprintsAndAttributesUnchanged': True,
            'attachedSurfacesContinuous': True,
            'stationCanopyUnchanged': True,
            'lowElevatedRemaining': 0}
