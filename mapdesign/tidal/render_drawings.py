"""本体から採取した形状で、全体平面図と切断位置つきの断面図を作る。"""
import json
import subprocess
import sys
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.colors import LinearSegmentedColormap, ListedColormap, Normalize
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle

ROOT = Path(__file__).resolve().parents[2]
VERSION = sys.argv[1] if len(sys.argv)>1 else 'v'+subprocess.check_output(
    ['node','-e',"global.window={};require('./prototype/maps/tidal.js');console.log(window.MAP_DATA.tidal.generation.version)"],cwd=ROOT,text=True).strip()
OUT = Path(__file__).resolve().parent / VERSION / 'drawings'
DATA = json.loads((OUT/'geometry.json').read_text())
M = DATA['map']
MX, MZ = M['size']
LENGTH = MZ*2
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
font_manager.fontManager.addfont(FONT)
plt.rcParams.update({'font.family':font_manager.FontProperties(fname=FONT).get_name(),
                     'font.size':11, 'axes.unicode_minus':False, 'svg.fonttype':'none',
                     'axes.edgecolor':'#81919d', 'text.color':'#243440',
                     'axes.labelcolor':'#435560', 'xtick.color':'#435560', 'ytick.color':'#435560'})
PAPER = '#f7f9fb'
BLUE, ORANGE = '#197bc0', '#cf702b'
CUTS = {'A':'#a34483','B':'#257e69','C':'#8458a3','D':'#267fa4','E':'#ba6841','F':'#686d2e','G':'#946031','H':'#ac345c','I':'#7b596e'}
SKINS = {'baseWall':'#7c95a7','hesco':'#b6a17c','office':'#91b2ca','barracks':'#799575','house':'#c59d84',
         'prefab':'#b1b997','container':'#5d907b','trailer':'#c1c5bb'}
EARTH = LinearSegmentedColormap.from_list('地表',[(0,'#b6c6c4'),(.214,'#dce5df'),(.5,'#d2c9af'),(1,'#baa07b')])

def p(x,z):
    return MZ-z,x

def base_axes(ax):
    ax.set_facecolor('#eef3f5')
    ax.grid(color='#cbd6dd',linewidth=.55,alpha=.8,zorder=0)
    ax.tick_params(labelsize=9)

