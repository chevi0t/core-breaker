#!/usr/bin/env python3
"""通常本体の環都を既存の半縮尺検査へ渡す。ルールを書き換えず読み口だけ追加。"""
import hashlib
import json
from pathlib import Path
import re
import runpy
import sys

ROOT = Path(__file__).resolve().parents[2]
output = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'dbg/kanto-registered')
output.mkdir(parents=True, exist_ok=True)
text = (ROOT / 'prototype/index.html').read_text()
sources = ['prototype/index.html', 'prototype/maps.js', 'prototype/sounds.js',
           'prototype/music.js', 'vendor/three-r128/three.min.js', 'tools/test/make_dbg.py']
for url, name in [('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', sources[4]),
                  ('maps.js', sources[1]), ('sounds.js', sources[2]), ('music.js', sources[3])]:
    before = '<script src="' + url + '"></script>'
    assert text.count(before) == 1, url
    script = re.sub(r'</script', r'<\\/script', (ROOT / name).read_text(), flags=re.I)
    text = text.replace(before, '<script>' + script + '</script>')
text = re.sub(r'<link[^>]+href="https://fonts\.googleapis\.com[^>]+>\n?', '', text)
expose = runpy.run_path(str(ROOT / sources[-1]), run_name='registered_kanto_inspection')['EXPOSE']
expose += '''
Object.defineProperties(window.__g,{
 city:{get:()=>cityMap},battle:{get:()=>cityBattle},frame:{get:()=>loop},
 chosenTeam:{get:()=>chosenTeam,set:v=>{chosenTeam=v;}},
 mouseDown:{get:()=>mouseDown,set:v=>{mouseDown=v;}},rightDown:{get:()=>rightDown,set:v=>{rightDown=v;}},
 selectedTeamSize:{get:()=>selectedTeamSize,set:v=>{selectedTeamSize=v;}},
 mapRoot:{get:()=>mapRoot},mapBounds:{get:()=>[MAP_X,MAP_Z]},
 GRAV:{get:()=>GRAV},CAT_LOCK:{get:()=>CAT_LOCK},UNIT_H:{get:()=>UNIT_H},R:{get:()=>R}
});
window.__cityBattle=window.__g;
selectMap('kanto');
'''
before = '\nrequestAnimationFrame(loop);\n'
assert text.count(before) == 1
text = text.replace(before, '\n' + expose + before)
(output / 'play.html').write_text(text)
(output / 'source-manifest.json').write_text(json.dumps({
    'purpose': '通常本体のコードと全マップを使用。読み口・初期マップ選択・素材埋込みのみ。',
    'sourceHashes': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in sources},
    'htmlSHA256': hashlib.sha256(text.encode()).hexdigest(),
}, ensure_ascii=False, indent=2) + '\n')
print('通常版の検査用HTML:', output / 'play.html')
