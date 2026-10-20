"""同seedの実記録からB–C帯の大破位置と時刻を比較する。射撃方向は推定しない。"""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Rectangle,Circle
from matplotlib.lines import Line2D
HERE=Path(__file__).resolve().parent
font='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
font_manager.fontManager.addfont(font)
plt.rcParams.update({'font.family':font_manager.FontProperties(fname=font).get_name(),'axes.unicode_minus':False})
colors={'B':'#1476b5','R':'#d36b22'}
inside=lambda p:-145<=p[0]<=110 and 0<=p[2]<=168
records=[json.loads((HERE/p).read_text()) for p in ['../v5/replay/recorded.json','replay/recorded.json']]
assert records[0]['matches'][0]['initialization']==records[1]['matches'][0]['initialization']
fig,axes=plt.subplots(2,2,figsize=(15,10),gridspec_kw={'height_ratios':[4,1]},facecolor='#f7f9fb')
fig.subplots_adjust(left=.07,right=.97,top=.87,bottom=.15,wspace=.22,hspace=.38)
fig.suptitle('B–C帯の大破地点｜同seed 1戦の実記録',x=.07,y=.975,ha='left',fontsize=22,weight='bold')
fig.text(.07,.93,'seed 20261410・通常編成・600秒。位置の分布と時刻を比較する。被弾位置や射撃方向は推定しない。',fontsize=11)
metrics=[]
for col,(version,data) in enumerate(zip(['v5：変更前','v6：斜め橋＋遮蔽'],records)):
    m=data['matches'][0];assert m['seed']==20261410
    ax=axes[0,col];ax.set_facecolor('#e9eeeb')
    for o in data['map']['obstacles']:
        ax.add_patch(Rectangle((168-o['maxZ'],o['minX']),o['maxZ']-o['minZ'],o['maxX']-o['minX'],facecolor='#a1abac',edgecolor='#657375',linewidth=.5,zorder=1))
    for x,z,w,d,h,t in data['map']['bridges']:
        ax.add_patch(Rectangle((168-z-d/2,x-w/2),d,w,facecolor='#e0c47d',edgecolor='none',alpha=.8,zorder=2))
    for p in data['map']['plants']:
        if p['id'] not in ['B','C']:continue
        x,y,z=p['pos'];ax.add_patch(Circle((168-z,x),16,facecolor='white',alpha=.75,edgecolor='#344c58',lw=1,zorder=3));ax.text(168-z,x,p['id'],ha='center',va='center',weight='bold',fontsize=12,zorder=4)
    events=[e for e in m['events'] if e['type']=='wreck' and inside(e['pos'])]
    seconds={'B':0,'R':0}
    for f,n in zip(m['frames'],m['frames'][1:]):
        for u,p in zip(m['units'],f['u']):
            if inside(p) and p[4]&1 and not p[4]&32:seconds[u['team']]+=n['t']-f['t']
    teams={}
    for team in ['B','R']:
        es=[e for e in events if e['team']==team]
        teams[team]={'wreckCount':len(es),'activeSeconds':seconds[team],'wrecksPerActiveMinute':len(es)*60/seconds[team]}
        for upper,marker in [(False,'o'),(True,'^')]:
            selected=[e for e in es if (e['pos'][1]>=5)==upper]
            ax.scatter([168-e['pos'][2] for e in selected],[e['pos'][0] for e in selected],marker=marker,s=34,color=colors[team],edgecolors='white',linewidths=.35,alpha=.7,zorder=6)
        axes[1,col].vlines([e['t'] for e in es],0 if team=='B' else 1,.7 if team=='B' else 1.7,color=colors[team],lw=1.1,alpha=.7)
    ax.set_xlim(-22,190);ax.set_ylim(-145,110);ax.set_aspect('equal');ax.set_title(version+f"\n大破 青{teams['B']['wreckCount']}／橙{teams['R']['wreckCount']}",fontsize=14)
    ax.set_xlabel('BからC方向への距離 [m]');ax.set_ylabel('横位置 x [m]');ax.grid(alpha=.2,zorder=0)
    t=axes[1,col];t.set_xlim(0,600);t.set_ylim(-.15,1.85);t.set_yticks([.35,1.35],['青','橙']);t.set_xlabel('試合開始からの時間 [秒]');t.set_title('同じ帯で大破した時刻（縦線1本＝1件）',fontsize=10);t.grid(axis='x',alpha=.2)
    metrics.append({'version':version,'teams':teams,'winner':m['winner'],'seed':m['seed']})
fig.legend(handles=[Line2D([],[],color=colors['B'],marker='o',ls='',label='青の大破'),Line2D([],[],color=colors['R'],marker='o',ls='',label='橙の大破'),Line2D([],[],color='#64747c',marker='^',ls='',label='△：高さ5m以上／○：5m未満'),Line2D([],[],color='#d4b668',lw=5,label='橋・上層床')],loc='lower left',bbox_to_anchor=(.07,.075),ncol=4,frameon=False)
fig.text(.07,.05,'対象帯：x=−145〜110m、z=0〜168m。生存・非転倒の延べ滞在：旧 青906.75秒／橙501秒、新 青1239.5秒／橙1188秒。',fontsize=10)
fig.text(.07,.023,'滞在量と戦線の位置も変わっている。近い地点・時刻の大破だけで同じ射線による集中攻撃や因果関係を断定しない。',fontsize=10,color='#586a73')
fig.savefig(HERE/'drawings/frontline-diagnostic.png',dpi=160)
fig.savefig(HERE/'drawings/frontline-diagnostic.pdf')
(HERE/'final/frontline-diagnostic.json').write_text(json.dumps({'scope':'同seed通常編成1戦のB–C帯','bounds':{'x':[-145,110],'z':[0,168]},'samplingSeconds':.25,'activeDefinition':'aliveフラグあり、downフラグなし。フレーム間隔で重み付けした延べ機体秒','rows':metrics,'limits':['大破位置は被弾位置や発射地点ではない。','滞在量・占拠・戦線の変化を伴う1戦で、遮蔽単独の効果や集中攻撃の原因を示さない。']},ensure_ascii=False,indent=2)+'\n')
print('B–C帯の大破位置・時刻・延べ滞在を実記録から出力')
