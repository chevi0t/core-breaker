"""再構築地形の重なり・街区の件数・着地時の閉所を、保存済みの形状から検査する。"""
import argparse,base64,hashlib,json,pathlib,sys
import numpy as np
import shapely
from shapely.geometry import Polygon,box
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from plateau_city_geometry import parts

ROOT=pathlib.Path(__file__).resolve().parents[2]

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--source',type=pathlib.Path);ap.add_argument('--output',type=pathlib.Path,default=pathlib.Path('/tmp/hoshimichi-rebuild-geometry.json'));args=ap.parse_args()
 folder=ROOT/'mapdesign/hoshimichi_west/rebuild';data=json.loads((folder/'layout.json').read_text());report=json.loads((folder/'generation.json').read_text());blocks=json.loads((folder/'blocks.json').read_text());policy=json.loads((ROOT/'research/maps/hoshimichi-west-rebuild-policy.json').read_text())
 assert (folder/'layout.json').stat().st_size==report['terrainBytes']<policy['maximumMapFileBytes']-20000
 assert data['playBounds']==[-350,350,-175,175] and data['preview']['terrainDeformed'] is False
 assert data['spawns']==[] and data['district']['bases']==[], '設備配置前の地形である'
 assert max(b['objects'] for b in blocks)<=3, '街区単位で1〜3個のモデルにまとめる'
 assert max(b['baseHeight'] for b in blocks if not b['active'])<=16
 assert report['riverVertices']<160 and len(data['river']['exits'])==10
 volumes=[]
 for kind,low,high,encoded,meta in data['volumes']:
  rings=[np.frombuffer(base64.b64decode(r),dtype='<i2').reshape(-1,2)*data['ringCoordinateStep'] for r in encoded]
  p=Polygon(rings[0],rings[1:]);assert p.is_valid and p.area>2 and low<high
  assert box(-450.03,-275.03,450.03,275.03).covers(p)
  volumes.append((p,kind,low,high,meta))
 assert len(volumes)==report['volumes']
 solid=[v for v in volumes if v[1]!=3];elevated=[v for v in volumes if v[1]==3]
 overlaps=[]
 for p,k,lo,hi,meta in elevated:
  for q,qk,ql,qh,qm in solid:
   area=p.intersection(q).area
   if min(hi,qh)-max(lo,ql)>.05 and area>.1:overlaps.append(round(area,3))
 assert not overlaps, ('建物と線路・駅屋根の体積干渉',overlaps)
 # 地上だけでなく、各高さの低い屋根も検査する。半径1.3mは本体と同じ。
 # 壁に囲まれた低所を調べる幾何検査であり、全ての移動経路を保証するものではない。
 pockets=[]
 for radius in [0,1.3]:
  for height in sorted({v[3] for v in solid}):
   walls=shapely.union_all([v[0] for v in solid if v[3]>=height]).buffer(radius,quad_segs=3)
   for p in parts(walls):
    for ring in p.interiors:
     hole=Polygon(ring).intersection(box(-350,-175,350,175))
     if hole.area>3:pockets.append({'height':height,'area':hole.area})
 assert not pockets, ('空中から入れる閉所',pockets)
 for key,surface in data['surfaces'].items():
  pts=np.frombuffer(base64.b64decode(surface['points']),dtype='<i2').reshape(-1,3)*surface['step']
  assert np.isfinite(pts).all()
  if key in ['dem','streets']:assert np.max(np.abs(pts[:,1]))<.001
 for r in data['river']['exits']:
  assert r['start'][1]==-5 and r['end'][1]==0 and r['street'][1]==0 and r['width']>=7
  assert np.isfinite(r['street']).all()
 if args.source:assert hashlib.sha256((args.source/'geometry.npz').read_bytes()).hexdigest()==report['sourceGeometrySHA256']
 result={'volumes':len(volumes),'blocks':len(blocks),'maxObjectsPerBlock':max(b['objects'] for b in blocks),'railBuildingOverlaps':overlaps,'enclosedLandingPockets':pockets,'riverExits':len(data['river']['exits']),'terrainBytes':report['terrainBytes']}
 args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
