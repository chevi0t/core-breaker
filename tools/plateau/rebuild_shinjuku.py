#!/usr/bin/env python3
"""新宿のPLATEAU初版から、通路を保護して100KB以下のゲーム用地形を再構築する。"""
import argparse
import base64
import gzip
import hashlib
import json
import pathlib
import re
import subprocess

import numpy as np
import shapely
from shapely.geometry import Polygon, box

from build import ROOT, write_preview
from rebuild_trial import compact, pack_rings, pack_surface
from simplify import building_masses, clip_footprint, extrusion, parts, projection, rings


def read_source(folder):
    html = (folder/'preview.html').read_text()
    direct = re.search(r'const DATA=(.*);\n', html)
    if direct:
        payload = {'data': json.loads(direct[1]), 'meta': json.loads((folder/'summary.json').read_text())}
    else:
        payload = json.loads(re.search(r'let payload=(.*);\nif\(typeof payload', html)[1])
        if isinstance(payload, str):
            payload = json.loads(gzip.decompress(base64.b64decode(payload)))
    arrays = {k: np.frombuffer(base64.b64decode(v), dtype='<f4').reshape(-1, 3)
              for k, v in payload['data'].items()}
    return arrays, payload['meta']


def mesh(polygons, y):
    values = [extrusion(p, y-.1, y, False) for p in parts(polygons) if p.area > .05]
    return np.concatenate(values) if values else np.empty((0, 3), dtype='<f4')


def mound(allowed):
    # 公園の土盛りはゲーム用。道路と歩行空間を残し、平地から連続した斜面にする。
    angles = np.arange(20)*2*np.pi/20
    rows = []
    for radius, y in [(1, 0), (.72, 7), (.38, 14), (.12, 18)]:
        rows.append(np.array([[-210+77*radius*np.cos(a), y, -85+140*radius*np.sin(a)] for a in angles]))
    triangles = []
    for outside, inside in zip(rows, rows[1:]):
        for i in range(20):
            j = (i+1) % 20
            triangles.extend([outside[i], inside[i], outside[j], outside[j], inside[i], inside[j]])
    for i in range(1, 19):
        triangles.extend([rows[-1][0], rows[-1][i+1], rows[-1][i]])
    shape = Polygon(rows[0][:, [0, 2]])
    return clip_footprint(np.array(triangles, dtype='<f4'), allowed.intersection(shape)), shape


