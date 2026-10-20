#!/usr/bin/env python3
"""猫8匹のPNGをindex.htmlへ埋め込む。画像の画素は変更しない。"""
import base64
import pathlib
import re
import struct

ROOT = pathlib.Path(__file__).resolve().parents[1]
image = (ROOT / 'prototype/avatars/cats.png').read_bytes()
if image[:8] != b'\x89PNG\r\n\x1a\n':
    raise SystemExit('猫の画像がPNGではありません')
width, height = struct.unpack('>II', image[16:24])
if width != height * 2:
    raise SystemExit('4列×2行の画像は、横幅を高さの2倍にしてください')
page = ROOT / 'prototype/index.html'
source = page.read_text()
pattern = r'/\* PILOT_ATLAS_BEGIN \*/.*?/\* PILOT_ATLAS_END \*/'
if len(re.findall(pattern, source, re.S)) != 1:
    raise SystemExit('猫の画像の埋め込み場所が見つかりません')
data = base64.b64encode(image).decode('ascii')
source = re.sub(pattern, '/* PILOT_ATLAS_BEGIN */\n.catFace { background-image: url("data:image/png;base64,' + data + '"); }\n/* PILOT_ATLAS_END */', source, flags=re.S)
page.write_text(source)
print(f'猫8匹を埋め込み: {width}×{height}、{len(image):,}バイト')
