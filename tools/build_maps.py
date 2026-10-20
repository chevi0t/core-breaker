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
CHECK = r"""
const fs = require('fs');
global.window = {};
const files = JSON.parse(process.argv[1]), errs = [];
const num = v => typeof v === 'number' && isFinite(v);
const KINDS = ['house', 'wall', 'tower'];
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
  for (const [x, z] of [...d.turrets, ...d.basePods, d.radar]) inMap(x, z, 'ベースの施設');
  for (const b of d.barricades) { inMap(b[0], b[1], '障害物'); if (b.length !== 5 || !b.every(num)) E(`バリケード [${b}] は [x, z, 幅, 奥行き, 高さ]`); }
  // 建物：6番目の要素（任意）は種類
  for (const b of d.layout) {
    inMap(b[0], b[1], '障害物');
    if (!(b.length === 5 || b.length === 6) || !b.slice(0, 5).every(num)) E(`障害物 [${b}] は [x, z, 幅, 奥行き, 高さ] か、6番目に種類`);
    else if (b.length === 6 && !KINDS.includes(b[5])) E(`障害物 [${b}] の種類 ${b[5]} はエンジンに無い（使えるのは ${KINDS.join('・')}）`);
  }
  const types = ['mesa', 'block', 'ramp', 'hill', 'trench'];
  for (const f of d.terrain) if (!types.includes(f.type)) E(`地形の種類 ${f.type} はエンジンに無い（使えるのは ${types.join('・')}）`);
  // 任意の項目
  if (d.asym !== undefined && typeof d.asym !== 'boolean') E('asym は true か false');
  if (d.subtitle !== undefined && typeof d.subtitle !== 'string') E('subtitle は文字列');
  for (const key of ['jumpPads', 'lifts', 'ziplines']) if (d[key] !== undefined && !Array.isArray(d[key])) E(`${key} は配列`);
  const point = (p, what) => {
    if (!Array.isArray(p) || p.length !== 3 || !p.every(num)) { E(`${what} は [x, z, 海抜y]`); return false; }
    inMap(p[0], p[1], what); return true;
  };
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
    const nodes = d.nav.nodes, links = d.nav.links;
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
