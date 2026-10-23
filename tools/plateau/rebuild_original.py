#!/usr/bin/env python3
"""初版から高架→店舗→街区単純化の順に作り直す。道路・路地の保護を先に決める。"""
import argparse
import base64
import copy
import gzip
import hashlib
import json
import math
import pathlib
import re

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box, mapping

from build import write_preview
from build_trial import ROOT, build
from rebuild_trial import compact, make_layout, volume
from simplify import building_masses, clip_footprint, extrusion, parts, projection, rings
from trial_district import BUILDINGS, access_routes, mark_landmarks, shape
from trial_river import add_exits
from trial_simplify import clear_bases, floor_mesh
from trial_streets import thin_deck


def read_original(folder):
    html = (folder/'preview.html').read_text()
    match = re.search(r'const DATA=(.*);\n', html)
    if match:
        encoded = json.loads(match[1])
    else:
        payload = json.loads(re.search(r'let payload=(.*);\nif\(typeof payload',html)[1])
        if isinstance(payload,str): payload=json.loads(gzip.decompress(base64.b64decode(payload)))
        encoded = payload['data']
    arrays = {k:np.frombuffer(base64.b64decode(v),dtype='<f4').reshape(-1,3).copy() for k,v in encoded.items()}
    meta = json.loads((folder/'summary.json').read_text())
    for k,a in arrays.items(): assert len(a)//3 == meta['layers'][k]['triangles']
    return arrays,meta


def empty(): return np.empty((0,3),dtype='<f4')


def source_passages(raw, land, roads, settings):
    # 初版の外形を分析するだけで、ここでは描画用の建物を変更しない。隙間の充填処理は呼ばない。
    profile=json.loads((ROOT/'research/maps/akihabara-compact.json').read_text())
    profile.update(outlineTolerance=.15,footprintPrecision=.05,minimumBuildingArea=8)
    _,volumes,occupied,_=building_masses(raw['bldg'],land,roads,profile,-3,6)
    free=land.difference(occupied)
    radius=settings['minimumPassageWidth']/2
    core=free.buffer(-radius,quad_segs=2,join_style='mitre')
    connected=shapely.union_all([p for p in parts(core) if p.intersection(roads).area>5])
    # 広場の全面を「路地」にせず、建物に挟まれた細い接続部分を取り出す。
    wide=free.buffer(-settings['wideOpenSpaceWidth']/2,quad_segs=2,join_style='mitre')
    wide=wide.buffer(settings['wideOpenSpaceWidth']/2-radius,quad_segs=2,join_style='mitre')
    narrow=connected.difference(wide)
    narrow=shapely.union_all([p for p in parts(narrow) if p.area>=6])
    alleys=narrow.buffer(radius,quad_segs=2,join_style='mitre').intersection(free)
    protected=shapely.union_all([roads,alleys]).intersection(land)
    return volumes,occupied,connected,narrow,protected


