"""川底から街路へ戻れるスロープ。出口から既存道路までの通路も確保する。"""
import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points
from simplify import clip_footprint, extrusion, parts, projection, rings, vertical_height


def add_exits(meshes, volumes, land, river, bed):
    solid=[(v,Polygon(v['rings'][0],v['rings'][1:])) for v in volumes]
    building_kinds={'grounded','infill','upper','elevated'}
    bridges=projection(meshes['brid'],precision=.001)
    roads=projection(np.concatenate([meshes['tran'],meshes['streets'],meshes['plazas']]),precision=.001).intersection(land).buffer(-1.5)
    def ground(x,z):
        hs=[vertical_height(meshes[k],x,z) for k in ['dem','tran','streets','historicGround','plazas']]
        return max(h for h in hs if h is not None) if any(h is not None for h in hs) else None
    exits=[]
    for side in [-1,1]:
        candidates=[]
        for x in range(-274,275,2):
            section=river.intersection(LineString([(x,-300),(x,300)]))
            if section.is_empty:continue
            north,south=section.bounds[1],section.bounds[3]
            shore=north if side<0 else south
            start=shore-side*20;end=shore+side*4;width=8
            footprint=box(x-width/2,min(start,end),x+width/2,max(start,end))
            if not land.covers(Point(x,end).buffer(2)):continue
            top=ground(x,end)
            if top is None or top<=bed+1 or top-bed>12:continue
            if footprint.buffer(1).intersects(bridges):continue
            vicinity=box(x-30,end if side>0 else end-35,x+30,end+35 if side>0 else end)
            street=roads.intersection(vicinity)
            if street.is_empty:continue
            dest=nearest_points(Point(x,end),street)[1]
            path=LineString([(x,end),(dest.x,dest.y)])
            if path.length>35 or not land.buffer(.01).covers(path.buffer(1.4)):continue
            passage=path.buffer(width/2+1.4,cap_style='square').union(footprint.buffer(1.4,join_style='mitre'))
            if path.length<.01:passage=passage.union(Point(x,end).buffer(width/2+1.4))
            blocked=False;cleared=0
            for v,p in solid:
                if v['top']<=bed+.1 or v['bottom']>=top+4.6 or not passage.intersects(p):continue
                if v['kind'] not in building_kinds or v['top']>40:blocked=True;break
                cleared+=passage.intersection(p).area
            if blocked:continue
            heights=[ground(x+dx,end+side*dz) for dx in [-3,0,3] for dz in [0,2]]
            if any(h is None or abs(h-top)>.8 for h in heights):continue
            entry=dict(bank='north' if side<0 else 'south',start=[x,bed,start],end=[x,top,end],width=width,
                slope=(top-bed)/abs(end-start),street=[dest.x,ground(dest.x,dest.y),dest.y],clearedArea=round(cleared,2))
            candidates.append((entry,footprint,passage,path.length))
        chosen=[]
        for group,target in enumerate([-240,-80,80,240]):
            available=[v for v in candidates if all(abs(v[0]['start'][0]-e[0]['start'][0])>=65 for e in chosen)]
            if not available:raise ValueError(f'川の出口が不足: {side}, 候補x={[v[0]["start"][0] for v in candidates]}')
            entry,footprint,passage,length=min(available,key=lambda v:abs(v[0]['start'][0]-target)+v[0]['clearedArea']*.16+v[3])
            entry={**entry,'id':f'{"north" if side<0 else "south"}-{group+1}'}
            chosen.append((entry,footprint,passage,length))
        exits.extend(chosen)
    aprons=[]
    for entry,footprint,_,_ in exits:
        path=LineString([entry['end'][::2],entry['street'][::2]])
        aprons.append(path.buffer(entry['width']/2,cap_style='flat',join_style='mitre').difference(footprint))
    cut=shapely.union_all([*[p for _,p,_,_ in exits],*aprons])
    # 川へ戻るだけの袋小路にしないよう、岸から既存道路までの低層棟・充填棟を局所的に切る。
    new_volumes=[];bldg=[]
    for v,p in solid:
        if v['kind'] not in building_kinds:new_volumes.append(v);continue
        masks=[a for e,_,a,_ in exits if v['top']>bed+.1 and v['bottom']<e['end'][1]+4.6]
        access=shapely.union_all(masks)
        for piece in parts(p.difference(access)):
            if piece.area<.01:continue
            new_volumes.append({**v,'rings':rings(piece)})
            bldg.append(extrusion(piece,v['bottom'],v['top'],v['kind'] not in {'grounded','infill'}))
    volumes[:]=new_volumes;meshes['bldg']=np.concatenate(bldg)
    for k in ['dem','tran','streets','historicGround','plazas']:meshes[k]=clip_footprint(meshes[k],box(-300,-300,300,300).difference(cut))
    ramps=[];marks=[];apron_meshes=[]
    for entry,footprint,_,_ in exits:
        x,y,z=entry['start'];ex,ey,ez=entry['end']
        a=extrusion(footprint,bed-.5,ey).copy()
        top=np.isclose(a[:,1],ey);a[top,1]=bed+(a[top,2]-z)/(ez-z)*(ey-bed)
        ramps.append(a)
        direction=np.sign(ez-z)
        for fraction in [.35,.65,.9]:
            center=z+(ez-z)*fraction
            for px,pz in [(x,center+direction*1.5),(x-1.1,center-direction*.9),(x+1.1,center-direction*.9)]:
                marks.append([px,bed+(pz-z)/(ez-z)*(ey-bed)+.04,pz])
    meshes['ramps']=np.concatenate(ramps)
    meshes['exitMarks']=np.array(marks,dtype='<f4')
    for (entry,_,_,_),apron in zip(exits,aprons):
        start=np.array(entry['end']);end=np.array(entry['street']);delta=end[[0,2]]-start[[0,2]];length2=np.dot(delta,delta)
        if length2<.01:continue
        for p in parts(apron):
            maximum=max(start[1],end[1])+1
            a=extrusion(p,bed-.5,maximum);top=np.isclose(a[:,1],maximum)
            t=np.clip((a[top][:,[0,2]]-start[[0,2]])@delta/length2,0,1)
            a[top,1]=start[1]+t*(end[1]-start[1]);apron_meshes.append(a)
    meshes['aprons']=np.concatenate(apron_meshes)
    return [entry for entry,_,_,_ in exits],cut
