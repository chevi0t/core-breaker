#!/usr/bin/env python3
"""地形確認用メッシュを削減し、建物間の狭い隙間を可視の低層棟で閉じる。"""
import argparse,hashlib,json,math,pathlib,time
import numpy as np
import fast_simplification
import mapbox_earcut
import shapely
from shapely.geometry import Polygon,box,Point,mapping
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from build import write_preview,clip
KINDS=('bldg','tran','brid','dem')

def index_mesh(vertices):
    points,inverse=np.unique(np.round(vertices.astype(float),3),axis=0,return_inverse=True)
    faces=inverse.reshape(-1,3).astype(np.int32)
    t=points[faces];valid=np.linalg.norm(np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]),axis=1)>1e-7
    return points,faces[valid]

def remove_small_components(points,faces):
    a=faces.ravel();b=faces[:,[1,2,0]].ravel();graph=coo_matrix((np.ones(len(a)),(a,b)),shape=(len(points),len(points))).tocsr()
    count,labels=connected_components(graph,directed=False);lo=np.full((count,3),np.inf);hi=np.full((count,3),-np.inf)
    np.minimum.at(lo,labels,points);np.maximum.at(hi,labels,points);size=hi-lo
    small=(np.maximum(size[:,0],size[:,2])<3)|((size[:,1]<2.5)&(size[:,0]*size[:,2]<64))
    keep=~small[labels[faces[:,0]]]
    return faces[keep],{'removedComponents':int(np.count_nonzero(small[np.unique(labels[faces[:,0]])])),'removedTriangles':int(np.count_nonzero(~keep))}

def decimate(vertices,keep,agg,clean=False):
    if keep>=1:return vertices.copy(),{}
    points,faces=index_mesh(vertices);info={}
    if clean:faces,info=remove_small_components(points,faces)
    points,faces=fast_simplification.simplify(points,faces,target_reduction=1-keep,agg=agg)
    return points[faces].reshape(-1,3).astype('<f4'),info

def projection(vertices,precision=.02,coverage=False):
    t=vertices.reshape(-1,3,3)[:,:,[0,2]].astype(float)
    area=np.abs((t[:,1,0]-t[:,0,0])*(t[:,2,1]-t[:,0,1])-(t[:,2,0]-t[:,0,0])*(t[:,1,1]-t[:,0,1]))
    polygons=shapely.polygons(t[area>1e-5])
    polygons=shapely.set_precision(polygons,precision)
    return shapely.make_valid(shapely.coverage_union_all(polygons) if coverage else shapely.union_all(polygons))

def parts(geometry):
    if isinstance(geometry,Polygon):return [geometry]
    return [p for g in getattr(geometry,'geoms',[]) for p in parts(g)]

def extrusion(polygon,bottom,top,floor=True):
    rings=[np.array(r.coords[:-1]) for r in [polygon.exterior,*polygon.interiors]]
    xy=np.concatenate(rings).astype(float);ends=np.cumsum([len(r) for r in rings]).astype(np.uint32)
    idx=mapbox_earcut.triangulate_float64(xy,ends).reshape(-1,3)
    upper=np.column_stack((xy[:,0],np.full(len(xy),top),xy[:,1]));lower=upper.copy();lower[:,1]=bottom
    roof=upper[idx];flip=np.cross(roof[:,1]-roof[:,0],roof[:,2]-roof[:,0])[:,1]<0;roof[flip]=roof[flip][:,[0,2,1]]
    base=lower[idx];flip=np.cross(base[:,1]-base[:,0],base[:,2]-base[:,0])[:,1]>0;base[flip]=base[flip][:,[0,2,1]]
    # 地中に埋まる底面は描画しない。橋のような高架部分の下面は保持。
    triangles=[roof,base] if floor else [roof]
    for ring in rings:
        for a,b in zip(ring,np.roll(ring,-1,axis=0)):
            triangles.append(np.array([[[a[0],bottom,a[1]],[b[0],bottom,b[1]],[a[0],top,a[1]]],[[b[0],bottom,b[1]],[b[0],top,b[1]],[a[0],top,a[1]]]]))
    return np.concatenate(triangles).reshape(-1,3).astype('<f4')

