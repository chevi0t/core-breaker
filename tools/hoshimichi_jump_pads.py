"""星路の街路を、既存の屋根・高架を越える垂直パッドで接続する。"""
import base64
import math

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points


def add_jump_pads(definition):
    data=definition['cityTerrain'];step=data.get('ringCoordinateStep',.01)
    def rings(rr):return [np.frombuffer(base64.b64decode(r),dtype='<i2').reshape(-1,2)*step for r in rr]
    def shape(rr):
        r=rings(rr);return Polygon(r[0],r[1:])
    solids=[(shape(v[3]),v[1],v[2],data['volumeKinds'][v[0]]) for v in data['volumes']]
    for x,z,w,d,h,_ in definition['layout']:solids.append((box(x-w/2,z-d/2,x+w/2,z+d/2),-2,h-2,'wall'))
    river=shapely.union_all([Polygon(rr[0],rr[1:]) for rr in data['river']['rings']])
    occupied=[p[1:3] for p in definition['plantPods']]
    occupied.extend(p[:2] for team in definition['cityBattle']['respawns'].values() for ps in team.values() for p in ps)
    occupied.extend(p for team in definition['bases'].values() for row in team['catapults'] for p in [row[:2],row[2:]])
    ground_block=shapely.union_all([p for p,lo,hi,_ in solids if lo<2.1 and hi>-1.7]).union(river)
    sky_block=shapely.union_all([p for p,_,_,_ in solids])
    def free(p,r):return max(abs(p[0]),abs(p[1]))<297-r and not ground_block.intersects(Point(p).buffer(r))
    def clear(a,b,r=1.65):return not ground_block.intersects(LineString([a,b]).buffer(r))
    def rooftop_path(a,b,height):
        distance=math.dist(a,b);xz=np.array(a)+(np.array(b)-a)*np.linspace(0,1,math.ceil(distance/.75)+1)[:,None]
        points=shapely.points(xz);line=LineString([a,b]);covered=[(shapely.intersects(poly,points),lo,hi) for poly,lo,hi,_ in solids if poly.intersects(line)]
        level=height
        for i in range(len(xz)):
            column=[(lo,hi) for mask,lo,hi in covered if mask[i]]
            if any(hi>level+6.2 and lo<level+4 for lo,hi in column):return False
            level=max([-2,*[hi for lo,hi in column if hi<=level+6.2]])
        return True
    roofs=[];covered=Polygon()
    for h in sorted({hi for _,_,hi,_ in solids},reverse=True):
        at_height=shapely.union_all([p for p,_,hi,_ in solids if hi==h])
        if 6<=h<=65:
            region=at_height.difference(covered).buffer(-4)
            for p in getattr(region,'geoms',[region]):
                if p.area>25:roofs.append((p,h))
        covered=covered.union(at_height)
    # 4組は線路を両方向へ横断、2基は東西の街区を抜ける。基地専用にはしない。
    seeds=[((-55,-38),0,1,45),((48,-42),0,-1,-65),
           ((-67,82),0,1,40),((33,84),0,-1,-75),
           ((-180,-15),1,1,55),((-180,55),1,-1,-25),
           ((208,22),1,1,95),((238,94),1,-1,20),
           ((245,-140),0,-1,190),((-170,110),0,1,-135)]
    pads=[];routes=[]
    for seed,axis,sign,beyond in seeds:
        choices=[]
        for dx in range(-32,33,4):
            for dz in range(-32,33,4):
                start=[seed[0]+dx,seed[1]+dz];pt=Point(start)
                if not free(start,3.5) or sky_block.intersects(pt.buffer(3.5)):continue
                if any(math.dist(start,b['at'])<85 for b in definition['bases'].values()):continue
                if any(math.dist(start,p[1:3])<22 for p in definition['plants']):continue
                if any(math.dist(start,p)<9 for p in occupied) or any(math.dist(start,p['at'][:2])<32 for p in pads):continue
                for roof,h in roofs:
                    distance=roof.distance(pt)
                    if not 9<=distance<=16:continue
                    q=np.array(nearest_points(pt,roof)[1].coords[0]);direction=(q-start)/distance
                    if direction[axis]*sign<.65:continue
                    end=None
                    for length in range(30,121,2):
                        candidate=np.array(start)+direction*length
                        if (candidate[axis]-beyond)*sign<0 or not free(candidate,2.3):continue
                        if any(math.dist(candidate,p[1:3])<3 for p in definition['plants']):continue
                        if any(math.dist(candidate,b['at'])<55 for b in definition['bases'].values()):continue
                        corridor=LineString([start,candidate]).buffer(1.7)
                        if river.intersects(corridor):break
                        if any(top>h+5 and lo<h+4 and poly.intersects(corridor) for poly,lo,top,_ in solids):break
                        if not rooftop_path(q,candidate,h):continue
                        if not any(math.dist(candidate,p[:2])<22 and clear(candidate,p[:2]) for p in definition['nav']['nodes']):continue
                        end=np.round(candidate,2).tolist();break
                    if end is None:continue
                    cost=math.dist(start,seed)+abs(distance-12)*2+math.dist(start,end)*.05
                    choices.append((cost,start,np.round(q,2).tolist(),h,end))
        if not choices:raise ValueError(f'別の街路へ抜けるパッドを配置できない: {seed}')
        _,start,target,h,end=min(choices,key=lambda c:c[0])
        pad={'at':[*start,-2],'exit':[*target,h],'rise':min(100,math.ceil((h+34)/4)*4),'radius':3}
        pads.append(pad);routes.append({'at':pad['at'],'roof':pad['exit'],'street':[*end,-2]})
    # 既存の地上経路は保持し、パッドの踏み口だけを近隣の街路へ接続する。
    nav=definition['nav'];old_count=len(nav['nodes']);added=[]
    for pad in pads:
        p=pad['at'];links=sorted(range(old_count),key=lambda i:math.dist(p[:2],nav['nodes'][i][:2]))
        links=[i for i in links if math.dist(p[:2],nav['nodes'][i][:2])<65 and clear(p[:2],nav['nodes'][i][:2])][:3]
        if not links:raise ValueError(f'パッドの地上経路が無い: {p}')
        ident=len(nav['nodes']);nav['nodes'].append(p.copy());nav['links'].extend([[ident,i] for i in links]);added.append({'node':ident,'links':links})
    definition['jumpPads']=pads
    return {'routes':routes,'navigationAnchors':added}


