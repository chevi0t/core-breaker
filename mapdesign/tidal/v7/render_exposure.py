"""共通の地上標本へ見える固定視点の数が、何点分変わったかを描く。"""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.colors import ListedColormap,BoundaryNorm
from matplotlib.patches import Rectangle
HERE=Path(__file__).resolve().parent
font='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';font_manager.fontManager.addfont(font)
plt.rcParams.update({'font.family':font_manager.FontProperties(fname=font).get_name(),'axes.unicode_minus':False})
data=json.loads((HERE/'final/exposure-comparison.json').read_text());geo=json.loads((HERE/'drawings/geometry.json').read_text());m=geo['map']
cmap=ListedColormap(['#28794f','#67a880','#b1d1bd','#e0e5e5','#edd6b2','#d9a05a','#b76d2b']);norm=BoundaryNorm([i-.5 for i in range(-3,5)],7)
fig,axes=plt.subplots(1,3,figsize=(16,8),facecolor='#f7f9fb');fig.subplots_adjust(left=.06,right=.96,bottom=.23,top=.77,wspace=.22)
fig.suptitle('積みコンテナ追加前後｜地上の視認範囲',x=.06,y=.97,ha='left',fontsize=23,weight='bold')
fig.text(.06,.91,'変更前後とも立てる地上点を比較。各点へ見える固定3視点の数が、何点分変わったかを表示する。',fontsize=12)
fig.text(.06,.865,'緑：見える視点が減った　／　灰：同じ　／　橙：見える視点が増えた。高さのある橋上・展望台も視点に含む。',fontsize=11)
for ax,(zone,title,x0,x1,z0,z1) in zip(axes,[('AB','A–B間',-85,125,185,335),('CD','C–D間',-87,130,-125,-19),('DE','D–E間',-80,135,-335,-165)]):
 grouped={}
 for r in data['samples']:
  if r['zone']!=zone:continue
  x,y,z=r['pos'];grouped[(x,z)]=grouped.get((x,z),0)+int(r['after'])-int(r['before'])
 for (x,z),delta in grouped.items():ax.add_patch(Rectangle((x-4.7,z-4.7),9.4,9.4,facecolor=cmap(norm(delta)),edgecolor='none',zorder=1))
 for ob in geo['obstacles']:
  if ob.get('bottom',0)>4.1:continue
  ax.add_patch(Rectangle((ob['minX'],ob['minZ']),ob['maxX']-ob['minX'],ob['maxZ']-ob['minZ'],facecolor='#727f83',edgecolor='#4f6268',linewidth=.4,zorder=2))
 for name,x,z,w,d in m['generation']['approachCover']['clusters']:
  ax.add_patch(Rectangle((x-w/2,z-d/2),w,d,facecolor='#547e5b',edgecolor='#254f3b',linewidth=.8,zorder=3))
 row=next(r for r in data['rows'] if r['zone']==zone and r['view']=='3視点合計')
 ax.set_title(f"{title}\n視認：{row['beforePercent']:.1f}% → {row['afterPercent']:.1f}%",fontsize=14)
 ax.set_xlim(x0,x1);ax.set_ylim(z0,z1);ax.set_aspect('equal');ax.set_xlabel('横位置 x [m]');ax.set_ylabel('縦位置 z [m]');ax.grid(alpha=.15)
bar=fig.colorbar(plt.cm.ScalarMappable(cmap=cmap,norm=norm),ax=axes,location='bottom',fraction=.03,pad=.15,shrink=.55,ticks=list(range(-3,4)));bar.set_label('見える固定視点の数の差（追加後 − 追加前）',fontsize=10)
fig.text(.06,.085,'割合の分母は共通の点×3視点。立てない点は除外し、箱の内部を「隠れられる地上」として数えない。緑の実体は追加したコンテナ群。',fontsize=10)
fig.text(.06,.04,'固定視点による形状検査で、試合中の射撃頻度・被弾率・生存率ではない。視点ごとの件数と制約はexposure-comparison.jsonに保存。',fontsize=10,color='#556a73')
fig.savefig(HERE/'drawings/exposure-comparison.png',dpi=170);fig.savefig(HERE/'drawings/exposure-comparison.pdf')