def vertical_height(vertices,x,z):
    t=vertices.reshape(-1,3,3).astype(float);a,b,c=t[:,0],t[:,1],t[:,2]
    den=(b[:,2]-c[:,2])*(a[:,0]-c[:,0])+(c[:,0]-b[:,0])*(a[:,2]-c[:,2]);good=np.abs(den)>1e-7
    u=np.divide((b[:,2]-c[:,2])*(x-c[:,0])+(c[:,0]-b[:,0])*(z-c[:,2]),den,out=np.zeros(len(den)),where=good)
    v=np.divide((c[:,2]-a[:,2])*(x-c[:,0])+(a[:,0]-c[:,0])*(z-c[:,2]),den,out=np.zeros(len(den)),where=good)
    hit=good&(u>=-1e-6)&(v>=-1e-6)&(u+v<=1.000001)
    return float(np.max((u*a[:,1]+v*b[:,1]+(1-u-v)*c[:,1])[hit])) if hit.any() else None

def rings(p):
    return [[[round(x,3),round(z,3)] for x,z in r.coords[:-1]] for r in [p.exterior,*p.interiors]]

def clip_footprint(vertices,allowed):
    """削減で動いた境界を原外周で切り、川などの欠測域へ新しい床を作らない。"""
    triangles=vertices.reshape(-1,3,3).astype(float);flat=triangles[:,:,[0,2]]
    projected=shapely.polygons(flat);area=shapely.area(projected)
    covered=shapely.covers(allowed,projected)|(area<1e-7);result=[triangles[covered].reshape(-1,3)]
    for tri,p in zip(triangles[~covered],projected[~covered]):
        normal=np.cross(tri[1]-tri[0],tri[2]-tri[0])
        for piece in parts(p.intersection(allowed)):
            if piece.is_empty or piece.area<1e-9:continue
            xy=np.concatenate([np.array(r.coords[:-1]) for r in [piece.exterior,*piece.interiors]])
            ends=np.cumsum([len(r.coords)-1 for r in [piece.exterior,*piece.interiors]]).astype(np.uint32)
            idx=mapbox_earcut.triangulate_float64(xy,ends)
            y=tri[0,1]-(normal[0]*(xy[:,0]-tri[0,0])+normal[2]*(xy[:,1]-tri[0,2]))/normal[1]
            result.append(np.column_stack((xy[:,0],y,xy[:,1]))[idx])
    return np.concatenate(result).astype('<f4')

