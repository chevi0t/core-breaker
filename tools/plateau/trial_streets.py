"""途切れた道路を連続面につなぎ、低い橋片と高架切断後の細片を除く。"""
import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

from simplify import clip_footprint, extrusion, index_mesh, parts, projection, rings


class Surface:
    """元の道路・地面の面上の高さ。高さ場の穴を道路の補修面で埋めるために使う。"""
    def __init__(self, mesh):
        triangles = mesh.reshape(-1, 3, 3).astype(float)
        polygons = shapely.polygons(triangles[:, :, [0, 2]])
        valid = shapely.area(polygons) > 1e-7
        self.a, self.b, self.c = np.moveaxis(triangles[valid], 1, 0)
        self.den = (self.b[:, 2]-self.c[:, 2])*(self.a[:, 0]-self.c[:, 0])+(self.c[:, 0]-self.b[:, 0])*(self.a[:, 2]-self.c[:, 2])
        self.tree = shapely.STRtree(polygons[valid])

    def heights(self, xy):
        xy = np.asarray(xy, dtype=float)
        pi, ti = self.tree.query(shapely.points(xy), predicate='intersects')
        x, z = xy[pi].T
        a, b, c, den = self.a[ti], self.b[ti], self.c[ti], self.den[ti]
        u = ((b[:, 2]-c[:, 2])*(x-c[:, 0])+(c[:, 0]-b[:, 0])*(z-c[:, 2]))/den
        v = ((c[:, 2]-a[:, 2])*(x-c[:, 0])+(a[:, 0]-c[:, 0])*(z-c[:, 2]))/den
        result = np.full(len(xy), -np.inf)
        np.maximum.at(result, pi, u*a[:, 1]+v*b[:, 1]+(1-u-v)*c[:, 1])
        return result


def grid_surface(footprint, height_at):
    """境界を切りそろえた4m格子。元の面へ接続する高さは呼び出し側で決める。"""
    x0,z0,x1,z1=footprint.bounds;triangles=[]
    for x in np.arange(np.floor(x0/4)*4,x1,4):
        for z in np.arange(np.floor(z0/4)*4,z1,4):
            for p in parts(box(x,z,x+4,z+4).intersection(footprint)):
                if p.area<1e-6:continue
                a=extrusion(p,-20,0,False).reshape(-1,3,3)
                a=a[np.all(a[:,:,1]==0,axis=1)].reshape(-1,3)
                a[:,1]=height_at(a[:,[0,2]])
                triangles.append(a)
    return np.concatenate(triangles)


def thin_deck(mesh,thickness=.35):
    """歩道橋の歩行面を残し、下面の大きな三角形を一定厚の床へ置き換える。"""
    triangles=mesh.reshape(-1,3,3)
    normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
    top=triangles[normals[:,1]>.65*np.linalg.norm(normals,axis=1)]
    bottom=top[:,[0,2,1]].copy();bottom[:,:,1]-=thickness
    edges={}
    for tri in top:
        for a,b in zip(tri,np.roll(tri,-1,axis=0)):
            key=tuple(sorted((tuple(np.round(a,3)),tuple(np.round(b,3)))))
            edges.setdefault(key,[]).append((a,b))
    result=[top.reshape(-1,3),bottom.reshape(-1,3)]
    for matches in edges.values():
        if len(matches)!=1:continue
        a,b=matches[0];c=a.copy();d=b.copy();c[1]-=thickness;d[1]-=thickness
        result.append(np.array([a,c,b,b,c,d]))
    return np.concatenate(result)