def railway(raw, land, roads, rail_profile, trial_profile):
    bounds=box(-300,-300,300,300);volumes=[];decks={}
    specs={s['id']:s for s in rail_profile['lines']}
    paths={s['id']:LineString(s['points']) for s in rail_profile['lines']}
    def add(p,lo,hi,kind,**meta):
        for q in parts(p.intersection(bounds)):
            if q.area>.05:volumes.append(volume(q,round(lo,3),hi,kind,**meta))
    for spec in rail_profile['lines']:
        p=paths[spec['id']].buffer(spec['width']/2,cap_style='flat',join_style='mitre').intersection(bounds)
        decks[spec['id']]=p
        add(p,spec['top']-spec['thickness'],spec['top'],'rail-deck',line=spec['id'])
    # 2本の南北高架間は8→10mの連続面にする。店舗は次の段階で作る。
    zs=sorted({-300.,300.,*[z for p in [decks['local'],decks['highspeed']] for _,z in p.exterior.coords]})
    edges=[]
    for z in zs:
        section=LineString([(-300,z),(300,z)])
        edges.append((decks['local'].intersection(section).bounds[2],decks['highspeed'].intersection(section).bounds[0],z))
    gap=Polygon([(a,z) for a,b,z in edges]+[(b,z) for a,b,z in reversed(edges)])
    bridge=[];thickness=trial_profile['railGap']['thickness']
    for n,((a,b,z),(c,d,zz)) in enumerate(zip(edges,edges[1:])):
        if zz-z<.001:continue
        top=np.array([[a,8,z],[b,10,z],[c,8,zz],[d,10,zz]])
        bottom=top.copy();bottom[:,1]-=thickness
        bridge.extend(top[[0,2,1,1,2,3]]);bridge.extend(bottom[[0,1,2,1,3,2]])
        sides=[(1,3),(2,0)]+([(0,1)] if n==0 else [])+([(3,2)] if n==len(edges)-2 else [])
        for i,j in sides:bridge.extend([top[i],top[j],bottom[i],top[j],bottom[j],bottom[i]])
    for spec in rail_profile['lines']:
        line=paths[spec['id']];other=shapely.union_all([p for k,p in decks.items() if k!=spec['id']]).buffer(4)
        for distance in np.arange(25,line.length,rail_profile['pierSpacing']):
            pt=line.interpolate(distance);a=line.interpolate(distance-.5);b=line.interpolate(distance+.5)
            direction=np.array([b.x-a.x,b.y-a.y]);direction/=np.linalg.norm(direction)
            for sign in [-1,1]:
                x,z=np.array([pt.x,pt.y])+np.array([-direction[1],direction[0]])*sign*(spec['width']/2-2)
                p=box(x-1,z-1,x+1,z+1)
                if land.covers(p) and not p.intersects(other) and not p.intersects(roads.buffer(4)):
                    add(p,-3,spec['top']-spec['thickness'],'rail-pier',line=spec['id'])
    original=raw['bldg'].reshape(-1,3,3);centers=original.mean(axis=1)
    normal=np.cross(original[:,1]-original[:,0],original[:,2]-original[:,0]);up=normal[:,1]>.7*np.linalg.norm(normal,axis=1)
    for roof in rail_profile['station']['roofs']:
        name=roof['line'];low,high=roof['sourceRoofRange']
        chosen=original[up&(centers[:,1]>low)&(centers[:,1]<high)]
        footprint=projection(chosen.reshape(-1,3)).intersection(paths[name].buffer(roof['sourceWidth']/2)).intersection(box(*roof['bounds']))
        if name=='local':footprint=footprint.difference(decks['cross'].buffer(8))
        footprint=shapely.union_all([p for p in parts(footprint.simplify(.4,preserve_topology=True)) if p.area>=80])
        add(footprint,roof['top']-roof['thickness'],roof['top'],'station-roof',line=name)
        for distance in np.arange(18,paths[name].length,36):
            pt=paths[name].interpolate(distance);a=paths[name].interpolate(distance-.5);b=paths[name].interpolate(distance+.5)
            direction=np.array([b.x-a.x,b.y-a.y]);direction/=np.linalg.norm(direction)
            for sign in [-1,1]:
                x,z=np.array([pt.x,pt.y])+np.array([-direction[1],direction[0]])*sign*(specs[name]['width']/2-2)
                p=box(x-.75,z-.75,x+.75,z+.75)
                if footprint.covers(p) and decks[name].covers(p):add(p,specs[name]['top'],roof['top']-roof['thickness'],'station-support',line=name)
    return volumes,decks,gap,np.asarray(bridge,dtype='<f4'),{'rings':rings(gap),'levels':[8,10],'thickness':thickness,'area':round(gap.area,2)}


def shops(volumes,decks,gap,land,protected,settings):
    clear=protected.buffer(settings['protectedShoulder'],join_style='mitre')
    corridor=shapely.union_all([*decks.values(),gap]);stats=[]
    ns=shapely.union_all([decks['local'],decks['highspeed'],gap]).buffer(1,join_style='mitre')
    specs=[('local',decks['local'],6.75),('highspeed',decks['highspeed'],8.75),('link',gap,6.75),('cross',decks['cross'].difference(ns),16.5)]
    for name,p,top in specs:
        footprint=p.intersection(land).difference(clear)
        pieces=[q for q in parts(footprint.simplify(.08,preserve_topology=True).intersection(footprint)) if q.area>=30]
        for q in pieces:volumes.append(volume(q,-3,top,'rail-shop',line=name))
        stats.append({'line':name,'blocks':len(pieces),'area':round(sum(q.area for q in pieces),2),'top':top})
    # いずれの店舗も、保護した道路・路地を跨がない。
    solid=shapely.union_all([shape(v) for v in volumes if v['kind']=='rail-shop'])
    assert solid.intersection(protected).area<.1
    return corridor,stats


