#!/usr/bin/env python3
"""採用済み500m版を通常の環都へ登録する。元の1km版は固定コミットから再生成可能。"""
import hashlib
import json
from pathlib import Path
import subprocess
from kanto_base_clearance import remove_north_sliver

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'mapdesign/kanto_half/map.json'
definition = json.loads(source.read_text())
assert definition['size'] == [250, 250] and len(definition['rooftopTurrets']) == 4
remove_north_sliver(definition['cityTerrain'])
definition['name'] = '環都駅前'
definition['desc'] = '500m四方の高層街区。実都市に対して8m級の機体比率で、屋上・街路・公園の5プラントを争う。AとEには別角度から守る屋上砲台。'
definition['cityTerrain']['district']['facadeScale'] = .5
raw = json.dumps(definition, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
assert len(raw.encode()) <= 100000
output = ROOT / 'prototype/maps/kanto.js'
output.write_text('// 梅田の採用済み半縮尺版。再生成: python tools/register_kanto_half.py\n'
                  '(window.MAP_DATA = window.MAP_DATA || {}).kanto = ' + raw + ';\n')
subprocess.run(['python3', str(ROOT / 'tools/build_maps.py')], check=True)
(ROOT / 'mapdesign/kanto_half/registration.json').write_text(json.dumps({
    'sourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'registeredMapSHA256': hashlib.sha256(output.read_bytes()).hexdigest(),
    'mapID': 'kanto', 'mapDataBytes': len(raw.encode()), 'extentMeters': [500, 500],
    'changesFromApprovedPreview': ['表示名・説明', '窓模様の縮尺を任意データとして指定'],
}, ensure_ascii=False, indent=2) + '\n')
print('通常マップkantoへ500m版を登録:', len(raw.encode()), 'B')
