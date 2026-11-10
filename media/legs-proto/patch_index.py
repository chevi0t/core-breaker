#!/usr/bin/env python3
"""脚の形の試作用に、index.html の写しへ差し込み口（window.__legProto）を入れる。ゲーム本体は変えない。

使い方（リポジトリの直下で）:
  python3 media/legs-proto/patch_index.py /tmp/legs/index.html
  python3 tools/test/make_dbg.py media/legs-proto/dbg --src /tmp/legs/index.html
  node media/legs-proto/cap.js        # quadA.png・quadB.png・revA.png・revB.png を書き出す（dbg/ は .gitignore 済みでなければコミットしない）
"""
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
s = (ROOT / "prototype" / "index.html").read_text(encoding="utf-8")
def swap(old, new):
    global s
    assert s.count(old) == 1, old
    s = s.replace(old, new)
# 1) 脚の箱を試作の形に置き換える（全部を腰の骨に付けるので、立ち姿だけ）
swap("  reworkMechParts(boxes,series,C);\n", "  reworkMechParts(boxes,series,C);\n  if(window.__legProto){boxes.legs=[];window.__legProto((geo,c)=>boxes.legs.push([0,1,0,C[c],0,0,0,0,0,'hip',{raw:geo}]),T);}\n")
# 2) 向きを付け終えた形状をそのまま使う
swap("const b = shape?.kind?.startsWith('nozzle')", "const b = shape?.raw ? shape.raw : shape?.kind?.startsWith('nozzle')")
# 3) 二脚の関節の六角を出さない
swap("if (bone.slot !== slot || !bone.joint ||", "if (bone.slot !== slot || !bone.joint || (window.__legProto && slot==='legs') ||")
pathlib.Path(sys.argv[1]).parent.mkdir(parents=True, exist_ok=True)
pathlib.Path(sys.argv[1]).write_text(s, encoding="utf-8")
print("書き出し:", sys.argv[1])