def rebuild(raw):
    boundary = box(-300, -300, 300, 300)
    # 位置・幅は初版の道路外形を資料にしたゲーム用の値。上下はユーザーの現地指摘を優先。
    crossings = [{'id': 'north', 'z': -78, 'width': 32, 'x0': -105},
                 {'id': 'south', 'z': 116, 'width': 30, 'x0': -300}]
    north_south = [-91, 45, 167]
    trenches = shapely.union_all([box(c['x0'], c['z']-c['width']/2, 300, c['z']+c['width']/2) for c in crossings])
    protected = projection(raw['tran'], .1).simplify(.8, preserve_topology=True).intersection(boundary)
    protected = shapely.union_all([protected, trenches,
        *[box(x-14, -300, x+14, 300) for x in north_south]])
    profile = dict(footprintPrecision=.1, minimumBuildingArea=60, minimumRoofArea=100,
                   roofHeightStep=2, outlineTolerance=.8, tieredBuildingArea=1600)
    _, source, _, _ = building_masses(raw['bldg'], boundary, protected, profile, -10, 8)
    volumes = []
    for v in source:
        if v['top'] < 8:
            continue
        original = Polygon(v['rings'][0], v['rings'][1:])
        polygon = original.simplify(.7, preserve_topology=True).intersection(original)
        for p in parts(polygon):
            if p.area < 60:
                continue
            volumes.append({**v, 'rings': rings(p)})
    # 降りたら戻れない堀にしない。各横道に3本ずつ、幅10m・勾配1:4の復帰坂を付ける。
    ramps = []
    for c in crossings:
        edge = c['z']-c['width']/2
        for x in ([-60, 167, 242] if c['id']=='north' else [-150, 45, 167]):
            ramps.append({'id': f"{c['id']}-{x}", 'x': x, 'z0': edge-32, 'z1': edge+1, 'width': 10})
    holes = shapely.union_all([box(r['x']-5, r['z0'], r['x']+5, r['z1']) for r in ramps])
    hill, hill_shape = mound(boundary.difference(protected.buffer(2)))
    hill_shape = hill_shape.intersection(boundary).difference(protected.buffer(2))
    ground = boundary.difference(trenches).difference(holes).difference(hill_shape)
    dem = np.concatenate([mesh(ground, 0), hill])
    road = protected.difference(trenches).difference(holes)
    tran = np.concatenate([mesh(road, .035), mesh(trenches.difference(holes), -8)])
    ramp_mesh = []
    for r in ramps:
        x, a, b = r['x'], r['z0'], r['z1']
        ramp_mesh.extend([[x-5, 0, a], [x-5, -8, b], [x+5, 0, a],
                          [x+5, 0, a], [x-5, -8, b], [x+5, -8, b]])
    tran = np.concatenate([tran, np.array(ramp_mesh, dtype='<f4')])
    decks = []
    for c in crossings:
        for x in north_south:
            decks.append({'kind': 'rail-deck', 'bottom': -1.5, 'top': 0,
                          'rings': rings(box(x-14, c['z']-c['width']/2-1, x+14, c['z']+c['width']/2+1)),
                          'crossing': c['id']})
    # 庁舎と会議棟の間は歩行デッキ。下に南北道路、その下に東西道路を通す。
    for z in [-30, 80]:
        decks.append({'kind': 'rail-deck', 'bottom': 6.5, 'top': 8,
                      'rings': rings(box(-5, z-5, 136, z+5)), 'pedestrian': True})
    volumes += decks
    brid = np.concatenate([extrusion(Polygon(v['rings'][0], v['rings'][1:]), v['bottom'], v['top']) for v in decks])
    bldg = np.concatenate([extrusion(Polygon(v['rings'][0], v['rings'][1:]), v['bottom'], v['top'], v['kind'] != 'grounded')
                           for v in volumes if v not in decks])
    return {'bldg': bldg, 'dem': dem, 'tran': tran, 'brid': brid}, volumes, protected, crossings, ramps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source', type=pathlib.Path)
    ap.add_argument('output', type=pathlib.Path)
    args = ap.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    raw, source_meta = read_source(args.source)
    layers, volumes, protected, crossings, ramps = rebuild(raw)
    kinds = sorted({v['kind'] for v in volumes})
    # 秋葉原と同じ、輪郭・高さと必要な地面だけを持つ形式。描画メッシュは実行時に展開。
    layout = {
        'geometryEncoding': 'city-layout-v1', 'half': 300, 'groundMaximum': 18,
        'spawns': [], 'district': {'bases': [], 'roofPads': []}, 'landmarks': [],
        'streetRepairs': [], 'heritage': {}, 'river': {'bed': -12, 'water': -10, 'rings': []},
        'volumeKinds': kinds,
        'volumes': [[kinds.index(v['kind']), v['bottom'], v['top'], pack_rings(v['rings']),
                     {k: val for k, val in v.items() if k not in ['kind', 'bottom', 'top', 'rings']}] for v in volumes],
        'surfaces': {k: pack_surface(layers[k]) for k in ['dem', 'tran']}, 'decorations': [],
        'packing': {'encoding': 'city-layout-v1', 'layers': {k: {'triangles': 0} for k in
                    ['bldg', 'rail', 'station', 'shops', 'dem', 'tran', 'brid', 'fill', 'ramps', 'aprons', 'plazas', 'streets', 'historicGround']}},
        'attribution': '東京都・国土交通省 Project PLATEAU 新宿区2025年度3D都市モデル、国土地理院。CC BY 4.0。建物・地面・道路をゲーム用に再構築。詳細はCREDITS.md。',
    }
    # 高架を地形の体積として持つので、橋の同じ面を二重には保存しない。
    measure = """
const fs=require('node:fs'),T=require(process.argv[1]);
const expand=new Function(fs.readFileSync(process.argv[2],'utf8')+';return expandCityLayout;')();
const data=JSON.parse(fs.readFileSync(process.argv[3]));expand(T,data);
console.log(JSON.stringify(Object.fromEntries(Object.entries(data.meshes).map(([k,v])=>[k,Buffer.from(v,'base64').length/36]))));
"""
    data = compact(layout)
    assert len(data) <= 100_000, f'地形が100KBを超過: {len(data)}B'
    (args.output/'layout.json').write_bytes(data+b'\n')
    counts = json.loads(subprocess.check_output(['node', '-e', measure, str(ROOT/'vendor/three-r128/three.min.js'),
                str(ROOT/'tools/plateau/rebuild_runtime.js'), str(args.output/'layout.json')]))
    for name, count in counts.items():
        layout['packing']['layers'].setdefault(name, {})['triangles'] = count
    data = compact(layout)
    assert len(data)+1 <= 100_000, f'地形が100KBを超過: {len(data)+1}B'
    (args.output/'layout.json').write_bytes(data+b'\n')
    bounds = {k: {'triangles': len(a)//3, 'min': a.min(axis=0).round(3).tolist(), 'max': a.max(axis=0).round(3).tolist()}
              for k, a in layers.items()}
    meta = {**source_meta, 'layers': bounds, 'bases': 0, 'plants': 0,
        'display': {'title': '摩天街区・地形再構築案', 'areaName': '高層街区と中央公園',
                    'robotPoint': [-150, -20], 'cameraTargetY': 45, 'streetTarget': [60, 0, -78],
                    'scaleYaw': -.5, 'scalePitch': .4, 'scaleDistance': 32,
                    'labels': []},
        'reconstruction': {'sourceTriangles': sum(v['triangles'] for v in source_meta['layers'].values()),
            'triangles': sum(counts.values()), 'layoutBytes': len(data)+1, 'limitBytes': 100_000,
            'volumes': len(volumes), 'buildings': sum(v['kind'] in ['grounded', 'upper', 'elevated'] for v in volumes),
            'levels': {'lowerRoad': -8, 'street': 0, 'pedestrianDeck': 8, 'parkTop': 18},
            'crossings': crossings, 'ramps': ramps, 'sourceHTMLSHA256': hashlib.sha256((args.source/'preview.html').read_bytes()).hexdigest(),
            'layoutSHA256': hashlib.sha256(data+b'\n').hexdigest(), 'bases': 0, 'plants': 0,
            'note': '上下道路とデッキは現地指摘に基づくゲーム用補正。地下構造の実測再現ではない。'}}
    manifest = json.loads((ROOT/'mapdesign/plateau_city/source-manifest.json').read_text())
    write_preview(layers, meta, manifest, args.output)
    (args.output/'summary.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2)+'\n')
    (args.output/'generation.json').write_text(json.dumps(meta['reconstruction'], ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(meta['reconstruction'], ensure_ascii=False))


if __name__ == '__main__':
    main()