def plan(subtitle=None):
    label=subtitle or M.get('subtitle','屈折前線')
    plant_end=DATA['plants'][-1]['id']
    fig,ax=plt.subplots(figsize=(18,9),facecolor=PAPER)
    fig.subplots_adjust(left=.065,right=.975,bottom=.23,top=.84)
    fig.suptitle('潮路搬送区｜全体平面図',x=.065,y=.972,ha='left',fontsize=25,weight='bold')
    fig.text(.065,.915,f'配置「{label}」   370 × 1,136 m   ／   左：青の常設基地 → 右：橙の野戦拠点',fontsize=13)
    base_axes(ax)
    # zの正方向を左へ回し、海側（+x）を上にする。地面は本体の2m格子サンプル。
    grid=np.asarray(DATA['grid'])
    ax.imshow(grid[::-1,:].T,origin='lower',extent=(0,LENGTH,-MX,MX),
              cmap=EARTH,norm=Normalize(-6,22),interpolation='nearest',zorder=1)
    for x,z,hx,hz,y in M.get('water',[]):
        xs=np.linspace(-MX,MX,grid.shape[1]);zs=np.linspace(-MZ,MZ,grid.shape[0])
        wet=(np.abs(xs[None,:]-x)<=hx)&(np.abs(zs[:,None]-z)<=hz)&(grid<y)
        layer=np.ma.masked_where(~wet,np.zeros_like(grid))
        ax.imshow(layer[::-1,:].T,origin='lower',extent=(0,LENGTH,-MX,MX),
                  cmap=ListedColormap(['#91bdd5']),interpolation='nearest',zorder=2)
    for b in M['layout']:
        x,z,w,depth,h,*skin=b;u,v=p(x,z)
        ax.add_patch(Rectangle((u-depth/2,v-w/2),depth,w,facecolor=SKINS.get(skin[0] if skin else '', '#79858a'),
                               edgecolor='#3f505b',linewidth=.65,zorder=3))
    for x,z,w,depth,h,thickness in M.get('bridges',[]):
        u,v=p(x,z)
        ax.add_patch(Rectangle((u-depth/2,v-w/2),depth,w,facecolor='#d9b96c',alpha=.65,
                               edgecolor='none' if depth<3 else '#916b26',linewidth=1.1,zorder=4))
    for sign,color in [(1,BLUE),(-1,ORANGE)]:
        boundary=MZ-sign*M['baseLine']
        ax.axvline(boundary,color=color,lw=1.2,ls='--',zorder=5)
        a,b=(0,boundary) if sign==1 else (boundary,LENGTH)
        ax.axvspan(a,b,color=color,alpha=.06,zorder=5)
        ax.text((a+b)/2,-MX-18,'青：常設基地' if sign==1 else '橙：野戦拠点',
                color=color,ha='center',va='top',fontsize=11,weight='bold')
    for cp in DATA['catapults']:
        ax.annotate('',xy=p(cp['to'][0],cp['to'][2]),xytext=p(cp['from'][0],cp['from'][2]),
                    arrowprops={'arrowstyle':'-|>','color':'#566879','lw':.7,'mutation_scale':7},zorder=6)
    for pod in DATA['pods']:
        ax.plot(*p(pod['pos'][0],pod['pos'][2]),marker='+',ms=6,mew=1.4,color='#2e9468',zorder=7)
    for turret in DATA['turrets']:
        ax.plot(*p(turret['pos'][0],turret['pos'][2]),marker='s',ms=3.5,color='#b45c2a',zorder=7)
    for radar in DATA['radars']:
        ax.plot(*p(radar['pos'][0],radar['pos'][2]),marker='^',ms=6,color='#8559ad',zorder=7)
    for core in DATA['cores']:
        u,v=p(core['pos'][0],core['pos'][2]);color=BLUE if core['team']=='B' else ORANGE
        ax.plot(u,v,marker='h',ms=15,color=color,mec='white',mew=1.5,zorder=9)
        ax.annotate('青コア' if core['team']=='B' else '橙コア',(u,v),xytext=(0,14),textcoords='offset points',
                    ha='center',color=color,fontsize=11,weight='bold',zorder=10,
                    bbox={'facecolor':PAPER,'alpha':.9,'edgecolor':'none','pad':1})
    for plant in DATA['plants']:
        u,v=p(plant['pos'][0],plant['pos'][2]);color={'B':BLUE,'R':ORANGE}.get(plant['owner'],'#263d49')
        ax.add_patch(plt.Circle((u,v),16,facecolor='white',edgecolor=color,alpha=.8,lw=1.2,zorder=8))
        ax.text(u,v,plant['id'],ha='center',va='center',fontsize=12,weight='bold',color=color,zorder=10)
    for i,j in enumerate(M['jumpPads'],1):
        u,v=p(j['at'][0],j['at'][1]);eu,ev=p(j['exit'][0],j['exit'][1])
        ax.scatter([u],[v],marker='^',s=46,c='#008c9a',edgecolors='white',linewidths=.5,zorder=10)
        ax.annotate('',(eu,ev),(u,v),arrowprops={'arrowstyle':'->','color':'#008c9a','lw':1},zorder=9)
        ax.annotate(f'J{i}',(u,v),xytext=(5,5),textcoords='offset points',fontsize=9,color='#006b76',weight='bold',zorder=11)
    for i,lift in enumerate(M['lifts'],1):
        u,v=p(lift['from'][0],lift['from'][1]);eu,ev=p(lift['to'][0],lift['to'][1])
        ax.plot([u,eu],[v,ev],color='#9c7108',lw=2,zorder=9)
        ax.scatter([u],[v],marker='s',s=33,c='#c69b2e',edgecolors='white',linewidths=.5,zorder=10)
        ax.annotate(f'L{i}',(u,v),xytext=(5,-12),textcoords='offset points',fontsize=9,color='#775800',weight='bold',zorder=11)
    for cut in DATA['cuts']:
        name,axis,fixed=cut['name'],cut['axis'],cut['fixed'];color=CUTS[name]
        if axis=='z':
            ax.plot([0,LENGTH],[fixed,fixed],color=color,ls=(0,(6,3,1,3)),lw=1.25,zorder=12)
            ends=[(-9,fixed,name),(LENGTH+9,fixed,name+'′')]
        else:
            u=MZ-fixed;ax.plot([u,u],[-MX,MX],color=color,ls=(0,(6,3,1,3)),lw=1.25,zorder=12)
            ends=[(u,-MX-9,name),(u,MX+9,name+'′')]
        for u,v,label in ends:
            ax.text(u,v,label,ha='center',va='center',color=color,fontsize=10,weight='bold',zorder=13,
                    bbox={'facecolor':'white','edgecolor':color,'boxstyle':'round,pad=.14'})
    def callout(text,at,to):
        ax.annotate(text,at,xytext=to,ha='center',fontsize=11,color='#304651',zorder=14,
                    bbox={'facecolor':PAPER,'edgecolor':'#c5d0d7','alpha':.96,'pad':3},
                    arrowprops={'arrowstyle':'-','color':'#657d88','lw':.8})
    callout(f'斜め高架：床{M["generation"]["deck"]}m' if M['generation']['version']>=6 else '高架：床上12m',p(M['generation']['west'],0),(470,-142))
    callout('倉庫屋根：10m',p(52,152),(355,125))
    callout('展望台：22m',p(72,0),(630,138))
    if M['generation']['version']>=4:
        callout('工場街：屋根・橋下・地上路',p(88,374),(205,166))
        callout('住宅地：路地・共同住宅の屋上',p(78,-371),(936,166))
    if M['generation']['version']>=5:
        route=[p(x,z) for x,z in [(-164,-350),(-164,-410),(-164,-480),(-100,-480),(-100,-518),(-108,-518),(-108,-506),(-52,-504)]]
        ax.plot(*zip(*route),color='#c42a59',lw=2.2,ls='--',zorder=15)
        callout('山岳侵入路：尾根14m → 側壁越え10m',p(-164,-458),(933,-211))
    if M['generation'].get('approachCover'):
        for name,x,z,w,depth in M['generation']['approachCover']['clusters']:
            u,v=p(x,z)
            ax.add_patch(Rectangle((u-depth/2,v-w/2),depth,w,facecolor='none',edgecolor='#267d53',linewidth=1.2,linestyle='--',zorder=16))
        callout('段積みコンテナ：A–B間',p(-36,276),(315,-203))
        callout('段積みコンテナ：C–E間',p(-56,-224),(785,-195))
    ax.text(850,165,'海側',color='#356982',fontsize=11,ha='center')
    ax.text(850,-166,'陸側',color='#5b6758',fontsize=11,ha='center')
    ax.set_xlim(-22,LENGTH+22);ax.set_ylim(-220,215);ax.set_aspect('equal')
    ax.set_xticks([0,200,400,600,800,1000,1136]);ax.set_yticks([-185,-100,0,100,185])
    ax.set_xlabel('青側のマップ端からの距離 [m]',labelpad=10);ax.set_ylabel('横位置 x [m]')
    handles=[Line2D([],[],marker='o',color='#263d49',ls='',mfc='white',label='プラント A〜'+plant_end),
             Line2D([],[],marker='h',color=BLUE,ls='',label='コア'),
             Line2D([],[],marker='+',color='#2e9468',ls='',label='補給ポッド'),
             Line2D([],[],marker='^',color='#8559ad',ls='',label='レーダー'),
             Line2D([],[],marker='s',color='#b45c2a',ls='',label='防衛砲台'),
             Line2D([],[],marker='^',color='#008c9a',ls='',label='J：ジャンプパッド'),
             Line2D([],[],marker='s',color='#c69b2e',ls='',label='L：リフト'),
             Line2D([],[],color='#916b26',lw=5,alpha=.6,label='上層の床・門の梁'),
             Line2D([],[],color=BLUE,ls='--',label='侵入警報の境界'),
             Line2D([],[],color=CUTS['A'],ls='-.',label=('A〜I' if len(DATA['cuts'])>7 else 'A〜G' if len(DATA['cuts'])>5 else 'A〜E')+'：断面の切断線')]
    fig.legend(handles=handles,loc='lower left',bbox_to_anchor=(.065,.095),ncol=5,frameon=False,fontsize=10,
               columnspacing=2.1,handletextpad=.7)
    pad_note='J1・J2：射出30m → 倉庫屋根10m　／　J3・J4：射出34m → 基地の荷役屋根10m'
    if M['generation']['version']>=4:pad_note+='　／　J5〜J7：街区の屋根10〜12mへ'
    fig.text(.065,.055,pad_note,fontsize=10)
    fig.text(.065,.024,'地形は3配置共通。プラントは「'+label+'」の初期状態。青を左に回転して表示。平面の縦横は同縮尺。',fontsize=10,color='#60727c')
    return fig

