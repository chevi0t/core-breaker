"""南北高架下の店舗。通路を残す実体と、衝突を増やさない窓・看板の帯。"""
import math
import numpy as np
from build import clip
from simplify import extrusion,parts,rings,vertical_height

def footprints(decks,land,roads,bounds,clearance,settings):
    result={}
    for name in settings['lines']:
        raw=decks[name].buffer(clearance,join_style='mitre').intersection(bounds).intersection(land).difference(roads.buffer(settings['roadClearance']))
        result[name]=[p for p in parts(raw) if p.area>=settings['minimumArea']]
    return result

def build(footprints,specs,ground,settings,half):
    meshes=[];colors=[];volumes=[];cursor=0;stats=[]
    def append(mesh,color):
        nonlocal cursor
        if np.abs(mesh[:,[0,2]]).max()>half:mesh=clip(mesh.reshape(-1,3,3),half)
        if not len(mesh):return
        meshes.append(mesh);colors.append({'start':cursor,'count':len(mesh),'color':color});cursor+=len(mesh)
    def panel(a,b,lo,hi,color):
        if hi<=lo:return
        append(np.array([[a[0],lo,a[1]],[b[0],lo,b[1]],[b[0],hi,b[1]],[a[0],lo,a[1]],[b[0],hi,b[1]],[a[0],hi,a[1]]],dtype='<f4'),color)
    bottom=float(ground[:,1].min())-1
    for name,polygons in footprints.items():
        top=specs[name]['top']-specs[name]['thickness'];area=0
        for p in polygons:
            append(extrusion(p,bottom,top,False),'#9ba5a8')
            volumes.append({'rings':rings(p),'bottom':round(bottom,3),'top':top,'kind':'rail-shop','line':name})
            area+=p.area;point=p.representative_point();floor=vertical_height(ground,point.x,point.y)
            if floor is None:continue
            coords=np.array(p.exterior.coords);orientation=1 if p.exterior.is_ccw else -1
            for a,b in zip(coords,coords[1:]):
                direction=b-a;length=float(np.linalg.norm(direction))
                if length<3:continue
                direction/=length;offset=np.array([direction[1],-direction[0]])*orientation*.035
                start=a+offset;end=b+offset
                panel(start,end,floor+3.25,min(floor+4,top-.2),'#c8b993')
                count=max(1,math.ceil(length/settings['frontage']))
                for i in range(count):
                    x=start+direction*(length*i/count+.3);y=start+direction*(length*(i+1)/count-.3)
                    panel(x,y,floor+.7,min(floor+3,top-.4),'#456572' if i%2 else '#51656b')
        stats.append({'line':name,'blocks':len(polygons),'area':round(area,2),'top':top})
    mesh=np.concatenate(meshes) if meshes else np.empty((0,3),dtype='<f4')
    return mesh,colors,volumes,stats
