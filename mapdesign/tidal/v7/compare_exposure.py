"""変更前後とも立てる地上点だけを使い、同じ固定視点からの視認を比較する。"""
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text())
a=read(HERE/'final/approach-before.json')['results'][0]['exposure']
b=read(HERE/'final/approach-after.json')['results'][0]['exposure']
key=lambda r:(r['zone'],r['view'],*r['pos'])
a={key(r):r for r in a};b={key(r):r for r in b}
samples=[]
for k in sorted(a.keys()&b.keys()):
 assert a[k]['from']==b[k]['from']
 samples.append({**b[k],'before':a[k]['visible'],'after':b[k]['visible']})
rows=[]
for zone in ['AB','CD','DE']:
 for view in [None,*sorted({r['view'] for r in samples if r['zone']==zone})]:
  xs=[r for r in samples if r['zone']==zone and (view is None or r['view']==view)]
  rows.append({'zone':zone,'view':view or '3視点合計','samples':len(xs),'visibleBefore':sum(r['before'] for r in xs),'visibleAfter':sum(r['after'] for r in xs),'beforePercent':100*sum(r['before'] for r in xs)/len(xs),'afterPercent':100*sum(r['after'] for r in xs)/len(xs)})
result={'method':'10m格子の地上点。変更前後とも本体の地形・障害物から立てる点だけを共通標本とする。同じ固定3視点、視点の高さも固定。','limits':['試合の滞在量や生存率ではない。視線と実弾の検査は別途実施。','追加された箱の中や、地形が変わる点を隠れた点として数えない。','倉庫の2m移動も含む比較。'],'rows':rows,'samples':samples}
(HERE/'final/exposure-comparison.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
for r in rows:
 if r['view']=='3視点合計':print(r['zone'],r['samples'],f"{r['beforePercent']:.1f}% → {r['afterPercent']:.1f}%")