def repair(meshes, volumes, land, profile):
    road_surface = Surface(meshes['tran'])
    ground_surface = Surface(np.concatenate([meshes['dem'], meshes['tran']]))
    bounds = box(-300, -300, 300, 300)
    masks, surfaces, plans = [], [], []
    for spec in profile['streetRepairs']:
        path = LineString(spec['points']); r = spec['width']/2; shoulder = spec['shoulder']
        footprint = path.buffer(r+shoulder, cap_style='flat', join_style='mitre').intersection(land).intersection(bounds)
        # 出入口の路面を使い、線路の下の窪みや縁石に合わせて再び波打たせない。
        heights = []
        for x, z in [spec['points'][0], spec['points'][-1]]:
            samples = np.array([[x+dx, z+dz] for dx in range(-4, 5, 2) for dz in range(-4, 5, 2)])
            hs = road_surface.heights(samples); hs = hs[np.isfinite(hs)]
            if not len(hs): hs = ground_surface.heights(samples)
            heights.append(float(np.median(hs[np.isfinite(hs)])))
        assert abs(heights[1]-heights[0])/path.length < .1, '道路の長手方向を急坂にしない'
        if 'groundSimplification' in profile:
            # 既に平面にした道路には格子を再導入せず、一枚の舗装にまとめる。
            from trial_simplify import floor_mesh
            triangles=[floor_mesh(footprint,profile['groundSimplification']['height'])]
        else:
            # 4m格子で肩と出入口だけ元の地面にすり付け、中央の走行帯は単一の緩い勾配にする。
            x0,z0,x1,z1=footprint.bounds; triangles=[]
            for x in np.arange(np.floor(x0/4)*4, x1, 4):
                for z in np.arange(np.floor(z0/4)*4, z1, 4):
                    square=box(x,z,x+4,z+4).intersection(footprint)
                    for piece in parts(square):
                        if piece.area<1e-6:continue
                        a=extrusion(piece, -20, 0, False).reshape(-1,3,3)
                        a=a[np.all(a[:,:,1]==0,axis=1)].reshape(-1,3)
                        xy=a[:,[0,2]];points=shapely.points(xy);s=shapely.line_locate_point(path,points)
                        distance=shapely.distance(path,points)
                        weight=np.clip((r+shoulder-distance)/shoulder,0,1)*np.clip(np.minimum(s,path.length-s)/spec['endBlend'],0,1)
                        old=ground_surface.heights(xy);assert np.isfinite(old).all(), '補修道路の境界に地面がある'
                        ideal=heights[0]+s/path.length*(heights[1]-heights[0])
                        a[:,1]=old*(1-weight)+ideal*weight
                        triangles.append(a)
        surfaces.append(np.concatenate(triangles));masks.append(footprint)
        plans.append({**spec,'heights':heights,'length':path.length})
    mask=shapely.union_all(masks)
    for k in ['dem','tran']:
        t=meshes[k].reshape(-1,3,3)
        flat=shapely.polygons(t[:,:,[0,2]])
        stale=(shapely.area(flat)<1e-7)&shapely.covers(mask,shapely.points(t.mean(axis=1)[:,[0,2]]))
        meshes[k]=clip_footprint(t[~stale].reshape(-1,3),bounds.difference(mask))
    meshes['streets']=np.concatenate(surfaces)

    # 地上道路に接する低い橋の小片だけを除く。川の橋と歩道橋・幹線の高架は残す。
    vertices,faces=index_mesh(meshes['brid'])
    graph=coo_matrix((np.ones(faces.size),(faces.ravel(),faces[:,[1,2,0]].ravel())),shape=(len(vertices),len(vertices))).tocsr()
    count,labels=connected_components(graph,directed=False);kept=[];removed_bridge=[];regularized=[]
    for component in range(count):
        a=vertices[faces[labels[faces[:,0]]==component]].reshape(-1,3)
        center=a[:,[0,2]].mean(axis=0);near=[p for p,m in zip(plans,masks) if m.intersects(Point(*center))]
        if near and a[:,1].max()<max(max(p['heights']) for p in near)+1.2:
            removed_bridge.append({'bounds':[a.min(axis=0).tolist(),a.max(axis=0).tolist()],'triangles':len(a)//3})
        elif box(-100,-155,-20,-30).covers(Point(*center)) and np.ptp(a[:,0])>40 and np.ptp(a[:,2])>70:
            deck=thin_deck(a);kept.append(deck)
            regularized.append({'bounds':[a.min(axis=0).tolist(),a.max(axis=0).tolist()],
                'beforeTriangles':len(a)//3,'afterTriangles':len(deck)//3,'thickness':.35})
        else:kept.append(a)
    meshes['brid']=np.concatenate(kept).astype('<f4')

    # 高架帯の切断でできた、細長く実体化した建物の端片を整理する。
    deck=shapely.union_all([Polygon(v['rings'][0],v['rings'][1:]) for v in volumes if v['kind']=='rail-deck'])
    kept=[];removed_shards=[]
    for v in volumes:
        p=Polygon(v['rings'][0],v['rings'][1:])
        if v['kind'] in {'grounded','upper','elevated','infill'} and not v.get('landmark') and p.area<200 and p.buffer(-2.25).is_empty and p.distance(deck)<2:
            removed_shards.append({'kind':v['kind'],'top':v['top'],'area':p.area,'bounds':list(p.bounds)})
            continue
        if v['kind']=='infill' and p.intersects(mask):
            for piece in parts(p.difference(mask)):
                if piece.area>.05:kept.append({**v,'rings':rings(piece)})
        else:kept.append(v)
    volumes[:]=kept
    return {'roads':plans,'removedBridgeFragments':removed_bridge,'regularizedBridgeDecks':regularized,'removedBuildingShards':removed_shards}


def smooth_heritage(meshes,volumes,land,spec,original_ground):
    """旧駅沿いの粗い盛土を、平らな上面と緩い接続部へ作り直す。川は増築しない。"""
    footprint=Polygon(spec['outline']).intersection(land)
    tall=shapely.union_all([Polygon(v['rings'][0],v['rings'][1:]) for v in volumes if v['kind']=='grounded' and v['top']>40])
    bridge=projection(meshes['brid']).buffer(2)
    mask=footprint.buffer(spec['blend'],join_style='mitre').intersection(land).difference(tall.buffer(.5)).difference(bridge)
    original=Surface(original_ground)
    def height_at(xy):
        points=shapely.points(xy);distance=shapely.distance(footprint,points)
        weight=np.clip(1-distance/spec['blend'],0,1)
        old=original.heights(xy);assert np.isfinite(old).all(),'旧駅の補修境界に地面がある'
        ideal=spec['baseHeight']+(spec['height']-spec['baseHeight'])*weight*weight*(3-2*weight)
        edge=np.clip((spec['blend']-distance)/4,0,1)*np.clip(shapely.distance(bridge,points)/12,0,1)
        return old*(1-edge)+ideal*edge
    replacement=grid_surface(mask,height_at)
    allowed=box(-300,-300,300,300).difference(mask)
    for k in ['dem','tran']:meshes[k]=clip_footprint(meshes[k],allowed)
    meshes['historicGround']=replacement
    kept=[];removed=[]
    for v in volumes:
        p=Polygon(v['rings'][0],v['rings'][1:])
        if v['kind'] in {'grounded','infill','upper','elevated'} and v['top']<20 and p.intersection(footprint).area>p.area*.5:
            removed.append({'kind':v['kind'],'top':v['top'],'area':p.area});continue
        kept.append(v)
    volumes[:]=kept
    return {'rings':[rings(p) for p in parts(footprint)],'height':spec['height'],'removedSmallMasses':removed,
        'access':[[-248,198],[-263,184],[-290,153]],'surfaceColor':spec['color']}
