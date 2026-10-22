#!/usr/bin/env python3
"""簡略化案の道路・欠測域・目印・可視の充填を検査（ゲーム物理の試験ではない）。"""
import argparse,gzip,hashlib,json,pathlib
import numpy as np
import shapely
from shapely.geometry import Polygon,shape
from simplify import KINDS,projection,vertical_height

def main():
    ap=argparse.ArgumentParser();ap.add_argument('source',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path);args=ap.parse_args()
    out=args.output;raw=np.load(args.source/'geometry.npz');geo=np.load(out/'geometry.npz')
    meta=json.loads((out/'summary.json').read_text());s=meta['simplification'];profile=s['profile']
    assert s['sourceGeometrySHA256']==hashlib.sha256((args.source/'geometry.npz').read_bytes()).hexdigest()
    total=sum(len(geo[k])//3 for k in KINDS)
    assert total==s['triangles'] and total<=profile['maximumTriangles'],total
    assert total<s['originalTriangles']*.35
    for k in KINDS:
        v=geo[k];assert np.isfinite(v).all() and len(v)%3==0
        assert np.abs(v[:,[0,2]]).max()<=meta['extentMeters']/2+.01
    assert np.array_equal(raw['brid'],geo['brid']),'歩道橋の形状を保持'
    for k in raw.files:
        if k not in KINDS:assert np.array_equal(raw[k],geo[k],equal_nan=True),k
    assert meta['bases']==meta['plants']==0
    # 角柱の屋根は水平、壁は垂直。QEMで屋根がテント状になる劣化を検出。
    t=geo['bldg'].reshape(-1,3,3).astype(float);normal=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]);length=np.linalg.norm(normal,axis=1)
    assert np.all((np.abs(normal[:,1])<1e-5)|(np.abs(np.abs(normal[:,1])-length)<1e-5))
    landmarks=[]
    for spec in profile['landmarks']:
        x,z=spec['at'];before=vertical_height(raw['bldg'],x,z);after=vertical_height(geo['bldg'],x,z)
        assert before is not None and after is not None,spec['name']
        assert abs(after-before)<=spec['maximumRoofChange'],(spec['name'],before,after)
        landmarks.append({'name':spec['name'],'originalRoof':before,'compactRoof':after,'differenceMeters':after-before})
    features=json.loads((out/'footprints.geojson').read_text())['features'];foot={f['properties']['kind']:shape(f['geometry']) for f in features}
    volumes=json.loads((out/'collision-volumes.json').read_text())['volumes']
    solids=[];fill=[];roof_checks=0
    for v in volumes:
        p=Polygon(v['rings'][0],v['rings'][1:]);assert p.is_valid and v['top']>v['bottom']
        if v['kind'] in ('grounded','infill'):solids.append(p)
        if v['kind']=='infill':fill.append(p)
        if v['kind']=='elevated':assert v['bottom']>=s['roadCeiling']-.001
        if p.buffer(-.002).intersection(foot['wideRoads'].buffer(-.002)).area>.01:
            assert v['bottom']>=s['roadCeiling']-.001,'上層部も道路の頭上を塞がない'
        # JSONだけの不可視壁になっていないことを、各体積の上面への鉛直線で検査。
        point=p.representative_point();at_height=geo['bldg'].reshape(-1,3,3)
        at_height=at_height[np.all(np.abs(at_height[:,:,1]-v['top'])<.002,axis=1)].reshape(-1,3)
        hit=vertical_height(at_height,point.x,point.y)
        assert hit is not None and abs(hit-v['top'])<.002,(v['kind'],point,v['top'])
        roof_checks+=1
    solid=shapely.union_all(solids);filled=shapely.union_all(fill)
    # 保存時の1mm丸めを除外して、主要道路と川へのはみ出しを検出。
    road_overlap=solid.buffer(-.002).intersection(foot['wideRoads'].buffer(-.002)).area
    water_overlap=solid.difference(foot['land'].buffer(.002)).area
    assert road_overlap<.01,road_overlap
    assert water_overlap<.01,water_overlap
    dem_outside=projection(geo['dem']).difference(foot['land'].buffer(.03)).area
    assert dem_outside<.01,dem_outside
    ground_errors=[]
    for iz in range(2,len(raw['ground'])-2,2):
        for ix in range(2,len(raw['ground'])-2,2):
            if not raw['groundValid'][iz-1:iz+2,ix-1:ix+2].all():continue
            x,y,z=raw['ground'][iz,ix];after=vertical_height(geo['dem'],x,z)
            assert after is not None,(x,z)
            ground_errors.append(abs(after-y))
    assert max(ground_errors)<profile['maximumSampledGroundError'],max(ground_errors)
    assert filled.area>1000 and len(fill)==s['sealedRegions']
    # 幅2.6mの機体が入り得た、建物まで4m未満の点が実体付きで閉じられた例。
    grid=np.arange(-298,300,2);xx,zz=np.meshgrid(grid,grid);points=shapely.points(np.c_[xx.ravel(),zz.ravel()])
    inside=shapely.contains(filled,points);candidates=points[inside];distance=shapely.distance(candidates,foot['original'])
    witnesses=candidates[(distance>profile['unitRadius']+.1)&(distance<profile['minimumPassageWidth']/2)]
    assert len(witnesses)>10,len(witnesses)
    source_html=(args.source/'preview.html').read_bytes();compact_html=(out/'preview.html').read_bytes()
    result={'finiteAndClipped':True,'triangles':total,'reductionPercent':round(100*(1-total/s['originalTriangles']),2),'flatRoofsAndVerticalWalls':True,'landmarks':landmarks,'bridgeUnchanged':True,'roadGroundedOverlapSquareMeters':road_overlap,'groundedOutsideLandSquareMeters':water_overlap,'demOutsideOriginalLandSquareMeters':dem_outside,'groundHeightSamples':len(ground_errors),'maximumGroundHeightDifferenceMeters':max(ground_errors),'minimumRoadHeadroomMeters':profile['roadHeadroom'],'visibleVolumeRoofsChecked':roof_checks,'sealedAreaSquareMeters':round(filled.area,2),'sealedNarrowGapWitnessCount':len(witnesses),'witnesses':[[p.x,p.y] for p in witnesses[::max(1,len(witnesses)//8)][:8]],'htmlBytes':{'original':len(source_html),'compact':len(compact_html)},'gzipBytes':{'original':len(gzip.compress(source_html)),'compact':len(gzip.compress(compact_html))},'bases':0,'plants':0,'gamePhysicsTested':False}
    (out/'geometry-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