def add_catapults(definition):
    """D→A・C→Bと、基地から街区を越える射出を足す。"""
    data=definition['cityTerrain'];step=data.get('ringCoordinateStep',.01)
    def polygon(v):
        rr=[np.frombuffer(base64.b64decode(r),dtype='<i2').reshape(-1,2)*step for r in v[3]]
        return Polygon(rr[0],rr[1:])
    solids=[(polygon(v),v[1],v[2]) for v in data['volumes']]
    solids.extend((box(x-w/2,z-d/2,x+w/2,z+d/2),-2,h-2) for x,z,w,d,h,_ in definition['layout'])
    river=shapely.union_all([Polygon(r[0],r[1:]) for r in data['river']['rings']])
    blocked=shapely.union_all([p for p,lo,hi in solids if lo<2.1 and hi>-1.7]).union(river)
    sky=shapely.union_all([p for p,_,_ in solids]);occupied=[p[1:3] for p in definition['plantPods']]+[p['at'][:2] for p in definition['jumpPads']]
    routes=[]
    for source_id,target_id in [('D','A'),('C','B')]:
        source=np.array(next(p[1:3] for p in definition['plants'] if p[0]==source_id));target=np.array(next(p[1:3] for p in definition['plants'] if p[0]==target_id))
        angle=math.atan2(*(target-source)[::-1]);choices=[]
        def candidates(center,heading):
            points=[]
            for radius in [28,32,36,40]:
                for delta in np.linspace(-1.2,1.2,49):
                    p=np.round(center+[math.cos(heading+delta)*radius,math.sin(heading+delta)*radius],1).tolist()
                    if blocked.intersects(Point(p).buffer(5)) or sky.intersects(Point(p).buffer(3)):continue
                    if any(math.dist(p,q)<10 for q in occupied):continue
                    points.append(p)
            desired=center+np.array([math.cos(heading),math.sin(heading)])*30
            return sorted(points,key=lambda p:math.dist(p,desired))[:16]
        for a in candidates(source,angle):
            for b in candidates(target,angle+math.pi):
                f=np.linspace(0,1,241);points=shapely.points(np.array(a)+(np.array(b)-a)*f[:,None]);corridor=LineString([a,b]).buffer(2)
                crossings=[(shapely.intersects(poly.buffer(2),points),lo,hi) for poly,lo,hi in solids if poly.intersects(corridor)]
                for flight in np.arange(4.2,8.01,.2):
                    y=-2+.5*34*flight**2*f*(1-f)
                    if any(np.any(mask&(y<hi+3)&(y+4>lo)) for mask,lo,hi in crossings):continue
                    choices.append((flight*100+math.dist(a,source)*.1+math.dist(b,target)*.1,a,b,round(float(flight),1)));break
        if not choices:raise ValueError(f'建物を越えるカタパルト経路が無い: {source_id}→{target_id}')
        _,a,b,flight=min(choices,key=lambda q:q[0]);route=dict(at=a,exit=b,plant=source_id,targetPlant=target_id,flight=flight);routes.append(route);occupied.extend([a,b])
        for p in [a,b]:
            nav=definition['nav'];index=len(nav['nodes']);links=[]
            for i in sorted(range(index),key=lambda i:math.dist(p,nav['nodes'][i][:2])):
                q=nav['nodes'][i]
                if math.dist(p,q[:2])>80:break
                if not blocked.intersects(LineString([p,q[:2]]).buffer(1.65)):links.append(i)
                if len(links)==3:break
            if not links:raise ValueError(f'射出・着地先の地上経路が無い: {p}')
            nav['nodes'].append([*p,-2]);nav['links'].extend([[index,i] for i in links])
    definition['plantCatapults']=routes
    return {**strengthen_base_catapults(definition),'plantCatapults':routes}