def color_of(ob):
    if 'bottom' in ob:return '#d4ac52'
    for b in M['layout']:
        x,z,w,depth,h,*skin=b
        if abs((ob['minX']+ob['maxX'])/2-x)<.01 and abs((ob['minZ']+ob['maxZ'])/2-z)<.01:
            return SKINS.get(skin[0] if skin else '', '#75858f')
    return '#8a99a2'

def profile(ax,cut,exaggeration):
    base_axes(ax)
    name,axis,fixed=cut['name'],cut['axis'],cut['fixed']
    points=np.asarray(cut['points']);t,ground=points[:,0],points[:,1]
    x=MZ-t if axis=='z' else t
    order=np.argsort(x);x,ground=x[order],ground[order]
    ax.fill_between(x,-9,ground,color='#c8c2ac',zorder=1)
    for ob in DATA['obstacles']:
        if axis=='z':
            if not ob['minX']<=fixed<=ob['maxX']:continue
            lo,hi=MZ-ob['maxZ'],MZ-ob['minZ']
        else:
            if not ob['minZ']<=fixed<=ob['maxZ']:continue
            lo,hi=ob['minX'],ob['maxX']
        if hi<x.min() or lo>x.max():continue
        floor=ob.get('bottom',float(np.min(ground[(x>=max(lo,x.min()))&(x<=min(hi,x.max()))])) if np.any((x>=lo)&(x<=hi)) else -9)
        ax.add_patch(Rectangle((lo,floor),hi-lo,ob['top']-floor,facecolor=color_of(ob),
                               edgecolor='#5b6569',linewidth=.7,zorder=3))
    ax.plot(x,ground,color='#6b7266',lw=1,zorder=4)
    ax.axhline(0,color='#82949d',lw=.65,ls='--',zorder=2)
    for wx,wz,hx,hz,level in M.get('water',[]):
        if axis=='x' and wz-hz<=fixed<=wz+hz:
            wet=(x>=wx-hx)&(x<=wx+hx)&(ground<level)
            ax.fill_between(x,ground,level,where=wet,color='#91bdd5',zorder=5)
    if axis=='z':
        for sign,color in [(1,BLUE),(-1,ORANGE)]:
            ax.axvline(MZ-sign*M['baseLine'],color=color,ls='--',lw=.85,zorder=5)
        ax.set_xlim(0,LENGTH);ax.set_xticks([0,200,400,600,800,1000,1136])
        ax.set_xlabel('青側端からの距離 [m]',fontsize=10)
    else:
        ax.set_xlim(-MX,MX);ax.set_xticks([-185,-100,0,100,185])
        ax.set_xlabel('横位置 x [m]　陸側 ← → 海側',fontsize=10)
    ax.set_ylim(-8,38);ax.set_yticks([0,10,20,30]);ax.set_ylabel('高さ [m]',fontsize=10)
    ax.set_aspect(exaggeration,adjustable='box')
    return ax