def simplify_blocks(source,land,protected,corridor,profile,settings):
    source=copy.deepcopy(source)
    marks=mark_landmarks(source,json.loads((ROOT/'research/maps/akihabara-landmarks.json').read_text())['landmarks'])
    protected=protected.buffer(settings['protectedShoulder'],join_style='mitre')
    cleared=shapely.union_all([Polygon(b['outline']) for b in profile['baseClearings']])
    allowed=land.difference(protected).difference(corridor.buffer(.8,join_style='mitre')).difference(cleared)
    # 拡幅の採用済み区間は、建物を削る方向で引き継ぐ。
    lane=LineString(profile['sideAlleys']['centerline']).buffer(24,cap_style='flat')
    allowed=allowed.difference(lane)
    result=[];ordinary=[]
    def coarse(p,tolerance):
        p=Polygon(p.exterior)
        q=p.simplify(tolerance,preserve_topology=True)
        q=shapely.set_precision(q,settings['footprintGrid'])
        # 道路の輪郭で最後に切り戻すので、街区の統合や丸めで通路を消さない。
        return q.intersection(allowed)
    for mark in marks:
        group=[v for v in source if v.get('landmark')==mark['id']]
        shape0=shapely.union_all([shape(v) for v in group if v['kind']=='grounded'])
        top=max(v['top'] for v in group)
        for pad in profile['roofPads']:
            if shape0.covers(Point(*pad['exit'])):top=95
        for p in parts(shape0):
            for q in parts(coarse(p,1.0)):
                if q.area>8:result.append(volume(q,-3,top,'grounded',landmark=mark['id'],landmarkColor=mark['color'],facade=mark['style']))
    ordinary=[v for v in source if v['kind']=='grounded' and not v.get('landmark')]
    polygons=[shape(v) for v in ordinary];tree=shapely.STRtree(polygons)
    gap=settings['mergeGap']/2
    merged=shapely.union_all(polygons).buffer(gap,join_style='mitre').buffer(-gap,join_style='mitre').difference(protected)
    groups=sorted(parts(merged),key=lambda p:(p.centroid.x,p.centroid.y))
    for i,p in enumerate(groups):
        matches=tree.query(p,predicate='intersects')
        weights=sorted((ordinary[j]['top'],p.intersection(polygons[j]).area) for j in matches)
        if not weights:continue
        cumulative=0;target=sum(a for _,a in weights)*.65
        for top,a in weights:
            cumulative+=a
            if cumulative>=target:break
        top=max(9,round(top/settings['roofHeightStep'])*settings['roofHeightStep'])
        for q in parts(coarse(p,settings['outlineTolerance'])):
            if q.area>=settings['minimumBuildingArea']:result.append(volume(q,-3,top,'grounded',rebuildId=i+1))
    present={v.get('landmark') for v in result}
    return result,[m for m in marks if m['id'] in present]


def sample_passages(narrow,protected,land,profile,settings):
    safe=protected.buffer(-1.4,join_style='mitre').intersection(land)
    bases=shapely.union_all([Point(*b['at']).buffer(45) for b in profile['bases']])
    plans=[]
    for p in sorted(parts(narrow),key=lambda p:-p.area):
        at=p.representative_point()
        if bases.covers(at) or any(at.distance(Point(*v['center']))<22 for v in plans):continue
        choices=[]
        for angle in np.arange(0,math.pi,math.pi/16):
            dx,dz=math.cos(angle)*18,math.sin(angle)*18
            line=LineString([(at.x-dx,at.y-dz),(at.x+dx,at.y+dz)])
            for segment in getattr(line.intersection(safe),'geoms',[line.intersection(safe)]):
                if segment.geom_type!='LineString' or segment.length<8 or segment.distance(at)>.1:continue
                a,b=[segment.interpolate(f,normalized=True) for f in [.08,.92]]
                choices.append((segment.length,[a.x,-2,a.y],[b.x,-2,b.y]))
        if choices:
            length,a,b=max(choices);plans.append({'id':len(plans)+1,'center':[at.x,at.y],'start':a,'end':b,'length':round(length*.84,2)})
        if len(plans)>=settings['maximumPassageSamples']:break
    assert len(plans)>=16, f'初版からの代表路地を採れない: {len(plans)}'
    return plans


