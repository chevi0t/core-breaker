#!/usr/bin/env python3
"""確認済み都市の形状・対戦配置を、通常のmaps.jsへ入るマップとして登録する。"""
import hashlib
import json
import pathlib
import subprocess

from hoshimichi_jump_pads import add_jump_pads, add_catapults
from hoshimichi_ground_passages import add_ground_passages, pack_navigation

ROOT=pathlib.Path(__file__).resolve().parents[1]


def main():
    source=ROOT/'mapdesign/hoshimichi/source'
    layout=json.loads((source/'layout.json').read_text())
    definition=json.loads((source/'definition.json').read_text())
    # 円形の基地判定はbasesを使う。旧形式の必須値も従来の大小関係へそろえる。
    definition.update(order=80,baseLine=220,cityTerrain=layout,
        attribution='地理データ：東京都・千代田区・台東区／国土交通省 Project PLATEAU（2025年度）、国土地理院、OpenStreetMap contributors。CC BY 4.0に基づき、街区・高架・川・ゲーム施設を加工。出典・謝辞：https://github.com/chevi0t/core-breaker/blob/main/mapdesign/hoshimichi/CREDITS.md')
    definition['cityBattle']['nodeReach']=1.5
    # 通常操作での最初の接地を検査し、建物の角へ触れずに降りられる街路へ向ける。
    definition['bases']['B']['catapults'][3][2:]=[218,152]
    mobility=add_jump_pads(definition)
    mobility.update(add_catapults(definition))
    passages=add_ground_passages(definition)
    navigation=pack_navigation(definition)
    # 描画側と同じ三角化で、加工後の面数も保存する。
    measure="""
const fs=require('node:fs'),T=require(process.argv[1]),s=fs.readFileSync(process.argv[2],'utf8');
const f=new Function(s.slice(s.indexOf('function expandCityLayout('),s.indexOf('// 肩越し視点'))+';return expandCityLayout;')();
const d=JSON.parse(fs.readFileSync(0,'utf8'));f(T,d);
console.log(JSON.stringify(Object.fromEntries(Object.entries(d.meshes).map(([k,v])=>[k,Buffer.from(v,'base64').length/36]))));
"""
    counts=json.loads(subprocess.check_output(['node','-e',measure,str(ROOT/'vendor/three-r128/three.min.js'),str(ROOT/'prototype/index.html')],input=json.dumps(layout).encode()))
    for name,count in counts.items():layout['packing']['layers'][name]={'triangles':count}
    raw=json.dumps(definition,ensure_ascii=False,separators=(',',':')).encode()
    if len(raw)>100_000:raise ValueError(f'街形状・対戦配置が100KBを超過: {len(raw)} B')
    header='// PLATEAU由来のゲーム用街区。元資料・加工・謝辞はmapdesign/hoshimichi/CREDITS.md。\n// tools/import_city_map.pyが確認済みの形状・配置から作る。\n'
    output=header+'(window.MAP_DATA = window.MAP_DATA || {}).hoshimichi = '+raw.decode()+';\n'
    if len(output.encode())>100_000:raise ValueError('コメント込みのマップJSが100KBを超過')
    (ROOT/'prototype/maps/hoshimichi.js').write_text(output)
    record={'sourceCommit':'5649404','sourceHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.glob('*.json')},
            'mapDataBytes':len(raw),'mapFileBytes':len(output.encode()),'mapSHA256':hashlib.sha256(output.encode()).hexdigest(),
            'plants':len(definition['plants']),'team':definition['team'],'time':definition['time'],'jumpPads':len(definition['jumpPads']),
            'adjustments':{'baseLine':220,'southEastCatapult4Landing':{'from':[230,116],'to':[218,152]}},'mobility':mobility,
            'groundPassages':passages,'navigation':navigation,'triangles':sum(counts.values())}
    (ROOT/'mapdesign/hoshimichi/import.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(record,ensure_ascii=False))


if __name__=='__main__':main()
