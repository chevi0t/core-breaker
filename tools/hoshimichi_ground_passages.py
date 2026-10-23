"""ユーザー図の4本を地上の通り抜けとして開け、上の高架・駅舎を残す。"""
import base64
import math

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box


def add_ground_passages(definition):
    data=definition['cityTerrain'];step=data.get('ringCoordinateStep',.01)
    routes=[{'from':[-32,-232],'to':[65,-232],'width':12},
            {'from':[-82,27],'to':[33,37],'width':12},
            {'from':[-82,-14],'to':[-82,66],'width':12},
            {'from':[33,-4],'to':[33,116],'width':12}]
    shapes=[LineString([r['from'],r['to']]).buffer(r['width']/2,cap_style=2) for r in routes]
    cut=shapely.union_all(shapes);ceiling=4.5
    def parts(g):return [g] if isinstance(g,Polygon) else [p for v in getattr(g,'geoms',[]) for p in parts(v)]
    def polygon(v):
        rr=[np.frombuffer(base64.b64decode(r),dtype='<i2').reshape(-1,2)*step for r in v[3]];return Polygon(rr[0],rr[1:])
    def pack(p):return [base64.b64encode(np.rint(np.asarray(r.coords[:-1])/step).astype('<i2').tobytes()).decode() for r in [p.exterior,*p.interiors]]
    if 'elevated' not in data['volumeKinds']:data['volumeKinds'].append('elevated')
    elevated=data['volumeKinds'].index('elevated');volumes=[];changed=0;roof_checks=[]
    original=[(polygon(v),v[2]) for v in data['volumes']]
    s=data['surfaces']['brid']
    points=np.frombuffer(base64.b64decode(s['points']),dtype='<i2').reshape(-1,3)*s['step']
    bridges=points[np.frombuffer(base64.b64decode(s['indices']),dtype='<u2')].reshape(-1,3,3)
    def original_top(point):
        x,z=point.coords[0];height=max(h for shape,h in original if shape.distance(point)<.78)
        # 元からある橋の三角面も接地に使われる。体積の屋根だけと比較しない。
        for a,b,c in bridges:
            normal=np.cross(b-a,c-a);length=np.linalg.norm(normal)
            if length==0 or normal[1]/length<=.65:continue
            den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
            u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den
            v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den
            if u>=-1e-6 and v>=-1e-6 and u+v<=1.000001:height=max(height,u*a[1]+v*b[1]+(1-u-v)*c[1])
        return height
    for v in data['volumes']:
        p=polygon(v);inside=p.intersection(cut)
        if v[1]>=ceiling or inside.area<.001:volumes.append(v);continue
        changed+=1
        points=[inside.representative_point()]
        x0,z0,x1,z1=inside.bounds
        points.extend(Point(x,z) for x in np.linspace(x0,x1,13) for z in np.linspace(z0,z1,13))
        # 1cm格子で切った境界付近は避け、接地カプセルの縁から余裕のある所を比較する。
        point=next((q for q in points if inside.contains(q) and all(abs(shape.distance(q)-.78)>.1 for shape,h in original)),points[0])
        roof_checks.append({'at':list(point.coords[0]),'top':original_top(point)})
        meta=dict(v[4])
        if data['volumeKinds'][v[0]]=='grounded' and 'landmarkColor' not in meta and 'paint' not in meta:
            # 分割後の輪郭中心から別の色を引かない。既存の建物の配色を継承する。
            center=np.frombuffer(base64.b64decode(v[3][0]),dtype='<i2').reshape(-1,2).mean(axis=0)*step
            if v[2]>50:meta['landmarkColor']='#7b94a0'
            else:meta['paint']=abs(math.floor(center[0]*7+.5)+math.floor(center[1]*13+.5))%8
        for q in parts(p.difference(cut)):
            if q.area>.01:volumes.append([*v[:3],pack(q),meta])
        if v[2]>ceiling:
            kind=elevated if data['volumeKinds'][v[0]]=='grounded' else v[0]
            for q in parts(inside):
                if q.area>.01:volumes.append([kind,ceiling,v[2],pack(q),meta])
    data['volumes']=volumes;data['district']['groundPassages']=routes
    # 幅12mの平坦な舗装。既存の地面・川・復帰坂は保持する。
    s=data['surfaces']['streets'];points=np.frombuffer(base64.b64decode(s['points']),dtype='<i2').reshape(-1,3)*s['step']
    old=points[np.frombuffer(base64.b64decode(s['indices']),dtype='<u2')];faces=[old]
    for p in shapes:
        ring=np.asarray(p.exterior.coords[:-1]);a=np.column_stack([ring[:,0],np.full(4,-1.98),ring[:,1]])
        triangles=a[[0,2,1,0,3,2]].reshape(-1,3,3)
        wrong=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])[:,1]<0
        triangles[wrong]=triangles[wrong][:,[0,2,1]];faces.append(triangles.reshape(-1,3))
    raw=np.concatenate(faces);points,indices=np.unique(np.rint(raw/.01).astype('<i2'),axis=0,return_inverse=True)
    data['surfaces']['streets']={'points':base64.b64encode(points.tobytes()).decode(),'indices':base64.b64encode(indices.astype('<u2').tobytes()).decode(),'step':.01}
    ground=[polygon(v) for v in volumes if v[1]<2.1 and v[2]>-1.7]
    ground.extend(box(x-w/2,z-d/2,x+w/2,z+d/2) for x,z,w,d,h,_ in definition['layout'])
    ground.extend(Polygon(r[0],r[1:]) for r in data['river']['rings'])
    blocked=shapely.union_all(ground)
    def clear(a,b):return not blocked.intersects(LineString([a,b]).buffer(1.65))
    nav=definition['nav'];old_count=len(nav['nodes']);anchors=[]
    for r in routes:
        a=np.array(r['from']);b=np.array(r['to']);count=math.ceil(np.linalg.norm(b-a)/6);chain=[]
        for f in np.linspace(0,1,count+1):
            p=np.round(a+(b-a)*f,2).tolist();index=len(nav['nodes']);nav['nodes'].append([*p,-1.98]);chain.append(index)
            near=sorted(range(old_count),key=lambda i:math.dist(p,nav['nodes'][i][:2]));linked=0
            for i in near:
                q=nav['nodes'][i]
                if math.dist(p,q[:2])>65:break
                if q[2]<-2.1 or not clear(p,q[:2]):continue
                nav['links'].append([index,i]);linked+=1
                if linked==2:break
        for a,b in zip(chain,chain[1:]):
            if not clear(nav['nodes'][a][:2],nav['nodes'][b][:2]):raise ValueError('地上通路内に障害物が残っている')
            nav['links'].append([a,b])
        anchors.append(chain)
    return {'routes':routes,'ceiling':ceiling,'changedVolumes':changed,'roofChecks':roof_checks,'navigationAnchors':anchors}


def pack_navigation(definition):
    # 1cm・XYZのまま可逆に保存。川底・坂・橋上の高さを落とさない。
    nav=definition['nav'];points=np.array(nav['nodes']);scaled=np.rint(points/.01).astype('<i2')
    assert np.max(np.abs(scaled*.01-points))<1e-8
    definition['nav']={'encoding':'xyz-i16-links-u16','step':.01,'nodes':base64.b64encode(scaled.tobytes()).decode(),
                       'links':base64.b64encode(np.array(nav['links'],dtype='<u2').tobytes()).decode()}
    return {'nodes':len(points),'links':len(nav['links']),'step':.01}
