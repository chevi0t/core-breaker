#!/usr/bin/env python3
"""高架の連続・上下の空間・道路上の柱を検査。本体の物理試験ではない。"""
import argparse,json,pathlib
import numpy as np
import shapely
from shapely.geometry import Polygon,LineString,shape
from simplify import vertical_height

def main():
    ap=argparse.ArgumentParser();ap.add_argument('source',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path);args=ap.parse_args()
    source=args.source;out=args.output;geo=np.load(out/'geometry.npz');raw=np.load(source/'geometry.npz');meta=json.loads((out/'summary.json').read_text());profile=meta['railways']['profile']
    total=sum(len(geo[k])//3 for k in meta['layers']);assert total==meta['railways']['triangles'] and total<profile['maximumTriangles']
    for k in meta['layers']:
        assert np.isfinite(geo[k]).all() and np.abs(geo[k][:,[0,2]]).max()<=300.001
    for k in ['dem','tran','brid']:assert np.array_equal(geo[k],raw[k]),k
    specs={v['id']:v for v in profile['lines']};paths={k:LineString(v['points']) for k,v in specs.items()}
    volumes=json.loads((out/'collision-volumes.json').read_text())['volumes'];decks={v['line']:Polygon(v['rings'][0],v['rings'][1:]) for v in volumes if v['kind']=='rail-deck'}
    assert len(decks)==3 and all(p.is_valid and p.geom_type=='Polygon' for p in decks.values())
    features=json.loads((source/'footprints.geojson').read_text())['features'];roads=next(shape(f['geometry']) for f in features if f['properties']['kind']=='roads')
    gaps=[]
    for lower in ['local','highspeed']:
        intersection=paths[lower].intersection(paths['cross']);assert intersection.geom_type=='Point'
        gap=specs['cross']['top']-specs['cross']['thickness']-(specs[lower]['top']+.16)
        assert gap>=profile['minimumHeadroom'];gaps.append({'lower':lower,'at':[intersection.x,intersection.y],'clearanceMeters':gap})
    parallel_gap=decks['local'].distance(decks['highspeed']);assert parallel_gap>=8,parallel_gap
    roof_tri=geo['rail'].reshape(-1,3,3);samples=[]
    for name,spec in specs.items():
        p=decks[name];axis=0 if name=='cross' else 1
        assert p.bounds[axis]<=-299.99 and p.bounds[axis+2]>=299.99
        surface=roof_tri[np.all(np.abs(roof_tri[:,:,1]-spec['top'])<.001,axis=1)].reshape(-1,3)
        minimum_clearance=1000;count=0
        for distance in np.arange(0,paths[name].length,8):
            point=paths[name].interpolate(distance)
            if not (-299<point.x<299 and -299<point.y<299):continue
            assert vertical_height(surface,point.x,point.y) is not None,(name,distance)
            floors=[vertical_height(geo[k],point.x,point.y) for k in ['dem','tran']]
            floors=[h for h in floors if h is not None]
            if floors:minimum_clearance=min(minimum_clearance,spec['top']-spec['thickness']-max(floors))
            count+=1
        assert minimum_clearance>=profile['minimumHeadroom'],(name,minimum_clearance)
        samples.append({'line':name,'samples':count,'minimumGroundHeadroomMeters':minimum_clearance})
    corridors=shapely.union_all(list(decks.values())).buffer(profile['buildingClearance']-.01)
    building_overlap=0;piers=0;station_roofs=[];station_supports=0
    for v in volumes:
        p=Polygon(v['rings'][0],v['rings'][1:]);assert p.is_valid
        if v['kind']=='rail-pier':
            assert p.buffer(-.002).intersection(roads.buffer(profile['roadPierClearance']-.002)).area<.01
            assert not any(p.intersects(d.buffer(3.99)) for name,d in decks.items() if name!=v['line'])
            piers+=1
        elif v['kind']=='station-roof':
            spec=specs[v['line']];clearance=v['bottom']-spec['top']-.16
            assert clearance>=profile['minimumHeadroom']-.001
            if v['line']=='local':assert p.distance(decks['cross'])>=7.99
            point=p.representative_point();cap=geo['station'].reshape(-1,3,3)
            cap=cap[np.all(np.abs(cap[:,:,1]-v['top'])<.001,axis=1)].reshape(-1,3)
            assert vertical_height(cap,point.x,point.y) is not None,'駅の屋根が描画メッシュに存在する'
            station_roofs.append({'line':v['line'],'area':p.area,'headroom':clearance})
        elif v['kind']=='station-support':
            spec=specs[v['line']];assert abs(v['bottom']-spec['top'])<.001
            assert p.distance(paths[v['line']])>max(map(abs,spec['tracks']))+1.3+.75,'柱が線路の通行帯を塞がない'
            station_supports+=1
        elif v['kind']!='rail-deck':building_overlap+=p.intersection(corridors).area
    assert building_overlap<.01,building_overlap
    assert piers==meta['railways']['piers']
    assert meta['bases']==meta['plants']==0 and meta['railways']['decorativeRailsHaveCollision'] is False
    station_result=None
    if 'station' in profile:
        assert set(v['line'] for v in station_roofs)=={'local','cross'}
        assert sum(v['area'] for v in station_roofs if v['line']=='cross')>3000
        assert sum(v['area'] for v in station_roofs if v['line']=='local')>500
        assert vertical_height(geo['station'],-25,40)==25.5,'元の駅の確認点に屋根を復元'
        station_result={'roofRegions':len(station_roofs),'roofArea':round(sum(v['area'] for v in station_roofs),2),'minimumHeadroomMeters':min(v['headroom'] for v in station_roofs),'supportsClearOfTracks':station_supports,'originalStationWitnessRoofHeight':25.5}
    result={'triangles':total,'railTriangles':meta['railways']['railTriangles'],'continuousDecksToMapEdges':3,'trackCounts':{k:len(v['tracks']) for k,v in specs.items()},'crossingClearances':gaps,'parallelDeckGapMeters':parallel_gap,'deckSurfaceSamples':samples,'buildingCorridorOverlapSquareMeters':building_overlap,'piersClearOfRoadsAndOtherLines':piers,'station':station_result,'sourceGroundRoadsBridgesUnchanged':True,'decorativeRailsHaveCollision':False,'bases':0,'plants':0,'gamePhysicsTested':False}
    (out/'geometry-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
