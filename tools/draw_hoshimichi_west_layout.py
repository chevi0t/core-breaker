# 基地とプラントの配置案を実データから描く。ゲームの地形・施設は書き換えない。
import argparse,base64,hashlib,json,math,subprocess
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.patches import PathPatch,Rectangle
from matplotlib.path import Path as MPath
from matplotlib.collections import PolyCollection
font=FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
bold=FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc')
plt.rcParams.update({'font.family':font.get_name(),'svg.fonttype':'path','axes.unicode_minus':False})
ROOT=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser(description='星路西街区の基地・プラント配置案を図面へ出力する')
ap.add_argument('output',type=Path,help='PNG/PDFの出力先フォルダ')
ap.add_argument('--proposal',type=Path,default=ROOT/'mapdesign/hoshimichi_west/layout-proposal.json')
args=ap.parse_args()
proposal=json.loads(args.proposal.read_text())
assert hashlib.sha256((ROOT/'mapdesign/hoshimichi_west/layout.json').read_bytes()).hexdigest()==proposal['terrainSHA256'], '配置案と元地形の組み合わせを確認してください'
js="const fs=require('fs'),{decodeCityVolumes}=require(process.argv[1]);const d=JSON.parse(fs.readFileSync(process.argv[2]));d.volumes=decodeCityVolumes(d);process.stdout.write(JSON.stringify(d));"
d=json.loads(subprocess.check_output(['node','-e',js,str(ROOT/'tools/city_volume_codec.js'),str(ROOT/'mapdesign/hoshimichi_west/layout.json')]))
fig=plt.figure(figsize=(15.5,10.5),dpi=160,facecolor='#19262e')
ax=fig.add_axes([.025,.12,.95,.74]);ax.set_aspect('equal');ax.set_xlim(-505,505);ax.set_ylim(330,-330);ax.axis('off')
ax.add_patch(Rectangle((-450,-275),900,550,facecolor='#546166',edgecolor='#9eafb3',linewidth=1,zorder=0))
for name,color in [('bed','#35647a'),('water','#337e9d')]:
 m=d['surfaces'][name];p=np.frombuffer(base64.b64decode(m['points']),dtype='<i2').reshape(-1,3)*m['step'];ids=np.frombuffer(base64.b64decode(m['indices']),dtype='<u2').reshape(-1,3)
 ax.add_collection(PolyCollection(p[ids][:,:,[0,2]],facecolors=color,edgecolors='none',zorder=1))
palette=['#889da8','#a69f90','#aab0ae','#7f929a','#9d9181','#8b8785','#8c9da0','#a6a39b']
for kind,lo,hi,encoded,meta in sorted(d['volumes'],key=lambda q:q[2]):
 rings=[np.frombuffer(base64.b64decode(s),dtype='<i2').reshape(-1,2)*d['ringCoordinateStep'] for s in encoded]
 center=rings[0].mean(axis=0)
 color=meta.get('landmarkColor') or ('#7b94a0' if hi>50 else palette[abs(math.floor(center[0]*7+.5)+math.floor(center[1]*13+.5))%len(palette)])
 parts=[]
 area=lambda p:np.sum(p[:,0]*np.roll(p[:,1],-1)-np.roll(p[:,0],-1)*p[:,1])
 sign=area(rings[0])
 for i,r in enumerate(rings):
  if i and area(r)*sign>0:r=r[::-1]
  points=np.vstack((r,r[0]));codes=[MPath.MOVETO]+[MPath.LINETO]*(len(r)-1)+[MPath.CLOSEPOLY];parts.append(MPath(points,codes))
 ax.add_patch(PathPatch(MPath.make_compound_path(*parts),facecolor=color,edgecolor='#40505a',linewidth=.22,zorder=2))
# 進入範囲外を淡くし、背景の街が続くことを示す。
for x,z,w,h in [(-450,-275,900,100),(-450,175,900,100),(-450,-175,100,350),(350,-175,100,350)]:
 ax.add_patch(Rectangle((x,z),w,h,facecolor='#c9d6d6',alpha=.30,edgecolor='none',zorder=3))
yellow='#ffda67'
ax.add_patch(Rectangle((-350,-175),700,350,facecolor='none',edgecolor='#13242c',linewidth=4.5,zorder=5))
ax.add_patch(Rectangle((-350,-175),700,350,facecolor='none',edgecolor=yellow,linewidth=2.2,zorder=6))
# 寸法線は背景の外に置く。
arrow={'arrowstyle':'|-|','color':yellow,'linewidth':1.0,'shrinkA':0,'shrinkB':0}
ax.annotate('',(-350,-300),(350,-300),arrowprops=arrow,zorder=8)
ax.text(0,-307,'進入範囲 700 m',fontproperties=bold,fontsize=13,color=yellow,ha='center',va='bottom')
for x in [-350,350]:ax.plot([x,x],[-292,-175],color=yellow,linewidth=.55,alpha=.6,zorder=7)
ax.annotate('',(475,-175),(475,175),arrowprops=arrow,zorder=8)
for z in [-175,175]:ax.plot([350,482],[z,z],color=yellow,linewidth=.55,alpha=.6,zorder=7)
ax.text(487,0,'350 m',rotation=90,fontsize=12,color=yellow,va='center',ha='center')
# 北は枠の長辺に対して30度傾く。
x,z=-425,-275
ax.annotate('',(x+math.sin(math.pi/6)*43,z-math.cos(math.pi/6)*43),(x,z),arrowprops={'arrowstyle':'-|>','color':'#e1edf0','lw':1.8,'mutation_scale':18})
ax.text(x+25,z-42,'N',fontsize=13,color='#e1edf0',fontweight='bold',ha='center')
# 位置ラベルは線で実座標を指す。
placements={'新御茶ノ水駅':(-245,-36),'御茶ノ水駅':(-215,-220),'秋葉原駅':(185,135),'秋葉原UDX':(202,15)}
for q in d['preview']['labels']:
 x,z=q['at'];tx,tz=placements[q['text']]
 ax.scatter([x],[z],s=22,c='#f2f8f9',edgecolors='#16252d',linewidths=.8,zorder=10)
 ax.annotate(q['text'],(x,z),(tx,tz),fontproperties=bold,fontsize=11,color='#eff6f8',ha='center',va='center',bbox={'boxstyle':'round,pad=.45','fc':'#182a34','ec':'#88a2ae','lw':.65},arrowprops={'arrowstyle':'-','color':'#e3eff1','lw':.75},zorder=11)
