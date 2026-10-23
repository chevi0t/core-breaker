#!/usr/bin/env python3
"""梅田1km四方を、PLATEAU建物と地理院道路中心線から100KB以下へ再構築する。"""
import argparse
import base64
import concurrent.futures
import hashlib
import json
import math
import pathlib
import subprocess
import urllib.request

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box

from build import ROOT, Frame, ecef, write_preview
from rebuild_trial import compact, pack_rings, pack_surface
from simplify import building_masses, extrusion, parts, projection, rings
from trial_simplify import floor_mesh


def fetch_roads(cache, manifest):
    folder = cache/'roads';folder.mkdir(exist_ok=True)
    lon, lat = manifest['center'];half = manifest['halfExtent']+12
    dx = half/(111320*math.cos(math.radians(lat)));dy = half/110900
    def tile(lo, la):
        return ((lo+180)/360*65536, (1-math.asinh(math.tan(math.radians(la)))/math.pi)/2*65536)
    x0,y0 = tile(lon-dx, lat+dy);x1,y1 = tile(lon+dx, lat-dy)
    jobs = [(x,y) for x in range(int(x0),int(x1)+1) for y in range(int(y0),int(y1)+1)]
    def get(xy):
        x,y=xy;url=f'https://cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/16/{x}/{y}.geojson'
        path=folder/f'16-{x}-{y}.geojson'
        if not path.exists():
            with urllib.request.urlopen(url,timeout=40) as response:path.write_bytes(response.read())
        data=path.read_bytes();json.loads(data)
        return {'file':str(path.relative_to(cache)),'url':url,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(get,jobs))


def roads_from_source(cache, records, manifest):
    frame=Frame(manifest['center'],0);half=manifest['halfExtent'];boundary=box(-half,-half,half,half)
    reference=json.loads((cache/'gsi-elevation.json').read_text())['elevation']
    geoid=float(json.loads((cache/'geoid.txt').read_text())['OutputData']['geoidHeight'])
    areas=[];samples=[];seen=set();excluded=0
    for record in records:
        for feature in json.loads((cache/record['file']).read_text())['features']:
            props=feature['properties'];geometry=feature['geometry']
            if geometry['type']!='LineString':continue
            if props.get('lvOrder',0)<0 or 'トンネル' in props.get('type','') or props.get('motorway')==1:
                excluded+=1;continue
            coordinates=geometry['coordinates'];key=json.dumps(coordinates,separators=(',',':'))
            if key in seen:continue
            seen.add(key)
            lo,la=np.array(coordinates).T[:2]
            xyz=frame.local(ecef(np.radians(lo),np.radians(la),reference+geoid),reference+geoid)
            line=LineString(xyz[:,[0,2]]).intersection(boundary)
            if line.is_empty:continue
            try:width=float(props.get('Width',0))
            except (TypeError,ValueError):width=0
            if width<=0:
                band=props.get('rnkWidth','');width=24 if '19.5m以上' in band else 16 if '13m' in band else 10
            width=max(8,min(42,width))
            areas.append(line.buffer(width/2+1,cap_style='flat',join_style='mitre'))
            if line.geom_type=='LineString' and line.length>20:
                a=line.interpolate(.5,normalized=True);samples.append([round(a.x,2),round(a.y,2)])
    roads=shapely.union_all(areas).intersection(boundary)
    # 駅中央を地上で横断できるようにする。地下街・改札・店舗内の再現は行わない。
    concourse=box(-207,-148,-193,150)
    plazas=shapely.union_all([Point(-186,158).buffer(27,quad_segs=4),Point(-180,-134).buffer(24,quad_segs=4)])
    protected=shapely.union_all([roads,concourse,plazas]).intersection(boundary)
    return protected, samples, {'roadFeatures':len(areas),'excludedUndergroundOrMotorwayFeatures':excluded,
                                'concourse':[-207,-148,-193,150],'plazas':[[-186,158,27],[-180,-134,24]]}


def geometry(raw, protected, half, tolerance):
    boundary=box(-half,-half,half,half)
    profile=dict(footprintPrecision=.1,minimumBuildingArea=60,minimumRoofArea=100,
                 roofHeightStep=2,outlineTolerance=tolerance,tieredBuildingArea=3000)
    _,source,_,_=building_masses(raw,boundary,protected,profile,-2,8)
    volumes=[]
    for v in source:
        if v['top']<6:continue
        original=Polygon(v['rings'][0],v['rings'][1:])
        allowed=original if v['kind']!='grounded' else original.difference(protected.buffer(.1))
        coarse=original.simplify(tolerance,preserve_topology=True).intersection(allowed)
        for p in parts(coarse):
            if p.area>=60:volumes.append({**v,'rings':rings(p)})
    # 地面は一枚の平面。道路表示だけを分け、移動の細かな段差を作らない。
    dem=floor_mesh(boundary,0)
    street=protected.simplify(.6,preserve_topology=True).intersection(boundary)
    tran=floor_mesh(street,.04)
    bldg=np.concatenate([extrusion(Polygon(v['rings'][0],v['rings'][1:]),v['bottom'],v['top'],v['kind']!='grounded') for v in volumes])
    # 空レイヤーも残し、共通のビューアと都市ランタイムへ接続できるようにする。
    return {'bldg':bldg,'dem':dem,'tran':tran,'brid':np.empty((0,3),dtype='<f4')},volumes


