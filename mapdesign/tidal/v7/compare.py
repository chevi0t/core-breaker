"""v6とv7の同条件12戦を照合して集計する。途中戦績は受け付けない。"""
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
FINAL=HERE/'final'
ROOT=HERE.parents[2]
read=lambda p:json.loads(p.read_text())
write=lambda p,d:p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
before=read(HERE/'../v6/final/battles.json')
after=[]
for label in ['main','high','multi']:
    batch=read(FINAL/f'battles-{label}.json')
    assert len(batch)==4,label
    after+=batch
assert len(before)==len(after)==12
for a,b in zip(before,after):
    assert a['map']==b['map'] and a['seed']==b['seed']
    assert a['initialization']==b['initialization'],(b['map'],b['seed'],'initialization')
    assert b['ended'] and b['seconds']==600 and not b['errors']
    for i,t in enumerate(['B','R']):
        assert abs(b['initialCore'][i]-b['coreExact'][i]-sum(b['losses'][t].values()))<1e-6

def summarize(matches):
    return {'wins':{t:sum(m['winner']==t for m in matches) for t in ['B','R','draw']},
            'losses':{t:{k:sum(m['losses'][t][k] for m in matches) for k in ['direct','wreck']} for t in ['B','R']}}
rows=[{'map':id,'before':summarize([m for m in before if m['map']==id]),'after':summarize([m for m in after if m['map']==id])} for id in ['tidal','tidal-v2','tidal-v3']]
recording=read(HERE/'replay/recorded.json');replay=recording['matches'][0];first=after[0]
for k,expected in [('initialization',first['initialization']),('winner',first['winner']),('seconds',first['seconds']),('kills',first['kills']),('finalCore',first['coreExact'])]:
    assert replay[k]==expected,k
manifest=read(FINAL/'manifest.json')
assert recording['mapSourceSha256']==manifest['sources']['prototype/maps/tidal.js']
assert recording['engineSha256']==manifest['sources']['prototype/index.html']
assert recording['debugMakerSha256']==manifest['sources']['tools/test/make_dbg.py']
for p,digest in manifest['sources'].items():assert hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==digest,p
write(FINAL/'battles.json',after)
write(FINAL/'comparison.json',{'baseline':'../../v6/final/battles.json','candidate':'battles.json','matchesPerVariant':4,'initializationMatchesAll12':True,'engineUnchangedFromV6':True,'replayMatchesMainSeed20261410':True,'rows':rows,'totalBefore':summarize(before),'totalAfter':summarize(after),'limits':['両区間のコンテナ追加と出撃余白のための倉庫2m移動をまとめて比較。区間ごとの因果効果は分離していない。','各4戦で公平さは未確定。実弾を遮れることと大破の減少を分ける。']})
for r in rows:print(r['map'],r['before']['wins'],'→',r['after']['wins'])
print('全12戦の初期編成・HP内訳・主配置リプレイ・ソースの照合OK')
