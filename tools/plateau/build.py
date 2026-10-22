#!/usr/bin/env python3
"""復号済みPLATEAUと地理院DEMから、地形確認専用のHTMLを作る。"""
import argparse, base64, hashlib, json, math, pathlib
import numpy as np
from PIL import Image
from scipy.ndimage import minimum_filter
ROOT=pathlib.Path(__file__).resolve().parents[2]
LON,LAT=map(math.radians,(139.6918,35.68975));ANG=math.radians(12);CA,SA=math.cos(ANG),math.sin(ANG)
EAST=np.array([-math.sin(LON),math.cos(LON),0]);UP=np.array([math.cos(LAT)*math.cos(LON),math.cos(LAT)*math.sin(LON),math.sin(LAT)]);NORTH=np.cross(UP,EAST)
A=6378137.;E2=.0066943799901413165

def ecef(lon,lat,h):
    n=A/np.sqrt(1-E2*np.sin(lat)**2)
    return np.stack(((n+h)*np.cos(lat)*np.cos(lon),(n+h)*np.cos(lat)*np.sin(lon),(n*(1-E2)+h)*np.sin(lat)),axis=-1)
REF=ecef(LON,LAT,0)

def local(v,base):
    q=v-REF;e=q@EAST;s=-q@NORTH
    return np.stack((e*CA-s*SA,q@UP-base,e*SA+s*CA),axis=-1)

