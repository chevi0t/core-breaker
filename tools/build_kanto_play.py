#!/usr/bin/env python3
"""通常の本体と同じコード・素材を使い、環都駅前を選択済みにした確認用HTMLを作る。"""
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'prototype/index.html').read_text()
s='<base href="../../prototype/">\n'+s
s=s.replace('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js','../vendor/three-r128/three.min.js')
needle='requestAnimationFrame(loop);\n})();'
assert s.count(needle)==1
s=s.replace(needle,"selectMap('kanto');\n"+needle)
(ROOT/'mapdesign/kanto/play.html').write_text(s)
print('書き出し: mapdesign/kanto/play.html（通常本体・環都駅前を選択済み）')