def sections():
    towns=len(DATA['cuts'])>5
    mountain=len(DATA['cuts'])>7
    fig=plt.figure(figsize=(18,18 if mountain else 15.6 if towns else 13.2),facecolor=PAPER)
    fig.suptitle('潮路搬送区｜縦断・横断図',x=.065,y=.973,ha='left',fontsize=25,weight='bold')
    fig.text(.065,.935,'切断位置は平面図の '+('A〜I' if mountain else 'A〜G' if towns else 'A〜E')+' に対応。高さは海抜0m基準。切断線上の地形・固定物を表示。',fontsize=12)
    gs=fig.add_gridspec(6 if mountain else 5 if towns else 4,2,left=.07,right=.975,top=.90,bottom=.10,hspace=.78,wspace=.18,
                        height_ratios=[2.7,2.7,1.8]+[1.8]*(3 if mountain else 2 if towns else 1))
    cuts={c['name']:c for c in DATA['cuts']}
    axes={}
    for row,key,title in [(0,'A',('A–A′　斜め高架を横切る縦断' if M['generation']['version']>=6 else 'A–A′　高架沿いの縦断')+'　x = −38m　｜　高さを4倍強調'),
                          (1,'B','B–B′　倉庫・展望台沿いの縦断　x = +58m　｜　高さを4倍強調')]:
        ax=profile(fig.add_subplot(gs[row,:]),cuts[key],4);axes[key]=ax
        ax.set_title(title,loc='left',color=CUTS[key],fontsize=13,pad=13,weight='bold')
    ax=profile(fig.add_subplot(gs[2,:]),cuts['C'],1);axes['C']=ax
    ax.set_title('C–C′　中央の横断　z = 0m　｜　縦横同縮尺',loc='left',color=CUTS['C'],fontsize=13,pad=12,weight='bold')
    if towns:
        for col,key,title in [(0,'F','F–F′　工場街　z = +383m'),(1,'G','G–G′　住宅地　z = −371m')]:
            ax=profile(fig.add_subplot(gs[3,col]),cuts[key],2);axes[key]=ax
            ax.set_title(title+'　｜　高さ2倍',loc='left',color=CUTS[key],fontsize=11,pad=12,weight='bold')
    for col,key,title in [(0,'D','D–D′　青の常設基地　z = +531.2m'),(1,'E','E–E′　橙の野戦拠点　z = −531.2m')]:
        ax=profile(fig.add_subplot(gs[4 if towns else 3,col]),cuts[key],2);axes[key]=ax
        ax.set_title(title+'　｜　高さ2倍',loc='left',color=CUTS[key],fontsize=11,pad=12,weight='bold')
    def label(key,text,xy,at):
        axes[key].annotate(text,xy,xytext=at,fontsize=10,ha='center',va='center',zorder=8,
                           bbox={'facecolor':PAPER,'edgecolor':'none','alpha':.95,'pad':2},
                           arrowprops={'arrowstyle':'-','color':'#667a84','lw':.8})
    label('A','門の梁 16.5m\n梁の下を通過',(MZ-444.8,16.5),(190,30))
    if M['generation']['version']>=6:
        label('A','斜め高架の上面 20m／下面 18.5m',(534,20),(555,34))
    else:
        label('A','高架の上面 12m\n板の下面 10.5m',(560,12),(555,28))
        label('A','高架下は地上通路',(700,0),(755,25))
    label('B','倉庫屋根 10m\n床下にも通路',(MZ-152,10),(360,28))
    label('B','展望台 22m',(MZ,22),(590,34))
    label('B','倉庫屋根 10m',(MZ+152,10),(800,28))
    if M['generation']['version']>=6:
        label('C','斜め高架 20m',(-18,20),(-50,34))
        label('C','地上の横断路',(-18,0),(-70,12))
    else:
        label('C','高架 12m',(-38,12),(-75,29))
        label('C','中央の障害物 13m',(-8,13),(18,33))
    label('C','展望台 22m',(72,22),(71,33))
    label('C','海面 −5.5m',(164,-5.5),(151,14))
    lift=M['lifts'][0];ax=axes['C'];a,b=lift['from'],lift['to']
    ax.annotate('',(b[0],b[2]),(a[0],a[2]),arrowprops={'arrowstyle':'<->','color':'#9c7108','lw':1.8},zorder=7)
    ax.text(110,25,'L1：0 → 22m',color='#866108',fontsize=10)
    # 各基地のパッドは、この横断線上にある。矢印は理論上の垂直射出高。
    for key,sign in [('D',1),('E',-1)]:
        ax=axes[key];jx=148*sign;exit_x=128*sign
        ax.annotate('',(jx,34),(jx,0),arrowprops={'arrowstyle':'->','color':'#008c9a','lw':1.5},zorder=7)
        ax.plot(exit_x,10,marker='D',ms=4,color='#008c9a',zorder=8)
        label(key,'荷役屋根 10m',(107*sign,10),(65*sign,23))
        ax.text(jx-9*sign,35,'J：34m',color='#006b76',fontsize=9,ha='right' if sign>0 else 'left')
    label('D','事務所・兵舎 12m',(-82,12),(-55,31))
    label('E','プレハブ 8m',(82,8),(50,31))
    if towns:
        label('B','工場屋根 10m',(MZ-294,10),(MZ-294,31))
        label('F','作業棟の屋根 12m',(-100,12),(-101,31))
        label('F','工場屋根 10m',(88,10),(82,30))
        label('G','共同住宅の屋上 10m',(-78,10),(-73,30))
        label('G','低層住宅',(80,6),(80,28))
    if mountain:
        ax=profile(fig.add_subplot(gs[5,0]),cuts['H'],2);axes['H']=ax
        ax.set_xlim(MZ+350,MZ+525)
        ax.set_title('H–H′　山の縦断　x = −164m　｜　高さ2倍',loc='left',color=CUTS['H'],fontsize=11,pad=12,weight='bold')
        ax.set_xticks([950,1000,1050,1090])
        label('H','尾根 14m',(MZ+458,14),(MZ+430,29))
        ax=profile(fig.add_subplot(gs[5,1]),cuts['I'],2);axes['I']=ax
        ax.set_title('I–I′　側壁越え　z = −480m　｜　高さ2倍',loc='left',color=CUTS['I'],fontsize=11,pad=12,weight='bold')
        label('I','山 14m',(-164,14),(-159,30))
        label('I','足場 10m／側壁 8m',(-115,10),(-79,30))
        label('I','内側の斜面',(-100,10),(-32,23))
    fig.text(.07,.052,'茶：地面　／　青灰・緑・砂色：固定建物と防壁　／　金：上層の板　／　青緑矢印：パッドの理論射出高　◇：着地先',fontsize=10)
    fig.text(.07,.024,'縦断は横方向に長いため高さを4倍、街区・基地の横断は2倍に強調。距離と高さはそれぞれの軸から読み取る。',fontsize=10,color='#60727c')
    return fig

