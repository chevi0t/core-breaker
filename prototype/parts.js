// メーカーと機体パーツの表（2026-11-04 リファクタで index.html から分けた。前は「メーカー」「機体パーツ」の節）。
// index.html が maps.js と同じように先に読み、本体の「機体パーツ」の位置で partTables() を呼んで中の名前を受け取る。
// 新しい名前を足したら、最後の return { ... } にも足す（本体と試験の __g から見えるようになる）。手で書いてよい。
// メーカーと機体パーツの表。本体の「機体パーツ」の位置で呼ぶ
function partTables() {
// ---- メーカー（v0.13、ユーザー決定：架空のメーカーごとに性格を決め、武器とパーツは「シリーズ＋型」で揃える。公式の名前は使わない）----
const MAKERS = {
  sylph: { name: 'シルフ精機', desc: '軽く速射の効く銃と刃物' },
  gard: { name: 'ガルド重工', desc: '重く頑丈な実弾兵器' },
  lumina: { name: 'ルミナ技研', desc: 'エネルギー兵器と高出力の装置' },
  volca: { name: 'ボルカ火工', desc: '爆発物と設置物' },
  iris: { name: 'アイリス電子', desc: '索敵・迷彩・修理の電子装備' },
};
// ---- 機体パーツ（v0.12、Codex 版から移植）----
// 重量・装甲・脚の速さ・重量耐性は wiki PS4版の各部位の最初の型の強化前（軽量＝シュライクⅠ、標準＝クーガーⅠ、重装＝ヘヴィガードⅠ）。
// 頭のロック距離と射撃補正、胴のブーストとSP、腕の反動吸収と携行弾数はユーザーが Codex 版で決めた補正
const PART_SLOTS = ['head', 'body', 'arms', 'legs'], PART_NAMES = { head: '頭部', body: '胴部', arms: '腕部', legs: '脚部' };
// weight：重量（kg）、armor：その部位に当たったときの被ダメージ倍率
const PARTS = {
  head: { // lock：ロック距離（m）、aim：射撃補正（ばらつきをこれで割る）
    light: { weight: 460, armor: 1.24, lock: 60, aim: 1.2 },
    standard: { weight: 610, armor: 1, lock: 50, aim: 1 },
    heavy: { weight: 830, armor: 0.77, lock: 40, aim: 0.8 },
  },
  body: { // boost：ブースト容量、sp：SP回復性能（100基準）、supply：追加の回復倍率
    light: { weight: 1010, armor: 1.24, boost: 120, sp: 80, supply: 1 },
    standard: { weight: 1300, armor: 1, boost: 100, sp: 100, supply: 1 },
    heavy: { weight: 1480, armor: 0.81, boost: 80, sp: 120, supply: 1.1 },
  },
  arms: { // reload：リロード時間の倍率、swap：持ち替えの速さ、recoil：反動吸収、ammo：主武器・副武器の携行弾数の倍率
    light: { weight: 680, armor: 1.17, reload: 0.91, swap: 1.1, recoil: 0.75, ammo: 0.75 },
    standard: { weight: 840, armor: 1, reload: 1, swap: 1, recoil: 1, ammo: 1 },
    heavy: { weight: 1030, armor: 0.77, reload: 1.18, swap: 0.8, recoil: 1.25, ammo: 1.25 },
  },
  legs: { // walk・dash・cruise：歩行・ダッシュ・巡航（wiki の m/s）、cap：重量耐性（kg）
    light: { weight: 770, armor: 1.17, walk: 7.6, dash: 24.8, cruise: 21.4, cap: 3700 },
    standard: { weight: 850, armor: 1, walk: 6, dash: 21.8, cruise: 19.7, cap: 4650 },
    heavy: { weight: 1340, armor: 0.77, walk: 4.8, dash: 19.4, cruise: 17.2, cap: 6450 },
  },
};
// ACの現行表（2026-10-19）。比の分子は採用型、分母はACのⅠ型。元の名前・実数は research/parts/types/*.json。
// SP回復性能の基準値と巡航速度はAC表に無いので本作Ⅰ型を継承する。DEF・加速時間から値を作らない。
const PART_VARIANTS = {
  head: {
    harrier: ['standard', { weight: 500/600, armor: 1.19/1, aim: 1.16/1, lock: 90/80 }], // AC ヤクシャ / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    harrier2: ['standard', { weight: 500/600, armor: 1.19/1, aim: 1.16/1, lock: 120/80 }], // AC ヤクシャ・改 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    harrier3: ['standard', { weight: 520/600, armor: 1.25/1, aim: 1.2/1, lock: 80/80 }], // AC ヤクシャ・弐 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    prism: ['standard', { weight: 550/600, armor: 1.32/1, aim: 1.3/1, lock: 60/80 }], // AC E.D.G.-α / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    prism2: ['standard', { weight: 560/600, armor: 1.32/1, aim: 1.33/1, lock: 30/80 }], // AC E.D.G.-β / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    prism3: ['standard', { weight: 570/600, armor: 1.32/1, aim: 1.3/1, lock: 80/80 }], // AC E.D.G.-δ / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    bastion: ['standard', { weight: 750/600, armor: 0.85/1, aim: 0.84/1, lock: 100/80 }], // AC ケーファー42 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    bastion2: ['standard', { weight: 730/600, armor: 0.85/1, aim: 0.84/1, lock: 120/80 }], // AC ケーファー44 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    bastion3: ['standard', { weight: 770/600, armor: 0.9/1, aim: 1.04/1, lock: 90/80 }], // AC ケーファー45 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    light2: ['light', { weight: 470/450, armor: 1.32/1.32, aim: 1/1, lock: 60/85 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/315.html
    light3: ['light', { weight: 450/450, armor: 1.32/1.32, aim: 1.16/1, lock: 100/85 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/315.html
    standard2: ['standard', { weight: 620/600, armor: 1/1, aim: 1/1, lock: 60/80 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/308.html
    standard3: ['standard', { weight: 630/600, armor: 1/1, aim: 1.25/1, lock: 100/80 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/308.html
    heavy2: ['heavy', { weight: 850/800, armor: 0.71/0.78, aim: 0.8/0.76, lock: 100/80 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/313.html
    heavy3: ['heavy', { weight: 800/800, armor: 0.78/0.78, aim: 0.84/0.76, lock: 70/80 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/313.html
  },
  body: {
    harrier: ['standard', { weight: 1150/1250, armor: 1.19/1, boost: 110/100, supply: 1/1 }], // AC ヤクシャ / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    harrier2: ['standard', { weight: 1160/1250, armor: 1.25/1, boost: 130/100, supply: 0.65/1 }], // AC ヤクシャ・改 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    harrier3: ['standard', { weight: 1180/1250, armor: 1.19/1, boost: 105/100, supply: 1.2/1 }], // AC ヤクシャ・弐 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    prism: ['standard', { weight: 1250/1250, armor: 1.25/1, boost: 80/100, supply: 1.6/1 }], // AC E.D.G.-α / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    prism2: ['standard', { weight: 1280/1250, armor: 1.25/1, boost: 100/100, supply: 1.35/1 }], // AC E.D.G.-β / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    prism3: ['standard', { weight: 1250/1250, armor: 1.25/1, boost: 60/100, supply: 2/1 }], // AC E.D.G.-δ / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    bastion: ['standard', { weight: 1380/1250, armor: 0.85/1, boost: 105/100, supply: 1.1/1 }], // AC ケーファー42 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    bastion2: ['standard', { weight: 1420/1250, armor: 0.85/1, boost: 100/100, supply: 1.35/1 }], // AC ケーファー44 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    bastion3: ['standard', { weight: 1450/1250, armor: 0.85/1, boost: 125/100, supply: 0.9/1 }], // AC ケーファー45 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    light2: ['light', { weight: 1030/1000, armor: 1.32/1.32, boost: 115/95, supply: 0.5/0.9 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/315.html
    light3: ['light', { weight: 1070/1000, armor: 1.25/1.32, boost: 90/95, supply: 1.2/0.9 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/315.html
    standard2: ['standard', { weight: 1300/1250, armor: 1/1, boost: 110/100, supply: 1/1 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/308.html
    standard3: ['standard', { weight: 1320/1250, armor: 0.9/1, boost: 100/100, supply: 1.35/1 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/308.html
    heavy2: ['heavy', { weight: 1550/1430, armor: 0.71/0.78, boost: 110/100, supply: 1/1.2 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/313.html
    heavy3: ['heavy', { weight: 1500/1430, armor: 0.78/0.78, boost: 120/100, supply: 1/1.2 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/313.html
  },
  arms: {
    harrier: ['standard', { weight: 770/850, armor: 1.19/1, recoil: 0.9/1, reload: 0.91/1, swap: 1.3/1, ammo: 1.23/1 }], // AC ヤクシャ / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    harrier2: ['standard', { weight: 710/850, armor: 1.25/1, recoil: 0.75/1, reload: 0.82/1, swap: 1.5/1, ammo: 1.14/1 }], // AC ヤクシャ・改 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    harrier3: ['standard', { weight: 790/850, armor: 1.19/1, recoil: 1.2/1, reload: 0.955/1, swap: 1.3/1, ammo: 1.27/1 }], // AC ヤクシャ・弐 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    prism: ['standard', { weight: 850/850, armor: 1.25/1, recoil: 1/1, reload: 0.78/1, swap: 1/1, ammo: 1.27/1 }], // AC E.D.G.-α / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    prism2: ['standard', { weight: 860/850, armor: 1.25/1, recoil: 0.75/1, reload: 0.64/1, swap: 1.05/1, ammo: 1.09/1 }], // AC E.D.G.-β / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    prism3: ['standard', { weight: 850/850, armor: 1.25/1, recoil: 1.35/1, reload: 0.82/1, swap: 1/1, ammo: 1.32/1 }], // AC E.D.G.-δ / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    bastion: ['standard', { weight: 930/850, armor: 0.85/1, recoil: 1.2/1, reload: 1.09/1, swap: 0.9/1, ammo: 1.5/1 }], // AC ケーファー42 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    bastion2: ['standard', { weight: 910/850, armor: 0.9/1, recoil: 1.1/1, reload: 1/1, swap: 1.1/1, ammo: 1.45/1 }], // AC ケーファー44 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    bastion3: ['standard', { weight: 980/850, armor: 0.85/1, recoil: 1.45/1, reload: 1.18/1, swap: 0.9/1, ammo: 1.59/1 }], // AC ケーファー45 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    light2: ['light', { weight: 620/660, armor: 1.32/1.25, recoil: 0.75/0.9, reload: 0.82/0.91, swap: 1.4/1.2, ammo: 1/1 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/315.html
    light3: ['light', { weight: 700/660, armor: 1.25/1.25, recoil: 1/0.9, reload: 0.86/0.91, swap: 1.1/1.2, ammo: 1.18/1 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/315.html
    standard2: ['standard', { weight: 860/850, armor: 1/1, recoil: 1.2/1, reload: 1.09/1, swap: 1/1, ammo: 1.32/1 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/308.html
    standard3: ['standard', { weight: 900/850, armor: 0.9/1, recoil: 1.25/1, reload: 1/1, swap: 1/1, ammo: 1.45/1 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/308.html
    heavy2: ['heavy', { weight: 1120/1000, armor: 0.71/0.78, recoil: 1.45/1.25, reload: 1.23/1.18, swap: 0.7/0.8, ammo: 1.63/1.5 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/313.html
    heavy3: ['heavy', { weight: 1050/1000, armor: 0.78/0.78, recoil: 1.2/1.25, reload: 1.04/1.18, swap: 0.95/0.8, ammo: 1.59/1.5 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/313.html
  },
  legs: {
    harrier: ['standard', { weight: 880/900, armor: 1.19/1, walk: 6.75/6.3, dash: 25.5/21.9, cap: 4550/4550 }], // AC ヤクシャ / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    harrier2: ['standard', { weight: 850/900, armor: 1.25/1, walk: 8.55/6.3, dash: 25.5/21.9, cap: 4550/4550 }], // AC ヤクシャ・改 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    harrier3: ['standard', { weight: 940/900, armor: 1.19/1, walk: 5.85/6.3, dash: 26.1/21.9, cap: 4550/4550 }], // AC ヤクシャ・弐 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/316.html
    prism: ['standard', { weight: 880/900, armor: 1.19/1, walk: 6.97/6.3, dash: 24.3/21.9, cap: 4750/4550 }], // AC E.D.G.‐α / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    prism2: ['standard', { weight: 920/900, armor: 1.19/1, walk: 7.65/6.3, dash: 24.3/21.9, cap: 4750/4550 }], // AC E.D.G.‐β / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    prism3: ['standard', { weight: 970/900, armor: 1.25/1, walk: 6.3/6.3, dash: 25.5/21.9, cap: 4750/4550 }], // AC E.D.G.‐δ / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/311.html
    bastion: ['standard', { weight: 1220/900, armor: 0.85/1, walk: 6.3/6.3, dash: 20.7/21.9, cap: 6350/4550 }], // AC ケーファー42 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    bastion2: ['standard', { weight: 1210/900, armor: 0.9/1, walk: 7.65/6.3, dash: 20.7/21.9, cap: 6150/4550 }], // AC ケーファー44 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    bastion3: ['standard', { weight: 1320/900, armor: 0.85/1, walk: 5.21/6.3, dash: 21.9/21.9, cap: 6350/4550 }], // AC ケーファー45 / クーガーⅠ型。https://w.atwiki.jp/borderbreak/pages/314.html
    light2: ['light', { weight: 700/750, armor: 1.32/1.25, walk: 9.76/8.73, dash: 24.9/24.9, cap: 3800/3800 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/315.html
    light3: ['light', { weight: 770/750, armor: 1.25/1.25, walk: 7.65/8.73, dash: 27/24.9, cap: 3800/3800 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/315.html
    standard2: ['standard', { weight: 920/900, armor: 1.05/1, walk: 7.65/6.3, dash: 22.5/21.9, cap: 4550/4550 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/308.html
    standard3: ['standard', { weight: 1000/900, armor: 1/1, walk: 6.3/6.3, dash: 24.3/21.9, cap: 5150/4550 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/308.html
    heavy2: ['heavy', { weight: 1330/1300, armor: 0.71/0.78, walk: 4.68/5.21, dash: 18.9/19.8, cap: 6800/6550 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/313.html
    heavy3: ['heavy', { weight: 1320/1300, armor: 0.78/0.78, walk: 4.68/5.21, dash: 20.7/19.8, cap: 6550/6550 }], // AC採用型 / ACⅠ型。https://w.atwiki.jp/borderbreak/pages/313.html
  },
};
// ホバー型のAC原表。通常移動・高速移動はホバー補正済み。採用記録：research/parts/types/hover-series.json。
// ネレイド45/45改/46/RT：https://w.atwiki.jp/borderbreak/pages/326.html
// ロージー：https://w.atwiki.jp/borderbreak/pages/435.html
// B.U.Z.：https://w.atwiki.jp/borderbreak/pages/469.html
const HOVER_PART_TYPES = {
  skimmer: {"rows":{"head":[[550,1.05,1,80],[560,1.05,1,115],[580,1.05,1.08,60],[600,1.05,1.33,60]],"body":[[1200,1.05,115,0.9],[1220,1.05,100,1.2],[1260,1.13,125,1],[1290,1,100,0.9]],"arms":[[740,1.05,0.9,1,1.2,1.41],[760,1.05,1.1,1.05,1.2,1.41],[810,1,0.9,1.09,1.5,1.45],[840,0.95,0.85,1.05,1.6,1.45]],"legs":[[900,1.05,10.8,18.48,1.92,5000],[880,1.05,9.6,18.48,1.65,5150],[940,1.05,9.6,19.44,2.19,5000],[980,1,9,19.44,1.6,5150]]}},
  anchor: {"rows":{"head":[[810,0.71,0.76,70],[880,0.71,0.76,120],[830,0.71,0.84,80],[920,0.63,0.76,40]],"body":[[1560,0.71,100,1.2],[1580,0.71,80,1.7],[1530,0.71,135,0.65],[1620,0.63,95,0.9]],"arms":[[1010,0.71,1.15,1.04,0.8,1.5],[1030,0.71,1.3,1.09,0.7,1.59],[980,0.78,1.05,0.91,0.9,1.45],[1150,0.63,1.2,1.18,0.75,1.63]],"legs":[[1370,0.71,8.4,15.84,3.27,6550],[1310,0.68,7.8,15.12,2.46,6800],[1350,0.71,7.8,16.56,3.27,6550],[1420,0.63,7.43,15.84,3.81,6800]]}},
  wisp: {"rows":{"head":[[490,1.32,1.2,60],[520,1.32,1.25,40],[500,1.32,1.3,90],[520,1.28,1.33,50]],"body":[[970,1.32,105,0.65],[980,1.32,95,1.2],[1050,1.32,130,0.5],[1010,1.28,100,1.1]],"arms":[[600,1.32,0.75,0.91,1.5,1.05],[640,1.32,0.75,0.78,1.3,1.05],[650,1.32,0.95,0.73,1,1.05],[630,1.28,0.95,0.86,1.35,1.14]],"legs":[[670,1.32,13.01,19.92,2.73,3800],[720,1.32,11.4,19.92,2.19,4250],[700,1.32,11.63,20.4,2.46,3800],[740,1.28,13.5,20.4,3,3800]]}},
};
const HOVER_PART_FIELDS = { head: ['weight','armor','aim','lock'], body: ['weight','armor','boost','supply'], arms: ['weight','armor','recoil','reload','swap','ammo'], legs: ['weight','armor','walk','dash','accelTime','cap'] };
const HOVER_PART_BASE = { head: [600,1,1,80], body: [1250,1,100,1], arms: [850,1,1,1,1,1], legs: [900,1,6.3,21.9,1,4550] };
for (const [series, family] of Object.entries(HOVER_PART_TYPES)) for (const [slot, rows] of Object.entries(family.rows)) rows.forEach((row,i) => {
  const ratios = {};
  HOVER_PART_FIELDS[slot].forEach((field,j) => { if (field !== 'accelTime') ratios[field] = row[j] / HOVER_PART_BASE[slot][j]; });
  // 巡航の実測値は原表に無い。既存標準の巡航を基準に、同ランク二脚への逆算とホバー巡航7/6を一度だけ適用する。
  if (slot === 'legs') ratios.cruise = row[3] / .8 / 21.9 * 7 / 6;
  PART_VARIANTS[slot][series + (i ? i+1 : '')] = ['standard',ratios];
});
for (const [slot, variants] of Object.entries(PART_VARIANTS)) for (const [key, [base, ratios]] of Object.entries(variants)) {
  const p = { ...PARTS[slot][base] };
  for (const [field, ratio] of Object.entries(ratios)) {
    const digits = ['weight', 'cap'].includes(field) ? 0 : ['lock', 'boost'].includes(field) ? 1 : ['walk', 'dash', 'cruise'].includes(field) ? 2 : 4;
    p[field] = +(p[field] * ratio).toFixed(digits);
  }
  PARTS[slot][key] = p;
}

for (const [series, family] of Object.entries(HOVER_PART_TYPES)) family.rows.legs.forEach((row,i) => Object.assign(PARTS.legs[series + (i ? i+1 : '')], { kind: 'hover', accelTime: row[4] }));

// パーツのシリーズ（v0.13）：見た目と性格のまとまり。types はそのシリーズのⅠ・Ⅱ・Ⅲ型のキー。
// set はセットボーナス（頭・胴・腕・脚を同じシリーズで揃えると付く。型は問わない。ユーザー決定）：text は説明、fx は [部位, 項目, 'mul' か 'add', 値]。
// 本家はアーケード版だけにある（PS4版はシリーズごとのチップに置き換えた。research/parts/setbonus.md）。
// 値はアーケード版 wiki のブランドごとの表（https://w.atwiki.jp/borderbreak/pages/24.html 、2018年3月のBB.NET表記。v0.13.1、ユーザー指定）：
// スウィフト＝シュライク（ブースター+5、歩行+0.45m/s）、ハウンド＝クーガー（射撃補正+5%、重量耐性+150）、
// ブルワーク＝ヘヴィガード（装甲+3%を各部位。もう1つの DEF耐久+250 は本作に DEF が無いので入れない）
const PART_SERIES = {
  wisp: {"name":"ウィスプ","maker":"lumina","profile":"light","desc":"軽量・高機動のホバー。装甲は薄く、Ⅱは積載、Ⅳは通常移動を優先","set":{"text":"通常移動 +0.60m/s","fx":[["legs","walk","add",0.6]]},"types":["wisp","wisp2","wisp3","wisp4"]},
  anchor: {"name":"アンカー","maker":"volca","profile":"heavy","desc":"重装甲・高積載のホバー。Ⅲはブースト、Ⅳは装甲を優先","set":{"text":"装甲 +4.5%（各部位の被ダメージ −4.5%）","fx":[["head","armor","add",-0.045],["body","armor","add",-0.045],["arms","armor","add",-0.045],["legs","armor","add",-0.045]]},"types":["anchor","anchor2","anchor3","anchor4"]},
  skimmer: {"name":"スキマー","maker":"iris","profile":"balanced","desc":"中量級ホバー。水上と空中を使い分け、Ⅳは射撃と機体制御に寄せる","set":{"text":"射撃補正 +5%、巡航加速時間 −0.27秒","fx":[["head","aim","mul",1.05],["legs","accelTime","add",-0.27]]},"types":["skimmer","skimmer2","skimmer3","skimmer4"]},
  harrier: {"maker":"sylph","name":"ハリアー","desc":"薄い装甲で機動力を優先。Ⅱは歩行とブースト、ⅢはダッシュとSP回復に寄せる","types":["harrier","harrier2","harrier3"],"set":{"text":"ロック距離 +5m、ダッシュ +0.60m/s","fx":[["head","lock","add",5],["legs","dash","add",0.6]]}},
  prism: {"maker":"lumina","name":"プリズム","desc":"射撃補正・再装填・SP回復に優れるが装甲が薄い。Ⅲ胴はブーストを削って回復を優先","types":["prism","prism2","prism3"],"set":{"text":"再装填速度 +4.5%（時間を1.045で割る）","fx":[["arms","reload","mul",0.9569377990430623]]}},
  bastion: {"maker":"gard","name":"バスティオン","desc":"重装備を載せるための重量耐性と反動制御。Ⅱは取り回し、Ⅲは火力支援向け","types":["bastion","bastion2","bastion3"],"set":{"text":"反動吸収 +5%、歩行 +0.45m/s","fx":[["arms","recoil","mul",1.05],["legs","walk","add",0.45]]}},
  swift: { maker: 'sylph', name: 'スウィフト', desc: '軽く速いが打たれ弱い', types: ['light', 'light2', 'light3'], set: { text: 'ブースト +5、歩行 +0.45m/s', fx: [['body', 'boost', 'add', 5], ['legs', 'walk', 'add', 0.45]] } },
  hound: { maker: 'gard', name: 'ハウンド', desc: '釣り合いの取れた標準機', types: ['standard', 'standard2', 'standard3'], set: { text: '射撃補正 +5%（弾のばらつきが減る）、重量耐性 +150kg', fx: [['head', 'aim', 'mul', 1.05], ['legs', 'cap', 'add', 150]] } },
  bulwark: { maker: 'gard', name: 'ブルワーク', desc: '重く硬いが遅い', types: ['heavy', 'heavy2', 'heavy3'], set: { text: '装甲 +3%（各部位の被ダメージ −3%）', fx: PART_SLOTS.map(k => [k, 'armor', 'add', -0.03]) } },
};
for (const [id, ps] of Object.entries(PART_SERIES)) ps.types.forEach((t, i) => { for (const k of PART_SLOTS) Object.assign(PARTS[k][t], { series: id, model: ps.name + 'ⅠⅡⅢⅣ'[i], label: 'ⅠⅡⅢⅣ'[i] + '型' }); });
// 塗装。'team' はチームの色。ほかの色に塗ってもチームの色は細い帯に残る（Botはチームの色のまま）
const PAINTS = [
  { id: 'team', name: 'チームの色', color: null }, { id: 'ash', name: 'アッシュ', color: 0xaebcc8 }, { id: 'sand', name: 'サンド', color: 0xd2b782 },
  { id: 'forest', name: 'フォレスト', color: 0x648d79 }, { id: 'violet', name: 'バイオレット', color: 0x9c82c7 }, { id: 'crimson', name: 'クリムゾン', color: 0xc76363 },
];
return { MAKERS, PART_SLOTS, PART_NAMES, PARTS, PART_VARIANTS, HOVER_PART_TYPES, HOVER_PART_FIELDS, HOVER_PART_BASE, PART_SERIES, PAINTS };
}