# 床面の復元・局所整地は提案として重ね、元の地形データは変更しない。
for bridge in proposal['bridgeRepairs']:
 ax.add_collection(PolyCollection([bridge['ring']],facecolors='#b3d7d8',edgecolors='#d4f3f2',hatch='///',linewidths=.9,zorder=6))
for base in proposal['bases']:
 x0,z0,x1,z1=base['clear'];color='#51b8ff' if base['team']=='B' else '#ffad54'
 ax.add_patch(Rectangle((x0,z0),x1-x0,z1-z0,facecolor=color,edgecolor=color,alpha=.48,hatch='///',linewidth=1.5,zorder=6))
 x,z=base['at'];ax.scatter([x],[z],marker='*',s=340,color=color,edgecolor='#122632',linewidth=1,zorder=12)
 label='青基地' if base['team']=='B' else '橙基地';tx,tz=(-305,210) if base['team']=='B' else (305,-215)
 ax.annotate(label,(x,z),(tx,tz),fontproperties=bold,fontsize=16,color=color,ha='center',va='center',bbox={'boxstyle':'round,pad=.4','fc':'#122632','ec':color,'lw':1.1},arrowprops={'arrowstyle':'-','color':color,'lw':1.1},zorder=13)
for route in proposal['routes']:
 points=np.array(route['points']);color='#80e1df' if route['kind']=='alternative' else '#e7f4f8'
 ax.plot(points[:,0],points[:,1],color='#173441',lw=3.5,alpha=.85,zorder=7)
 ax.plot(points[:,0],points[:,1],color=color,lw=1.25,ls=(0,(4,4)),alpha=.92,zorder=8)
for plant in proposal['plants']:
 x,z=plant['at'];color={'B':'#66beff','R':'#ffb35e'}.get(plant['initialOwner'],'#e5edf2')
 if plant['id']=='C':color=yellow
 ax.add_patch(plt.Circle((x,z),plant['clearRadius'],facecolor='#415e6b',edgecolor='#a5bcc5',alpha=.9,hatch='///',linewidth=.5,zorder=8))
 ax.add_patch(plt.Circle((x,z),plant['radius'],facecolor=color,edgecolor='#142c36',alpha=.7,linewidth=1.8,zorder=9))
 ax.text(x,z,plant['id'],fontproperties=bold,fontsize=16,ha='center',va='center',color='#102631',zorder=14)

# 目盛り。100mは現実の200mに相当する。
ax.plot([-445,-345],[305,305],color='#e1edf0',lw=2.4)
for x in [-445,-395,-345]:ax.plot([x,x],[301,309],color='#e1edf0',lw=1)
ax.text(-395,319,'ゲーム内 100 m',fontproperties=font,fontsize=10,color='#e1edf0',ha='center')
ax.text(450,315,'背景を含む描画範囲 900 × 550 m',fontproperties=font,fontsize=11,color='#b8cbd2',ha='right')
fig.text(.055,.94,'秋葉原〜新御茶ノ水　基地・プラント配置案 01',fontproperties=bold,fontsize=21,color='#f0f6f8')
fig.text(.055,.90,'基地2つ・プラント5つ  ／  縮尺1/2・8m級機体  ／  初期所有：A＝青、E＝橙、B・C・D＝中立',fontproperties=font,fontsize=11.5,color='#b8cbd2')
fig.text(.055,.087,'黄色枠：進入境界　／　斜線：整地・橋の復元案　／　点線：整備後の地上経路概算',fontproperties=font,fontsize=12,color=yellow)
fig.text(.055,.05,'地形：国土交通省 Project PLATEAU・国土地理院の公開データを加工。街や道路の形は変形していません。',fontproperties=font,fontsize=9,color='#a6bbc4')
fig.text(.945,.05,'PR #55  /  配置案・実走前',fontsize=9,color='#a6bbc4',ha='right')
dist=proposal['routeEstimate']['centralBaseRouteMeters']
fig.text(.945,.875,f"中央Cまでの地上経路：青 約{dist['B']:.0f}m ／ 橙 約{dist['R']:.0f}m（整備を仮定した2m格子の概算）",fontproperties=font,fontsize=10,color='#c2d5dd',ha='right')
out=args.output
out.mkdir(parents=True,exist_ok=True)
fig.savefig(out/'akiba-west-layout-proposal.png',facecolor=fig.get_facecolor(),dpi=160)
fig.savefig(out/'akiba-west-layout-proposal.pdf',facecolor=fig.get_facecolor(),metadata={'Title':'秋葉原西街区・基地とプラントの配置案01','Subject':'PR #55: 2基地と5プラント。整備を想定した提案で、実走・対戦前' ,'Author':'Core Breaker'})
print(json.dumps({'png':str(out/'akiba-west-layout-proposal.png'),'pdf':str(out/'akiba-west-layout-proposal.pdf'),'volumes':len(d['volumes']),'pixelSize':[2480,1680]},ensure_ascii=False))
