#!/usr/bin/env python3
"""既存の環都駅前を別案として1/2に縮め、4m機体を実都市8m級の比率にする。"""
import copy
import hashlib
import json
import math
import pathlib
import subprocess

import numpy as np
import shapely
from scipy.ndimage import label
from scipy.spatial import cKDTree
from shapely.geometry import Point, LineString, box

import build_kanto_map as city

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'mapdesign/kanto_half'
city.STEP=.01


class Streets:
    def __init__(self,solids):
        self.volumes=solids
        self.shapes=[p for p,lo,hi in solids if lo<4.1 and hi>.3]
        self.tree=shapely.STRtree(self.shapes)
        self.blocked=shapely.union_all(self.shapes).buffer(1.65,quad_segs=4)
        self.air=shapely.union_all([p for p,lo,hi in solids])

    def free(self,p,r=1.65):
        return max(abs(p[0]),abs(p[1]))<250-r and not len(self.tree.query(Point(p).buffer(r,quad_segs=6),predicate='intersects'))

    def clear(self,a,b):
        return self.free(a) and self.free(b) and not self.blocked.intersects(LineString([a,b]))


def read_source():
    source=ROOT/'prototype/maps/kanto.js'
    script="const fs=require('fs'),vm=require('vm'),c={window:{}};vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),c);process.stdout.write(JSON.stringify(c.window.MAP_DATA.kanto));"
    return source,json.loads(subprocess.check_output(['node','-e',script,str(source)]))


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    source,before=read_source();d=copy.deepcopy(before);data=d['cityTerrain']
    assert d['size']==[500,500] and data['half']==500
    d.update(name='環都駅前・8m級試験',size=[250,250],baseZ=240,baseLine=200,
        desc='街の幅・奥行き・高さを1/2にした500m四方。現行機体が実寸の街に対して8m級となる確認版。')
    data['half']=250;data['ringCoordinateStep']*=.5;data['groundMaximum']*=.5
    for v in data['volumes']:v[1]*=.5;v[2]*=.5
    for s in data['surfaces'].values():s['step']*=.5
    for key in ['bed','water']:data['river'][key]*=.5
    assert not data['river']['rings'] and not data['spawns'] and not data['decorations']
    for b in data['district']['bases']:b['at']=[v*.5 for v in b['at']];b['radius']=24;b['height']*=.5
    canopy=data['district']['stationCanopy'];canopy['ring']=[[v*.5 for v in p] for p in canopy['ring']]
    for k in ['top','low','thickness']:canopy[k]*=.5
    assert not data['district']['roofPads']
    # 芝生の輪郭もringCoordinateStepを共有するため整数列をそのまま縮尺変更できる。
    for p in d['plants']:p[1]*=.5;p[2]*=.5
    for p in d['plantPods']:p[1]*=.5;p[2]*=.5
    # 基地設備は縮小せず、前面の防衛・側面の補給・左奥の索敵を離して配置する。
    d['turrets']=[[x,d['baseZ']+z] for x,z in [(-24,0),(24,0),(-10,-18),(10,-18)]]
    d['basePods']=[[x,d['baseZ']+10] for x in [-18,18]]
    d['radar']=[-10,d['baseZ']+21]
    d['layout']=[[x*.5,z*.5,w*.5,h*.5,height,kind] for x,z,w,h,height,kind in d['layout']]
    for b in d['bases'].values():
        b['at']=[v*.5 for v in b['at']];b['radius']=24
        b['catapults']=[[v*.5 for v in row] for row in b['catapults']]
    for p in d['jumpPads']:
        p['at']=[v*.5 for v in p['at']];p['exit']=[v*.5 for v in p['exit']];p['rise']*=.5
        # 機体と踏む範囲は縮めない。
        p['radius']=3
    for p in d['plantCatapults']:
        p['at']=[v*.5 for v in p['at']];p['exit']=[v*.5 for v in p['exit']]
        p['flight']=math.ceil(p['flight']*math.sqrt(.5)*10)/10
    from kanto_half_clearance import adjust_clearance
    clearance=adjust_clearance(data)
    # 移動指示で6m手前に停止するBotも屋根へ乗れるよう、目標だけ少し奥へ置く。
    roof_targets=[]
    for i,target in {1:[-124.38,-78.57,22],2:[-114.26,45.29,7.5],
                     3:[98.97,-61.29,22],4:[28.46,110.91,28]}.items():
        roof_targets.append({'pad':i+1,'before':d['jumpPads'][i]['exit'],'after':target})
        d['jumpPads'][i]['exit']=target
    # 機体サイズを保つため、深い屋上ポケットだけを塞ぐ。
    roof_fills=[{'volume':63,'rings':3},{'volume':28,'rings':1}]
    data['volumes'][63][3]=data['volumes'][63][3][:1]
    del data['volumes'][28][3][1]
    d['bases']['R']['at'][1]=-222
    for b in data['district']['bases']:
        if b['at']==[175,-225]:b['at'][1]=-222
    # 台の実寸直径7.4mとコアの傘を避け、既存の空いた街路へ分散する。
    base_launches={
        'B':[[-173,181],[-160,186],[-143,183],[-125,181]],
        'R':[[204,-238],[188,-176],[150,-187],[136,-204]],
    }
    for team,starts in base_launches.items():
        for row,start in zip(d['bases'][team]['catapults'],starts):row[:2]=start
    # 占拠円とコアは本体の寸法を保つ。小さくなった建物の縁が施設へ入る部分だけ除く。
    clear=shapely.union_all([*[Point(p[1:3]).buffer(17,quad_segs=12) for p in d['plants']],
        *[Point(b['at']).buffer(28,quad_segs=12) for b in d['bases'].values()]])
    volumes=[];trim=[]
    for i,v in enumerate(data['volumes']):
        poly=city.polygon(v)
        if v[1]>=5.5 or not poly.intersects(clear):volumes.append(v);continue
        removed=poly.intersection(clear).area
        if removed<.001:volumes.append(v);continue
        trim.append({'index':i,'removedArea':round(removed,3)})
        for part in city.parts(shapely.set_precision(poly.difference(clear),.01)):
            if part.area>.5:volumes.append([*v[:3],city.pack_polygon(part),v[4]])
    data['volumes']=volumes
    solids=[(city.polygon(v),v[1],v[2]) for v in volumes]
    def local(t,p):
        b=d['bases'][t]['at'];s=1 if t=='B' else -1
        return [b[0]+s*p[0],b[1]+s*(p[1]-d['baseZ'])]
    for x,z,w,h,height,_ in d['layout']:solids.append((box(x-w/2,z-h/2,x+w/2,z+h/2),0,height))
    for t,b in d['bases'].items():
        x,z=b['at'];solids.append((box(x-6,z-6,x+6,z+6),0,16))
        for p in d['turrets']:
            x,z=local(t,p);solids.append((box(x-1.5,z-1.5,x+1.5,z+1.5),0,2.4))
        x,z=local(t,d['radar']);solids.append((box(x-1.5,z-1.5,x+1.5,z+1.5),0,10))
    for _,x,z,_ in d['plants']:solids.append((box(x-.7,z-.7,x+.7,z+.7),0,7))
    # 窪地へは縮尺後の坂の入口から入る。地上経路がピットを横切らないようにする。
    shelters=[]
    for ident,sign in [('A',1),('E',-1)]:
        _,x,z=next(p for p in d['plantPods'] if p[0]==ident)
        solids.append((box(x-2.5,z-2.5,x+2.5,z+2.5),-1,1));shelters.append({'plant':ident,'at':[x,z],'sign':sign})
    streets=Streets(solids)
    # 同じ施設の縮小前位置を基準に、小さい着地余白だけ補う。
    adjustments=[];occupied=[p[1:] for p in d['plantPods']]+[local(t,p) for t in d['bases'] for p in d['basePods']]
    def nearby_free(at,r,limit=16,avoid=0):
        if streets.free(at,r) and all(math.dist(at,p)>=avoid for p in occupied):return at
        choices=[]
        for dx in range(-limit,limit+1):
            for dz in range(-limit,limit+1):
                p=[round(at[0]+dx,2),round(at[1]+dz,2)]
                if streets.free(p,r) and all(math.dist(p,q)>=avoid for q in occupied):choices.append((math.hypot(dx,dz),p))
        assert choices,('施設余白なし',at,r)
        p=min(choices)[1];adjustments.append({'from':at,'to':p,'clearance':r});return p
    for b in d['bases'].values():
        for row in b['catapults']:
            row[:2]=nearby_free(row[:2],4,12,4);row[2:]=nearby_free(row[2:],3,12)
            occupied.append(row[:2])
    for p in d['plantCatapults']:
        p['at']=nearby_free(p['at'],2.5,12,5);p['exit']=nearby_free(p['exit'],3,12);occupied.append(p['at'])
    for p in d['jumpPads']:
        p['at'][:2]=nearby_free(p['at'][:2],2.5,10,5);occupied.append(p['at'][:2])
    # 施設がつながる最大の歩行領域だけから再出撃点を採る。
    values=np.arange(-246,247,2);xx,zz=np.meshgrid(values,values);points=np.column_stack([xx.ravel(),zz.ravel()])
    mask=~shapely.intersects(streets.blocked,shapely.points(points)).reshape(xx.shape)
    labels,_=label(mask,np.ones((3,3)));sizes=np.bincount(labels.ravel());sizes[0]=0;mask&=labels==sizes.argmax()
    cells=np.argwhere(mask);connected_points=np.column_stack([values[cells[:,1]],values[cells[:,0]]]);tree=cKDTree(connected_points)
    def connected(p):
        distances,ids=tree.query(p,k=8)
        return any(distance<6 and streets.clear(p,connected_points[i]) for distance,i in zip(distances,ids))
    anchors=[];respawns={};base_spawns={}
    for t,b in d['bases'].items():
        respawns[t]={}
        for ident,x,z,_ in d['plants']:
            angle=math.atan2(b['at'][1]-z,b['at'][0]-x);slots=[]
            for da in np.linspace(-1.5,1.5,101):
                for r in [46.1,49,51.9]:
                    p=[round(x+math.cos(angle+da)*r,2),round(z+math.sin(angle+da)*r,2)]
                    if streets.free(p,2) and connected(p) and all(math.dist(p,q)>5 for q in slots):slots.append(p)
            assert len(slots)>=3,('出撃帯なし',t,ident)
            slots=slots[::max(1,math.ceil(len(slots)/5))];respawns[t][ident]=slots
            anchors.extend((f'spawn-{t}-{ident}-{i}',p) for i,p in enumerate(slots))
        slots=[]
        for angle in np.linspace(0,2*math.pi,48,endpoint=False):
            p=[round(b['at'][0]+math.cos(angle)*18,2),round(b['at'][1]+math.sin(angle)*18,2)]
            away_from_facilities=all(math.dist(p,row[:2])>=6 for row in b['catapults']) and all(math.dist(p,local(t,pod))>=4 for pod in d['basePods'])
            if streets.free(p,2) and connected(p) and away_from_facilities and all(math.dist(p,q)>4 for q in slots):slots.append(p)
        assert len(slots)>=6,('基地出撃点なし',t)
        base_spawns[t]=slots;anchors.extend((f'base-{t}-{i}',p) for i,p in enumerate(slots))
        anchors.extend((f'basepod-{t}-{i}',local(t,p)) for i,p in enumerate(d['basePods']))
        for i,row in enumerate(b['catapults']):anchors.extend([(f'cat-{t}-{i}',row[:2]),(f'land-{t}-{i}',row[2:])])
    anchors.extend((f'plant-{ident}-{s}',[x+s*4,z+3]) for ident,x,z,_ in d['plants'] for s in [-1,1])
    anchors.extend((f'pod-{pid}',[x,z+next((s['sign']*9 for s in shelters if s['plant']==pid),0)]) for pid,x,z in d['plantPods'])
    for p in d['plantCatapults']:anchors.extend([(f'plant-cat-{p["plant"]}',p['at']),(f'plant-land-{p["plant"]}',p['exit'])])
    anchors.extend((f'pad-{i}',p['at'][:2]) for i,p in enumerate(d['jumpPads']))
    d['nav'],nav_stats=city.navigation(streets,anchors,half=250,grid_step=2,span=45)
    d['cityBattle'].update(respawns=respawns,baseSpawns=base_spawns)
    d['attribution']+=' 縮尺1/2・機体8m級相当の別案。立体通路の天井と施設周辺をゲーム用に補正。'
    measure="""
const fs=require('node:fs'),T=require(process.argv[1]),s=fs.readFileSync(process.argv[2],'utf8');
const f=new Function(s.slice(s.indexOf('function expandCityLayout('),s.indexOf('// 肩越し視点'))+';return expandCityLayout;')();
const d=JSON.parse(fs.readFileSync(0,'utf8'));f(T,d);
console.log(JSON.stringify(Object.fromEntries(Object.entries(d.meshes).map(([k,v])=>[k,Buffer.from(v,'base64').length/36]))));
"""
    counts=json.loads(subprocess.check_output(['node','-e',measure,str(ROOT/'vendor/three-r128/three.min.js'),str(ROOT/'prototype/index.html')],input=city.compact(data)))
    for name,count in counts.items():data['packing']['layers'][name]={'triangles':count}
    raw=city.compact(d);assert len(raw)<=100000,len(raw)
    (OUT/'map.json').write_bytes(raw+b'\n')
    report={'sourceMapSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'sourceCommit':'0ef53120d4ca6a43527b103c1544dc84926254ae',
        'extentMeters':[500,500],'nominalScaleXYZ':[.5,.5,.5],'equivalentRealWorldMechHeightMeters':8,'mapDataBytes':len(raw),
        'clearance':clearance,'roofPocketFills':roof_fills,'roofTargetAdjustments':roof_targets,
        'triangles':sum(counts.values()),
        'localFacilityClearing':trim,'facilityAdjustments':adjustments,'navigation':nav_stats,
        'bases':d['bases'],'plants':d['plants'],'shelters':shelters,'jumpPads':d['jumpPads'],'plantCatapults':d['plantCatapults'],
        'baseEquipment':{t:{'turrets':[local(t,p) for p in d['turrets']],
            'pods':[local(t,p) for p in d['basePods']],'radar':local(t,d['radar'])} for t in d['bases']},
        'sourcePreserved':True}
    (OUT/'generation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (OUT/'CREDITS.md').write_text((ROOT/'mapdesign/kanto/CREDITS.md').read_text()+'\n\n1/2試作版：街の全軸を半分にし、立体通路の天井・施設空間・射出設備・経路を現行機体向けに補正しました。現実の構造を厳密に表すものではありません。\n')
    from build_kanto_half_play import build_html
    build_html(OUT)
    print(json.dumps({k:report[k] for k in ['extentMeters','nominalScaleXYZ','mapDataBytes','navigation','facilityAdjustments']},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