def building_masses(vertices,land,roads,profile,bottom,road_ceiling):
    """外周と面積のある屋根から箱を組む。細部のQEMによる屋根の崩れを避ける。"""
    points,faces=index_mesh(vertices);faces,removed=remove_small_components(points,faces)
    triangles=points[faces];normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
    roof=triangles[(normals[:,1]>.7*np.linalg.norm(normals,axis=1))&(normals[:,1]>1e-4)]
    area=np.cross(roof[:,1]-roof[:,0],roof[:,2]-roof[:,0])[:,1]/2
    centers=roof.mean(axis=1);heights=centers[:,1]
    outlines=parts(projection(triangles.reshape(-1,3),profile['footprintPrecision']))
    tree=shapely.STRtree(outlines);matches=tree.query(shapely.points(centers[:,[0,2]]),predicate='within')
    assignments=[[] for _ in outlines]
    for face,outline in matches.T:assignments[outline].append(face)
    meshes=[];volumes=[];grounded=[]
    def add(shape,lo,hi,kind):
        if hi-lo<.1:return
        for p in parts(shapely.make_valid(shape)):
            if p.area<profile['minimumBuildingArea']:continue
            meshes.append(extrusion(p,lo,hi,kind!='grounded'));volumes.append({'rings':rings(p),'bottom':round(lo,3),'top':round(hi,3),'kind':kind})
            if kind=='grounded':grounded.append(p)
    for outline,ids in zip(outlines,assignments):
        if not ids or outline.area<profile['minimumBuildingArea'] or outline.buffer(-1.3).is_empty:continue
        ids=np.array(ids);a=area[ids];h=heights[ids]
        # 低層の庇と屋上の小物ではなく、面積のある高さを優先する。
        band=np.rint(h/profile['roofHeightStep'])*profile['roofHeightStep']
        levels=np.unique(band);weights=np.array([a[band==v].sum() for v in levels])
        meaningful=levels[weights>=max(profile['minimumRoofArea'],outline.area*.025)]
        if not len(meaningful):meaningful=np.array([levels[np.argmax(weights)]])
        meaningful=meaningful[meaningful>road_ceiling-2]
        if not len(meaningful):continue
        if outline.area<profile['tieredBuildingArea']:
            # 小さな棟は単純な角柱にまとめる。面積の大きい屋根の高さを採用。
            base=float(max(meaningful,key=lambda v:weights[np.where(levels==v)[0][0]]));levels_used=[base]
        else:
            base=float(meaningful.min())
            chosen=sorted(meaningful,key=lambda v:weights[np.where(levels==v)[0][0]],reverse=True)[:3]
            levels_used=sorted(set([base,float(meaningful.max()),*map(float,chosen)]))
        shape=outline.simplify(profile['outlineTolerance'],preserve_topology=True)
        # 小さな中庭は塞ぐが、大きな中庭は残す。
        shape=Polygon(shape.exterior,[r for r in shape.interiors if Polygon(r).area>=64])
        add(shape.intersection(land).difference(roads),bottom,base,'grounded')
        add(shape.difference(land.difference(roads)),road_ceiling,base,'elevated')
        for height in levels_used[1:]:
            selected=roof[ids[band>=height]]
            if not len(selected):continue
            mask=projection(selected.reshape(-1,3),profile['footprintPrecision']).simplify(profile['outlineTolerance'],preserve_topology=True).intersection(shape)
            if base<road_ceiling:
                # 低い基壇の上は基壇へ接続。道路・川の上だけ頭上空間を確保。
                add(mask.intersection(land).difference(roads),base,height,'upper')
                add(mask.difference(land.difference(roads)),road_ceiling,height,'elevated')
            else:add(mask,base,height,'upper')
    return np.concatenate(meshes),volumes,shapely.union_all(grounded),removed

