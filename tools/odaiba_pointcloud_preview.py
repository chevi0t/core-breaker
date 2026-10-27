#!/usr/bin/env python3
"""確認済みの地形データを、オフラインで開ける確認HTMLへまとめる。"""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(
    os.environ.get(
        "ODAIBA_POINTCLOUD_OUTPUT", str(ROOT / "mapdesign/sowan/pointcloud-third")
    )
)
TEMPLATES = ROOT / "mapdesign/sowan/pointcloud-third"
terrain = (OUT / "terrain.json").read_text()
if len(terrain.encode()) > 500000:
    raise ValueError("地形データが500KBを超えています")
if json.loads(terrain)["scale"] != 1 / 3:
    raise ValueError("ユーザーが選んだ1/3縮尺と違います")
page = (TEMPLATES / "viewer-template.html").read_text()
page = page.replace(
    "/*THREE_LIBRARY*/", (ROOT / "vendor/three-r128/three.min.js").read_text()
)
page = page.replace("/*TERRAIN_JSON*/", terrain)
page = page.replace("/*MECH_JSON*/", (TEMPLATES / "reference-mech.json").read_text())
surface = (TEMPLATES / "surface-render.js").read_text()
if len(terrain.encode()) + len(surface.encode()) > 500000:
    raise ValueError("地形と生成材質・交通描画の合計が500KBを超えています")
page = page.replace("/*SURFACE_RENDER*/", surface)
page = page.replace("/*SURFACE_RENDER_BYTES*/", str(len(surface.encode())))
(OUT / "preview.html").write_text(page)
print("地形:", len(terrain.encode()), "bytes / 確認HTML:", len(page.encode()), "bytes")
