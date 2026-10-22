#!/usr/bin/env python3
"""公開タイル範囲への座標照合と、切り出し・複層・標高の形状検査。"""
import argparse,json,pathlib
import numpy as np

def main():
    ap=argparse.ArgumentParser();ap.add_argument('cache',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path);args=ap.parse_args();cache=args.cache;out=args.output
    manifest=json.loads((cache/'inputs.json').read_text());regions={m['file']:m['bounds'] for m in manifest['models'] if 'bounds' in m}
    if not regions:
        for kind in ['bldg','tran','brid']:
            def visit(n):
                if n.get('content'):
                    c=n['content'];regions[kind+'-'+c.get('uri',c.get('url')).split('/')[-1]]=c.get('boundingVolume',n['boundingVolume'])['region']
                for c in n.get('children',[]):visit(c)
            visit(json.loads((cache/f'{kind}-tileset.json').read_text())['root'])
    assert len({m['file'] for m in manifest['models']})==len(manifest['models']),'同名キャッシュの衝突'
    # 変換結果を、公開3D Tilesに記載された緯度経度・楕円体高の範囲へ独立に照合する。
    worst=0.;seen=set()
    for m in json.loads((cache/'decoded/meshes.json').read_text()):
        assert m['name'] not in seen;seen.add(m['name'])
        v=np.fromfile(cache/'decoded'/(m['name']+'.pos'),dtype='<f4').reshape(-1,3).astype(float)
        x,y,z=(v[:,[0,2,1]]*np.array([1,-1,1])+m['rtc']).T
        a=6378137.;b=6356752.314245179;e2=1-(b/a)**2;ep2=(a*a-b*b)/(b*b);p=np.hypot(x,y);q=np.arctan2(z*a,p*b)
        lat=np.arctan2(z+ep2*b*np.sin(q)**3,p-e2*a*np.cos(q)**3);lon=np.arctan2(y,x);height=p/np.cos(lat)-a/np.sqrt(1-e2*np.sin(lat)**2)
        r=regions[m['source']]
        assert lon.min()>=r[0]-2e-7 and lon.max()<=r[2]+2e-7,m['name']
        assert lat.min()>=r[1]-2e-7 and lat.max()<=r[3]+2e-7,m['name']
        error=max(r[4]-height.min(),height.max()-r[5],0);worst=max(worst,error);assert error<.2,(m['name'],error)
    geo=np.load(out/'geometry.npz');summary=json.loads((out/'summary.json').read_text())
    for name in ['bldg','tran','brid','dem']:
        v=geo[name];assert v.shape[1]==3 and len(v)>0 and len(v)%3==0
        assert np.isfinite(v).all();assert np.abs(v[:,[0,2]]).max()<=summary['extentMeters']/2+.001
        assert v[:,1].min()>-50 and v[:,1].max()<350
    checks=manifest.get('checks',{'minimumReliefMeters':10,'multiLevelWitnesses':[[165,-75],[165,120]]})
    heights=geo['heights'];valid=np.isfinite(heights)
    assert valid.any() and np.ptp(heights[valid])>=checks.get('minimumReliefMeters',0)
    if not valid.all():assert int(np.count_nonzero(~valid))==summary['missingDEMVertices']
    assert np.all(geo['ground'][:,:,1]<=geo['rawGround'][:,:,1]+1e-6) # 地面の補正で盛り上げない。
    assert summary['bases']==summary['plants']==0
    t=np.concatenate([geo['tran'],geo['brid']]).reshape(-1,3,3);a,b,c=t[:,0],t[:,1],t[:,2]
    den=(b[:,2]-c[:,2])*(a[:,0]-c[:,0])+(c[:,0]-b[:,0])*(a[:,2]-c[:,2]);good=np.abs(den)>.001;witnesses=[]
    for x,z in checks.get('multiLevelWitnesses',[]):
        u=np.divide((b[:,2]-c[:,2])*(x-c[:,0])+(c[:,0]-b[:,0])*(z-c[:,2]),den,out=np.zeros(len(den)),where=good)
        v=np.divide((c[:,2]-a[:,2])*(x-c[:,0])+(a[:,0]-c[:,0])*(z-c[:,2]),den,out=np.zeros(len(den)),where=good)
        hit=good&(u>=0)&(v>=0)&(u+v<=1);h=(u*a[:,1]+v*b[:,1]+(1-u-v)*c[:,1])[hit]
        assert len(h)>1 and np.ptp(h)>5,(x,z,h)
        witnesses.append({'x':x,'z':z,'floorHeights':np.unique(np.round(h,2)).tolist()})
    result={'decodedMeshes':len(seen),'maxHeightOutsideSourceBoundsMeters':worst,'multiLevelWitnesses':witnesses,'finiteAndClipped':True,'terrainReliefPreserved':True,'bases':0,'plants':0}
    (out/'geometry-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
