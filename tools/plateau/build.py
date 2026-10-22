#!/usr/bin/env python3
"""復号済みPLATEAUと地理院DEMから、地形確認専用のHTMLを作る。"""
import argparse, base64, gzip, hashlib, html, json, math, pathlib
import numpy as np
from PIL import Image
from scipy.ndimage import minimum_filter
ROOT=pathlib.Path(__file__).resolve().parents[2]
A=6378137.;E2=.0066943799901413165

def ecef(lon,lat,h):
    n=A/np.sqrt(1-E2*np.sin(lat)**2)
    return np.stack(((n+h)*np.cos(lat)*np.cos(lon),(n+h)*np.cos(lat)*np.sin(lon),(n*(1-E2)+h)*np.sin(lat)),axis=-1)

class Frame:
    def __init__(self,center,rotation):
        lon,lat=map(math.radians,center);angle=math.radians(rotation)
        self.ca,self.sa=math.cos(angle),math.sin(angle)
        self.east=np.array([-math.sin(lon),math.cos(lon),0])
        self.up=np.array([math.cos(lat)*math.cos(lon),math.cos(lat)*math.sin(lon),math.sin(lat)])
        self.north=np.cross(self.up,self.east);self.reference=ecef(lon,lat,0)

    def local(self,v,base):
        q=v-self.reference;e=q@self.east;s=-q@self.north
        return np.stack((e*self.ca-s*self.sa,q@self.up-base,e*self.sa+s*self.ca),axis=-1)

def clip(tris,half=300):
    """境界を横切る面も指定範囲へ切断。切断面の蓋は作らない。"""
    valid=(tris[:,:,[0,2]].min(axis=1)<=half).all(axis=1)&(tris[:,:,[0,2]].max(axis=1)>=-half).all(axis=1)
    tris=tris[valid];inside=(np.abs(tris[:,:,[0,2]])<=half).all(axis=(1,2));out=[tris[inside].reshape(-1,3)]
    for tri in tris[~inside]:
        poly=list(tri)
        for axis,sign in [(0,1),(0,-1),(2,1),(2,-1)]:
            result=[]
            for i,a in enumerate(poly):
                b=poly[(i+1)%len(poly)];da=half-sign*a[axis];db=half-sign*b[axis]
                if da>=0:result.append(a)
                if (da>=0)!=(db>=0):result.append(a+(b-a)*(da/(da-db)))
            poly=result
            if len(poly)<3:break
        if len(poly)>=3:out.append(np.array([[poly[0],poly[i],poly[i+1]] for i in range(1,len(poly)-1)]).reshape(-1,3))
    result=np.concatenate(out) if out else np.empty((0,3))
    # 境界に沿う退化面を除く。
    t=result.reshape(-1,3,3);keep=np.linalg.norm(np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]),axis=1)>1e-5
    return t[keep].reshape(-1,3).astype('<f4')

def write_preview(layers,meta,manifest,out,compress=True):
    blob={k:base64.b64encode(v.tobytes()).decode() for k,v in layers.items()}
    # 座標と表示設定を可逆圧縮。量子化・面削減はせず、標準APIで展開する。
    payload={'data':blob,'meta':meta}
    if compress:
        encoded=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode('utf-8')
        payload=base64.b64encode(gzip.compress(encoded,compresslevel=9,mtime=0)).decode('ascii')
    template=(ROOT/'tools/plateau/viewer.html').read_text();three=(ROOT/'vendor/three-r128/three.min.js').read_text();license=(ROOT/'vendor/three-r128/LICENSE').read_text()
    links=list({v['url']:v for v in manifest.get('sourceLinks',[{'url':'https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2025','label':'東京都・PLATEAU 新宿区2025年度3D都市モデル'}])}.values())
    source_links='・'.join('<a href="'+html.escape(v['url'],quote=True)+'">'+html.escape(v['label'])+'</a>' for v in links)
    title=html.escape(meta['display'].get('title','都市地形プレビュー'));area=html.escape(meta['display'].get('areaName','都庁周辺'))
    html_output=template.replace('/*__THREE__*/',three).replace('/*__PAYLOAD__*/',json.dumps(payload,ensure_ascii=False,separators=(',',':'))).replace('__THREE_LICENSE__',license).replace('__TITLE__',title).replace('__AREA__',area).replace('__EXTENT__',str(meta['extentMeters'])).replace('__SOURCE_LINKS__',source_links)
    (out/'preview.html').write_text(html_output)