def make_layout(layers, volumes, half):
    kinds=sorted({v['kind'] for v in volumes});step=.02
    return {'geometryEncoding':'city-layout-v1','ringCoordinateStep':step,'half':half,'groundMaximum':.04,
        'spawns':[],'district':{'bases':[],'roofPads':[]},'landmarks':[],'streetRepairs':[],'heritage':{},
        'river':{'bed':-3,'water':-1,'rings':[]},'volumeKinds':kinds,
        'volumes':[[kinds.index(v['kind']),v['bottom'],v['top'],pack_rings(v['rings'],step),{}] for v in volumes],
        'surfaces':{k:pack_surface(layers[k],step) for k in ['dem','tran']},'decorations':[],
        'packing':{'encoding':'city-layout-v1','layers':{k:{'triangles':0} for k in
            ['bldg','dem','tran','brid','fill','ramps','aprons','plazas','streets','historicGround','rail','station','shops']}},
        'attribution':'大阪市・国土交通省 Project PLATEAU（北区2025年度）、国土地理院の道路中心線・標高・ジオイド。CC BY 4.0。街区と道路をゲーム用に加工。出典と謝辞はCREDITS.md。'}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('cache',type=pathlib.Path);ap.add_argument('source',type=pathlib.Path)
    ap.add_argument('output',type=pathlib.Path);args=ap.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((args.cache/'inputs.json').read_text());assert manifest['halfExtent']==500 and manifest['rotationDegrees']==0
    for record in [*manifest['models'],*manifest['dem'],*manifest['tilesets'],manifest['geoid'],manifest['referenceElevation']]:
        assert hashlib.sha256((args.cache/record['file']).read_bytes()).hexdigest()==record['sha256'],record['file']
    raw=np.load(args.source/'geometry.npz')['bldg'];source_meta=json.loads((args.source/'summary.json').read_text())
    road_records=fetch_roads(args.cache,manifest)
    protected,samples,road_stats=roads_from_source(args.cache,road_records,manifest)
    attempts=[]
    for tolerance in [1,1.5,2,3]:
        layers,volumes=geometry(raw,protected,500,tolerance);layout=make_layout(layers,volumes,500)
        size=len(compact(layout))+1;attempts.append({'outlineTolerance':tolerance,'bytes':size})
        if size<98000:break
    assert size<98000,f'100KBの予算に収まらない: {attempts}'
    (out/'layout.json').write_bytes(compact(layout)+b'\n')
    measure="""
const fs=require('node:fs'),T=require(process.argv[1]);
const expand=new Function(fs.readFileSync(process.argv[2],'utf8')+';return expandCityLayout;')();
const d=JSON.parse(fs.readFileSync(process.argv[3]));expand(T,d);
console.log(JSON.stringify(Object.fromEntries(Object.entries(d.meshes).map(([k,v])=>[k,Buffer.from(v,'base64').length/36]))));
"""
    counts=json.loads(subprocess.check_output(['node','-e',measure,str(ROOT/'vendor/three-r128/three.min.js'),
        str(ROOT/'tools/plateau/rebuild_runtime.js'),str(out/'layout.json')]))
    for name,count in counts.items():layout['packing']['layers'][name]['triangles']=count
    data=compact(layout)+b'\n';assert len(data)<=100000;(out/'layout.json').write_bytes(data)
    sha=hashlib.sha256(data).hexdigest()
    # 俯瞰にも量子化後の同じ面を使う。Python側の三角化の予測値と混ぜない。
    restore="""
const fs=require('node:fs'),T=require(process.argv[1]);
const expand=new Function(fs.readFileSync(process.argv[2],'utf8')+';return expandCityLayout;')();
const d=JSON.parse(fs.readFileSync(process.argv[3]));expand(T,d);console.log(JSON.stringify(d.meshes));
"""
    expanded=json.loads(subprocess.check_output(['node','-e',restore,str(ROOT/'vendor/three-r128/three.min.js'),
        str(ROOT/'tools/plateau/rebuild_runtime.js'),str(out/'layout.json')]))
    layers={name:np.frombuffer(base64.b64decode(expanded.get(name,'')),dtype='<f4').reshape(-1,3) for name in ['bldg','dem','tran','brid']}
    record={'area':'umeda','extentMeters':1000,'halfExtent':500,'layoutBytes':len(data),'limitBytes':100000,
        'triangles':sum(counts.values()),'sourceBuildingTriangles':len(raw)//3,'volumes':len(volumes),'sourceTiles':len(manifest['models']),
        'coordinateStep':.02,'outlineTolerance':tolerance,'attempts':attempts,'layoutSHA256':sha,
        'sourceGeometrySHA256':hashlib.sha256((args.source/'geometry.npz').read_bytes()).hexdigest(),
        **road_stats,'bases':0,'plants':0,'roadSamples':samples}
    stats={k:{'triangles':len(a)//3,'min':a.min(axis=0).round(3).tolist() if len(a) else None,
              'max':a.max(axis=0).round(3).tolist() if len(a) else None} for k,a in layers.items()}
    meta={**source_meta,'layers':stats,'reconstruction':record,'display':{
        'title':'環都駅前・地形再構築案','areaName':'中央駅と百貨店周辺','robotPoint':[-200,165],
        'cameraTargetY':30,'streetTarget':[-160,0,85],'scaleYaw':.3,'scalePitch':.4,'scaleDistance':32,'labels':[]}}
    write_preview(layers,meta,manifest,out)
    (out/'generation.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    (out/'summary.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    (out/'source-manifest.json').write_text(json.dumps({**manifest,'roadCenterlines':road_records},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in record.items() if k!='roadSamples'},ensure_ascii=False))


if __name__=='__main__':main()