def clip(tris):
    """境界を横切る面も600m四方へ切断。切断面の蓋は作らない。"""
    valid=(tris[:,:,[0,2]].min(axis=1)<=300).all(axis=1)&(tris[:,:,[0,2]].max(axis=1)>=-300).all(axis=1)
    tris=tris[valid];inside=(np.abs(tris[:,:,[0,2]])<=300).all(axis=(1,2));out=[tris[inside].reshape(-1,3)]
    for tri in tris[~inside]:
        poly=list(tri)
        for axis,sign in [(0,1),(0,-1),(2,1),(2,-1)]:
            result=[]
            for i,a in enumerate(poly):
                b=poly[(i+1)%len(poly)];da=300-sign*a[axis];db=300-sign*b[axis]
                if da>=0:result.append(a)
                if (da>=0)!=(db>=0):result.append(a+(b-a)*(da/(da-db)))
            poly=result
            if len(poly)<3:break
        if len(poly)>=3:out.append(np.array([[poly[0],poly[i],poly[i+1]] for i in range(1,len(poly)-1)]).reshape(-1,3))
    result=np.concatenate(out) if out else np.empty((0,3))
    # 境界に沿う退化面を除く。
    t=result.reshape(-1,3,3);keep=np.linalg.norm(np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]),axis=1)>1e-5
    return t[keep].reshape(-1,3).astype('<f4')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('cache',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path);args=ap.parse_args();cache=args.cache;out=args.output;out.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((cache/'inputs.json').read_text())
    for record in [*manifest['models'],*manifest['tilesets'],*manifest['dem'],manifest['geoid'],manifest['referenceElevation']]:
        if hashlib.sha256((cache/record['file']).read_bytes()).hexdigest()!=record['sha256']:raise ValueError('入力のハッシュ不一致: '+record['file'])
    geoid=json.loads((cache/'geoid.txt').read_text())['OutputData'];gh=float(geoid['geoidHeight']);reference=float(json.loads((cache/'gsi-elevation.json').read_text())['elevation']);base=reference+gh
    meshes=json.loads((cache/'decoded/meshes.json').read_text());layers={k:[] for k in ['bldg','tran','brid']}
    for m in meshes:
        ps=np.fromfile(cache/'decoded'/(m['name']+'.pos'),dtype='<f4').reshape(-1,3).astype(float)
        # glTF Y-up → 3D Tiles Z-up、その後RTC中心を加えてECEFへ。
        v=local(ps[:,[0,2,1]]*np.array([1,-1,1])+m['rtc'],base)
        idx=np.fromfile(cache/'decoded'/(m['name']+'.idx'),dtype='<u4').reshape(-1,3)
        if idx.max()>=len(v):raise ValueError('頂点番号が範囲外')
        layers[m['kind']].append(clip(v[idx]))
    layers={k:np.concatenate(v) for k,v in layers.items()}
    tiles={}
    for d in manifest['dem']:
        rgb=np.array(Image.open(cache/d['file']).convert('RGB'),dtype=np.int32);h=rgb[:,:,0]*65536+rgb[:,:,1]*256+rgb[:,:,2];nodata=h==2**23;h=np.where(h>=2**23,h-2**24,h)/100.;h[nodata]=np.nan;tiles[(d['x'],d['y'])]=h
    def sample_dem(lon,lat):
        n=2**15;px=(np.degrees(lon)+180)/360*n*256;py=(1-np.arcsinh(np.tan(lat))/math.pi)/2*n*256
        # 地理院タイル画素中心で双線形補間。
        px-=.5;py-=.5;ix=np.floor(px).astype(int);iy=np.floor(py).astype(int);fx=px-ix;fy=py-iy
        vals=[]
        for dx,dy in [(0,0),(1,0),(0,1),(1,1)]:
            a=np.empty(px.shape)
            for i in np.ndindex(px.shape):
                xx=int(ix[i])+dx;yy=int(iy[i])+dy;a[i]=tiles[(xx//256,yy//256)][yy%256,xx%256]
            vals.append(a)
        return vals[0]*(1-fx)*(1-fy)+vals[1]*fx*(1-fy)+vals[2]*(1-fx)*fy+vals[3]*fx*fy
    # 4m格子へ再標本化（原データは5mメッシュ）。地面は誇張しない。
    steps=np.linspace(-300,300,151);xx,zz=np.meshgrid(steps,steps);east=xx*CA+zz*SA;south=-xx*SA+zz*CA
    n0=A/math.sqrt(1-E2*math.sin(LAT)**2);m0=A*(1-E2)/(1-E2*math.sin(LAT)**2)**1.5
    lon=LON+east/(n0*math.cos(LAT));lat=LAT-south/m0
    h=sample_dem(lon,lat)
    if not np.isfinite(h).all():raise ValueError('DEMに欠測あり')
    ground=local(ecef(lon,lat,h+gh),base);ground[:,:,0]=xx;ground[:,:,2]=zz
    tri=np.array([[a,b,c] for z in range(150) for x in range(150) for a,b,c in [(z*151+x,(z+1)*151+x,z*151+x+1),(z*151+x+1,(z+1)*151+x,(z+1)*151+x+1)]])
    # DEMは橋の下を表現できない。道路の実メッシュより高い地面だけを下げる。
    # 上下の道路が重なる場所では最下層を使い、橋そのものは別メッシュのまま保つ。
    raw_ground=ground.copy();roadbed=np.full(xx.shape,np.inf)
    for t in layers['tran'].reshape(-1,3,3):
        a,b,c=t;den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
        if abs(den)<.01:continue
        x0=max(0,int(math.ceil((t[:,0].min()+300)/4)));x1=min(150,int(math.floor((t[:,0].max()+300)/4)))
        z0=max(0,int(math.ceil((t[:,2].min()+300)/4)));z1=min(150,int(math.floor((t[:,2].max()+300)/4)))
        if x1<x0 or z1<z0:continue
        gx=xx[z0:z1+1,x0:x1+1];gz=zz[z0:z1+1,x0:x1+1]
        u=((b[2]-c[2])*(gx-c[0])+(c[0]-b[0])*(gz-c[2]))/den
        v=((c[2]-a[2])*(gx-c[0])+(a[0]-c[0])*(gz-c[2]))/den
        inside=(u>=-1e-6)&(v>=-1e-6)&(u+v<=1.000001);yy=u*a[1]+v*b[1]+(1-u-v)*c[1]
        patch=roadbed[z0:z1+1,x0:x1+1];patch[inside]=np.minimum(patch[inside],yy[inside]-.35)
    # 4m格子の補間が道路へ食い込まないための1格子分の余白。
    roadbed=minimum_filter(roadbed,size=3,mode='nearest');ground[:,:,1]=np.minimum(ground[:,:,1],roadbed)
    layers['dem']=ground.reshape(-1,3)[tri].reshape(-1,3).astype('<f4')
    np.savez_compressed(out/'geometry.npz',**layers,heights=h,rawGround=raw_ground,ground=ground)
    stats={k:{'triangles':len(v)//3,'min':v.min(axis=0).round(3).tolist(),'max':v.max(axis=0).round(3).tolist()} for k,v in layers.items()}
    meta={'center':[139.6918,35.68975],'rotationDegrees':12,'extentMeters':600,'referenceElevation':reference,'geoidHeight':gh,'demElevationRange':[float(h.min()),float(h.max())],'layers':stats,'groundAdjustedVertices':int(np.count_nonzero(ground[:,:,1]<raw_ground[:,:,1]-.01)),'groundMaxLowering':float(np.max(raw_ground[:,:,1]-ground[:,:,1])),'sourceModelTiles':len(manifest['models']),'bases':0,'plants':0}
    (out/'summary.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    blob={k:base64.b64encode(v.tobytes()).decode() for k,v in layers.items()}
    template=(ROOT/'tools/plateau/viewer.html').read_text();three=(ROOT/'vendor/three-r128/three.min.js').read_text();license=(ROOT/'vendor/three-r128/LICENSE').read_text()
    html=template.replace('/*__THREE__*/',three).replace('/*__DATA__*/',json.dumps(blob,separators=(',',':'))).replace('/*__META__*/',json.dumps(meta)).replace('__THREE_LICENSE__',license)
    (out/'preview.html').write_text(html)
    print(json.dumps(meta,ensure_ascii=False))
if __name__=='__main__':main()
