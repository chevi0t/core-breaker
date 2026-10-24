#!/usr/bin/env python3
"""prototype/maps/<id>.js（1ファイルに1マップ）を prototype/maps.js にまとめる（ゲームはこのファイルを読む）。

使い方: python3 tools/build_maps.py
- 各ファイルは `(window.MAP_DATA = window.MAP_DATA || {}).<id> = { ... };` の形（<id> はファイル名と同じ）。
  書き方と項目は prototype/maps/README.md。
- node があれば、まとめる前に各ファイルを読み込んで、必須の項目・形・プラントIDのつながり・座標の範囲を確かめる。
  問題があれば maps.js を書かずに止まる。
- maps.js は生成物なので手で編集しない。tools/build_zip.py はこれを呼ばない（配布には公開中の maps.js を使う）。
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys
import argparse

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "prototype" / "maps"
OUT = ROOT / "prototype" / "maps.js"

# node で読み込んで確かめる（必須の項目は index.html の MAP_KEYS と同じ。任意の項目 subtitle・variants・nav・bridges・water・建物の種類も確かめる）
CHECK = "const {decodeCityVolumes}=require("+json.dumps(str(ROOT/"tools/city_volume_codec.js"))+");\n"+r"""
const fs = require('fs');
global.window = {};
const files = JSON.parse(process.argv[1]), errs = [];
const num = v => typeof v === 'number' && isFinite(v);
const KINDS = ['house', 'wall', 'tower', 'baseWall', 'container', 'trailer', 'barracks', 'office', 'hesco', 'prefab'];
// 1つのマップ（配置違いは元のマップに上書きした物）を確かめ、問題の一覧を返す
function check(d) {
  const out = [], E = m => out.push(m);
  const keys = ['name', 'size', 'team', 'time', 'baseZ', 'baseLine', 'desc', 'terrain', 'layout', 'plants', 'turrets', 'radar', 'catapults', 'basePods', 'plantPods', 'barricades'];
  const miss = keys.filter(k => d[k] === undefined);
  if (miss.length) { E('項目が足りない：' + miss.join('、')); return out; }
  const [mx, mz] = d.size;
  if (!num(mx) || !num(mz)) E('size は [x の半分, z の半分]');
  if (!Number.isInteger(d.team) || d.team < 1 || d.team > 10) E('team は1〜10');
  if (!num(d.time) || d.time <= 0) E('time は秒');
  if (!(d.baseLine < d.baseZ && d.baseZ < mz)) E('baseLine < baseZ < size[1] にする');
  const inMap = (x, z, what) => { if (!num(x) || !num(z) || Math.abs(x) > mx - 2 || Math.abs(z) > mz - 2) E(`${what} (${x}, ${z}) がマップの外`); };
  const ids = d.plants.map(p => p[0]);
  if (new Set(ids).size !== ids.length) E('プラントIDが重複');
  for (const [pid, x, z, own] of d.plants) { inMap(x, z, 'プラント' + pid); if (![null, 'B', 'R'].includes(own)) E(`プラント${pid} の最初の持ち主は 'B'・'R'・null`); }
  for (const [pid, x, z] of d.plantPods) { if (!ids.includes(pid)) E(`plantPods のプラント ${pid} が無い`); inMap(x, z, 'ポッド'); }
  for (const c of d.catapults) { inMap(c[0], c[1], 'カタパルト'); inMap(c[2], c[3], 'カタパルトの着地点'); if (c[4] && !ids.includes(c[4])) E(`カタパルトのプラント ${c[4]} が無い`); }
  if(d.plantCatapults!==undefined){
    if(!Array.isArray(d.plantCatapults))E('plantCatapults は配列');
    else for(const c of d.plantCatapults){
      if(!c||!ids.includes(c.plant)||!ids.includes(c.targetPlant)||c.plant===c.targetPlant)E('plantCatapults の出発・到着プラントが不正');
      for(const key of ['at','exit'])if(!Array.isArray(c?.[key])||c[key].length!==2||!c[key].every(num))E('plantCatapults.'+key+' は [x,z]');else inMap(...c[key],'プラント間カタパルト');
      if(!num(c?.flight)||c.flight<2.8||c.flight>8)E('plantCatapults.flight は2.8〜8秒');
    }
  }
  for (const [x,z] of [...d.turrets,...d.basePods,d.radar]) {
    if(d.bases)for(const team of ['B','R']){
      const s=team==='B'?1:-1,p=d.bases[team]?.at;
      if(p)inMap(p[0]+x*s,p[1]+(z-d.baseZ)*s,'ベースの施設');
    }else inMap(x,z,'ベースの施設');
  }
  for (const b of d.barricades) { inMap(b[0], b[1], '障害物'); if (b.length !== 5 || !b.every(num)) E(`バリケード [${b}] は [x, z, 幅, 奥行き, 高さ]`); }
  // 建物：6番目の要素（任意）は種類
  for (const b of d.layout) {
    inMap(b[0], b[1], '障害物');
    if (!(b.length === 5 || b.length === 6) || !b.slice(0, 5).every(num)) E(`障害物 [${b}] は [x, z, 幅, 奥行き, 高さ] か、6番目に種類`);
    else if (b.length === 6 && !KINDS.includes(b[5])) E(`障害物 [${b}] の種類 ${b[5]} はエンジンに無い（使えるのは ${KINDS.join('・')}）`);
  }
  const types = ['mesa', 'block', 'ramp', 'hill', 'trench'];
  for (const f of d.terrain) if (!types.includes(f.type)) E(`地形の種類 ${f.type} はエンジンに無い（使えるのは ${types.join('・')}）`);
  for (const f of d.terrain) if (f.keepBaseHeight !== undefined) {
    if (typeof f.keepBaseHeight !== 'boolean') E('keepBaseHeight は真偽値');
    if (f.keepBaseHeight && (!num(f.h) || f.h <= 0)) E('keepBaseHeight は正の高さの地形にだけ指定する');
  }
  // 任意の項目
  if (d.asym !== undefined && typeof d.asym !== 'boolean') E('asym は true か false');
  if (d.batchBuildings !== undefined && typeof d.batchBuildings !== 'boolean') E('batchBuildings は true か false');
  if (d.roadsFollowTerrain !== undefined && typeof d.roadsFollowTerrain !== 'boolean') E('roadsFollowTerrain は真偽値');
  if(d.bases!==undefined){
    for(const team of ['B','R']){
      const b=d.bases?.[team];
      if(!b||!Array.isArray(b.at)||b.at.length!==2||!b.at.every(num)){E('bases.'+team+'.at は [x,z]');continue;}
      inMap(...b.at,'基地');
      if(!num(b.radius)||b.radius<=0)E('基地の radius は正の数');
      if(b.catapultFlight!==undefined&&(!num(b.catapultFlight)||b.catapultFlight<2.8||b.catapultFlight>8))E('基地のcatapultFlightは2.8〜8秒');
      for(const c of b.catapults||[]){
        if(!Array.isArray(c)||c.length!==4||!c.every(num)){E('基地のcatapultsは [x,z,着地点x,着地点z]');continue;}
        inMap(c[0],c[1],'基地の射出台');inMap(c[2],c[3],'基地の射出台の着地点');
      }
    }
  }
  if (d.roads !== undefined) {
    if (!Array.isArray(d.roads)) E('roads は [x,z,幅,奥行き] の配列');
    else for (const r of d.roads) {
      if (!Array.isArray(r) || ![4,5].includes(r.length) || !r.every(num) || r[2]<=0 || r[3]<=0) E('道路は [x,z,正の幅,正の奥行き,任意の高さ]');
      else inMap(r[0],r[1],'道路');
    }
  }
  if (d.cityTerrain !== undefined) {
    const c=d.cityTerrain,battle=d.cityBattle;
    if(!c||c.geometryEncoding!=='city-layout-v1')E('cityTerrain は city-layout-v1 の都市データ');
    else {
      if(c.half!==mx||c.half!==mz)E('都市のhalfとマップの縦横サイズをそろえる');
      if(c.playBounds!==undefined){
        const b=c.playBounds,ext=c.halfExtents||[c.half,c.half];
        if(!Array.isArray(b)||b.length!==4||!b.every(num)||b[1]-b[0]<16||b[3]-b[2]<16||
          !Array.isArray(ext)||ext.length!==2||!ext.every(v=>num(v)&&v>0&&v<=c.half)||
          b[0]<-ext[0]||b[1]>ext[0]||b[2]<-ext[1]||b[3]>ext[1])E('都市の進入範囲と描画範囲が不正');
      }
      if(c.ringCoordinateStep!==undefined&&![.01,.02].includes(c.ringCoordinateStep))E('都市の輪郭格子は1cmか2cm');
      if(!num(c.groundMaximum)||!num(c.river?.bed)||!num(c.river?.water)||c.river.bed>=c.river.water)E('都市の地面上限・川底・水面の高さが不正');
      const ring=(r,what)=>{
        if(typeof r!=='string'){E(what+' はbase64の座標列');return;}
        const bytes=Buffer.from(r,'base64');
        if(bytes.length<12||bytes.length%4)E(what+' は3頂点以上のint16のXZ座標');
      };
      if(c.district?.lawns!==undefined){
        if(!Array.isArray(c.district.lawns))E('都市のlawnsは配列');
        else for(const lawn of c.district.lawns){
          if(!lawn||!/^#[0-9a-f]{6}$/i.test(lawn.color)||!Array.isArray(lawn.rings)||!lawn.rings.length)E('芝生の色・輪郭が不正');
          else for(const r of lawn.rings)ring(r,'芝生の輪郭');
        }
      }
      if(c.district?.groundPassages!==undefined){
        if(!Array.isArray(c.district.groundPassages))E('都市のgroundPassagesは配列');
        else for(const road of c.district.groundPassages){
          for(const key of ['from','to']){
            if(!Array.isArray(road?.[key])||road[key].length!==2||!road[key].every(num))E('地上通路の端は [x,z]');
            else inMap(...road[key],'地上通路');
          }
          if(!num(road?.width)||road.width<4||road.width>30)E('地上通路の幅は4〜30m');
        }
      }
      if(c.district?.facadeScale!==undefined&&(!num(c.district.facadeScale)||c.district.facadeScale<=0))E('都市のfacadeScaleは正の数');
      if(c.district?.ferrisWheel!==undefined){
        const w=c.district.ferrisWheel;
        if(!w||typeof w!=='object'||Array.isArray(w))E('都市のferrisWheelは観覧車の寸法');
        else {
          const center=Array.isArray(w.center)&&w.center.length===3&&w.center.every(num);
          if(!center)E('観覧車のcenterは有限数の [x,y,z]');
          else inMap(w.center[0],w.center[2],'観覧車の中心');
          if(!num(w.radius)||w.radius<=0)E('観覧車のradiusは正の数');
          if(!num(w.roofY)||(center&&w.roofY>=w.center[1]))E('観覧車のroofYは中心より低い高さ');
          if(w.yaw!==undefined&&!num(w.yaw))E('観覧車のyawは有限数');
          if(w.color!==undefined&&(typeof w.color!=='string'||!/^#[0-9a-f]{6}$/i.test(w.color)))E('観覧車の色は #RRGGBB');
          if(w.cabins!==undefined&&(!Number.isInteger(w.cabins)||w.cabins<4||w.cabins>24))E('観覧車のcabinsは4〜24の整数');
          for(const key of ['supportHalfWidth','supportHalfDepth'])if(w[key]!==undefined&&(!num(w[key])||w[key]<=0))E('観覧車の'+key+'は正の数');
          if(center&&num(w.radius)&&w.radius>0&&num(w.yaw??0)){
            // 輪・キャビン・脚の平面範囲。既定の支持脚寸法は描画処理と同じ。
            const yaw=w.yaw??0,halfX=Math.max(w.radius+.6,w.supportHalfWidth??5),halfZ=Math.max(1.7,w.supportHalfDepth??1.5);
            const dx=Math.abs(Math.cos(yaw))*halfX+Math.abs(Math.sin(yaw))*halfZ;
            const dz=Math.abs(Math.sin(yaw))*halfX+Math.abs(Math.cos(yaw))*halfZ;
            inMap(w.center[0]-dx,w.center[2]-dz,'観覧車の外周');
            inMap(w.center[0]+dx,w.center[2]+dz,'観覧車の外周');
          }
        }
      }
      if(!Array.isArray(c.volumeKinds)||!c.volumeKinds.length)E('都市のvolumeKindsが必要');
      let rows=c.volumes;
      if(typeof rows==='string'){
        try{rows=decodeCityVolumes(c);}catch(e){E('都市の整数列：'+e.message);rows=[];}
      }
      if(!Array.isArray(rows)||!rows.length)E('都市のvolumesが必要');
      else for(const v of rows){
        if(!Array.isArray(v)||v.length!==5||!Number.isInteger(v[0])||!c.volumeKinds?.[v[0]]||!num(v[1])||!num(v[2])||v[1]>=v[2]||!Array.isArray(v[3])||!v[3].length){E('都市の体積は [種類番号, 底, 上面, 輪郭列, 属性]');continue;}
        for(const r of v[3])ring(r,'都市の体積輪郭');
      }
      if(!c.surfaces||typeof c.surfaces!=='object')E('都市のsurfacesが必要');
      else for(const [name,s] of Object.entries(c.surfaces)){
        if(!s||typeof s.points!=='string'||typeof s.indices!=='string'||![.01,.02].includes(s.step)){E('都市の面 '+name+' の座標形式が不正');continue;}
        const p=Buffer.from(s.points,'base64'),ids=Buffer.from(s.indices,'base64');
        if(p.length%6||ids.length%6){E('都市の面 '+name+' の頂点・三角形が不正');continue;}
        for(let i=0;i<ids.length;i+=2)if(ids.readUInt16LE(i)>=p.length/6){E('都市の面 '+name+' が存在しない頂点を参照');break;}
      }
      if(!d.bases||!Array.isArray(c.district?.bases)||c.district.bases.length!==2)E('都市の両基地が必要');
      else for(const team of ['B','R']){
        const base=c.district.bases.find(b=>b.team===team);
        if(!base||!num(base.height)||JSON.stringify(base.at)!==JSON.stringify(d.bases[team]?.at))E('都市の地形と対戦配置の基地が不一致：'+team);
      }
      if(!Array.isArray(c.decorations))E('都市のdecorationsが必要');
      else for(const decoration of c.decorations){
        if(!num(decoration.height)||typeof decoration.color!=='string'||!Array.isArray(decoration.rings))E('都市の線路装飾が不正');
        else for(const r of decoration.rings)ring(r,'都市の装飾輪郭');
      }
    }
    if(!battle||!num(battle.nodeReach)||battle.nodeReach<.25||battle.nodeReach>5)E('cityBattle.nodeReach は0.25〜5m');
    for(const team of ['B','R']){
      const slots=battle?.baseSpawns?.[team];
      if(!Array.isArray(slots)||!slots.length)E('都市の基地再出撃点が必要：'+team);
      for(const [name,list] of [['base',slots],...ids.map(id=>[id,battle?.respawns?.[team]?.[id]])]){
        if(!Array.isArray(list)||!list.length){E('都市の再出撃点が必要：'+team+'/'+name);continue;}
        for(const p of list)if(!Array.isArray(p)||p.length!==2||!p.every(num))E('都市の再出撃点は [x,z]');else inMap(...p,'都市の再出撃点');
      }
    }
    if(typeof d.attribution!=='string'||!d.attribution.trim())E('都市データの出典・ライセンスをattributionへ記載する');
  } else if(d.cityBattle!==undefined)E('cityBattleにはcityTerrainが必要');
  if (d.subtitle !== undefined && typeof d.subtitle !== 'string') E('subtitle は文字列');
  if (d.baseDefense !== undefined) {
    const cfg=d.baseDefense;
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) E('baseDefense はオブジェクト');
    else {
      for (const key of ['posts','gates']) {
        if (!Array.isArray(cfg[key]) || cfg[key].length<2) E(`baseDefense.${key} は2地点以上の配列`);
        else for (const p of cfg[key]) {
          if (!Array.isArray(p) || p.length!==2 || !p.every(num)) E(`baseDefense.${key} は [x,z]`);
          else {inMap(p[0],p[1],`baseDefense.${key}`);if(p[1]<d.baseLine)E(`baseDefense.${key} は自軍ベース内`);}
        }
      }
      for (const key of ['leash','responseRadius']) if(!num(cfg[key]) || cfg[key]<=0)E(`baseDefense.${key} は正の数`);
      for (const key of ['alertRadius','gateDepth']) if(cfg[key]!==undefined&&(!num(cfg[key])||cfg[key]<=0))E(`baseDefense.${key} は正の数`);
      if(cfg.yard!==undefined&&(!Array.isArray(cfg.yard)||cfg.yard.length!==4||!cfg.yard.every(num)||cfg.yard[2]<=0||cfg.yard[3]<=0))E('baseDefense.yard は [x,z,幅,奥行き]');
      if(!Number.isInteger(cfg.reinforcements) || cfg.reinforcements<0 || cfg.reinforcements>d.team)E('baseDefense.reinforcements は0〜teamの整数');
    }
  }
  for (const key of ['jumpPads', 'lifts', 'ziplines']) if (d[key] !== undefined && !Array.isArray(d[key])) E(`${key} は配列`);
  const point = (p, what) => {
    if (!Array.isArray(p) || p.length !== 3 || !p.every(num)) { E(`${what} は [x, z, 海抜y]`); return false; }
    inMap(p[0], p[1], what); return true;
  };
  if(d.rooftopTurrets!==undefined){
    if(!Array.isArray(d.rooftopTurrets))E('rooftopTurretsは配列');
    else for(const t of d.rooftopTurrets){
      if(!t||typeof t!=='object'||Array.isArray(t)){E('屋上砲台は所属と設置座標のオブジェクト');continue;}
      if(!['B','R'].includes(t.team))E('屋上砲台のteamはBかR');
      if(!ids.includes(t.plant))E('屋上砲台の参照プラントが存在しない');
      point(t.at,'屋上砲台');
      if(t.yaw!==undefined&&!num(t.yaw))E('屋上砲台のyawは有限数');
    }
  }
  if(d.botRepairRange!==undefined&&(!num(d.botRepairRange)||d.botRepairRange<=0))E('botRepairRange は正の数');
  if(d.raidRoutes!==undefined){
    if(!Array.isArray(d.raidRoutes)||!d.raidRoutes.length)E('raidRoutes は空でない配列');
    else for(const r of d.raidRoutes){
      if(!r||!['rush','covert','radar','sprint'].includes(r.kind)||!['core','radar'].includes(r.objective)){E('raidRoutes の kind または objective が不正');continue;}
      if(r.pointRadius!==undefined){
        if(!r.pointRadius||typeof r.pointRadius!=='object'||Array.isArray(r.pointRadius))E('pointRadius は陣営ごとの半径');
        else for(const [team,radius] of Object.entries(r.pointRadius))if(!['B','R'].includes(team)||!num(radius)||radius<=0||radius>14)E('pointRadius は B/R ごとに0より大きく14m以下');
      }
      for(const key of ['points','pointsR']){
        if(key==='pointsR'&&r[key]===undefined)continue;
        if(!Array.isArray(r[key])||!r[key].length)E(`raidRoutes.${key} は空でない配列`);
        else for(const p of r[key])point(p,`raidRoutes.${key}`);
      }
    }
  }
  for (const p of Array.isArray(d.jumpPads) ? d.jumpPads : []) {
    if (!p || typeof p !== 'object') { E('jumpPads の各項目はオブジェクト'); continue; }
    point(p.at, 'ジャンプパッド');
    if (point(p.exit, 'ジャンプパッドの出口') && Array.isArray(p.at) && num(p.at[2]) && p.exit[2] >= p.at[2] + p.rise) E('ジャンプパッドの出口は射出の最高点より低くする');
    if (!num(p.rise) || p.rise <= 0 || p.rise > 100) E('ジャンプパッドの rise は0より大きく100以下');
    if (p.radius !== undefined && (!num(p.radius) || p.radius < 2 || p.radius > 10)) E('ジャンプパッドの radius は2〜10');
  }
  for (const l of Array.isArray(d.lifts) ? d.lifts : []) {
    if (!l || typeof l !== 'object') { E('lifts の各項目はオブジェクト'); continue; }
    const a = point(l.from, 'リフト始点'), b = point(l.to, 'リフト終点');
    if (a && b && l.from.every((v, i) => v === l.to[i])) E('リフトの始点と終点を分ける');
    if (l.size !== undefined && (!Array.isArray(l.size) || l.size.length !== 2 || !l.size.every(v => num(v) && v >= 4 && v <= 20))) E('リフトの size は4〜20の [幅, 奥行き]');
    if (l.speed !== undefined && (!num(l.speed) || l.speed <= 0 || l.speed > 30)) E('リフトの speed は0より大きく30以下');
    if (l.wait !== undefined && (!num(l.wait) || l.wait < 0 || l.wait > 60)) E('リフトの wait は0〜60秒');
  }
  // ジップライン（v0.21）：from と to のうち低い方が下の乗り場、高い方が上の端（崖の縁の外側でよい。降り場は上の端の先の足場をエンジンが探す）
  for (const z of Array.isArray(d.ziplines) ? d.ziplines : []) {
    if (!z || typeof z !== 'object') { E('ziplines の各項目はオブジェクト'); continue; }
    const a = point(z.from, 'ジップラインの一端'), b = point(z.to, 'ジップラインのもう一端');
    if (a && b && Math.abs(z.from[2] - z.to[2]) < 3) E('ジップラインの両端の高さは3m以上違える（上へ昇る設備）');
  }
  for (const w of d.water || []) { if (w.length !== 5 || !w.every(num)) E(`水面 [${w}] は [x, z, 横の半分, 奥行きの半分, 高さ]`); else inMap(w[0], w[1], '水面'); }
  for (const b of d.bridges || []) {
    if (b.length !== 6 || !b.every(num)) { E(`橋 [${b}] は [x, z, 幅, 奥行き, 上面の高さ, 厚さ]`); continue; }
    if (b[2] <= 0 || b[3] <= 0 || b[5] <= 0) E(`橋 [${b}] の幅・奥行き・厚さは正の数`);
    inMap(b[0], b[1], '橋');
  }
  if (d.nav !== undefined && d.nav !== null) {
    let nodes = d.nav.nodes, links = d.nav.links;
    if(d.nav.encoding!==undefined){
      const xyz=d.nav.encoding==='xyz-i16-links-u16',stride=xyz?6:4;
      if((!xyz&&d.nav.encoding!=='xz-i16-links-u16')||!(xyz?[.01]:[.01,.02]).includes(d.nav.step)||!d.asym||typeof nodes!=='string'||typeof links!=='string')E('圧縮navは非対称マップのXZ・1cm/2cmまたはXYZ・1cmの16bit座標とリンク');
      else {
        const p=Buffer.from(nodes,'base64'),e=Buffer.from(links,'base64');nodes=[];links=[];
        if(!p.length||p.length%stride||e.length%4)E('圧縮navの座標・リンクが不正');
        else {for(let i=0;i<p.length;i+=stride)nodes.push(Array.from({length:stride/2},(_,j)=>p.readInt16LE(i+j*2)*d.nav.step));for(let i=0;i<e.length;i+=4)links.push([e.readUInt16LE(i),e.readUInt16LE(i+2)]);}
      }
    }
    if (!Array.isArray(nodes) || !Array.isArray(links)) E('nav は { nodes: [[x, z], …], links: [[i, j], …] }');
    else {
      nodes.forEach((n, i) => { if (!Array.isArray(n) || !(n.length === 2 || n.length === 3) || !n.every(num)) E(`nav の節点 ${i} は [x, z] か、橋の上なら [x, z, 歩く高さ]`); else inMap(n[0], n[1], `nav の節点 ${i}`); });
      const used = new Set();
      const ref = r => {
        if (d.asym && typeof r === 'string') { E('asym の nav は全域の節点番号で指定する'); return null; }
        const i = typeof r === 'string' && /^~\d+$/.test(r) ? +r.slice(1) : r;
        if (!Number.isInteger(i) || i < 0 || i >= nodes.length) { E(`nav のリンクの ${JSON.stringify(r)} は節点の番号か '~番号'`); return null; }
        used.add(i); return i;
      };
      for (const l of links) { if (!Array.isArray(l) || l.length !== 2) { E(`nav のリンク ${JSON.stringify(l)} は [i, j]`); continue; } ref(l[0]); ref(l[1]); }
      nodes.forEach((n, i) => { if (!used.has(i)) E(`nav の節点 ${i} (${n}) がどのリンクにも無い`); });
    }
  }
  return out;
}
for (const [id, path] of files) {
  try { eval(fs.readFileSync(path, 'utf8')); } catch (e) { errs.push(`${id}: 読み込めない（${e.message}）`); continue; }
  const d = window.MAP_DATA[id];
  if (!d) { errs.push(`${id}: window.MAP_DATA.${id} が無い（ファイル名とIDをそろえる）`); continue; }
  const base = check(d);
  errs.push(...base.map(m => `${id}: ${m}`));
  // 配置違い：地形と layout は元のまま、ほかの項目を上書きした物として確かめる（元のマップと同じ問題は繰り返さない）
  if (d.variants !== undefined) {
    if (typeof d.variants !== 'object' || Array.isArray(d.variants)) errs.push(`${id}: variants は { キー: { name, … } }`);
    else for (const [k, v] of Object.entries(d.variants)) {
      if (!/^[a-z][a-z0-9_]*$/.test(k)) errs.push(`${id}: 配置違いのキー ${k} は英小文字・数字・_`);
      if (!v || typeof v.name !== 'string') { errs.push(`${id}-${k}: 配置違いには name（副題）が要る`); continue; }
      if (v.terrain || v.layout) errs.push(`${id}-${k}: 配置違いでは terrain と layout は変えられない（元のマップのまま）`);
      errs.push(...check({ ...d, ...v, terrain: d.terrain, layout: d.layout }).filter(m => !base.includes(m)).map(m => `${id}-${k}: ${m}`));
    }
  }
}
console.log(JSON.stringify(errs));
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', nargs='+', type=pathlib.Path, help='指定したマップだけ検査し、maps.js は書かない')
    args = parser.parse_args()
    files = args.check or sorted(SRC.glob("*.js"))
    if not files:
        sys.exit(f"{SRC} にマップがありません")
    pairs = [(f.stem, str(f)) for f in files]
    for id_, _ in pairs:
        if not re.fullmatch(r"[a-z][a-z0-9_]*", id_):
            sys.exit(f"マップID（ファイル名）は英小文字・数字・_ にする: {id_}")
    if shutil.which("node"):
        r = subprocess.run(["node", "-e", CHECK, json.dumps(pairs)], capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit("確かめられませんでした:\n" + r.stderr)
        errs = json.loads(r.stdout.strip().splitlines()[-1])
        if errs:
            sys.exit("マップに問題があります（maps.js は書いていません）:\n- " + "\n- ".join(errs))
    else:
        print("node が無いので中身の確認は飛ばします")
    if args.check:
        print('検査済み:', ', '.join(i for i, _ in pairs))
        return
    parts = [f"// ---- maps/{f.name} ----\n{f.read_text(encoding='utf-8').rstrip()}\n" for f in files]
    OUT.write_text(
        "// マップのデータ（tools/build_maps.py が prototype/maps/*.js から作る。手で編集しない）。書き方は prototype/maps/README.md\n"
        + "\n".join(parts), encoding="utf-8")
    print("書き出し:", OUT, "／ マップ:", ", ".join(i for i, _ in pairs))


if __name__ == "__main__":
    main()