def stage_preview(raw,meta,volumes,link,source,out,title):
    out.mkdir(parents=True,exist_ok=True);layers={k:v.copy() for k,v in raw.items()}
    colors={};layers['brid']=np.concatenate([raw['brid'],link])
    for layer,kinds,color in [('rail',{'rail-deck','rail-pier'},'#b4bbc2'),('station',{'station-roof','station-support'},'#c2cbd0'),('shops',{'rail-shop'},'#9ba5a8')]:
        pieces=[extrusion(shape(v),v['bottom'],v['top']) for v in volumes if v['kind'] in kinds]
        layers[layer]=np.concatenate(pieces) if pieces else empty()
        colors[layer+'ColorRanges']=[{'start':0,'count':len(layers[layer]),'color':color}]
    m=copy.deepcopy(meta);m.update(colors);m['display'].update(title=title,labels=[],railTarget=[-9,10,28])
    m['railways']={'profile':json.loads((ROOT/'research/maps/akihabara-rail.json').read_text())};m['station']={'sourceFootprintsRestored':True}
    m['layers']={k:{'triangles':len(a)//3} for k,a in layers.items()}
    write_preview(layers,m,json.loads((source/'source-manifest.json').read_text()),out)


def make_game(raw,source_volumes,volumes,decks,gap,link,rail_gap,land,river,roads,protected,narrow,profile,settings,shop_stats):
    buildings,marks=simplify_blocks(source_volumes,land,protected,shapely.union_all([*decks.values(),gap]),profile,settings)
    # 店舗と重なる柱は省き、通路上の柱は道路と同じ保護範囲で退ける。
    store=shapely.union_all([shape(v) for v in volumes if v['kind']=='rail-shop'])
    structures=[v for v in volumes if not(v['kind']=='rail-pier' and (shape(v).intersects(store) or shape(v).intersects(protected.buffer(.3))))]
    volumes=buildings+structures
    y=settings['flatHeight'];meshes={k:empty() for k in ['bldg','dem','tran','brid','fill','streets','plazas','historicGround','historicWall','bed','water','ramps','aprons','exitMarks','bank','rail','station','shops','railLinkShops','crossShops']}
    meshes['dem']=floor_mesh(land,y);meshes['tran']=floor_mesh(roads,y)
    # 地上部分は一枚の床へ統合し、川を渡る部分だけを薄い水平床へ作り直す。
    bridges=[]
    for p in parts(projection(raw['brid'],precision=.02)):
        if p.intersection(river).area>20:
            for q in parts(p.simplify(.5,preserve_topology=True).intersection(river)):
                if q.area>1:bridges.append(extrusion(q,y-.5,y))
        elif p.area>100:
            tris=raw['brid'].reshape(-1,3,3)
            normal=np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0])
            upper=(normal[:,1]>.65*np.linalg.norm(normal,axis=1))&(tris[:,:,1].min(axis=1)>3.5)
            upper &= shapely.intersects(p,shapely.points(tris.mean(axis=1)[:,[0,2]]))
            if upper.any():bridges.append(thin_deck(tris[upper].reshape(-1,3)))
    meshes['brid']=np.concatenate([link,*bridges])
    bases=[{**b,'height':y,'spawn':[b['at'][0],y,b['at'][1]+(18 if b['team']=='B' else -18)]} for b in profile['bases']]
    clearing=clear_bases(meshes,volumes,land,profile,bases,BUILDINGS)
    exits,cut=add_exits(meshes,volumes,land,river,settings['riverBed'])
    # 復帰斜面以外の地面は、一枚の水平な領域にする。
    meshes['dem']=floor_mesh(land.difference(cut),y)
    for k in ['tran','fill','streets','plazas']:meshes[k]=empty()
    bank=[]
    for ring in [river.exterior,*river.interiors]:
        for a,b in zip(ring.coords,ring.coords[1:]):
            if any(abs(a[i])>=299.99 and abs(b[i])>=299.99 for i in [0,1]):continue
            line=LineString([a,b]).difference(cut)
            for segment in getattr(line,'geoms',[line]):
                if segment.geom_type!='LineString' or segment.is_empty:continue
                (ax,az),(bx,bz)=segment.coords[0],segment.coords[-1];lo=settings['riverBed']
                bank.extend([[ax,y,az],[bx,y,bz],[ax,lo,az],[bx,y,bz],[bx,lo,bz],[ax,lo,az]])
    meshes['bank']=np.asarray(bank,dtype='<f4')
    pads=[]
    for p in profile['roofPads']:
        ex,ez=p['exit'];top=max(v['top'] for v in volumes if v['kind']=='grounded' and shape(v).covers(Point(ex,ez)))
        pads.append({**p,'at':[*p['at'],y],'exit':[ex,ez,top],'radius':3,'rise':top-y+p['riseAboveRoof']})
    passages=sample_passages(narrow,protected,land,profile,settings)
    district={'bases':bases,'roofPads':pads,'railGap':rail_gap,'shops':shop_stats,'passages':passages,'clearing':clearing,
              'minimumPassageWidth':settings['minimumPassageWidth'],
              'unifiedGround':{'height':y,'color':'#556168','afterTriangles':len(meshes['dem'])//3},
              'fromOriginal':True}
    district['accessRoutes']=access_routes(meshes,volumes,land,district)
    for b in bases:
        x,z=b['at']
        for p,top in [(Point(x,z).buffer(10,quad_segs=6),2),(box(x-6,z-6,x+6,z+6),16)]:volumes.append(volume(p,y,y+top,'base-core',team=b['team']))
    spawns=[{'name':'大通り','at':[-185,y,-50],'surface':'ground'},{'name':'駅の屋根','at':[-25,25.5,40],'surface':'roof'},
            {'name':'南北の高架','at':[-47,8,165],'surface':'rail'},{'name':'東西の高架','at':[-160,18,12],'surface':'rail'},
            {'name':'川底','at':[-150,settings['riverBed'],176],'surface':'river'}]
    spawns += [{'name':b['name'],'at':b['spawn'],'surface':'ground'} for b in bases]
    spawns += [{'name':p['name']+'・乗り場','at':[p['at'][0]+5,y,p['at'][1]],'surface':'ground'} for p in pads]
    spawns += [{'name':'復元した路地','at':passages[0]['start'],'surface':'ground'}]
    reference={'half':300,'spawns':spawns,'district':district,'landmarks':marks,'streetRepairs':[],
               'heritage':{'rings':[],'surfaceColor':'#556168','height':y,'access':[[-248,198],[-263,184],[-290,153]]},
               'river':{'bed':settings['riverBed'],'water':settings['waterHeight'],'rings':[rings(river)],'area':round(river.area,2),'exits':exits},'groundMaximum':y+.5,
               'volumes':source_volumes,'packing':{'layers':{k:{'triangles':len(a)//3} for k,a in raw.items()}}}
    stats={'sourceTriangles':sum(len(a)//3 for a in raw.values()),'sourceBuildingVolumes':len(source_volumes),
           'rebuiltBuildingVolumes':sum(v['kind'] in BUILDINGS for v in volumes),'rebuiltVolumes':len(volumes)}
    data,stats=make_layout(reference,meshes,reconstructed=(volumes,stats))
    ground_solids=shapely.union_all([shape(v) for v in volumes if v['bottom']<y+4 and v['top']>y+.3 and v['kind']!='base-core'])
    lost=ground_solids.intersection(protected).area
    assert lost<.1, f'道路・路地の保護範囲へ実体が張り出す: {lost}'
    stats['protectedAreaBlockedByFinalVolumes']=round(lost,6)
    rounded_shapes=[]
    for v in volumes:
        if v['bottom']>=y+4 or v['top']<=y+.3 or v['kind']=='base-core':continue
        contours=[np.rint(np.array(r)*100)/100 for r in v['rings']]
        rounded_shapes.append(Polygon(contours[0],contours[1:]))
    rounded=shapely.union_all(rounded_shapes)
    assert rounded.intersection(protected).area<.1, '1cm格子へ保存した後も通路保護を維持する'
    stats['protectedAreaBlockedAfterQuantization']=round(rounded.intersection(protected).area,6)
    return data,stats,passages


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('source',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path);args=ap.parse_args()
    settings=json.loads((ROOT/'research/maps/akihabara-original-rebuild.json').read_text())
    profile=json.loads((ROOT/'research/maps/akihabara-trial.json').read_text())
    rail_profile=json.loads((ROOT/'research/maps/akihabara-rail.json').read_text())
    raw,meta=read_original(args.source);bounds=box(-300,-300,300,300)
    original_land=projection(raw['dem'],precision=.001)
    land=original_land.difference(Polygon(profile['heritage']['shoreCut']))
    river=max(parts(bounds.difference(land)),key=lambda p:p.area);land=bounds.difference(river)
    roads=projection(raw['tran'],precision=.02).simplify(.05,preserve_topology=True).intersection(land)
    print('初版の通路を分析',flush=True)
    source_volumes,occupied,core,narrow,protected=source_passages(raw,land,roads,settings)
    print(f'元の建物 {len(source_volumes)} / 保護面積 {protected.area:.1f}',flush=True)
    volumes,decks,gap,link,rail_gap=railway(raw,land,roads,rail_profile,profile)
    stage_preview(raw,meta,volumes,link,args.source,args.output/'01_rail','星路駅前・高架延長の確認')
    stage1={'step':1,'operation':'初版へ高架と駅屋根を追加','originalBuildingSHA256':hashlib.sha256(raw['bldg'].tobytes()).hexdigest(),'structures':len(volumes)}
    _,shop_stats=shops(volumes,decks,gap,land,protected,settings)
    stage_preview(raw,meta,volumes,link,args.source,args.output/'02_shops','星路駅前・高架下店舗の確認')
    stage2={'step':2,'operation':'道路・路地・川を避けて高架下店舗を追加','originalBuildingSHA256':stage1['originalBuildingSHA256'],'shops':shop_stats}
    print('保護した通路の外側で街区を単純化',flush=True)
    data,stats,passages=make_game(raw,source_volumes,volumes,decks,gap,link,rail_gap,land,river,roads,protected,narrow,profile,settings,shop_stats)
    encoded=compact(data);packed=gzip.compress(encoded,compresslevel=9,mtime=0)
    if len(encoded)>settings['maximumLayoutBytes']:raise ValueError(f'街データが目標を超過: {len(encoded)}')
    out=args.output;out.mkdir(parents=True,exist_ok=True)
    (out/'layout.json').write_bytes(encoded);(out/'layout.json.gz').write_bytes(packed)
    build(args.source,out,data=data,layout_runtime=(ROOT/'tools/plateau/rebuild_runtime.js').read_text(),variant='・路地を残す案')
    stats.update(layoutBytes=len(encoded),gzipBytes=len(packed),base64Bytes=len(base64.b64encode(packed)),htmlBytes=(out/'index.html').stat().st_size,
                 originalPreviewSHA256=hashlib.sha256((args.source/'preview.html').read_bytes()).hexdigest(),
                 sourceLayerSHA256={k:hashlib.sha256(a.tobytes()).hexdigest() for k,a in raw.items()},
                 builderSHA256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
                 layoutSHA256=hashlib.sha256(encoded).hexdigest(),
                 settingsSHA256=hashlib.sha256((ROOT/'research/maps/akihabara-original-rebuild.json').read_bytes()).hexdigest(),
                 railProfileSHA256=hashlib.sha256((ROOT/'research/maps/akihabara-rail.json').read_bytes()).hexdigest(),
                 stages=[stage1,stage2,{'step':3,'operation':'通路を保護してゲーム用街区へ単純化・地面と基地を平坦化'}],
                 protectedArea=round(protected.area,2),passages=passages,settings=settings)
    (out/'reconstruction.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2)+'\n')
    features=[{'type':'Feature','properties':{'kind':k},'geometry':mapping(v)} for k,v in [('originalBuildings',occupied),('originalRoads',roads),('protectedPassages',protected),('narrowCore',narrow)]]
    (out/'source-layout.geojson').write_bytes(compact({'type':'FeatureCollection','features':features}))
    (out/'source-layout.geojson.gz').write_bytes(gzip.compress(compact({'type':'FeatureCollection','features':features}),compresslevel=9,mtime=0))
    print(json.dumps({k:v for k,v in stats.items() if k not in ['passages','stages','settings']},ensure_ascii=False,indent=2))


if __name__=='__main__':main()
