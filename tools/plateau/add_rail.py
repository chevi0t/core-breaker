#!/usr/bin/env python3
"""簡略化した街区に、空間を空けた模式的な高架線路を追加する。"""
import argparse,hashlib,json,pathlib
import numpy as np
import shapely
from shapely.geometry import LineString,Polygon,box
from build import write_preview
from simplify import extrusion,parts,rings,vertical_height

def main():
    ap=argparse.ArgumentParser();ap.add_argument('source',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path);ap.add_argument('--profile',required=True,type=pathlib.Path);ap.add_argument('--manifest',required=True,type=pathlib.Path);args=ap.parse_args()
    source=args.source;out=args.output;out.mkdir(parents=True,exist_ok=True)
    profile=json.loads(args.profile.read_text());raw=np.load(source/'geometry.npz');meta=json.loads((source/'summary.json').read_text())
    features=json.loads((source/'footprints.geojson').read_text())['features']
    roads=next(shapely.geometry.shape(f['geometry']) for f in features if f['properties']['kind']=='roads')
    half=meta['extentMeters']/2;bounds=box(-half,-half,half,half)
    routes={v['id']:LineString(v['points']) for v in profile['lines']}
    decks={v['id']:routes[v['id']].buffer(v['width']/2,cap_style='flat',join_style='mitre').intersection(bounds) for v in profile['lines']}
    corridor=shapely.union_all(list(decks.values())).buffer(profile['buildingClearance'],join_style='mitre')
    # 元の駅を含む建物を線路帯から退け、屋根や充填棟で高架下を塞がない。
    volumes=[];building_mesh=[];removed_area=0;infill_triangles=0
    for v in json.loads((source/'collision-volumes.json').read_text())['volumes']:
        p=Polygon(v['rings'][0],v['rings'][1:]);remaining=p.difference(corridor);removed_area+=p.area-remaining.area
        for piece in parts(remaining):
            if piece.area<2:continue
            updated={**v,'rings':rings(piece)}
            if 'area' in updated:updated['area']=round(piece.area,3)
            mesh=extrusion(piece,v['bottom'],v['top'],v['kind'] not in ('grounded','infill'))
            volumes.append(updated);building_mesh.append(mesh)
            if v['kind']=='infill':infill_triangles+=len(mesh)//3
    rail_mesh=[];color_ranges=[];rail_volumes=[];cursor=0
    def add(p,lo,hi,color,kind=None,line=None):
        nonlocal cursor
        for piece in parts(p.intersection(bounds)):
            if piece.area<.001 or hi<=lo:continue
            mesh=extrusion(piece,lo,hi);rail_mesh.append(mesh)
            color_ranges.append({'start':cursor,'count':len(mesh),'color':color});cursor+=len(mesh)
            if kind:rail_volumes.append({'rings':rings(piece),'bottom':round(lo,3),'top':round(hi,3),'kind':kind,'line':line})
    pier_count=0
    for spec in profile['lines']:
        line=routes[spec['id']];deck=decks[spec['id']];top=spec['top'];bottom=top-spec['thickness']
        add(deck,bottom,top,'#b4bbc2','rail-deck',spec['id'])
        # 枕木や架線は省略。レールと色帯は描画専用で、細い衝突物にしない。
        for offset in spec['tracks']:
            path=line.offset_curve(offset)
            add(path.buffer(2.1,cap_style='flat',join_style='mitre'),top,top+.08,'#59636b')
            for edge in [-.65,.65]:
                rail=path.offset_curve(edge).buffer(.12,cap_style='flat',join_style='mitre')
                add(rail,top+.08,top+.16,'#d2d7da')
        for offset in [-spec['width']/2+.35,spec['width']/2-.35]:
            add(line.offset_curve(offset).buffer(.3,cap_style='flat',join_style='mitre'),top,top+.12,spec['accent'])
        # 主要道路・川・他線との交差を避けて端寄りに柱を置く。
        other=shapely.union_all([v for k,v in decks.items() if k!=spec['id']]).buffer(4)
        for distance in np.arange(25,line.length,profile['pierSpacing']):
            point=line.interpolate(distance);before=line.interpolate(max(0,distance-.5));after=line.interpolate(min(line.length,distance+.5))
            direction=np.array([after.x-before.x,after.y-before.y]);direction/=np.linalg.norm(direction);normal=np.array([-direction[1],direction[0]])
            for sign in [-1,1]:
                x,z=np.array([point.x,point.y])+normal*sign*(spec['width']/2-2)
                radius=profile['pierSize']/2;p=box(x-radius,z-radius,x+radius,z+radius)
                if not bounds.covers(p) or p.intersects(other) or p.intersects(roads.buffer(profile['roadPierClearance'])):continue
                ground=vertical_height(raw['dem'],x,z)
                if ground is None or bottom-ground<profile['minimumHeadroom']:continue
                add(p,ground-1,bottom,'#9da7b0','rail-pier',spec['id']);pier_count+=1
    layers={k:raw[k] for k in ['bldg','tran','brid','dem']};layers['bldg']=np.concatenate(building_mesh);layers['rail']=np.concatenate(rail_mesh)
    stats={k:{'triangles':len(v)//3,'min':v.min(axis=0).round(3).tolist(),'max':v.max(axis=0).round(3).tolist()} for k,v in layers.items()}
    meta['layers']=stats;meta['display']['title']=profile['title'];meta['display']['railTarget']=[-9,10,28]
    meta['railColorRanges']=color_ranges;meta['infillVolumes']=[v for v in volumes if v['kind']=='infill']
    total=sum(v['triangles'] for v in stats.values());meta['railways']={'profile':profile,'piers':pier_count,'railTriangles':len(layers['rail'])//3,'triangles':total,'sourceGeometrySHA256':hashlib.sha256((source/'geometry.npz').read_bytes()).hexdigest(),'removedBuildingAreaWithOverlappingLevels':round(removed_area,2),'dimensionsAreGameEstimates':True,'decorativeRailsHaveCollision':False}
    meta['simplification']={**meta['simplification'],'triangles':total,'reductionFraction':1-total/meta['simplification']['originalTriangles'],'buildingVolumes':len(volumes),'sealedRegions':len(meta['infillVolumes']),'sealedArea':round(sum(v['area'] for v in meta['infillVolumes']),3),'infillTriangles':infill_triangles}
    for spec in meta['simplification']['landmarks']:
        spec['simplifiedRoof']=vertical_height(np.concatenate([layers['bldg'],layers['rail']]),*spec['at'])
    (out/'summary.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    (out/'collision-volumes.json').write_text(json.dumps({'unitRadius':1.3,'unitHeight':4,'volumes':volumes+rail_volumes},ensure_ascii=False,indent=2)+'\n')
    np.savez_compressed(out/'geometry.npz',**layers,**{k:raw[k] for k in raw.files if k not in layers})
    write_preview(layers,meta,json.loads(args.manifest.read_text()),out)
    print(json.dumps(meta['railways'],ensure_ascii=False),flush=True)

if __name__=='__main__':main()