def strengthen_base_catapults(definition):
    """水平初速を52m/s以上にし、8基を安全な街路へ向ける。"""
    data=definition['cityTerrain'];solids=[]
    old_starts={team:[row[:2] for row in base['catapults']] for team,base in definition['bases'].items()}
    # 北西の3番台は目の前の建物から離し、強い水平初速でも上昇する余地を作る。
    definition['bases']['R']['catapults'][2][:2]=[-259,-233]
    for _,lo,hi,rings,_ in data['volumes']:
        rr=[np.frombuffer(base64.b64decode(r),dtype='<i2').reshape(-1,2)*data.get('ringCoordinateStep',.01) for r in rings]
        solids.append((Polygon(rr[0],rr[1:]),lo,hi))
    solids.extend((box(x-w/2,z-d/2,x+w/2,z+d/2),-2,h-2) for x,z,w,d,h,_ in definition['layout'])
    sky=shapely.union_all([p for p,_,_ in solids]);river=shapely.union_all([Polygon(r[0],r[1:]) for r in data['river']['rings']])
    ground=shapely.union_all([p for p,lo,hi in solids if lo<2.1 and hi>-1.7]).union(river)
    occupied=[p[1:3] for p in definition['plantPods']]+[p['at'][:2] for p in definition['jumpPads']]
    occupied.extend(p for r in definition['plantCatapults'] for p in [r['at'],r['exit']])
    # 既存の地上節点の周りから、着地と接地後の滑走が収まる道路を選ぶ。
    candidates=sorted({(round(x+dx,2),round(z+dz,2)) for x,z,y in definition['nav']['nodes'] if abs(y+2)<.1
                       for dx in [-4,0,4] for dz in [-4,0,4] if max(abs(x+dx),abs(z+dz))<286})
    points=shapely.points(candidates);free=(shapely.distance(sky,points)>2.7)&(shapely.distance(river,points)>7)
    candidates=[p for p,keep in zip(candidates,free) if keep and all(math.dist(p,q)>12 for q in occupied)
                and all(math.dist(p,q[1:3])>60 for q in definition['plants'])]
    shapes=np.array([p.buffer(2) for p,_,_ in solids],dtype=object)
    seeds={'B':[[20,220],[5,90],[225,-20],[110,40]],'R':[[60,-260],[-180,10],[-275,20],[-150,-10]]}
    f=np.linspace(0,1,321);records=[];flights={}
    def clear(a,b):return not ground.intersects(LineString([a,b]).buffer(1.65))
    for team,base in definition['bases'].items():
        selected=None
        for flight in [4.2,4.4,4.6,4.8,5.0,5.2]:
            options=[];y=-2+.5*34*flight**2*f*(1-f)
            for index,row in enumerate(base['catapults']):
                a=np.array(row[:2]);choices=[]
                for p in candidates:
                    distance=math.dist(a,p)
                    if not max(220,52*flight)<=distance<=330 or math.dist(p,base['at'])<180:continue
                    direction=(np.array(p)-a)/distance
                    landing=LineString([np.array(p)-direction*4,np.array(p)+direction*8]).buffer(2.5)
                    if sky.intersects(landing) or river.intersects(landing):continue
                    line=LineString([a,p]);crossings=shapely.intersects(shapes,line);samples=shapely.points(a+(np.array(p)-a)*f[:,None])
                    if any(np.any(shapely.intersects(poly,samples)&(y<hi+3)&(y+4>lo))
                           for poly,(_,lo,hi),hit in zip(shapes,solids,crossings) if hit):continue
                    if not any(abs(q[2]+2)<.1 and math.dist(p,q[:2])<30 and clear(p,q[:2]) for q in definition['nav']['nodes']):continue
                    cost=math.dist(p,seeds[team][index])+abs(distance-260)*.1
                    choices.append((cost,p))
                options.append([p for _,p in sorted(choices)[:24]])
            def choose(index,picked):
                if index==4:return picked
                for p in options[index]:
                    if any(math.dist(p,q)<18 for q in picked):continue
                    result=choose(index+1,[*picked,p])
                    if result:return result
            selected=choose(0,[])
            if selected:break
        if not selected:raise ValueError(f'基地の4方向へ十分な勢いで飛ぶ経路が無い: {team}')
        base['catapultFlight']=flight;flights[team]=flight
        for index,(row,p) in enumerate(zip(base['catapults'],selected)):
            old=row[2:];row[2:]=p;distance=math.dist(row[:2],p)
            records.append({'team':team,'index':index,'from':row[:2],'oldFrom':old_starts[team][index],'oldLanding':old,'landing':list(p),'flight':flight,
                            'distance':round(distance,2),'horizontalSpeed':round(distance/flight,2),'rise':round(34*flight**2/8,2)})
            nav=definition['nav'];ident=len(nav['nodes']);near=sorted(range(ident),key=lambda i:math.dist(p,nav['nodes'][i][:2]))
            links=[i for i in near if abs(nav['nodes'][i][2]+2)<.1 and math.dist(p,nav['nodes'][i][:2])<65 and clear(p,nav['nodes'][i][:2])][:3]
            if not links:raise ValueError(f'基地台の着地先が歩行経路につながらない: {p}')
            nav['nodes'].append([*p,-2]);nav['links'].extend([[ident,i] for i in links])
    return {'baseFlights':flights,'baseRoutes':records}
