#!/usr/bin/env python3
"""都市データの欠損や範囲外参照を、maps.jsの生成前に拒否できるか確認する。"""
import copy
import importlib.util
import json
import pathlib
import subprocess
import tempfile

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('build_maps',ROOT/'tools/build_maps.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
script="global.window={};require(process.argv[1]);console.log(JSON.stringify(window.MAP_DATA.hoshimichi));"
definition=json.loads(subprocess.check_output(['node','-e',script,str(ROOT/'prototype/maps/hoshimichi.js')]))


def check(value):
    with tempfile.TemporaryDirectory() as tmp:
        path=pathlib.Path(tmp)/'hoshimichi.js'
        path.write_text('window.MAP_DATA={hoshimichi:'+json.dumps(value,ensure_ascii=False)+'};')
        result=subprocess.run(['node','-e',module.CHECK,json.dumps([['hoshimichi',str(path)]])],capture_output=True,text=True,check=True)
        return json.loads(result.stdout.strip().splitlines()[-1])


assert not check(definition),'正しい都市を拒否しない'
cases={
 '未対応形式':lambda d:d['cityTerrain'].update(geometryEncoding='unknown'),
 '基地の不一致':lambda d:d['bases']['B'].update(at=[0,0]),
 '再出撃先なし':lambda d:d['cityBattle']['respawns']['B'].update(A=[]),
 '座標の範囲外':lambda d:d['cityBattle']['baseSpawns']['B'].append([999,0]),
 '出典なし':lambda d:d.update(attribution=''),
 '体積の上下が逆':lambda d:d['cityTerrain']['volumes'][0].__setitem__(2,-999),
 '面の頂点参照が範囲外':lambda d:next(iter(d['cityTerrain']['surfaces'].values())).update(indices='////////'),
}
for name,mutate in cases.items():
    data=copy.deepcopy(definition);mutate(data)
    assert check(data),name+' を拒否する'
    print(name+'：拒否を確認')
print('正常データ1件・破損データ7件の検査完了')
