#!/usr/bin/env python3
"""都市データの欠損や範囲外参照を、maps.jsの生成前に拒否できるか確認する。"""
import copy
import base64
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
 '長すぎる基地射出時間':lambda d:d['bases']['B'].update(catapultFlight=20),
 'XYZ経路の格子が不正':lambda d:d['nav'].update(step=.02),
 'XYZ経路の高さが欠損':lambda d:d['nav'].update(nodes='AAAAAA=='),
 '地上通路が配列以外':lambda d:d['cityTerrain']['district'].update(groundPassages={}),
 '地上通路の幅が不正':lambda d:d['cityTerrain']['district']['groundPassages'][0].update(width=0),
 '地上通路が範囲外':lambda d:d['cityTerrain']['district']['groundPassages'][0].update(to=[999,0]),
}
for name,mutate in cases.items():
    data=copy.deepcopy(definition);mutate(data)
    assert check(data),name+' を拒否する'
    print(name+'：拒否を確認')
print(f'正常データ1件・破損データ{len(cases)}件の検査完了')

script=script.replace('MAP_DATA.hoshimichi','MAP_DATA.kanto')
urban=json.loads(subprocess.check_output(['node','-e',script,str(ROOT/'prototype/maps/kanto.js')]))
assert not check(urban),'環都の都市データを拒否しない'
packed_cases={
 '未対応の輪郭格子':lambda d:d['cityTerrain'].update(ringCoordinateStep=.04),
 '未対応の経路格子':lambda d:d['nav'].update(step=.03),
 '途切れた経路座標':lambda d:d['nav'].update(nodes='AA=='),
 '範囲外の経路座標':lambda d:d['nav'].update(nodes=base64.b64encode(bytes([255,127,255,127])).decode()),
 '存在しない経路の参照':lambda d:d['nav'].update(links=base64.b64encode(bytes([255,255,254,255])).decode()),
 '存在しない射出元':lambda d:d['plantCatapults'][0].update(plant='Z'),
 '存在しない射出先':lambda d:d['plantCatapults'][0].update(targetPlant='Z'),
 '長すぎる飛行時間':lambda d:d['plantCatapults'][0].update(flight=20),
 '範囲外の到着位置':lambda d:d['plantCatapults'][0].update(exit=[999,0]),
 '射出先の形が不正':lambda d:d['plantCatapults'][0].update(exit=None),
 '公園の色が不正':lambda d:d['cityTerrain']['district']['lawns'][0].update(color='invalid'),
 '公園の輪郭が不正':lambda d:d['cityTerrain']['district']['lawns'][0].update(rings=[]),
}
for name,mutate in packed_cases.items():
    data=copy.deepcopy(urban);mutate(data)
    assert check(data),name+' を拒否する'
    print(name+'：拒否を確認')
print(f'環都正常データ1件・破損データ{len(packed_cases)}件の検査完了')

# 旧版にも適用できる任意項目のfixture。通常版へ統合された配置があればそのまま使う。
optional=copy.deepcopy(urban)
optional.setdefault('rooftopTurrets',[{'team':'B','plant':'A','at':[-106,40,24],'yaw':-3.059425}])
district=optional['cityTerrain']['district']
district.setdefault('facadeScale',.5)
district.setdefault('ferrisWheel',{'center':[110.375,43,-87.975],'radius':14,'roofY':27,
                                 'yaw':-.0822517,'color':'#bf3548','cabins':12,
                                 'supportHalfWidth':5,'supportHalfDepth':1.5})
assert not check(optional),'屋上砲台・観覧車・半縮尺の外壁を受理する'
defaults=copy.deepcopy(optional)
defaults['rooftopTurrets']=[]
for key in ['yaw','color','cabins','supportHalfWidth','supportHalfDepth']:
    defaults['cityTerrain']['district']['ferrisWheel'].pop(key,None)
assert not check(defaults),'空の砲台配列と観覧車の省略値を受理する'
missing=copy.deepcopy(optional);missing.pop('rooftopTurrets')
for key in ['ferrisWheel','facadeScale']:missing['cityTerrain']['district'].pop(key)
assert not check(missing),'追加項目の無い従来マップを受理する'
optional_cases={
 '屋上砲台が配列以外':lambda d:d.update(rooftopTurrets={}),
 '屋上砲台の要素なし':lambda d:d.update(rooftopTurrets=[None]),
 '屋上砲台の所属不正':lambda d:d['rooftopTurrets'][0].update(team='neutral'),
 '屋上砲台の参照先なし':lambda d:d['rooftopTurrets'][0].update(plant='Z'),
 '屋上砲台の高さなし':lambda d:d['rooftopTurrets'][0].update(at=[-106,40]),
 '屋上砲台の無限高度':lambda d:d['rooftopTurrets'][0].update(at=[-106,40,float('inf')]),
 '屋上砲台が範囲外':lambda d:d['rooftopTurrets'][0].update(at=[999,40,24]),
 '屋上砲台の向き不正':lambda d:d['rooftopTurrets'][0].update(yaw=float('nan')),
 '外壁の縮尺ゼロ':lambda d:d['cityTerrain']['district'].update(facadeScale=0),
 '外壁の縮尺無限':lambda d:d['cityTerrain']['district'].update(facadeScale=float('inf')),
 '観覧車の指定なし':lambda d:d['cityTerrain']['district'].update(ferrisWheel=None),
 '観覧車の中心高さなし':lambda d:d['cityTerrain']['district']['ferrisWheel'].update(center=[110,-88]),
 '観覧車の半径不正':lambda d:d['cityTerrain']['district']['ferrisWheel'].update(radius=-14),
 '観覧車の脚が上向き':lambda d:d['cityTerrain']['district']['ferrisWheel'].update(roofY=50),
 '観覧車の外周が範囲外':lambda d:d['cityTerrain']['district']['ferrisWheel'].update(center=[d['size'][0]-3,43,0]),
 '観覧車の向き不正':lambda d:d['cityTerrain']['district']['ferrisWheel'].update(yaw=float('nan')),
 '観覧車のキャビン過多':lambda d:d['cityTerrain']['district']['ferrisWheel'].update(cabins=10000),
 '観覧車の支持脚不正':lambda d:d['cityTerrain']['district']['ferrisWheel'].update(supportHalfWidth=-5),
 '観覧車の色不正':lambda d:d['cityTerrain']['district']['ferrisWheel'].update(color='red'),
}
for name,mutate in optional_cases.items():
    data=copy.deepcopy(optional);mutate(data)
    assert check(data),name+' を拒否する'
    print(name+'：拒否を確認')
print(f'追加項目の正常・省略・空配列3件、破損データ{len(optional_cases)}件の検査完了')
