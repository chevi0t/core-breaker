"""層の分け方を絵に重ねて見る（色：紫＝後ろ髪、水色＝前髪、黄＝顔、緑＝左腕、橙＝右腕、青＝体。白線＝rig.json の多角形、赤線＝hairPoly）。

  python3 tools/pilot_overlay.py <キャラID> <出力.png>

rig.json を直すたびに見て、腕や腰に髪が入っていないか、髪が体や腕に入っていないかを確かめる。"""
import sys, json, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import numpy as np
from PIL import Image, ImageDraw
import pilot_layers as pl
c = pl.ROOT / 'prototype/avatars/pilots' / sys.argv[1]
R = json.loads((c/'layers/rig.json').read_text())
img = np.asarray(pl.load(c, 'normal')).astype(np.float32)/255
M = pl.split(img, R)
col = {'hairB':(255,0,255),'hairF':(0,255,255),'head':(255,255,0),'armL':(0,255,0),'armR':(255,128,0),'body':(60,60,255)}
base = img[..., :3]*img[..., 3:4]
o = base.copy()
for k, cc in col.items():
    m = M[k]; o[m] = o[m]*0.45 + np.array(cc)/255*0.55
im = Image.fromarray((o*255).astype(np.uint8)).resize((900, 900), Image.NEAREST)
d = ImageDraw.Draw(im)
for k in ('head','armL','armR','bodyHull','frontHair'):
    d.line([(x*900, y*900) for x, y in R[k]+[R[k][0]]], fill=(255,255,255), width=1)
for q in R.get('hairPoly', []) + R.get('hairPolyAll', []): d.line([(x*900, y*900) for x, y in q+[q[0]]], fill=(255,0,0), width=1)
im.save(sys.argv[2])