def main():
    ap=argparse.ArgumentParser();ap.add_argument('cache',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path);args=ap.parse_args();cache=args.cache;out=args.output;out.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((cache/'inputs.json').read_text());frame=Frame(manifest['center'],manifest['rotationDegrees']);half=manifest['halfExtent']
    LON,LAT=map(math.radians,manifest['center']);CA,SA=frame.ca,frame.sa;local=frame.local
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
        layers[m['kind']].append(clip(v[idx],half))
    layers={k:np.concatenate(v) if v else np.empty((0,3),dtype='<f4') for k,v in layers.items()}
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
    cells=round(half*2/4);stride=cells+1;steps=np.linspace(-half,half,stride);xx,zz=np.meshgrid(steps,steps);east=xx*CA+zz*SA;south=-xx*SA+zz*CA
    n0=A/math.sqrt(1-E2*math.sin(LAT)**2);m0=A*(1-E2)/(1-E2*math.sin(LAT)**2)**1.5
    lon=LON+east/(n0*math.cos(LAT));lat=LAT-south/m0
    h=sample_dem(lon,lat)
    valid=np.isfinite(h)
    if not valid.any():raise ValueError('DEMが全域欠測')
    # 欠測の頂点は地面を作らない。内部配列用の代替値は描画面に使わない。
    ground=local(ecef(lon,lat,np.where(valid,h,reference)+gh),base);ground[:,:,0]=xx;ground[:,:,2]=zz
    tri=np.array([[a,b,c] for z in range(cells) for x in range(cells) for a,b,c in [(z*stride+x,(z+1)*stride+x,z*stride+x+1),(z*stride+x+1,(z+1)*stride+x,(z+1)*stride+x+1)]])
    tri=tri[valid.ravel()[tri].all(axis=1)]
    # DEMは橋の下を表現できない。道路の実メッシュより高い地面だけを下げる。
    # 上下の道路が重なる場所では最下層を使い、橋そのものは別メッシュのまま保つ。
    raw_ground=ground.copy();roadbed=np.full(xx.shape,np.inf)
    for t in layers['tran'].reshape(-1,3,3):
        a,b,c=t;den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
        if abs(den)<.01:continue
        x0=max(0,int(math.ceil((t[:,0].min()+half)/4)));x1=min(cells,int(math.floor((t[:,0].max()+half)/4)))
        z0=max(0,int(math.ceil((t[:,2].min()+half)/4)));z1=min(cells,int(math.floor((t[:,2].max()+half)/4)))
        if x1<x0 or z1<z0:continue
        gx=xx[z0:z1+1,x0:x1+1];gz=zz[z0:z1+1,x0:x1+1]
        u=((b[2]-c[2])*(gx-c[0])+(c[0]-b[0])*(gz-c[2]))/den
        v=((c[2]-a[2])*(gx-c[0])+(a[0]-c[0])*(gz-c[2]))/den
        inside=(u>=-1e-6)&(v>=-1e-6)&(u+v<=1.000001);yy=u*a[1]+v*b[1]+(1-u-v)*c[1]
        patch=roadbed[z0:z1+1,x0:x1+1];patch[inside]=np.minimum(patch[inside],yy[inside]-.35)
    # 4m格子の補間が道路へ食い込まないための1格子分の余白。
    roadbed=minimum_filter(roadbed,size=3,mode='nearest');ground[:,:,1]=np.minimum(ground[:,:,1],roadbed)
    layers['dem']=ground.reshape(-1,3)[tri].reshape(-1,3).astype('<f4')
    np.savez_compressed(out/'geometry.npz',**layers,heights=h,rawGround=raw_ground,ground=ground,groundValid=valid)
    stats={k:{'triangles':len(v)//3,'min':v.astype(float).min(axis=0).round(3).tolist() if len(v) else None,'max':v.astype(float).max(axis=0).round(3).tolist() if len(v) else None} for k,v in layers.items()}
    meta={'center':manifest['center'],'rotationDegrees':manifest['rotationDegrees'],'extentMeters':half*2,'display':manifest.get('display',{}),'referenceElevation':reference,'geoidHeight':gh,'demElevationRange':[float(np.nanmin(h)),float(np.nanmax(h))],'layers':stats,'missingDEMVertices':int(np.count_nonzero(~valid)),'groundAdjustedVertices':int(np.count_nonzero((ground[:,:,1]<raw_ground[:,:,1]-.01)&valid)),'groundMaxLowering':float(np.max((raw_ground[:,:,1]-ground[:,:,1])[valid])),'sourceModelTiles':len(manifest['models']),'bases':0,'plants':0}
    (out/'summary.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    write_preview(layers,meta,manifest,out)
    print(json.dumps(meta,ensure_ascii=False))
if __name__=='__main__':main()