def main():
    ap=argparse.ArgumentParser();ap.add_argument('source',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path);ap.add_argument('--manifest',required=True,type=pathlib.Path);ap.add_argument('--profile',required=True,type=pathlib.Path);args=ap.parse_args()
    t0=time.monotonic();source=args.source;out=args.output;out.mkdir(parents=True,exist_ok=True);profile=json.loads(args.profile.read_text());manifest=json.loads(args.manifest.read_text());raw=np.load(source/'geometry.npz');meta=json.loads((source/'summary.json').read_text());original={k:raw[k] for k in KINDS}
    layers={};details={}
    for k in KINDS[1:]:
        layers[k],details[k]=decimate(original[k],profile['keepFraction'][k],profile['aggressiveness'][k],k=='bldg')
        layers[k]=clip(layers[k].reshape(-1,3,3),meta['extentMeters']/2)
        print(k,'三角形',len(original[k])//3,'→',len(layers[k])//3,flush=True)
    precision=profile['footprintPrecision'];half=meta['extentMeters']/2;boundary=box(-half,-half,half,half);radius=profile['minimumPassageWidth']/2
    road=projection(original['tran'],precision).intersection(boundary)
    land=projection(original['dem'],precision,True).intersection(boundary)
    layers['dem']=clip_footprint(layers['dem'],land)
    layers['tran']=clip_footprint(layers['tran'],road)
    # 既に8m以上ある道路を保持。細い歩道・建物間の隙間を新しい低層棟で閉じる。
    wide_roads=road.buffer(-radius,quad_segs=4).buffer(radius,quad_segs=4).intersection(road)
    bottom=float(np.min(raw['ground'][:,:,1]))-4
    road_ceiling=float(np.max(original['tran'][:,1]))+profile['roadHeadroom']
    layers['bldg'],building_volumes,occupied,details['bldg']=building_masses(original['bldg'],land,wide_roads,profile,bottom,road_ceiling)
    print('bldg 三角形',len(original['bldg'])//3,'→',len(layers['bldg'])//3,flush=True)
    closed=occupied.buffer(radius,quad_segs=4).buffer(-radius,quad_segs=4).intersection(boundary)
    fills=closed.difference(occupied).difference(wide_roads).intersection(land)
    fills=fills.simplify(profile['sealSimplifyTolerance'],preserve_topology=True).difference(occupied).difference(wide_roads).intersection(land)
    fills=shapely.make_valid(fills);polys=[p for p in parts(fills) if p.area>=profile['minimumSealArea']]
    volumes=[];fillmesh=[];ground=raw['ground'];stride=ground.shape[0];step=meta['extentMeters']/(stride-1)
    for p in polys:
        sample=np.array([*p.exterior.coords,p.representative_point().coords[0]])
        ix=np.clip(np.rint((sample[:,0]+half)/step).astype(int),0,stride-1);iz=np.clip(np.rint((sample[:,1]+half)/step).astype(int),0,stride-1)
        top=math.ceil((float(np.max(ground[iz,ix,1]))+profile['sealHeight'])/2)*2;bottom=float(np.min(ground[:,:,1]))-4
        fillmesh.append(extrusion(p,bottom,top,False));volumes.append({'rings':rings(p),'bottom':round(bottom,3),'top':top,'area':round(p.area,3),'kind':'infill'})
    infill=np.concatenate(fillmesh) if fillmesh else np.empty((0,3),dtype='<f4');layers['bldg']=np.concatenate((layers['bldg'],infill))
    landmarks=[]
    for spec in profile['landmarks']:
        x,z=spec['at'];before=vertical_height(original['bldg'],x,z);after=vertical_height(layers['bldg'],x,z);landmarks.append({**spec,'originalRoof':before,'simplifiedRoof':after})
    stats={k:{'triangles':len(v)//3,'min':v.astype(float).min(axis=0).round(3).tolist(),'max':v.astype(float).max(axis=0).round(3).tolist()} for k,v in layers.items()}
    original_count=sum(len(v)//3 for v in original.values());total=sum(v['triangles'] for v in stats.values())
    result={'originalTriangles':original_count,'triangles':total,'reductionFraction':1-total/original_count,'minimumPassageWidth':profile['minimumPassageWidth'],'unitRadius':profile['unitRadius'],'unitHeight':profile['unitHeight'],'roadCeiling':road_ceiling,'buildingVolumes':len(building_volumes),'sealedRegions':len(volumes),'sealedArea':sum(v['area'] for v in volumes),'infillTriangles':len(infill)//3,'removedSmallParts':details['bldg'],'landmarks':landmarks,'profile':profile,'sourceGeometrySHA256':hashlib.sha256((source/'geometry.npz').read_bytes()).hexdigest()}
    meta['layers']=stats;meta['display']['title']=profile['title'];meta['simplification']=result;meta['infillVolumes']=volumes
    write_preview(layers,meta,manifest,out);(out/'summary.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n');(out/'collision-volumes.json').write_text(json.dumps({'unitRadius':profile['unitRadius'],'unitHeight':profile['unitHeight'],'volumes':building_volumes+volumes},ensure_ascii=False,indent=2)+'\n')
    (out/'footprints.geojson').write_text(json.dumps({'type':'FeatureCollection','features':[{'type':'Feature','properties':{'kind':name},'geometry':mapping(g)} for name,g in [('original',occupied),('infill',shapely.union_all(polys)),('wideRoads',wide_roads),('roads',road),('land',land)]]})+'\n')
    np.savez_compressed(out/'geometry.npz',**layers,infill=infill,**{k:raw[k] for k in raw.files if k not in KINDS})
    print(json.dumps({**result,'elapsedSeconds':time.monotonic()-t0},ensure_ascii=False),flush=True)
if __name__=='__main__':main()