def mountain_plan():
    fig,ax=plt.subplots(figsize=(10,10),facecolor=PAPER)
    fig.subplots_adjust(left=.10,right=.96,bottom=.10,top=.88)
    fig.suptitle('橙基地の山岳侵入路',x=.10,y=.97,ha='left',fontsize=22,weight='bold')
    fig.text(.10,.92,'徒歩で尾根へ → 防壁を越える → 基地内の斜面を下る',fontsize=12)
    base_axes(ax)
    grid=np.asarray(DATA['grid']);xs=np.linspace(-MX,MX,grid.shape[1]);zs=np.linspace(-MZ,MZ,grid.shape[0])
    ax.imshow(grid,origin='lower',extent=(-MX,MX,-MZ,MZ),cmap=EARTH,norm=Normalize(-6,22),zorder=1)
    cs=ax.contour(xs,zs,grid,levels=[2,6,10,14],colors='#8a7855',linewidths=.6,zorder=2)
    ax.clabel(cs,fontsize=8,fmt='%dm')
    for x,z,w,d,h,*skin in M['layout']:
        ax.add_patch(Rectangle((x-w/2,z-d/2),w,d,facecolor=SKINS.get(skin[0] if skin else '', '#79858a'),edgecolor='#3f505b',linewidth=.65,zorder=3))
    for x,z,w,d,h,t in M['bridges']:
        ax.add_patch(Rectangle((x-w/2,z-d/2),w,d,facecolor='#dfc477',alpha=.75,edgecolor='#916b26',linewidth=.9,zorder=4))
    route=[(-164,-350),(-164,-410),(-164,-480),(-100,-480),(-100,-518),(-108,-518),(-108,-506),(-52,-504)]
    ax.plot(*zip(*route),color='#c42a59',lw=2.4,ls='--',zorder=6)
    for a,b in zip(route,route[1:]):ax.annotate('',b,a,arrowprops={'arrowstyle':'-|>','color':'#c42a59','lw':1.5},zorder=7)
    for text,xy,at in [('尾根 14m',(-164,-434),(-158,-412)),('短い足場 10m',(-139,-480),(-126,-457)),('HESCO側壁 8m',(-115,-472),(-95,-442)),('内側の坂',(-100,-501),(-74,-516)),('既存の荷役屋根',(-126,-522),(-150,-530))]:
        ax.annotate(text,xy,xytext=at,fontsize=11,ha='center',zorder=8,bbox={'facecolor':PAPER,'edgecolor':'none','alpha':.94,'pad':3},arrowprops={'arrowstyle':'-','color':'#657d88','lw':.8})
    ax.set_xlim(-185,-50);ax.set_ylim(-540,-345);ax.set_aspect('equal')
    ax.set_xlabel('横位置 x [m]');ax.set_ylabel('縦位置 z [m]（上：住宅地側／下：橙基地奥）')
    fig.text(.10,.035,'桃色破線：侵入候補。両軍のプレイヤーとBotが同じ物理で通行できる。',fontsize=11)
    return fig

def main():
    figures=[plan(),sections()]
    names=['plan','sections']
    if M['generation']['version']>=5:figures.append(mountain_plan());names.append('mountain-plan')
    with PdfPages(OUT/'tidal-plan-sections.pdf') as pdf:
        for figure,name in zip(figures,names):
            figure.savefig(OUT/f'{name}.png',dpi=180,facecolor=PAPER)
            figure.savefig(OUT/f'{name}.svg',facecolor=PAPER)
            pdf.savefig(figure,facecolor=PAPER)
            plt.close(figure)
    original=DATA['plants']
    for key,variant in M.get('variants',{}).items():
        DATA['plants']=[{'id':pid,'pos':[x,0,z],'owner':owner} for pid,x,z,owner in variant['plants']]
        figure=plan(variant['name']);figure.savefig(OUT/f'plan-{key}.png',dpi=180,facecolor=PAPER);plt.close(figure)
    DATA['plants']=original
    print('出力:',OUT/'plan.png',OUT/'sections.png',OUT/'tidal-plan-sections.pdf')

if __name__=='__main__':main()
