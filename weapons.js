// 武器の表とモデル（2026-11-04 リファクタで index.html から分けた。前は「武器のモデル」「兵装と武器」「武器の型」の節）。
// index.html が maps.js と同じように先に読み、本体の決まった位置で weaponModels()・weaponTables() を呼んで中の名前を受け取る。
// 呼ぶのはその位置なので、中では本体のそれより前の定数・関数（T、MAKERS、PARTS など）と、本体のどこかにある function をそのまま使える。
// 新しい名前を足したら、最後の return { ... } にも足す（本体と試験の __g から見えるようになる）。
// 手で書いてよい（maps.js・sounds.js と違い、道具で作るファイルではない）。
// 武器のモデル（形と色）。本体の「武器のモデル」の位置で呼ぶ
function weaponModels() {
// ---- 武器のモデル（v0.11.1）：Codex 版（ユーザーが v0.10.9 を Codex に渡して作ったもの）の weapon-models.js のオリジナルの形を、本作の武器のキーに割り当てて使う ----
// 部品を頂点カラー付きの1つの形にまとめ、同じ形はキャッシュして使い回す。性能とは関係なく、機体の手の武器・背中の装置・投げた物・設置物・カードの画像で同じ形を使う。
// MODEL_OF：武器のキー → [形の系統, 型（0・1・2。色と細部が変わる）]。spear・sonar・sentry・remote・fmine・field は本作で足した形
const MODEL_OF = {
  mirage: ['mirage', 0], mirageH: ['mirage', 1], mirageL: ['mirage', 2], mirageD: ['mirage', 2],
  missile: ['missileRack', 0], mlrs: ['missileRack', 1],
  waveSword: ['waveSword', 0],
  stunner: ['stunner', 0],
  seeker: ['seeker', 0],
  sabre: ['sabre', 0], rod: ['dagger', 0], claw: ['claw', 0], pike: ['pike', 0], jammer: ['jammer', 0], airTurret: ['airTurret', 0], flyTurret: ['flyTurret', 0], stunGrenade: ['stunGrenade', 0], planeSensor: ['planeSensor', 0], ammoBox: ['ammoBox', 0], radarTool: ['radarTool', 0],
  flare: ['flare', 0], chain: ['chain', 0], dart: ['dart', 0], charge: ['charge', 0], zoom: ['zoom', 0], blastSniper: ['blastSniper', 0], lightSniper: ['lightSniper', 0], optSniper: ['optSniper', 0], jumpMine: ['jumpMine', 0], delayMine: ['delayMine', 0], detonator: ['detonator', 0],
  beamCannon: ['beamCannon', 0],
  artillery: ['artillery', 0], reflector: ['reflector', 1], barrier: ['barrier', 0], escort: ['escort', 0], repairPost: ['repairPost', 0],
  ar: ['ar', 0], burst: ['burst', 0], marks: ['marksman', 0], grenade: ['grenade', 0], timed: ['grenade', 1], gl: ['explosive', 0],
  sword: ['sword', 0], blade: ['sword', 2], spear: ['spear', 0], charger: ['charger', 0], chargerD: ['charger', 1], chargerS: ['charger', 2],
  gatling: ['gatling', 0], mg: ['lmg', 0], acannon: ['autocannon', 0], rocket: ['rocket', 0], scrum: ['rocket', 1], plasma: ['chargeCannon', 0],
  weaken: ['weaken', 0], impactb: ['grenade', 2], hsg: ['compactShot', 0], cannon: ['cannon', 0], cannonH: ['cannon', 1], cannonM: ['cannon', 2],
  pistols: ['pistols', 0], dualmg: ['dualSMG', 0], coyote: ['dualSemi', 0], sniper: ['sniper', 0], battle: ['sniper', 1], lzsniper: ['sniper', 2],
  drone: ['drone', 0], sonar: ['sonar', 0], sentry: ['sentry', 0], camo: ['camo', 0], camoD: ['camo', 1], camoH: ['camo', 2],
  shotgun: ['shotgun', 0], autosg: ['autoShot', 0], nail: ['nail', 0], mine: ['mine', 0], fmine: ['fmine', 0], remote: ['remote', 0],
  sensor: ['sensor', 0], airsensor: ['sensor', 2], fansensor: ['sensor', 1], repair: ['repair', 0], repairG: ['repair', 2], field: ['field', 0],
  carbine: ['carbine', 0], gale: ['compactShot', 1], vulcan: ['energyMG', 0], margay: ['dualSemi', 1], gemini: ['dualEnergy', 0], haggard: ['magnum', 0], aurora: ['energyShot', 0], // v0.14。型は WEAPON_TYPES から足す
  wave: ['wave', 0], lec: ['chargeCannon', 0], explo: ['explosive', 1], wide: ['dualSpread', 0], glint: ['dualCharge', 0], cls: ['focusShot', 0], omni: ['omni', 0], // v0.15
  rail: ['railRifle', 0], pulse: ['pulseRifle', 0], coil: ['coilCannon', 0], // アーケード版の3系統。形はオリジナル
};
const palette = [0x5bc9ee, 0xf3bf60, 0xf28479]; // 型ごとの差し色（青緑・黄・赤）
function buildWeaponGeo(id, part) {
  const [f, v] = MODEL_OF[id] || ['ar', 0], accent = palette[v];
  const dark = 0x243440, shell = [0x6c8390, 0x718b7a, 0x9a7470][v], steel = 0xb8cbd1, black = 0x101b24;
  const values = { position: [], normal: [], color: [] };
  function add(geo, color, x=0, y=0, z=0, rx=0, ry=0, rz=0) {
    geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz); geo.translate(x,y,z);
    const flat = geo.index ? geo.toNonIndexed() : geo;
    values.position.push(...flat.attributes.position.array); values.normal.push(...flat.attributes.normal.array);
    const c = new T.Color(color);
    for (let i=0;i<flat.attributes.position.count;i++) values.color.push(c.r,c.g,c.b);
    if (flat !== geo) flat.dispose(); geo.dispose();
  }
  const box = (w,h,d,c,x=0,y=0,z=0,rz=0) => add(new T.BoxGeometry(w,h,d),c,x,y,z,0,0,rz);
  const cyl = (r,len,c,x=0,y=0,z=0,axis='z',r2=r,sides=10) => add(new T.CylinderGeometry(r,r2,len,sides),c,x,y,z,axis==='z'?Math.PI/2:0,0,axis==='x'?Math.PI/2:0);
  const ball = (r,c,x=0,y=0,z=0) => add(new T.IcosahedronGeometry(r,1),c,x,y,z);
  const receiver = (w=.48,h=.48,d=1.1) => {
    box(w,h,d,shell); box(w*.55,.2,.65,dark,0,.25,-.05);
    box(.19,.52,.3,dark,0,-.38,.2,-.12); box(.15,.07,.45,accent,0,.39,-.1);
  };
  const barrel = (r=.12,len=1,z=-.85,x=0,y=0) => { cyl(r,len,steel,x,y,z); cyl(r*1.2,.16,black,x,y,z-len/2); };
  const primaryShapes = ['carbine','burst','marksman','compactShot','wave','autocannon','explosive','energyMG','chargeCannon','dualSemi','dualSMG','dualEnergy','dualSpread','dualCharge','autoShot','nail','energyShot','focusShot','railRifle','pulseRifle','coilCannon'];
  if (f === 'beamCannon') {
    // 独自形状の折り畳み式照射器。各部の形は共有し、関節だけを動かす。
    if (part === 'upper' || part === 'forearm') {
      const w=part==='upper'?.13:.105;
      box(w,1,.13,dark,0,.5,0);box(w*.45,.76,.025,steel,0,.5,-.078);
      box(w*1.25,.12,.16,shell,0,.08,0);box(w*1.25,.12,.16,shell,0,.92,0);
      box(.025,.42,.025,accent,w*.52,.53,-.08);
    } else if (part === 'joint') {
      cyl(.145,.13,dark,0,0,0,'x',.145,8);cyl(.092,.15,steel,0,0,0,'x',.092,8);
    } else if (part === 'emitter') {
      cyl(.205,.22,dark,0,0,.025,'z',.17,8);cyl(.225,.055,steel,0,0,-.1,'z',.225,8);
      cyl(.14,.035,black,0,0,-.143,'z',.14,8);cyl(.105,.04,0xb8ff32,0,0,-.16,'z',.105,8);
      box(.12,.12,.1,accent,0,0,.18);
    } else if (part === 'vane') {
      box(.105,.14,.06,black,0,.1,0);box(.17,.27,.045,shell,0,.285,0);
      box(.095,.19,.015,accent,0,.29,-.031);box(.17,.035,.06,steel,0,.43,0);
    } else {
      box(.72,.64,.38,dark,0,-.04,.06);box(.48,.4,.08,shell,0,0,.29);
      box(.85,.12,.2,steel,0,.15,0);box(.35,.07,.04,accent,0,.23,.3);
      for(const side of [-1,1])box(.12,.42,.25,shell,side*.38,-.08,.08);
    }
  } else if (f === 'sabre') {
    // 斬馬刀ほどの大きな刀（2026-11-06 オーナー「斬馬刀ぐらいでっかく」）。柄は両手で持てる長さ、刃先は柄（z .2）から当たりの間合い（4.6−0.65m）の所。
    // 見た目は伸び縮みさせない。形は本作のオリジナル
    cyl(.13,1.05,dark,0,0,.42,'z',.13,8); for (let i=0;i<5;i++) box(.29,.29,.05,i%2?accent:black,0,0,.08+i*.17);
    cyl(.16,.08,steel,0,0,.98,'z',.16,8); box(1.05,.2,.24,accent,0,0,-.12); box(.8,.26,.12,dark,0,0,-.2);
    box(.64,.1,3.2,steel,.02,0,-1.86); box(.16,.16,3.2,dark,-.3,0,-1.86); box(.07,.11,3.05,0xe8f6ff,.35,0,-1.86);
    box(.08,.12,2.6,accent,-.08,0,-1.7); box(.5,.1,.4,steel,.08,0,-3.6,.0); box(.28,.1,.18,0xe8f6ff,.2,0,-3.75);
  } else if (f === 'dagger') {
    // 両刃と面取り。保存キーrodは残し、電棍の棒・電極を刃へ置き換える。長さは電棍と同じ（先端 -1.84。ユーザー指定 2026-10-20「長さ変えずに見た目と名前だけ」）
    const outline = new T.Shape();
    outline.moveTo(-.11, 0); outline.lineTo(-.15, -1.1); outline.lineTo(0, -1.7);
    outline.lineTo(.15, -1.1); outline.lineTo(.11, 0); outline.closePath();
    const blade = new T.ExtrudeGeometry(outline, { depth: .035, bevelEnabled: true, bevelThickness: .02, bevelSize: .025, bevelSegments: 1, steps: 1, curveSegments: 1 });
    blade.rotateX(Math.PI / 2); add(blade, steel, 0, .0175, -.12);
    cyl(.095,.48,dark,0,0,.21,'z',.095,8); box(.46,.1,.12,accent,0,0,-.08);
    box(.2,.19,.09,shell,0,0,.48); box(.16,.08,.14,dark,0,0,-.16);
    for (const y of [-.042, .042]) box(.035,.012,1,accent,0,y,-.75);
    for (const z of [.08,.21,.34]) cyl(.102,.025,shell,0,0,z,'z',.102,8);
  } else if (f === 'claw') {
    box(.6,.32,.7,shell);box(.45,.13,.6,accent,0,.22,0);
    for(const x of [-.22,0,.22]){box(.1,.1,1.2,steel,x,0,-.8);box(.12,.18,.22,accent,x,0,-1.42);}
  } else if (f === 'pike') {
    if(part==='hit'){ // 射撃の被弾面は従来の武器形状を保持。
      box(.65,.6,.9,dark);box(.7,.12,.6,accent,0,.34,.05);cyl(.18,1.5,steel,0,0,-.7);
      cyl(.28,.3,shell,0,0,.5);box(.2,.18,.38,steel,.34,0,-.4);
    }else if(part==='ram'){
      cyl(.17,1.15,steel,0,0,-.45);cyl(.17,.42,steel,0,0,-1.235,'z',0,6);
      cyl(.24,.16,accent,0,0,.12);
    }else{
      box(.68,.58,1.16,dark,0,0,.08);box(.72,.16,.88,shell,0,.32,.12);
      for(const x of [-.33,.33]){box(.1,.16,1.25,steel,x,0,-.05);box(.12,.12,.46,accent,x,.18,.2);}
      cyl(.31,.22,shell,0,0,-.5);cyl(.23,.23,black,0,0,-.52);
      cyl(.27,.45,shell,0,0,.86,'z',.36,8);cyl(.29,.05,black,0,0,1.1);
    }
  } else if (f === 'jammer' || f === 'stunGrenade') {
    ball(.3,shell);cyl(.19,.22,accent,0,.3,0,'y');
    if(f==='jammer')for(const x of [-.22,.22])cyl(.035,.7,steel,x,.3,0,'y');
    else for(const x of [-.26,.26])box(.09,.55,.2,steel,x,0,0);
  } else if (f === 'airTurret' || f === 'flyTurret') {
    box(.58,.25,.6,shell);barrel(.09,.62,-.58);ball(.12,accent,0,.22,-.2);
    if(f==='airTurret')for(const x of [-.62,.62]){cyl(.28,.12,dark,x,.12,0,'y');box(.45,.04,.08,steel,x,.2,0);}
    else {for(const x of [-.55,.55]){box(.7,.06,.55,steel,x,.05,.05);box(.1,.23,.55,accent,x*1.5,.1,.08);}box(.25,.22,.4,dark,0,.15,.45);}
  } else if (f === 'planeSensor') {
    box(.65,.16,.5,dark);box(.17,.8,.2,steel,0,.45,0);box(.85,.12,.16,accent,0,.78,0);box(.5,.35,.14,shell,0,.5,-.1);
  } else if (f === 'ammoBox') {
    box(.75,.55,.55,shell);box(.78,.1,.58,accent,0,.2,0);box(.1,.65,.58,steel,-.3,0,0);box(.1,.65,.58,steel,.3,0,0);
    box(.3,.1,.2,dark,0,.34,0);box(.18,.23,.03,accent,0,0,-.3);
  } else if (f === 'radarTool') {
    receiver(.55,.35,.6);box(.8,.8,.14,dark,0,.6,-.4);box(.58,.56,.09,accent,0,.6,-.5);
    for(const x of [-.5,.5]){cyl(.045,.8,steel,x,.65,-.4,'y');ball(.1,accent,x,1.08,-.4);}
  } else if (f === 'flare') {
    ball(.34,shell); cyl(.21,.16,accent,0,.35,0,'y');
    for (const x of [-.37,.37]) box(.08,.55,.25,steel,x,0,0);
    for (let i=0;i<3;i++) cyl(.35,.04,accent,0,-.2+i*.2,0,'y');
  } else if (f === 'chain') {
    box(.78,.26,.6,dark); box(.65,.18,.42,shell,0,.17,0);
    for (let i=0;i<3+v;i++) {box(.1,.12,.35,accent,(i-(2+v)/2)*.13,.31,0);}
    box(.4,.12,.16,steel,0,0,-.42);
  } else if (f === 'jumpMine' || f === 'delayMine') {
    cyl(.42,.15,dark,0,0,0,'y',.48,6); cyl(.29,.2,shell,0,.15,0,'y',.34,6);
    if (f === 'jumpMine') {
      cyl(.12,.52,steel,0,.42,0,'y'); ball(.18,accent,0,.72,0);
      for (const x of [-.33,.33]) box(.08,.48,.12,steel,x,.25,0);
    } else {
      for (const x of [-.32,.32]) for (const z of [-.25,.25]) box(.15,.13,.18,accent,x,.23,z);
      box(.45,.16,.12,steel,0,.32,0);
    }
  } else if (['dart','charge','zoom','blastSniper','lightSniper','optSniper','detonator'].includes(f)) {
    receiver(f==='charge'?.74:.5,.45,f==='dart'?.8:1.15);
    box(.26,.55,v===1?.48:.3,dark,0,-.47,.05);
    if(f==='dart') {
      const n=v===1?5:3;
      for(let i=0;i<n;i++)barrel(.085,.85,-.82,(i-(n-1)/2)*.2);
      box(.9,.12,.3,accent,0,.25,-.75);
    } else if(f==='charge') {
      barrel(.23,1.5,-1.08);
      for(let i=0;i<4;i++){cyl(.36,.1,accent,0,0,-.55-i*.29);box(.14,.16,.18,steel,.35,0,-.55-i*.29);}
      box(.45,.6,.65,shell,.55,-.05,.2);
    } else if(f==='detonator') {
      barrel(.26,1.1,-.9);cyl(.4,.5,shell,0,-.32,-.1,'x');
      box(.18,.32,.6,accent,.35,.1,-.65);box(.35,.15,.6,dark,0,.3,0);
    } else {
      const energy=f==='lightSniper'||f==='optSniper',opt=f==='optSniper';barrel(opt?.14:energy?.12:.15,opt?2.1:1.6,opt?-1.43:-1.18);
      box(.35,.3,.55,shell,0,0,.8);
      if(f==='zoom') {cyl(.12,.6,black,-.12,.48,-.08);cyl(.17,.35,accent,.17,.48,-.18);}
      else {cyl(.13,.7,black,0,.45,-.15);box(.18,.1,.2,accent,0,.6,-.35);}
      if(energy)for(const x of [-.23,.23])box(.09,.15,opt?1.8:1.35,accent,x,0,opt?-1.3:-1.05);
      if(opt){cyl(.2,.22,accent,0,0,-2.4);cyl(.17,.55,black,0,.45,.15);box(.3,.38,.12,dark,0,-.1,-.25);} // 光学狙撃銃（2026-11-07、形は本作のオリジナル）：長い銃身の先に発光リング、後ろに大きいスコープ
      if(f==='blastSniper'){box(.72,.32,.18,steel,0,0,-1.75);for(const x of [-.28,.28])box(.08,.62,.1,dark,x,-.35,-.9,x*.8);}
    }
    if(v===2)box(.16,.15,.6,accent,.34,.2,-.4);
  } else if (f === 'artillery') {
    box(1.5,.45,.85,dark,0,-.35,0); box(1.2,.65,.65,shell,0,0,0);
    for (const x of [-.45,0,.45]) { cyl(.2,1.3,steel,x,.35,0,'y'); cyl(.23,.12,black,x,1,0,'y'); box(.12,.7,.08,accent,x,.25,-.22); }
    box(.9,.18,.2,accent,0,-.5,-.5);
  } else if (f === 'reflector') {
    // 反射衛星砲（2026-11-05、オーナーのオリジナル。形は本作のオリジナル）：背中に載せる、真上を向いた照射塔。
    // 台座と左右の蓄電器、縦の照射筒に3つの収束リング、頂の発光レンズ（照射の光の柱はここから出る。muzzle は台の上 1.08m）、横に衛星との交信アンテナ
    box(1.3,.4,.85,dark,0,-.38,0); box(.95,.22,.7,shell,0,-.12,0);
    for (const x of [-.56,.56]) { box(.32,.62,.56,shell,x,.08,.05); box(.34,.08,.58,accent,x,.3,.05); box(.06,.4,.04,0x7cfbd1,x+(x>0?.17:-.17),.08,-.18); }
    cyl(.17,1.05,steel,0,.42,0,'y',.21,12); cyl(.24,.14,dark,0,-.02,0,'y',.24,12);
    for (const [y,r] of [[.2,.3],[.48,.27],[.76,.24]]) add(new T.TorusGeometry(r,.045,6,18),accent,0,y,0,Math.PI/2);
    cyl(.2,.1,black,0,.95,0,'y',.17,12); ball(.16,0x9fe8ff,0,1.02,0);
    add(new T.CylinderGeometry(.34,.08,.12,14),steel,-.62,.62,.28,-.55,0,-.35); cyl(.025,.32,black,-.62,.52,.32,'y'); ball(.05,accent,-.66,.72,.22);
    box(.62,.3,.36,dark,0,-.3,-.58); box(.5,.12,.18,accent,0,-.48,-.78); // 背中への取り付け金具
  } else if (f === 'barrier') {
    box(1.1,1.25,.5,dark); box(.7,.9,.22,shell,0,0,-.35);
    for (const x of [-.7,.7]) { box(.22,1.55,.45,steel,x,0,-.2); ball(.22,accent,x,.65,-.4); }
    cyl(.4,.18,accent,0,0,-.5);
  } else if (f === 'escort') {
    box(1.2,.45,.65,dark,0,0,.1); cyl(.35,.45,steel,0,.4,0,'y'); box(.55,.4,.65,shell,0,.8,-.2);
    for (let i=0;i<(v === 1 ? 3 : 1);i++) barrel(v === 2 ? .2 : .1,1.1,-1, (i-(v===1?1:0))*.19,.8);
    ball(.16,accent,.38,.8,-.35);
  } else if (f === 'repairPost') {
    cyl(.22,1.3,steel,0,0,0,'y',.08); box(.6,.4,.55,shell,0,.35,0); ball(.22,accent,0,.7,0);
    for (const x of [-.45,.45]) box(.15,.9,.2,dark,x,-.15,0,x>0?-.4:.4);
  } else if (primaryShapes.includes(f)) {
    const dual = f.startsWith('dual'), heavy = ['autocannon','explosive','chargeCannon','coilCannon'].includes(f);
    const length = (dual ? .72 : heavy ? 1.4 : 1.15) * [1,1.08,1.2][v], width = dual ? .34 : heavy ? .72 : .5;
    receiver(width, dual ? .32 : .48, length);
    const energy = ['wave','energyMG','chargeCannon','dualEnergy','dualCharge','energyShot','focusShot','railRifle','pulseRifle','coilCannon'].includes(f), light = energy ? 0x7cfbd1 : accent;
    if (!dual) box(.3,.34,.65,dark,0,.02,length/2+.22);
    box(width*.55,[.42,.72,.5][v],v===1?.5:.28,dark,0,-.42,.12);
    box(width*.57,.1,v===1?.53:.31,light,0,v===1?-.79:-.59,.12);
    if (f === 'railRifle') {
      // 細い上下のレールと角形の先端。公式モデルの形は使わない。
      for (const side of [-1,1]) {
        box(.16,.18,1.4,steel,0,side*.22,-1.07);
        box(.08,.08,1.1,light,side*.22,0,-1.02);
      }
      box(.52,.56,.16,dark,0,0,-1.76);
      box(.22,.18,.18,light,0,0,-1.86);
      box(.18,.42,.55,accent,.34,-.08,.25);
    } else if (f === 'pulseRifle') {
      barrel(.14,.95,-.94);
      for (let i=0;i<3;i++) {
        box(.64,.1,.12,steel,0,.24,-.45-i*.25);
        box(.08,.22,.14,light,.3,.03,-.45-i*.25);
      }
      box(.58,.3,.22,dark,0,0,-1.42);
      box(.2,.18,.1,light,0,0,-1.58);
    } else if (f === 'coilCannon') {
      barrel(.19,1.35,-1.08);
      for (let i=0;i<4;i++) {
        cyl(.31,.1,accent,0,0,-.55-i*.29);
        box(.08,.12,.16,light,.31,0,-.55-i*.29);
      }
      box(.46,.5,.65,dark,.52,-.12,.1);
      box(.3,.08,.5,light,.52,-.41,.1);
    } else if (f === 'carbine') {
      barrel(.11,1.1,-1); box(.3,.6,.4,shell,0,-.28,.55);
      for(let i=0;i<5;i++) box(.52,.06,.06,steel,0,.28,-.35-i*.15);
      box(.08,.5,.42,accent,.3,0,.1);
    } else if (f === 'burst') {
      barrel(.12,1.2,-1.05); box(.58,.2,.65,dark,0,-.15,-.72);
      for(let i=0;i<3;i++) box(.58,.08,.1,accent,0,.16,-.52-i*.22);
      cyl(.1,.45,black,0,.43,-.15);
    } else if (f === 'marksman') {
      barrel(.09,1.85,-1.38); cyl(.16,.8,dark,0,.47,-.14); cyl(.12,.07,light,0,.47,-.58);
      for(const side of [-1,1]) box(.05,.62,.07,steel,side*.22,-.35,-1.05,side*.35);
    } else if (f === 'compactShot') {
      for(const side of [-1,1]) barrel(.16,.58,-.75,side*.16);
      box(.56,.22,.36,light,0,-.15,-.57); cyl(.14,.65,dark,0,-.22,.15);
    } else if (f === 'autocannon' || f === 'explosive') {
      barrel(f==='explosive'?.23:.19,1.7,-1.5); cyl(.35,.7,shell,0,0,-.65);
      box(.72,.12,.7,light,0,.4,-.25);
      if(f==='explosive') {cyl(.5,.75,dark,.45,-.3,.1,'x');cyl(.35,.78,accent,.45,-.3,.1,'x');}
      else {box(.43,.86,.7,shell,.5,-.2,.15);box(.45,.13,.72,steel,.5,-.65,.15);}
    } else if (f === 'dualSemi') {
      barrel(.1,.72,-.6); box(.38,.2,.95,steel,0,.17,-.15); box(.12,.12,.16,light,0,.32,-.48);
    } else if (f === 'dualSMG') {
      barrel(.085,.55,-.56); cyl(.3,.42,shell,.25,-.25,-.05,'x');
      box(.38,.12,.65,steel,0,.23,-.2); box(.16,.48,.2,accent,0,-.22,-.42);
    } else if (f === 'dualSpread') {
      for(const x of [-.21,0,.21]) barrel(.1,.65,-.66,x);
      box(.75,.12,.32,shell,0,.18,-.62); box(.75,.06,.13,light,0,.26,-.74);
    } else if (f === 'autoShot') {
      barrel(.18,1,-.95); cyl(.42,.6,dark,0,-.32,.04,'x'); cyl(.28,.63,light,0,-.32,.04,'x');
      box(.56,.18,.5,shell,0,-.18,-.66);
    } else if (f === 'nail') {
      box(.62,.62,.82,shell,0,0,-.32); barrel(.065,.7,-.9);
      for(let i=0;i<4;i++) box(.07,.32,.09,steel,.34,0,-.1-i*.15);
      box(.56,.1,.7,accent,0,.38,-.12);
    } else if (f === 'energyShot' || f === 'focusShot') {
      const count=f==='focusShot'?10:5, radius=f==='focusShot'?.27:.21;
      cyl(radius+.12,.22,dark,0,0,-.68);
      for(let i=0;i<count;i++) {const a=i/count*Math.PI*2;barrel(.065,.55,-.91,Math.cos(a)*radius,Math.sin(a)*radius);}
      cyl(radius+.1,.1,light,0,0,-1.17);
      for(const side of [-1,1]) box(.14,.45,.55,steel,side*.38,.04,-.65);
    } else {
      const count=f==='chargeCannon'?4:2, radius=f==='chargeCannon'?.35:dual?.17:.28;
      const long=f==='wave'?1.6:dual?.85:1.25;
      for(let i=0;i<count;i++) {const a=i/count*Math.PI*2;box(.12,.12,long,steel,Math.cos(a)*radius,Math.sin(a)*radius,-.5-long/2);}
      box(width+.14,.16,.46,light,0,.32,-.38);
      for(const side of [-1,1]) {cyl(dual?.14:.23,.7,dark,side*(width/2+.1),0,.05);cyl(dual?.1:.17,.12,light,side*(width/2+.1),0,-.36);}
      if(f==='dualCharge'||f==='chargeCannon') ball(dual?.16:.24,light,0,0,-.75);
      if(f==='wave') box(.85,.25,.12,light,0,0,-2);
      if(f==='energyMG') for(let i=0;i<4;i++) cyl(.31,.08,light,0,0,-.6-i*.23);
    }
    if(v===1) box(width+.16,.16,.4,light,0,.45,.2);
    if(v===2) {barrel(heavy?.23:.12,.35,-(dual?1.15:1.75)); box(.16,.19,.38,black,0,.48,-.12);}
  } else if (part === 'mount' && f === 'cannon') {
    box(1.45,.95,.25,dark,0,0,0);
    for(const side of [-1,1]) {
      box(.18,1.2,.25,steel,side*.62,.1,.08);
      cyl(.2,.22,shell,side*.68,.52,.18,'x');
    }
    box(1.1,.14,.28,accent,0,-.25,.18);
    // 右肩側の支持腕とヒンジ。砲身本体だけを起こすため、基部は背中に残す。
    box(.9,.18,.24,shell,.65,.48,.18);
    cyl(.22,.35,steel,1.04,.48,.18,'x');
    box(.24,.18,1.22,shell,1.04,.48,-.4);
    cyl(.22,.35,steel,1.04,.48,-.9,'x');
  } else if (f === 'ar') {
    receiver(.48,.42,1.1); barrel(v===2?.16:.1,v===2?1.45:1.05,v===2?-1.08:-.88);
    box(.35,.35,.6,dark,0,0,.78); box(.16,.6,v===1?.55:.3,accent,0,-.4,-.12);
    if (v===1) cyl(.35,.5,dark,0,-.35,-.1,'x');
    if (v===2) { cyl(.13,.6,black,0,.42,-.06); box(.36,.17,.72,dark,0,-.2,-.72); }
  } else if (f === 'lmg') {
    receiver(.6,.48,1.35); barrel(v===2?.16:.11,v===1?1.05:1.45,v===1?-1:-1.2);
    box(.5,.65,.62,dark,.42,-.32,.12); box(.52,.09,.64,accent,.42,-.65,.12);
    box(.35,.35,.65,shell,0,.04,.95); box(.7,.08,.23,steel,0,.45,-.14);
    for(let i=0;i<5;i++) box(.56,.065,.08,steel,0,.23,-.46-i*.18);
    for(const side of [-1,1]) box(.07,.68,.09,dark,side*.23,-.34,-.85,side*.35);
    if(v===1) cyl(.35,.5,accent,.5,-.26,.16,'x');
    if(v===2) cyl(.12,.55,dark,0,.46,-.1);
  } else if (f === 'magnum') {
    receiver(v===2?.43:.36,.35,.8); barrel(v===2?.16:.12,[.65,.85,1.1][v],[-.68,-.78,-.9][v]);
    cyl(v===1?.34:.27,.5,shell,0,-.08,-.14,'x',v===1?.34:.27,12);
    for(let i=0;i<6;i++) {const a=i*Math.PI/3; cyl(.045,.51,steel,0,Math.cos(a)*.22-.08,Math.sin(a)*.22-.14,'x');}
    box(.24,.6,.3,dark,0,-.4,.3,-.2); box(.25,.17,.25,accent,0,-.58,.35);
    if(v===2) { box(.5,.11,.9,steel,0,.24,-.26); box(.15,.12,.13,black,0,.34,-.7); }
  } else if (f === 'gatling') {
    receiver(.78,.64,1.15); const count=[6,4,8][v], r=[.3,.33,.26][v], len=[1.25,1.5,1.1][v];
    cyl(.47,.18,dark,0,0,-.55); cyl(.47,.16,shell,0,0,-.55-len);
    for (let i=0;i<count;i++) { const a=i/count*Math.PI*2; barrel(v===1?.14:.085,len,-.55-len/2,Math.cos(a)*r,Math.sin(a)*r); }
    cyl(.43,.85,accent,.62,-.2,.2,'z'); box(.18,.2,.5,steel,-.55,.28,.15);
    if(v===2) for(let i=0;i<4;i++) box(.95,.045,.08,steel,0,.4,.35-i*.18);
  } else if (f === 'missileRack') {
    // 枠と独立した円筒セルを持つオリジナルの携行ランチャー。公式の形は使わない。
    box(.7, .42, 1.55, dark, 0, .03, -.2);
    box(.24, .55, .3, black, 0, -.3, .18);
    box(.62, .13, .9, steel, 0, .38, -.1);
    const rows = v === 1 ? 3 : 2;
    for (let y = 0; y < rows; y++) for (let x = 0; x < 2; x++) {
      const cx = (x - .5) * .39, cy = (y - (rows - 1) / 2) * .35;
      cyl(.165, 1.65, shell, cx, cy, -.3);
      cyl(.12, .035, black, cx, cy, -1.14);
      cyl(.075, .04, accent, cx, cy, -1.17);
    }
    box(.12, .18, .32, accent, .47, .3, -.35);
  } else if (f === 'rocket' || f === 'cannon') {
    const heavy=f==='cannon', n=heavy?[2,4,1][v]:v===1?3:1, radius=heavy?(v===2?.48:.27):(v===2?.4:.29), len=heavy?2.4:1.9;
    receiver(heavy?.8:.58,.55,.9);
    for(let i=0;i<n;i++) {
      const x=n===1?0:n===2?(i-.5)*.65:(i%2-.5)*.62, y=n>2?Math.floor(i/2)*.58:.18;
      cyl(radius,len,shell,x,y,-.35); cyl(radius*1.09,.2,steel,x,y,-.35-len/2); cyl(radius*.78,.022,black,x,y,-.46-len/2);
      box(.13,.1,len*.6,accent,x,y+radius,-.15);
    }
    box(.23,.72,.34,dark,-.45,-.16,.1); if(heavy) box(1.4,.15,.42,dark,0,-.45,.25);
  } else if (f === 'pistols') {
    receiver(v===2?.38:.3,.3,v===1?.8:.65); barrel(v===2?.13:.085,v===2?.65:.38,v===2?-.57:-.43);
    box(.22,v===1?.68:.42,.26,accent,0,-.4,.14);
    if(v===1) box(.38,.14,.68,steel,0,.19,-.08);
    if(v===2) cyl(.2,.5,dark,0,-.16,-.1,'x');
  } else if (f === 'sniper') {
    receiver(.38,.36,1.5); barrel(v===2?.13:.08,[1.65,1.45,2.05][v],[-1.5,-1.4,-1.7][v]);
    box(.25,.42,.85,dark,0,-.03,1); box(.16,.38,.3,accent,0,-.35,.15);
    cyl([.14,.18,.22][v],[.65,.8,1][v],dark,0,.39,-.15); cyl(.13,.04,accent,0,.39,-.68);
    if(v!==1) for(const s of [-1,1]) box(.06,.65,.07,steel,s*.2,-.35,-1.05,s*.45);
    if(v===1) box(.52,.12,.8,steel,0,-.22,-.55);
  } else if (f === 'shotgun') {
    receiver(.6,.5,1.12); const count=[1,3,2][v];
    for(let i=0;i<count;i++) barrel(v===1?.13:.17,v===2?1.4:.9,v===2?-1:-.78,(i-(count-1)/2)*.27);
    box(.5,.28,.5,accent,0,-.15,-.65); box(.4,.35,.6,dark,0,-.04,.82);
    for(let i=0;i<3;i++) box(.055,.32,.08,steel,.31,-.04,.25-i*.18);
  } else if (f === 'stunner') {
    // スタンガン（2026-11-05、オーナーのオリジナル。形は本作のオリジナル）：短い本体の先に二股の放電端子、中ほどに巻いたコイルと蓄電筒
    receiver(.5,.46,.9);
    for (const x of [-.17,.17]) { box(.1,.12,.75,steel,x,.04,-.75); box(.14,.16,.12,accent,x,.04,-1.12); box(.05,.05,.12,0x9fe8ff,x,.04,-1.22); }
    box(.24,.08,.3,dark,0,.04,-.55);
    for (let i=0;i<4;i++) add(new T.TorusGeometry(.2,.035,5,14),i%2?accent:steel,0,.04,-.12-i*.13);
    cyl(.13,.55,dark,0,.34,.15,'z'); cyl(.09,.5,0x7cfbd1,0,.34,.15,'z',.09,8);
  } else if (f === 'seeker') {
    // レーザー誘導ロケット（2026-11-06、形は本作のオリジナル）：発射筒（三点射型3本・連射型5本・強装型は太い1本）、上に紫のレンズの誘導器とアンテナ、横に握り
    const k = id.slice(-1), n = k === 'K' ? 3 : k === 'R' ? 5 : 1, r = k === 'H' ? .38 : n > 1 ? .17 : .28, len = k === 'H' ? 2.2 : 1.95;
    const at = n === 1 ? [[0, 0]] : n === 3 ? [[-.2, -.12], [.2, -.12], [0, .2]] : [[-.36, -.12], [0, -.12], [.36, -.12], [-.18, .19], [.18, .19]];
    box(.62, .5, .8, shell, 0, -.05, .45);
    for (const [x, y] of at) {
      cyl(r, len, dark, x, y, -.4); cyl(r * 1.15, .18, steel, x, y, -.4 - len / 2 + .09);
      cyl(r * .8, .03, black, x, y, -.4 - len / 2 - .01); cyl(r * 1.12, .14, accent, x, y, -.4 + len / 2 - .1);
    }
    const top = n === 1 ? r + .12 : .42;
    box(.32, .24, .55, dark, .1, top + .08, -.2); cyl(.1, .06, 0xc58cff, .1, top + .08, -.5); box(.36, .05, .3, accent, .1, top + .22, -.15);
    box(.04, .36, .04, steel, -.12, top + .3, 0);
    box(.2, .62, .3, dark, -.45, -.3, .3, -.12);
    if (k === 'H') for (const sx of [-1, 1]) box(.05, .38, .55, steel, sx * (r + .04), 0, .25);
  } else if (f === 'waveSword') {
    // 二枚の導光レールと刃の発振器。既存ソードと同じ握り位置を持つオリジナル形。
    box(.16,.42,3.25,steel,0,0,-.12); box(.2,.12,2.85,accent,0,0,-.25);
    for (const y of [-.28,.28]) { box(.22,.08,2.6,dark,0,y,-.27); box(.24,.045,2.2,accent,0,y,-.35); }
    box(.3,.9,.22,shell,0,0,1.18); cyl(.18,.22,accent,0,0,1.1);
    box(.22,.22,.72,dark,0,0,1.68); box(.28,.28,.12,steel,0,0,2.08);
  } else if (f === 'sword') {
    const length=[3.4,3.7,4.3][v], width=[.38,.62,.9][v];
    box(.13,width,length,steel,0,0,-.05); box(.15,.09,length*.85,accent,0,-width/2,-.15);
    box(.2,width+.45,.17,dark,0,0,length/2-.5); box(.22,.22,.72,dark,0,0,length/2-.05);
    if(v===1) for(let i=0;i<3;i++) box(.2,.23,.28,dark,0,width/2,-.5-i*.62);
    if(v===2) { box(.2,.4,1.9,shell,0,width/2-.02,-.4); box(.23,.18,.7,accent,0,0,length/2+.28); }
  } else if (f === 'grenade' || f === 'weaken') {
    const color=f==='weaken'?0x987ae5:accent, r=[.32,.25,.43][v];
    if(v===0) ball(r,shell); else cyl(r,[.5,.65][v-1],shell,0,0,0,'y',r*.8);
    cyl(r*1.05,.12,color,0,.03,0,'y'); box(.16,.2,.19,dark,0,.33,0); box(.12,.07,.48,steel,0,.44,-.1);
    if(v===2) for(let i=0;i<4;i++) box(.08,.4,.1,dark,Math.cos(i*Math.PI/2)*r,0,Math.sin(i*Math.PI/2)*r);
  } else if (f === 'mine') {
    const r=[.67,.85,.57][v]; cyl(r,.2,shell,0,0,0,'y'); cyl(r*.65,.15,dark,0,.16,0,'y');
    for(let i=0;i<[4,6,3][v];i++) { const a=i/[4,6,3][v]*Math.PI*2; box(.16,.15,.23,accent,Math.cos(a)*r*.68,.18,Math.sin(a)*r*.68); }
    if(v===2) cyl(.23,.26,accent,0,.28,0,'y');
  } else if (f === 'sensor') {
    cyl([.4,.28,.5][v],.24,dark,0,0,0,'y'); cyl(.06,[.65,.45,.85][v],steel,0,.4,0,'y');
    if(v===0) { ball(.26,shell,0,.78); box(.6,.13,.13,accent,0,.8); }
    if(v===1) { box(.42,.35,.18,shell,0,.56); box(.31,.12,.05,accent,0,.58,-.13); }
    if(v===2) { cyl(.56,.1,shell,0,.85,-.1,'z'); cyl(.41,.03,accent,0,.85,-.18); cyl(.08,.2,steel,0,.85,-.3); }
  } else if (f === 'drone') {
    box(.44,.26,v===1?1.8:1.05,shell); box(v===1?1.1:1.8,.09,.3,steel,0,0,.12);
    if(v===1) { box(.09,.5,.42,accent,0,.2,.65); cyl(.13,.22,black,0,0,-.9); }
    else for(const x of [-.74,.74]) for(const z of [-.48,.48]) { cyl(v===2?.37:.26,.06,dark,x,.05,z,'y'); cyl(.07,.12,accent,x,.13,z,'y'); }
    if(v===2) ball(.3,accent,0,-.23,0); else ball(.13,accent,0,-.14,-.4);
  } else if (f === 'repair') {
    receiver(.5,.48,.9); const n=[2,1,3][v];
    for(let i=0;i<n;i++) { const x=(i-(n-1)/2)*.23; cyl(.11,v===1?1.25:.65,steel,x,0,v===1?-.9:-.65); ball(.12,0x89e9b4,x,0,v===1?-1.55:-1); }
    cyl(v===2?.34:.23,.55,0x5da67d,.4,-.06,.2,'y'); box(.25,.12,.4,accent,0,.33,.1);
  } else if (f === 'omni') {
    box(1.25,.65,.6,shell); box(.55,.14,.7,accent,0,.4,0);
    for(const side of [-1,1]) {
      cyl(v===1?.32:.25,v===2?1.1:.7,dark,side*.72,0,.22);
      cyl(.2,.08,accent,side*.72,0,v===2?.8:.63);
      cyl(.22,.45,steel,side*.88,-.02,0,'x'); cyl(.14,.04,accent,side*1.13,-.02,0,'x');
      cyl(.19,.24,dark,side*.5,0,-.45); cyl(.12,.03,accent,side*.5,0,-.59);
    }
    if(v===1) box(2.25,.11,.38,steel,0,.4,.1);
    if(v===2) for(const side of [-1,1]) box(.34,.7,.65,steel,side*.93,0,.1);
  } else if (f === 'charger') {
    box(1.1,.64,.55,shell); const n=v===2?3:2;
    for(let i=0;i<n;i++) { const x=(i-(n-1)/2)*.65; cyl(v===1?.35:.27,v===1?1.35:.85,dark,x,0,.25); cyl(.2,.1,accent,x,0,v===1?.98:.72); }
    if(v===1) for(const x of [-.85,.85]) box(.27,.7,.65,steel,x,0,-.1);
    if(v===2) box(1.8,.1,.45,accent,0,.43,0);
  } else if (f === 'mirage') {
    // 本作オリジナル：左右の投影レンズと扇状アンテナ。
    box(1.2,.55,.5,shell);
    for(const x of [-.72,.72]) {
      box(.3,v===1?.85:.65,.6,dark,x,.1,0);
      cyl(.22,.1,steel,x,.15,.38); cyl(.16,.04,0x75f4ec,x,.15,.46);
      for(const a of [-.5,0,.5]) box(.06,.58,.08,accent,x+Math.sin(a)*.2,.62,0,a);
    }
  } else if (f === 'camo') {
    box(v===1?1.6:1.1,.7,.45,shell); const n=[2,4,1][v];
    for(let i=0;i<n;i++) { const x=(i-(n-1)/2)*.35; cyl(v===2?.3:.13,.17,dark,x,0,.3); cyl(v===2?.23:.08,.03,0xb798f5,x,0,.41); }
    for(const x of [-.65,.65]) box(.09,v===2?1.25:.85,.12,accent,x,.2,0);
  } else if (f === 'spear') {
    // スピア（本作で追加）：細い柄と穂先。刃と同じく機体の前（-z）へ向け、長さ6.1m（間合い7.5m−根元1.4m）
    const L=6.1; cyl(.07,L,dark); add(new T.ConeGeometry(.2,1.1,8),steel,0,0,-L/2-.3,-Math.PI/2);
    box(.1,.3,.5,accent,0,0,-L/2+.4); box(.16,.16,.9,black,0,0,L/2-.45);
  } else if (f === 'sonar') {
    // 索敵ソナー（本作で追加）：投げる球と帯、短いアンテナ
    ball(.3,shell); cyl(.34,.08,accent,0,0,0,'y'); cyl(.05,.3,steel,0,.32,0,'y'); ball(.08,0x7dd8ff,0,.5,0);
  } else if (f === 'sentry') {
    // 自動砲台（本作で追加）：台座、旋回する胴、前（-z）へ向いた銃身
    cyl(.6,.22,dark,0,-.58,0,'y'); for(let i=0;i<3;i++){const a=i/3*Math.PI*2; box(.14,.12,.8,steel,Math.sin(a)*.45,-.62,Math.cos(a)*.45,0);}
    box(.8,.55,.8,shell,0,-.12,0); box(.52,.1,.52,accent,0,.2,0); barrel(.09,.9,-.8,0,-.05); cyl(.12,.25,black,.3,.08,-.25);
  } else if (f === 'remote') {
    // 遠隔爆弾（本作で追加）：平たい爆薬と赤い起爆灯
    cyl(.55,.3,shell,0,0,0,'y',.62); cyl(.3,.12,dark,0,.2,0,'y'); ball(.12,0xff6a5a,0,.3,0);
    for(let i=0;i<4;i++){const a=i*Math.PI/2; box(.14,.1,.22,accent,Math.cos(a)*.48,.1,Math.sin(a)*.48);}
  } else if (f === 'fmine') {
    // 浮遊機雷（本作で追加）：浮かぶ球と6本の触角
    ball(.5,shell); cyl(.55,.1,accent,0,0,0,'y');
    for(const [x,y,z] of [[.55,0,0],[-.55,0,0],[0,.55,0],[0,-.55,0],[0,0,.55],[0,0,-.55]]) ball(.1,steel,x,y,z);
  } else if (f === 'field') {
    // リペアフィールド（本作で追加）：背中の発生装置と緑の球
    box(1.1,.7,.5,shell); cyl(.32,.2,dark,0,.15,.3); ball(.26,0x89e9b4,0,.15,.42);
    for(const side of [-1,1]) { box(.12,.9,.12,accent,side*.62,.25,0); ball(.1,0x89e9b4,side*.62,.75,0); }
  }
  const geo = new T.BufferGeometry();
  for(const key of Object.keys(values)) geo.setAttribute(key,new T.Float32BufferAttribute(values[key],3));
  geo.computeBoundingBox(); geo.computeBoundingSphere(); geo.userData.weaponId=id;
  return geo;
}
const weaponGeoBank = new Map();
// 形を返す。同じ形は機体の手・背中、投げた物、設置物、カードの絵で共有する（捨てない）。part：'whole' か、重砲の背中の基部 'mount'
function weaponGeo(id, part = 'whole') {
  const k = id + ':' + part;
  if (!weaponGeoBank.has(k)) weaponGeoBank.set(k, MODEL_OF[id]?.[0]==='beamCannon' ? visualAlloc(()=>buildWeaponGeo(id,part)) : buildWeaponGeo(id, part));
  return weaponGeoBank.get(k);
}
// 投げた物・設置物・偵察機の色：形の色にチームの色を半分混ぜる
const toolMat = Object.fromEntries(['B', 'R'].map(t => [t, new T.MeshLambertMaterial({ vertexColors: true, color: new T.Color(TEAM[t].color).lerp(new T.Color(0xffffff), 0.5) })]));

return { MODEL_OF, palette, buildWeaponGeo, weaponGeoBank, weaponGeo, toolMat };
}

// 武器の表：重量・武器・兵装・機体カスタマイズの一覧・シリーズ・型・主武器の反動。本体の「兵装と武器」の位置で呼ぶ
function weaponTables() {
// 武器の重量（kg、wiki の強化前。元の武器名は research/weapons/*.md）
const WEAPON_KG = { mirage: 300, mirageH: 420, mirageL: 240, mirageD: 330, missile: 350, mlrs: 500, seeker: 470, waveSword: 230, stunner: 260, sabre: 180, rod: 190, claw: 200, pike: 210, jammer: 140, airTurret: 410, flyTurret: 490, stunGrenade: 210, planeSensor: 340, ammoBox: 300, radarTool: 370, flare: 170, chain: 140, dart: 340, charge: 490, zoom: 220, blastSniper: 350, lightSniper: 260, optSniper: 280, jumpMine: 150, delayMine: 170, detonator: 260, ar: 140, burst: 240, marks: 250, grenade: 100, timed: 90, gl: 220, sword: 230, blade: 320, spear: 200, charger: 270, chargerD: 310, chargerS: 320, gatling: 360, mg: 290, acannon: 400, rocket: 490, scrum: 520, plasma: 460, weaken: 180, impactb: 140, hsg: 200, cannon: 800, cannonH: 870, cannonM: 980, pistols: 180, dualmg: 290, coyote: 250, sniper: 240, battle: 230, lzsniper: 290, drone: 370, sonar: 230, sentry: 350, camo: 240, camoD: 320, camoH: 300, shotgun: 220, autosg: 190, nail: 140, mine: 240, fmine: 160, remote: 280, sensor: 260, airsensor: 380, fansensor: 380, repair: 580, repairG: 600, field: 550,
  carbine: 320, gale: 160, vulcan: 280, margay: 190, gemini: 280, haggard: 210, aurora: 270,
  wave: 330, lec: 340, explo: 440, wide: 230, glint: 340, cls: 260, omni: 240,
  beamCannon: 700, rail: 280, pulse: 190, coil: 410, barrier: 710, escort: 310, repairPost: 480, artillery: 900, reflector: 900 }; // 型の重さは WEAPON_TYPES から足す（v0.14）

// ---- 兵装と武器 ----
// 既存武器はPS4版の初期武器を基準にした値を保持。新しい系統はアーケード版wikiの現行表に合わせる。
// rpm：毎分の発射数、mag：1マガジンの弾数、mags：マガジン数、reload：秒、spread：ばらつき、look：銃身の見た目の拡大率、sfx：発射音（SFX の名前）
// AC追加近接：hits は原典の各段威力。専用ダッシュの追加・再配分は今回の指定（採用記録参照）。
function auxiliaryMelee(hits, profile, strong=false, rank=0) {
  // ユーザー指定 2026-10-22：日本刀は跳躍4段、爪は長いレーザーの左右袈裟、短刀は3段。
  const dmg=hits.reduce((n,x)=>n+x,0);
  if(strong) {
    let strikes,windup,sweep,recover;
    if(profile==='sabre') {
      // 日本刀：袈裟→逆袈裟→横薙ぎ→小跳躍から片手の面打ち。最後は旧ダッシュの全威力。
      windup=.14;sweep=1.47;recover=.45;
      const cuts=rank===0?[2500,2500,2500]:rank===1?[3000,3500,3500]:[3500,3500,4000];
      strikes=[
        {dmg:cuts[0],at:0,sweep:.22,from:-55,to:55,pitchFrom:48,pitchTo:-32,gripFrom:[.4,2.9,-.55],gripTo:[-.3,2.25,-.65],motion:'kesa'},
        {dmg:cuts[1],at:.31,sweep:.22,from:55,to:-55,pitchFrom:-32,pitchTo:48,gripFrom:[-.3,2.25,-.65],gripTo:[.4,2.9,-.55],motion:'reverse'},
        {dmg:cuts[2],at:.62,sweep:.24,from:-75,to:75,pitchFrom:0,pitchTo:0,gripFrom:[.35,2.4,-.65],gripTo:[-.35,2.4,-.65],motion:'horizontal'},
        {dmg,at:1.09,sweep:.38,from:0,to:0,pitchFrom:78,pitchTo:-62,gripFrom:[.35,3.45,-.15],gripTo:[.25,2.2,-.7],motion:'men',single:true}
      ].map(s=>({...s,hand:1}));
    } else if(profile==='claw') {
      windup=.14+rank*.03;const cut=.22+rank*.04,gap=.12+rank*.04;
      sweep=cut*2+gap;recover=.32+rank*.11;
      const span=58+rank*8;
      strikes=[
        {dmg:dmg/2,at:0,sweep:cut,hand:1,from:-span,to:span,pitchFrom:48,pitchTo:-32,gripFrom:[.9,2.9,-.45],gripTo:[.35,2.25,-.75],motion:'right-kesa'},
        {dmg:dmg/2,at:cut+gap,sweep:cut,hand:-1,from:span,to:-span,pitchFrom:48,pitchTo:-32,gripFrom:[-.9,2.9,-.45],gripTo:[-.35,2.25,-.75],motion:'left-kesa'}
      ];
    } else if(profile==='rod') {
      windup=.1;sweep=.68;recover=.28;
      // 右手→両手→両手の回転。総威力を1:1:2に分け、左右同時命中は合算。
      strikes=[
        {dmg:dmg*.25,at:0,hand:1,side:.35,from:65,to:-75,sweep:.14,motion:'right'},
        ...[1,-1].map(hand=>({dmg:dmg*.125,at:.19,hand,side:hand*.35,from:-75,to:70,sweep:.16,motion:'cross'})),
        ...[1,-1].map(hand=>({dmg:dmg*.25,at:.43,hand,side:hand*.35,from:70,to:430,sweep:.25,motion:'spin'}))
      ];
    }
    if(strikes)return {dmg:strikes.reduce((n,s)=>n+s.dmg,0),reach:profile==='claw'?5.6+rank*.9:profile==='rod'?4:4.6,height:2.4,from:strikes[0].from,to:strikes[0].to,
      windup,sweep,recover,time:windup+sweep+recover,step:2.5,homing:5,lunge:5,dashMotion:profile,
      ...(profile==='sabre'?{hop:{at:windup+.9,speed:9},flinch:.5}:{}),
      dashName:profile==='sabre'?'袈裟→逆袈裟→横薙ぎ→跳躍面打ち':profile==='claw'?'レーザー刃の右袈裟→左袈裟':'右薙ぎ→両手左薙ぎ→回転',strikes};
  }
  const pair = profile==='rod' && !strong || profile==='claw';
  const strikes=hits.map((dmg,i)=>({dmg,at:pair?Math.floor(i/2)*.22:i*.22,side:pair?(i%2?1:-1)*.35:0,from:i%2?-65:65,to:i%2?65:-65,sweep:.16}));
  const windup=strong?.09:.07, sweep=Math.max(...strikes.map(x=>x.at+x.sweep));
  return {dmg:hits.reduce((n,x)=>n+x,0),reach:profile==='claw'?3.5:profile==='rod'?4:4.6,height:2.4,from:65,to:-65,windup,sweep,time:windup+sweep+.23,step:2.5,homing:5,...(strong?{lunge:5,recover:.23}:{}),strikes};
}
// 斬馬刀（日本刀）の連続技（2026-11-06 オーナー「コンボ的に格闘叩き込めたら」「連続してザシュザシュザシュ！」）：
// 押すたびに次の段へ（袈裟→逆袈裟→横薙ぎ→締めの面打ち）。各段の威力は今の表から作る：通常の各段、足りない段は通常の平均、締めはダッシュの最後の段。
// 当てた機体は flinch 秒怯み、締めはダウン（down）。時間は Claude の仮置き
const SABRE_CUTS = [
  { from: -55, to: 55, pitchFrom: 48, pitchTo: -32, gripFrom: [.4, 2.9, -.55], gripTo: [-.3, 2.25, -.65], motion: 'kesa' },
  { from: 55, to: -55, pitchFrom: -32, pitchTo: 48, gripFrom: [-.3, 2.25, -.65], gripTo: [.4, 2.9, -.55], motion: 'reverse' },
  { from: -75, to: 75, pitchFrom: 0, pitchTo: 0, gripFrom: [.35, 2.4, -.65], gripTo: [-.35, 2.4, -.65], motion: 'horizontal' },
  { from: 0, to: 0, pitchFrom: 78, pitchTo: -62, gripFrom: [.35, 3.45, -.15], gripTo: [.25, 2.2, -.7], motion: 'men', single: true },
];
function sabreCombo(normalHits, strongHits) {
  const mean = Math.round(normalHits.reduce((n, x) => n + x, 0) / normalHits.length / 100) * 100;
  const dmgs = [0, 1, 2].map(i => normalHits[i] ?? mean).concat(strongHits[strongHits.length - 1]);
  return dmgs.map((dmg, i) => {
    const last = i === 3, windup = i === 0 ? .12 : last ? .14 : .06, sweep = last ? .26 : .2, recover = last ? .5 : .34;
    return { dmg, reach: 4.6, height: 2.4, from: SABRE_CUTS[i].from, to: SABRE_CUTS[i].to, windup, sweep, recover, time: windup + sweep + recover, step: 3, homing: 5,
      dashMotion: 'sabre', combo: i, flinch: last ? 0 : .5, strikes: [{ ...SABRE_CUTS[i], dmg, at: 0, sweep, hand: 1, down: last }] };
  });
}
const SABRE_DESC = '斬馬刀ほどの大きな刀。押すたびに袈裟→逆袈裟→横薙ぎ→面打ちとつながる連続技（当てると怯み、締めはダウン）。R で納刀し、長押しで溜めて離すと、前ブーストの最大2倍の距離を2倍の速さで踏み込み、通り道の敵を全員斬り抜ける（居合・抜刀一閃、よろけ）。ダッシュ中は4段の連続斬り';
const WEAPONS = {
  // AC NeLIS-T1（pages/694）：700kg・接触2700×2・毎秒7200×2・175m・回復40/35秒。
  // 本作調整：照射5秒はオーナー指定。準備.5秒・旋回毎秒5度・半径.6mは初期調整値。
  beamCannon: {name:'双肩照射砲',type:'beamCannon',dps:7200,contact:2700,range:175,use:5,warmup:.5,beamRadius:.6,turnRate:Math.PI/36,charge:40,chargeKeep:35,plant:true,desc:'両肩から極太ビームを最大5秒照射。構え中は移動不可、照射中は少しだけ旋回。機体と防御膜を貫通する。'},
  // ユーザー発案のオリジナル装備。調整値と根拠は research/weapons/mirage.md。
  mirage: { name: 'ミラージュデバイス', type: 'mirage', decoyHp: 1800, decoyLife: 12, decoyCost: 25, decoyOpacity: 1, hologram: false, charge: 40, chargeKeep: 30, desc: '作動中のクイックブーストで静止デコイを残す。受けていたロックを移し、最大4体。' },
  mirageH: { name: 'ミラージュデバイス・堅牢型', type: 'mirage', decoyHp: 3200, decoyLife: 12, decoyCost: 40, decoyOpacity: 1, hologram: false, charge: 40, chargeKeep: 30, desc: '作動中のクイックブーストで静止デコイを残す。受けていたロックを移し、最大4体。' },
  mirageL: { name: 'ミラージュデバイス・省エネ型', type: 'mirage', decoyHp: 1300, decoyLife: 9, decoyCost: 15, decoyOpacity: 0.35, hologram: false, charge: 40, chargeKeep: 30, desc: '作動中のクイックブーストで静止デコイを残す。受けていたロックを移し、最大4体。' },
  mirageD: { name: 'ミラージュデバイス・長時間型', type: 'mirage', decoyHp: 800, decoyLife: 20, decoyCost: 20, decoyOpacity: 0.7, hologram: true, charge: 40, chargeKeep: 30, desc: '作動中のクイックブーストで静止デコイを残す。受けていたロックを移し、最大4体。' },
  // AC ミサイルスロアー pages/341：現行の威力・重量・弾数・連射・爆風。誘導の再現値は guided-missiles.json。
  missile: {"name":"誘導ミサイル","type":"gun","rpm":360,"mag":4,"mags":4,"reload":2.4,"spread":0.006,"noLock":true,"sfx":"rocket","desc":"照準内で捕捉し左クリックで連射。右クリックで捕捉解除。未捕捉で撃つと直進する","missile":{"shots":4,"locks":1,"time":0.39,"rangeMul":1.25,"freeGap":0,"rank":"D"},"proj":{"kind":"shell","rocket":true,"guided":true,"grav":0,"life":12,"range":250,"speed":30,"maxSpeed":30,"accel":0,"turn":0.88,"delay":6,"ramp":25,"dmg":2600,"blast":11,"linear":true,"bodyLinear":true,"occluded":true,"core":true},"recoil":0.006981317007977318,"recoilH":0.003490658503988659},
  // AC 試験型MLRS pages/359：現行の威力・重量・弾数・連射・爆風。誘導の再現値は guided-missiles.json。
  mlrs: {"name":"多目標ミサイル","type":"gun","rpm":480,"mag":6,"mags":3,"reload":3,"spread":0.006,"noLock":true,"sfx":"rocket","desc":"照準内で捕捉し左クリックで連射。右クリックで捕捉解除。未捕捉で撃つと直進する","missile":{"shots":2,"locks":3,"time":0.26,"rangeMul":1.5,"freeGap":0.8,"rank":"C+"},"proj":{"kind":"shell","rocket":true,"guided":true,"grav":0,"life":12,"range":250,"speed":30,"maxSpeed":90,"accel":40,"turn":2,"delay":6,"ramp":25,"dmg":2600,"blast":12,"linear":true,"bodyLinear":true,"occluded":true,"core":true},"recoil":0.0017453292519943296,"recoilH":0.003490658503988659},
  // ユーザー指定のオリジナル：直接威力は通常3000・ダッシュ6000、満充填の光波は2000。
  waveSword: { name: '光波剣', type: 'sword', chargeTime: 1.2,
    chargeWave: { bladeWave: true, dmg: 2000, speed: 70, range: 60, width: 1.8 },
    normal: { dmg: 3000, reach: 4.8, height: 2.6, from: 75, to: -75, windup: .1, sweep: .15, time: .5, step: 4, homing: 6 },
    strong: { dmg: 6000, reach: 4.8, height: 2, from: 90, to: -630, spin: true, lunge: 16, windup: 0, sweep: .6, recover: 1, time: 1.6, homing: 1.8 },
    desc: '左長押しで充填し、離すと斬る。満充填なら振りに合わせて光波を1発放つ。短押しは斬撃のみ。直接威力は通常3000・ダッシュ6000' },
  // AC リヒトメッサー系統 pages/346：{"kg": 180, "normalHits": [2000, 3500], "strongHits": [4500]}。原典と再現値の区別は auxiliary.json。
  sabre: {"name":"日本刀","type":"sword","acMelee":"sabre","combo":sabreCombo([2000, 3500],[4500]),"strong":auxiliaryMelee([4500],"sabre",true),"iai":{"charge":1,"dmg":[3000,5000],"mult":2},"desc":SABRE_DESC},
  // AC スパークロッド系統 pages/411：{"kg": 190, "normalHits": [2500, 2500], "strongHits": [4500, 3500]}。原典と再現値の区別は auxiliary.json。
  rod: {"name":"双短刀","type":"sword","acMelee":"rod","normal":auxiliaryMelee([2500, 2500],"rod"),"strong":auxiliaryMelee([4500, 3500],"rod",true),"desc":"左右の短刀で連撃。同時に当たった分は合算して姿勢異常を判定。ダッシュ中は右薙ぎ→両手で左薙ぎ→回転の三段連撃","meleeDual":true},
  // AC ダブルクロー系統 pages/568：{"kg": 200, "normalHits": [2500, 2500], "strongHits": [3000, 3000]}。原典と再現値の区別は auxiliary.json。
  claw: {"name":"双爪ガントレット","type":"sword","acMelee":"claw","normal":auxiliaryMelee([2500, 2500],"claw"),"strong":auxiliaryMelee([3000, 3000],"claw",true),"desc":"左右の爪で近距離を連撃。ダッシュ中は伸びるレーザー刃で右袈裟→左袈裟の二段攻撃。上位型ほどリーチ・薙ぐ幅・隙が大きい","meleeDual":true},
  // AC パイク系統 pages/362：{"kg": 210, "normalLevels": [4500, 6750, 9000], "strongLevels": [6000, 9000, 12000], "chargeTime": 2}。原典と再現値の区別は auxiliary.json。
  pike: {"name":"パイルバンカー","type":"sword","acMelee":"pike","meleeCharge":true,"chargeTime":2,"chargeHold":8,"ohTime":2,"normalLevels":[4500,6750,9000],"strongLevels":[6000,9000,12000],"normal":{"dmg":4500,"reach":2.9,"height":2.4,"to":-7,"from":7,"windup":0.15,"sweep":0.12,"time":0.72,"step":1.2,"homing":4},"strong":{"dmg":6000,"reach":2.9,"height":2.4,"to":-7,"from":7,"windup":0.15,"sweep":0.12,"time":0.72,"step":1.2,"homing":4,"lunge":4,"recover":0.3},"desc":"左長押しで二段階に蓄圧、離して突く。離す瞬間にダッシュすると強打。満充填は8秒保持できる"},
  // AC ECM系統 pages/361：{"kg": 140, "count": 3, "jamSeconds": 5, "blast": 25, "fuse": 2.5}。原典と再現値の区別は auxiliary.json。
  jammer: {"name":"電子妨害グレネード","type":"gun","rpm":60,"mag":1,"mags":3,"reload":1,"spread":0,"noResupply":true,"desc":"時間で炸裂し、敵だけの視界・敵名表示・近距離ロックと他者への修理を妨害。自分と味方には効かない","proj":{"kind":"grenade","speed":32,"grav":24,"fuse":2.5,"blast":25,"jamSeconds":5}},
  // AC エアロセントリー系統 pages/970：{"kg": 410, "count": 2, "dmg": 70, "mag": 20, "rpm": 420, "reload": 4, "gunEnergy": false}。原典と再現値の区別は auxiliary.json。
  airTurret: {"name":"浮遊自動銃","type":"gun","rpm":60,"mag":1,"mags":2,"reload":1,"spread":0,"noResupply":true,"desc":"投げた空中で浮上し、全周60mの見える敵機を自動射撃。天井に当たると浮上を止める","proj":{"kind":"sentry","model":"airTurret","speed":22,"grav":12,"airDeploy":0.45,"riseHeight":3,"hp":1500,"max":2,"drawLift":0,"eyeY":0.35,"tip":[0,0,-0.95],"gun":{"dmg":70,"mag":20,"rpm":420,"reload":4,"range":60,"spread":0.018,"sfx":"pistol","energy":false}}},
  // AC FAS系統 pages/948：{"kg": 490, "count": 5, "dmg": 230, "mag": 6, "rpm": 120, "reload": 1.5, "dur": 8.4, "roamSpeed": 10}。原典と再現値の区別は auxiliary.json。
  flyTurret: {"name":"巡航自動銃","type":"gun","rpm":60,"mag":1,"mags":5,"reload":1,"spread":0,"noResupply":true,"desc":"投げた方向へ巡航しながら、下方の見える敵を自動射撃。一定時間で消える。攻撃で破壊できる","proj":{"kind":"sentry","model":"flyTurret","speed":22,"grav":12,"airDeploy":0.45,"riseHeight":3,"hp":1500,"max":5,"drawLift":0,"eyeY":0.35,"tip":[0,0,-0.95],"gun":{"dmg":230,"mag":6,"rpm":120,"reload":1.5,"range":60,"spread":0.018,"sfx":"pistol","energy":true},"dur":8.4,"roamSpeed":10,"downOnly":true}},
  // AC スタングレネード系統 pages/957：{"kg": 210, "count": 3, "stunSeconds": 2.5, "blast": 15, "fuse": 3, "reload": 1}。原典と再現値の区別は auxiliary.json。
  // スタンガン（2026-11-05、オーナーのオリジナル：「チャージ武器、前方にスタン範囲を形成する武器。低ダメージだが敵の機動を妨害」。数値は本作の仮の値）。
  // 左長押しで溜め、離すと前方に電撃の範囲を張る。範囲の長さと幅・残る秒・威力・妨害の秒（スタン時間）は、溜めた割合で len・width・time・dmg・shock の間を進む。
  // 範囲に入った敵機は1回だけ dmg を受け、shock 秒行動不能（電撃グレネードと同じ硬直。2026-11-06 オーナー「ちゃんと行動不能なってる？」。前は機動の妨害だけ）。
  // 2026-11-06 オーナー指定：ロックオンできる、過熱は遅く（満タンのまま chargeHold 8秒。前は3秒）、弾は無限でリロードなし（infinite）、
  // 範囲とスタン時間は溜めで変わる。撃った後に次を溜められるまでの間（rpm）は 0.5秒（Claude の値）。
  stunner: { name: 'スタンガン', type: 'gun', sfx: 'beam', rpm: 120, mag: 1, mags: 1, reload: 0, infinite: true, spread: 0, chargeTime: 1, chargeHold: 8, ohTime: 2,
    stunField: { len: [6, 12], width: [4, 7], height: 5, time: [.6, 1.4], dmg: [300, 1200], shock: [.3, 1], slow: .35 },
    desc: '左長押しで溜め、離すと前方に電撃の範囲を張る。溜めるほど範囲が広く、痺れが長い。範囲に入った敵機は痺れて動けず撃てない。ロックオンでき、弾は無限' },
  stunGrenade: {"name":"電撃グレネード","type":"gun","rpm":60,"mag":1,"mags":3,"reload":1,"spread":0,"noResupply":true,"desc":"時間で炸裂し、範囲内の敵だけを立ったまま硬直させる。ダメージはない","proj":{"kind":"grenade","speed":32,"grav":24,"fuse":3,"blast":15,"stunSeconds":2.5}},
  // AC ND索敵センサー系統 pages/692：{"kg": 340, "count": 2, "scan": 160, "keep": 10}。原典と再現値の区別は auxiliary.json。
  planeSensor: {"name":"索敵カーテン","type":"gun","rpm":60,"mag":1,"mags":2,"reload":1,"spread":0,"noResupply":true,"desc":"設置した向きの真横へ、上下左右の円盤状の索敵面を展開。面を横切る敵を10秒表示する","proj":{"kind":"sensor","model":"planeSensor","speed":24,"grav":24,"life":5,"hp":3000,"max":2,"scan":160,"keep":10,"planar":true}},
  // AC 弾薬BOX系統 pages/402：{"kg": 300, "count": 3, "reload": 1, "pickupRange": 1.5, "pickupSpeed": 20, "speed": 15}。原典と再現値の区別は auxiliary.json。
  ammoBox: {"name":"補給コンテナ","type":"gun","rpm":60,"mag":1,"mags":3,"reload":1,"spread":0,"noResupply":true,"desc":"接地後、弾が減った敵味方へ引き寄せられ、主・副武器を全補給。装填・過熱も回復。補助・SPは補給しない","proj":{"kind":"ammo","model":"ammoBox","speed":15,"grav":24,"life":5,"max":3,"invulnerable":true,"bounceUnit":true,"pickupRange":1.5,"pickupSpeed":20}},
  // AC レーダーユニット系統 pages/968：{"kg": 370, "range": 210, "arc": 60, "keep": 12, "expand": 1.98}。原典と再現値の区別は auxiliary.json。
  radarTool: {"name":"展開式レーダー","type":"radarTool","plant":true,"noLock":true,"range":210,"arc":60,"keep":12,"expand":1.98,"desc":"選ぶとその場で展開し、時間とともに前方の索敵距離が広がる。上下の制限なし。使用回数は無制限"},
  // AC フレアグレネード系統 pages/585：{"kg": 170, "dmg": 1150, "heatDps": 4600, "heatDur": 1.8, "mag": 1, "mags": 5, "blast": 10, "fuse": 1.2, "reload": 1.4, "speed": 35}。不明値・再現用の値は secondary.json に区別
  flare: {"name":"熱球グレネード","type":"gun","rpm":60,"mag":1,"mags":5,"reload":1.4,"spread":0,"semi":false,"desc":"時間で炸裂し、障害物で遮られる熱球を残す。触れた相手へ一度の接触損傷と継続損傷。距離減衰・のけぞりなし","proj":{"dmg":1150,"blast":10,"core":true,"kind":"grenade","speed":35,"grav":24,"fuse":1.2,"heatDps":4600,"heatDur":1.8}},
  // AC チェインボム系統 pages/524：{"kg": 140, "dmg": 6000, "mag": 1, "mags": 4, "blast": 12, "chainCount": 6, "chainStep": 12, "chainGap": 0.18, "reload": 1.5}。不明値・再現用の値は secondary.json に区別
  chain: {"name":"連鎖ボム","type":"gun","rpm":60,"mag":1,"mags":4,"reload":1.5,"spread":0,"semi":false,"desc":"地面に着くと前方へ連続爆発。壁では反射し、連鎖中に障害物へ当たると止まる","proj":{"dmg":6000,"blast":12,"core":true,"kind":"grenade","speed":32,"grav":24,"chainCount":6,"chainStep":12,"chainGap":0.18,"linear":true,"bodyLinear":true,"occluded":true,"life":5}},
  // AC パイロダート系統 pages/762：{"kg": 340, "dmg": 1400, "pellets": 3, "mag": 4, "mags": 3, "blast": 11, "rpm": 90, "reload": 3.5}。不明値・再現用の値は secondary.json に区別
  dart: {"name":"炸裂散弾ライフル","type":"gun","rpm":90,"mag":4,"mags":3,"reload":3.5,"spread":0.002,"semi":true,"desc":"横並びの炸裂弾を同時に発射。直撃は部位・頭部判定、周囲へは爆風。1クリックで1射","dmg":1400,"range":300,"pellets":3,"fan":0.026,"directBlast":11},
  // AC チャージカノン系統 pages/514：{"kg": 490, "dmg": 3500, "chargeStages": [3500, 5250, 7000], "chargeTime": 1, "chargeHold": 3, "ohTime": 2, "mag": 10, "mags": 1, "blast": 11, "rpm": 100, "reload": 4, "recoilV": 6}。不明値・再現用の値は secondary.json に区別
  charge: {"name":"蓄圧砲","type":"gun","rpm":100,"mag":10,"mags":1,"reload":4,"spread":0,"semi":false,"desc":"左長押しで二段階に蓄圧し、離すと射撃。最大充填を保持し続けると過熱する","chargeTime":1,"chargeStages":[3500,5250,7000],"chargeHold":3,"ohTime":2,"proj":{"dmg":3500,"blast":11,"core":true,"kind":"shell","speed":100,"life":3,"energy":0.5,"linear":true,"bodyLinear":true,"occluded":true},"recoil":0.10471975511965977},
  // AC イーグルアイ系統 pages/959：{"kg": 220, "dmg": 2600, "mag": 7, "mags": 5, "rpm": 150, "scope": 2.5, "scopeHigh": 5, "settle": 1.3, "reload": 4, "recoilV": 15}。不明値・再現用の値は secondary.json に区別
  zoom: {"name":"二段ズーム狙撃銃","type":"gun","rpm":150,"mag":7,"mags":5,"reload":4,"spread":0.001,"semi":true,"desc":"右クリックで低倍率→高倍率→通常視点。静止して照準を収束させ、左クリックで1発","dmg":2600,"range":800,"scope":2.5,"settle":1.3,"hip":0.5,"hipMove":1.6,"sway":0.025,"head":2.5,"noLock":true,"scopeHigh":5,"recoil":0.2617993877991494},
  // AC 炸薬狙撃銃系統 pages/960：{"kg": 350, "dmg": 4100, "mag": 2, "mags": 8, "rpm": 150, "scope": 4, "settle": 2.8, "blast": 11, "reload": 4.5, "recoilV": 40}。不明値・再現用の値は secondary.json に区別
  blastSniper: {"name":"炸裂狙撃銃","type":"gun","rpm":150,"mag":2,"mags":8,"reload":4.5,"spread":0.001,"semi":true,"desc":"即着弾の炸裂弾。直撃は部位・頭部判定、周囲へ爆風。直撃と爆風は重複しない","dmg":4100,"range":800,"scope":4,"settle":2.8,"hip":0.5,"hipMove":1.6,"sway":0.025,"head":2.5,"noLock":true,"directBlast":11,"recoil":0.6981317007977318},
  // AC LBR系統 pages/955：{"kg": 260, "dmg": 1930, "mag": 9, "mags": 3, "rpm": 240, "scope": 2.5, "settle": 0.55, "reload": 4, "recoilV": 0.4}。不明値・再現用の値は secondary.json に区別
  lightSniper: {"name":"レーザーバトルライフル","type":"gun","rpm":240,"mag":9,"mags":3,"reload":4,"spread":0.001,"semi":true,"desc":"低反動の光学ライフル。右長押しで照準、左クリックで1発。中距離の連射向け","dmg":1930,"range":600,"scope":2.5,"settle":0.55,"hip":0.035,"hipMove":1.6,"sway":0.015,"head":2,"noLock":true,"energy":true,"laserFade":0.4,"recoil":0.006981317007977318},
  // 光学狙撃銃（2026-11-07 オーナー指定の新しい系統。アーケード版 LZ-狙撃銃系統 https://w.atwiki.jp/borderbreak/pages/954.html 、LZ-デイライト：280、4750、1x10、単発、5.0倍、4.5秒、反動0.5/0.05、射程800m）
  // 即着弾（緑レーザー）で距離による威力の減衰なし、残光は1秒（laserFade）。収束1.8秒・腰撃ちのばらつきは大型狙撃銃と同じ Claude の仮置き
  optSniper: { sfx: 'sniper', name: '光学狙撃銃', type: 'gun', dmg: 4750, rpm: 60, semi: true, mag: 1, mags: 10, reload: 4.5, spread: 0.0005, hip: 0.5, hipMove: 1.6, sway: 0.03, settle: 1.8, scope: 5, head: 2.5, range: 800, noLock: true, energy: true, laserFade: 1, recoil: 0.0087, desc: '即着弾の光学狙撃銃。距離で威力が落ちない。1発ごとにリロードする' },
  // AC ジャンプマイン系統 pages/966：{"kg": 150, "dmg": 9000, "mag": 1, "mags": 4, "blast": 23, "reload": 1, "jumpDelay": 0.7}。不明値・再現用の値は secondary.json に区別
  jumpMine: {"name":"跳躍地雷","type":"gun","rpm":60,"mag":1,"mags":4,"reload":1,"spread":0,"semi":false,"desc":"敵の接近を感知すると垂直に跳ね上がり爆発。上昇中に障害物へ当たると即起爆","proj":{"dmg":9000,"blast":23,"core":true,"kind":"mine","speed":32,"grav":24,"model":"jumpMine","hp":2000,"max":4,"trigger":5,"linear":true,"bodyLinear":true,"occluded":true,"jumpDelay":0.7,"jumpHeight":6,"triggerSphere":true}},
  // AC インパクトマイン系統 pages/976：{"kg": 170, "dmg": 7300, "mag": 1, "mags": 4, "blast": 19, "reload": 1, "knockMult": 3}。不明値・再現用の値は secondary.json に区別
  delayMine: {"name":"衝撃吸着地雷","type":"gun","rpm":60,"mag":1,"mags":4,"reload":1,"spread":0,"semi":false,"desc":"壁にも貼りつく地雷。接近を感知して1秒後に炸裂。実ダメージより強く姿勢を崩す","proj":{"dmg":7300,"blast":19,"core":true,"kind":"mine","speed":32,"grav":24,"model":"delayMine","hp":2000,"max":4,"trigger":5,"linear":true,"bodyLinear":true,"occluded":true,"sticky":true,"triggerSphere":true,"detDelay":1,"knockMult":3}},
  // AC デトネーター系統 pages/491：{"kg": 260, "dmg": 5800, "mag": 2, "mags": 4, "blast": 17, "reload": 3.2, "rpm": 120}。不明値・再現用の値は secondary.json に区別
  // 遠隔ボムランチャー（2026-11-04 オーナー指摘「爆発しない弾がある」「銃身発射してない？」）：弾の寿命が既定の3秒で、高く撃つと着地前に消えていた → 15秒。弾と設置した爆弾はランチャーの形ではなく遠隔爆弾の形
  detonator: {"name":"遠隔ボムランチャー","type":"gun","rpm":120,"mag":2,"mags":4,"reload":3.2,"spread":0,"semi":true,"desc":"吸着爆弾を遠方へ射出。着弾後0.5秒で準備ができ、右クリックで設置済みを一括起爆","proj":{"dmg":5800,"blast":17,"core":true,"kind":"remote","attachUnit":true,"speed":70,"grav":12,"life":15,"model":"remote","hp":1000,"max":5,"trigger":5,"linear":true,"bodyLinear":true,"occluded":true}},
  // AC タイタン榴弾砲：900kg、10000×6、300m、5.5秒、誤差15m、爆風25m、54(44)秒。発射間隔1秒（364.html本文）。
  // 反射衛星砲（オーナーのオリジナル、2026-11-05）：真上の衛星へ撃ったレーザーを跳ね返し、マップで決めた始点から終点へ地上をなぞる。
  // speed：光がカーソルを追う最大の速さ（m/秒。2026-11-05 オーナー「速度全部1/3に」で前の1/3）、fireTime：SP満タンから照射できる秒、radius：地上の光の円の半径（m）、dps：毎秒の威力、warn：照射までの溜め（秒。この間は線と警告が出る。オーナー「一撃死は理不尽だから射撃警告とかチャージ時間」）
  reflector: { name: '反射衛星砲', type: 'reflector', noLock: true, plant: true, dps: 12000, speed: 6, fireTime: 6.7, radius: 6, range: 300, warn: .5, charge: 55, chargeKeep: 45, desc: 'マップで左クリックを押している間、衛星で跳ね返したレーザーが地上を焼き、光はカーソルを追う。離すと終了。照射中は移動不可で、真上への光で位置が知られる' },
  artillery: { name: '榴弾砲', type: 'artillery', noLock: true, plant: true, dmg: 10000, shots: 6, range: 300, flight: 5.5, scatter: 15, blast: 25, interval: 1, charge: 54, chargeKeep: 44, desc: 'マップで爆撃中心を指定して自動連射。移動・旋回不可。右クリックで即中断。着弾2秒前に火柱と落下音' },
  // AC現行表：バリアユニット（413）。前方LV2、12500、50秒、50(45)秒、710kg。
  barrier: { name: '防護バリア', type: 'barrier', shieldHp: 12500, arc: 180, level: 2, use: 50, charge: 50, chargeKeep: 45, desc: '選ぶと照準の前半分を防御。再選択で停止。射撃と移動を続けられる。近接攻撃は防げない' },
  // AC EUS-T1（974）：270、20×∞、360/min、3.4秒、50m、180度、35秒、充填30秒、310kg。
  escort: { name: '背部自動銃', type: 'escort', dmg: 270, mag: 20, mags: 1, rpm: 360, reload: 3.4, range: 50, arc: 180, use: 35, charge: 30, noResupply: true, desc: '選ぶと展開し、1秒後から射線の通る敵機を自動攻撃。再選択で停止。ほかの武器と同時に使える' },
  // AC リペアポスト（406）：1200/秒、12m、80秒、充填20秒、480kg。追加消費・耐久の扱いは research/arcade/weapons/special-equipment.md。
  repairPost: { name: 'リペアビーコン', type: 'repairPost', heal: 1200, radius: 12, use: 80, charge: 20, healDrain: 3.75, postHp: 6000, desc: '左クリックで投げて設置。範囲内の味方を回復・蘇生し、施設も修理。別の武器へ持ち替え可能。再選択して持ち替えが終わると回収' },
  // アーケード版の現行表（2026-10-19取得）。research/arcade/weapons/ と types/arcade.json。
  // 精度は従来のE+＝0.01radを基準に1段0.88倍で換算。縦反動は表の度をラジアンにする。
  // 電磁加速砲・壱式 https://w.atwiki.jp/borderbreak/pages/101.html ：1250、270発/分、14×13、2.2秒、280kg、精度A-、反動0.3/0.3度、射程350m。
  rail: { name: 'レールライフル', type: 'gun', dmg: 1250, rpm: 270, mag: 14, mags: 13, reload: 2.2, spread: 0.0028, recoil: 0.3 * Math.PI / 180, range: 350, energy: true, desc: '一発が重く精度の高い全自動銃。弾倉は小さく重め' },
  // VOLT-01 https://w.atwiki.jp/borderbreak/pages/101.html ：580、480発/分（3点射）、39×8、2.0秒、190kg、精度B+、反動0.2/0.25度、射程300m。
  // 1射0.375秒（個別ページ336）。3発×60/480に等しいため、追加の射撃間隔gapは0。
  pulse: { name: 'パルスバーストライフル', type: 'gun', dmg: 580, rpm: 480, burst: 3, gap: 0, mag: 39, mags: 8, reload: 2, spread: 0.0032, recoil: 0.2 * Math.PI / 180, range: 300, energy: true, desc: '3発ずつ撃つ軽い光学銃。反動が小さく弾数も多い' },
  // LAC-グローム https://w.atwiki.jp/borderbreak/pages/105.html ：1580、180発/分、22×11、2.5秒、410kg、精度B+、反動0.4/0.5度、射程300m。
  coil: { name: 'コイル機関砲', type: 'gun', dmg: 1580, rpm: 180, mag: 22, mags: 11, reload: 2.5, spread: 0.0032, recoil: 0.4 * Math.PI / 180, range: 300, energy: true, desc: '大きな光弾を連射する。熱制限はなく、発射間隔が長い' },
  // M90サブマシンガン相当：340、780発/分、62×15、リロード1.4秒
  ar: { sfx: 'ar', name: 'アサルトライフル', type: 'gun', dmg: 340, rpm: 780, mag: 62, mags: 15, reload: 1.4, spread: 0.01 },
  // デュエルソード相当（通常4500、ダッシュ中の特殊攻撃6000）は近づく危険に見合わないので強化：通常6000（2回で撃破）、回転斬り10000（満タンから一撃）。コアには当たらない。
  // 刃は実際に振り、刃が通った所にいる相手に当たる（ユーザー指定）。from・to は振り始めと振り終わりの角度（度。機体の正面が0で左が正）、
  // height は刃の高さ（足元から）、reach は機体の中心から刃先まで、windup は構え、sweep は振っている秒、time は振り全体の秒。
  // step は横なぎの踏み込み（m）、homing は踏み込み中にロックした敵へ曲がる速さ（ラジアン/秒）。v0.13、ユーザー指定（本家の近接のロック誘導）。値は仮
  sword: {
    name: 'ソード', type: 'sword',
    // 横なぎ：前方150度を左から右へ払う
    normal: { dmg: 6000, reach: 4.8, height: 2.6, from: 75, to: -75, windup: 0.1, sweep: 0.15, time: 0.5, step: 4, homing: 6 },
    // 回転斬り：ダッシュ中に振ると、前へ16m踏み込みながら2回転して周りを斬る（1回転だと刃と同じ向きに後ろへ流れる側、進路の右の敵を取りこぼす）。刃が低いのでジャンプで避けられる。
    // 回し終わると recover 秒その場で動けない（チャンスも隙も大きい）。spin は機体ごと回る。
    // v0.9.3（ユーザー指定）：踏み込みを11mから16mへ。踏み込みはブーストを使わず、踏み込んでいる間はブーストが回復する
    strong: { dmg: 10000, reach: 4.8, height: 2.0, from: 90, to: -630, spin: true, lunge: 16, windup: 0, sweep: 0.6, recover: 1.0, time: 1.6, homing: 1.8 },
  },
  // GAXガトリングガン相当：200、1500発/分、380×7、リロード3.5秒。空転0.5秒（止まるまで1.2秒）。
  // 撃ち続けると143発でオーバーヒートして4秒撃てない。撃たずにいれば3秒で冷える
  gatling: { sfx: 'gatling', name: 'ガトリング', type: 'gun', dmg: 200, rpm: 1500, mag: 380, mags: 7, reload: 3.5, spread: 0.02, spin: 0.5, spinDown: 1.2, heat: 143, ohTime: 4, cool: 3 },
  // サワードロケット相当：8500、1×5、リロード2秒。爆風は端で半分。v0.9.4でユーザー指定により強化：弾速80→120m/s、爆発半径10m（wiki 12mを縮めていた）→14m
  rocket: { sfx: 'rocket', name: 'ロケットランチャー', type: 'gun', proj: { dmg: 8500, blast: 14, core: true, rocket: true, speed: 120 }, rpm: 60, mag: 1, mags: 5, reload: 2, spread: 0 },
  // レヴェラーMP20相当：340×2（1回で左右から1発ずつ）、400回/分、26×12、リロード1.2秒
  pistols: { sfx: 'pistol', name: '二丁拳銃', type: 'gun', dual: true, dmg: 340, rpm: 400, mag: 26, mags: 12, reload: 1.2, spread: 0.016 },
  // 38式狙撃銃相当：3600、150発/分、4×8、リロード3.2秒、3.5倍スコープ、ヘッドショット2.5倍、ロックオンなし。
  // hip はスコープなしのばらつき（動いているか空中なら hipMove 倍）。wiki「スコープを覗かずに…撃とうものならとんでもない方向に弾がスッ飛んでいく」。
  // v0.10でユーザーの指摘（覗かずにバカバカ当たる）により 0.07 → 0.5：胴体を狙って止まって10mで約5割、20mで約1割、40mではほぼ当たらない（動きながらは半分以下）。
  // スコープを覗いて止まっていると settle 秒で sway のぶれが収まる（撃つと乱れる）
  sniper: { sfx: 'sniper', name: '狙撃銃', type: 'gun', dmg: 3600, rpm: 150, mag: 4, mags: 8, reload: 3.2, spread: 0.0008, hip: 0.5, hipMove: 1.6, sway: 0.025, settle: 2.5, scope: 3.5, head: 2.5, noLock: true },
  // スマックショット相当（460×8、50発/分）は弱すぎるので強化：500×12（12mまでは6000で2発撃破）、60発/分、8×8、リロード2.6秒。
  // falloff [近, 遠, 倍率]：近までは全威力、遠で倍率まで直線的に下がる（20mで約7割、30m以遠で3割）
  shotgun: { sfx: 'shotgun', name: 'ショットガン', type: 'gun', dmg: 500, pellets: 12, rpm: 60, mag: 8, mags: 8, reload: 2.6, spread: 0.08, falloff: [12, 30, 0.3] },
  // ---- 投げる物と偵察機（副武器・補助装備）。proj.grav があると山なりに投げ、照準の所に落ちる（届かなければ届く所まで） ----
  // MK3クラッカー相当：何かに当たると爆発（2.5秒で自爆）。7500、爆発半径17m（マップに合わせて14m）、1×6、リロード1秒
  grenade: { sfx: 'throw', name: 'グレネード', type: 'gun', proj: { dmg: 7500, blast: 14, core: true, kind: 'grenade', speed: 32, grav: 24, fuse: 2.5, impact: true }, rpm: 60, mag: 1, mags: 6, reload: 1, spread: 0 },
  // AN手榴弾相当：ダメージはなく、爆発に巻き込んだ敵機の被ダメージを5秒間1.4倍にする。爆発半径25m（21m）、起爆1.2秒、所持数4、リロード1秒
  weaken: { sfx: 'throw', name: '弱化グレネード', type: 'gun', proj: { dmg: 0, blast: 21, kind: 'grenade', speed: 30, grav: 24, fuse: 1.2, weak: { mult: 1.4, time: 5 } }, rpm: 60, mag: 1, mags: 4, reload: 1, spread: 0 },
  // ヘヴィマイン相当：投げると地面に置かれ、敵機が踏むと爆発。10800、爆発半径12m（10m）、1×5、同時に5個まで（超えると古い物から消える）、耐久3000
  mine: { sfx: 'throw', name: '地雷', type: 'gun', proj: { dmg: 10800, blast: 10, kind: 'mine', speed: 16, grav: 24, life: 6, trigger: 2.5, hp: 3000, max: 5 }, rpm: 60, mag: 1, mags: 5, reload: 1, spread: 0 },
  // 索敵センサー相当：投げた所（地面や壁）に貼りつき、半径65mの敵機を味方のミニマップに映す（範囲を出ても5秒）。所持数2（同時に2個まで）、耐久10000、補給できない
  sensor: { sfx: 'throw', name: '索敵センサー', type: 'gun', proj: { kind: 'sensor', speed: 24, grav: 24, life: 6, scan: 65, keep: 5, hp: 10000, max: 2 }, rpm: 60, mag: 2, mags: 1, reload: 1, spread: 0, noResupply: true },
  // ラーク偵察機相当：選ぶと屈んで動けない。撃つと5秒その場で上昇し、向いていた方へ250mを毎秒28mで飛ぶ。半径110mの敵機を味方のミニマップに10秒映す。
  // 所持数3、補給できない。back：使ったら元の武器に戻る
  drone: { sfx: 'drone', name: '偵察機', type: 'gun', drone: { scan: 110, keep: 10, hover: 5, alt: 40, dist: 250, speed: 28 }, rpm: 30, mag: 3, mags: 1, reload: 1, spread: 0, plant: true, noLock: true, back: true, noResupply: true },
  // ---- 特別装備（SPゲージを使う）。use：連続で使える秒、charge：使い切ってから満タンまでの秒、chargeKeep：使い切らなかったときの秒 ----
  // FXU-A相当：毎秒1100（味方機には1.2倍、壊れていない砲台には0.7倍）、射程60m（マップに合わせて50m）。SPは使うと10秒で尽き、30秒で満タンに戻る
  repair: { name: 'リペアユニット', type: 'repair', heal: 1100, range: 50, use: 10, charge: 30 },
  // アサルトチャージャー相当：選ぶと作動し、もう一度選ぶと止まる（v0.9.5、ユーザー指定）。持っている武器はそのままで、加速しながら撃てる（ユーザー指定）。
  // 作動中はShift長押しでブーストの代わりにSPを使い、向いている方へ毎秒45m（ロングダッシュの1.5倍）で進む。
  // 横の入力で少し曲がり、後ろの入力で8割遅くなる。連続2.4秒、満タンまで35秒（使い切らなければ30秒）。使い切ると止まる
  charger: { name: '加速装置', type: 'charger', speed: 45, use: 2.4, charge: 35, chargeKeep: 30 },
  // タウル重装砲相当：選ぶと構えて動けず、旋回も遅い（turn）。山なりの弾を撃つ（7600、爆発半径21m（17m）、弾速60m/s）。SPで6発、満タンまで35秒。
  // 撃ち切るか右クリックで元の武器に戻る
  cannon: { sfx: 'heavy', name: '重砲', type: 'cannon', proj: { dmg: 7600, blast: 17, core: true, kind: 'shell', speed: 60, grav: 12, life: 12 }, shots: 6, rpm: 40, spread: 0.015, charge: 35, chargeKeep: 30, plant: true, turn: 0.5, noLock: true },
  // 光学迷彩・試作型 C404 相当：選ぶと姿を消し、もう一度選ぶと解除（v0.9.5、ユーザー指定。持っている武器はそのまま）。SPは15秒で尽き、40秒で満タン。
  // 敵にロックされない（ロック中に消えると1秒後に外れる）。見えやすさは、止まっているとだんだん下がって still に近づき（settle：下がる速さ）、
  // 動くと速さに応じて揺らいで move[歩き, ダッシュ] まで上がり、撃つと shot まで上がる（ユーザー指定）。fade は解除して姿が戻る秒。
  // 被弾でも揺らぎ、SPを大きく削られる：hitHp のダメージでSPが尽きる（ユーザー指定で、wikiの耐久力12000から4000へ。アサルトライフル1発で約8%）
  camo: { name: '光学迷彩', type: 'camo', use: 15, charge: 40, still: 0.04, move: [0.25, 0.55], shot: 0.8, settle: 0.7, fade: 0.5, hitHp: 4000 },
  // ---- 機体カスタマイズで選べる武器（v0.11、ユーザー指定「武器のバリエーションとパラメータ作って」）。各兵装の各枠に3種類（上の初期装備と合わせて）。
  // 数値は wiki（PS4版）の各系統の最初の型の強化前の値（research/weapons/*.md）。爆発半径はマップの広さに合わせて約0.82倍（初期装備と同じ縮め方）。
  // 名前はオリジナル。desc は機体カスタマイズの画面に出す説明 ----
  // 強襲・主武器
  // ヴォルペ突撃銃V16相当：440、810発/分の3点射（1回引くと3発。続けて引くと gap 秒あけて次の3発）、57×10、リロード2.2秒。ばらつきが小さい
  burst: { sfx: 'ar', name: 'バーストライフル', type: 'gun', dmg: 440, rpm: 810, burst: 3, gap: 0.08, mag: 57, mags: 10, reload: 2.2, spread: 0.006, desc: '3発ずつ撃つ突撃銃。ばらつきが小さく、中距離でも当てやすい' },
  // STAR-10相当：1140、単発（1発ごとに左クリック。Botは連射の間隔で撃つ）、300発/分、18×10、リロード1.9秒。精度が高い
  marks: { sfx: 'sniper', name: 'マークスマンライフル', type: 'gun', dmg: 1140, rpm: 300, semi: true, mag: 18, mags: 10, reload: 1.9, spread: 0.003, desc: '1発ずつ撃つ大口径の突撃銃。クリックの速さが火力になる' },
  // 強襲・副武器
  // 38型手榴弾相当：8400、当たっても跳ね返らず、2.5秒たつと爆発（時限式）。爆発半径21m（17m）、1×6、リロード1秒
  timed: { sfx: 'throw', name: '時限グレネード', type: 'gun', proj: { dmg: 8400, blast: 17, core: true, kind: 'grenade', speed: 32, grav: 24, fuse: 2.5 }, rpm: 60, mag: 1, mags: 6, reload: 1, spread: 0, desc: '落ちた所で2.5秒後に爆発する。威力と爆風が大きい' },
  // グレネードランチャーGL113相当：5400、低い弾道で飛び、当たると爆発。1回で3発（200発/分）、3×4、リロード3秒、爆発半径14m（12m）
  gl: { sfx: 'rocket', name: 'グレネードランチャー', type: 'gun', proj: { dmg: 5400, blast: 12, core: true, kind: 'grenade', speed: 70, grav: 12, fuse: 4, impact: true }, rpm: 200, burst: 3, gap: 0.2, mag: 3, mags: 4, reload: 3, spread: 0.01, desc: '当たると爆発する弾を3発続けて撃つ。遠くまで届く' },
  // 強襲・補助装備（近接）
  // クラッシュエッジCE501相当（通常8500・特殊8500）：重く遅いが一振りが重い大剣。回転斬りは踏み込みが短い
  blade: {
    name: 'ソード・大剣', type: 'sword', desc: 'ソード系の上位。重く遅いが、横なぎの一振りが重い。ダッシュ斬りの踏み込みは短く、隙が大きい',
    normal: { dmg: 8000, reach: 5.4, height: 2.6, from: 80, to: -80, windup: 0.25, sweep: 0.2, time: 0.85, step: 3, homing: 5 },
    strong: { dmg: 11000, reach: 5.4, height: 2.0, from: 90, to: -630, spin: true, lunge: 11, windup: 0, sweep: 0.7, recover: 1.3, time: 2.0, homing: 1.5 }, // time は振り0.7＋硬直1.3（v0.21。1.9だと構えに戻ってから0.1秒動けなかった）
  },
  // ロングスピアA11S相当（通常4000・特殊6000）：穂先だけの突き。横の範囲はほとんど無いが届く。ダッシュ中は長く踏み込んで突く
  spear: {
    name: 'スピア', type: 'sword', desc: '槍の突き。横には当たらないが遠くまで届く。ダッシュ中は22m踏み込んで突く',
    normal: { dmg: 5400, reach: 7.5, height: 2.6, from: 7, to: -7, windup: 0.12, sweep: 0.1, time: 0.45, step: 4, homing: 6 },
    strong: { dmg: 10000, reach: 7.5, height: 2.4, from: 5, to: -5, lunge: 22, windup: 0, sweep: 0.55, recover: 0.8, time: 1.4, homing: 1.8 },
  },
  // 強襲・特別装備：アサルトチャージャー系統の型違い。speed は出力（初期型1.6で毎秒45m）に比例
  // AC-ディスタンス相当：出力1.3、連続4.7秒、満タンまで55秒（使い切らなければ50秒）
  chargerD: { name: '加速装置・持続型', type: 'charger', speed: 36.5, use: 4.7, charge: 55, chargeKeep: 50, desc: '速さは控えめだが、長く加速し続けられる' },
  // AC-スプリンター相当：出力1.65、連続2.2秒、満タンまで19秒（16秒）
  chargerS: { name: '加速装置・瞬発型', type: 'charger', speed: 46.4, use: 2.2, charge: 19, chargeKeep: 16, desc: '一番速く、すぐに溜まる。加速できるのは短い' },
  // SC－マルチウェイ相当（v0.15、Codex 版から）：入力した方向（横・後ろ・斜め）へそのままの速さで進む（omni）。出力1.25（毎秒35m）、連続3.4秒、満タンまで40秒（使い切らなければ35秒）
  omni: { name: '全方向加速装置', type: 'charger', omni: true, speed: 35.2, use: 3.4, charge: 40, chargeKeep: 35, desc: '入力した方向へそのままの速さで加速する。横や後ろにも速く動けるが、速さは控えめ' },
  // 重火力・主武器
  // ウィーゼル機関銃WL7A1相当：450、660発/分、170×8、リロード3秒。空転なし、64発でオーバーヒートして2.8秒撃てない、撃たずにいれば2.4秒で冷える
  mg: { sfx: 'ar', name: '機関銃', type: 'gun', dmg: 450, rpm: 660, mag: 170, mags: 8, reload: 3, spread: 0.03, heat: 64, ohTime: 2.8, cool: 2.4, desc: '空転なしですぐ撃てる。撃ち続けると早めにオーバーヒートする' },
  // 単式機関砲MA103相当：1520、220発/分、30×10、リロード3.6秒。18発でオーバーヒートして3.1秒撃てない
  acannon: { sfx: 'sniper', name: '機関砲', type: 'gun', dmg: 1520, rpm: 220, mag: 30, mags: 10, reload: 3.6, spread: 0.014, heat: 18, ohTime: 3.1, cool: 3, desc: '1発が重い大口径の連射砲。連射は遅く、18発でオーバーヒート' },
  // 重火力・副武器
  // スクラムバスターM34T1相当：2900、480発/分の連射ロケット、6×4、リロード4秒、爆発半径13m（11m）。ばらけて飛ぶ
  // レーザー誘導ロケット（2026-11-06、オーナー希望。アーケード版 シーカー系統 pages/449 の表と解説から）：右クリックの精密誘導モード（主観視点・紫のレティクル）で撃った弾だけ、
  // 照準の中心へ曲がる。遅く出て加速し、撃った機体から離れるほど曲がらなくなる（guideRange で0）。威力・重量・弾数・爆風・連射・リロード・初速は表の値、
  // 最高速・加速・旋回率は表に無いので Claude の仮置き。記録は research/weapons/types/seeker.json
  seeker: { sfx: 'rocket', name: 'レーザー誘導ロケット', type: 'gun', proj: { dmg: 8000, blast: 14, core: true, rocket: true, seek: true, grav: 0, life: 12, range: 250, speed: 40, maxSpeed: 150, accel: 75, turn: 2.2, guideRange: 150 }, rpm: 60, mag: 1, mags: 6, reload: 2.2, spread: 0, recoil: 2 * Math.PI / 180,
    desc: '右クリックの精密誘導モードで撃つと、照準の中心へ曲がる。遅く出て加速し、150m離れるとほとんど曲がらない' },
  scrum: { sfx: 'rocket', name: '連射ロケット', type: 'gun', proj: { dmg: 2900, blast: 11, core: true, rocket: true, speed: 100 }, rpm: 480, mag: 6, mags: 4, reload: 4, spread: 0.035, desc: '小さなロケットを6発ばらまく。爆風で広く削る' },
  // プラズマカノンPC201相当：5900、80発/分、4×3、リロード3.5秒、爆発半径13m（11m）。弾が速い
  plasma: { sfx: 'heavy', name: 'プラズマ砲', type: 'gun', proj: { dmg: 5900, blast: 11, core: true, kind: 'shell', speed: 220 }, rpm: 80, mag: 4, mags: 3, reload: 3.5, spread: 0, desc: '弾がとても速く、まっすぐ飛ぶ砲。ロケットより当てやすい' },
  // 重火力・補助装備
  // インパクトボムP6T-N相当：ダメージなし、爆風に巻き込んだ敵機を吹き飛ばして倒す。爆発半径16m（13m）、起爆1.5秒、所持数5、リロード1.6秒
  impactb: { sfx: 'throw', name: '衝撃グレネード', type: 'gun', proj: { dmg: 0, blast: 16, kind: 'grenade', speed: 30, grav: 24, fuse: 1.5, knock: true }, rpm: 60, mag: 1, mags: 5, reload: 1.6, spread: 0, desc: '爆風に巻き込んだ敵を吹き飛ばして倒す。敵機に直接当たるとすぐ炸裂する。ダメージは無い' },
  // ハウルHSG9相当：380×8、90発/分、3×4、リロード2.5秒。よろけ・ダウンの判定を3倍に数える（近くで全弾当てると倒せる）
  hsg: { sfx: 'shotgun', name: '衝撃散弾銃', type: 'gun', dmg: 380, pellets: 8, rpm: 90, mag: 3, mags: 4, reload: 2.5, spread: 0.07, falloff: [10, 30, 0.3], knockMult: 3, desc: '当てた敵をよろけさせ、近くで全弾当てると倒す散弾銃' },
  // 重火力・特別装備：重装砲系統の型違い
  // ハイドラ重装砲C56M4相当：5700×9発、180発/分、爆発半径17m（14m）、弾速115m/s
  cannonH: { sfx: 'heavy', name: '重砲・速射型', type: 'cannon', proj: { dmg: 5700, blast: 14, core: true, kind: 'shell', speed: 115, grav: 12, life: 12 }, shots: 9, rpm: 180, spread: 0.015, charge: 35, chargeKeep: 30, plant: true, turn: 0.5, noLock: true, desc: '低い弾道の砲弾を9発、速く撃てる。1発は軽い' },
  // モノセロス重装砲C56M5相当：20200×1発、爆発半径30m（24m）、弾速36m/s（遠くへは届かない）
  cannonM: { sfx: 'heavy', name: '重砲・単発型', type: 'cannon', proj: { dmg: 20200, blast: 24, core: true, kind: 'shell', speed: 36, grav: 12, life: 12 }, shots: 1, rpm: 60, spread: 0.01, charge: 35, chargeKeep: 30, plant: true, turn: 0.5, noLock: true, desc: '巨大な砲弾を1発だけ撃つ。爆風が広いが、遠くへは届かない' },
  // 遊撃・主武器
  // D90デュアル相当：270×2、560回/分、41×11、リロード2.1秒
  dualmg: { sfx: 'pistol', name: '二丁マシンガン', type: 'gun', dual: true, dmg: 270, rpm: 560, mag: 41, mags: 11, reload: 2.1, spread: 0.03, desc: '2丁の短機関銃。1発は軽いが、長く撃ち続けられる' },
  // コヨーテM68相当：500×2、360回/分の3点射、12×18、リロード1.4秒
  coyote: { sfx: 'pistol', name: '二丁バーストピストル', type: 'gun', dual: true, dmg: 500, rpm: 360, burst: 3, gap: 0.1, mag: 12, mags: 18, reload: 1.4, spread: 0.012, desc: '2丁で3発ずつ撃ち込む。瞬間の火力が高く、リロードが多い' },
  // 遊撃・副武器
  // バトルライフルBF00相当：1950、300発/分、10×5、リロード2.9秒、スコープ2倍、0.55秒で収束。覗かなくても照準の方へ飛ぶ
  battle: { sfx: 'sniper', name: '速射狙撃銃', type: 'gun', dmg: 1950, rpm: 300, mag: 10, mags: 5, reload: 2.9, spread: 0.001, hip: 0.035, hipMove: 1.6, sway: 0.015, settle: 0.55, scope: 2, head: 2, noLock: true, desc: '連射できる近〜中距離の狙撃銃。覗かなくても当たる' },
  // LZ-デイライト相当：6100、1発ごとにリロード（1×10、4.5秒）、スコープ5.5倍、1.8秒で収束
  lzsniper: { sfx: 'sniper', name: '大型狙撃銃', type: 'gun', dmg: 6100, rpm: 30, mag: 1, mags: 10, reload: 4.5, spread: 0.0005, hip: 0.5, hipMove: 1.6, sway: 0.03, settle: 1.8, scope: 5.5, head: 2.5, noLock: true, desc: '1発ごとにリロードする大型の狙撃銃。頭に当てれば一撃' },
  // 遊撃・補助装備
  // クリアリングソナーL7S-N相当：投げると1.5秒後に炸裂し、その瞬間に半径170mの敵機を味方のミニマップに15秒映す。所持数5、補給できない
  sonar: { sfx: 'throw', name: '索敵ソナー', type: 'gun', proj: { dmg: 0, blast: 4, kind: 'sonar', speed: 30, grav: 24, fuse: 1.5, scan: 170, keep: 15 }, rpm: 60, mag: 5, mags: 1, reload: 1, spread: 0, noResupply: true, desc: '投げると炸裂した瞬間に周り170mの敵を15秒映す' },
  // セントリーガンSMG（U26-MG）相当：置くと、70m（wiki 90m）以内の見える敵機を自動で撃つ（110、800発/分、30発ごとに2.6秒リロード、弾は無限）。
  // 耐久4000（仮置き）。持てるのは2台、置けるのは1台（置き直すと前の台は消える）
  sentry: { sfx: 'throw', name: '自動砲台', type: 'gun', proj: { kind: 'sentry', speed: 16, grav: 24, life: 6, hp: 4000, max: 1, gun: { sfx: 'ar', dmg: 110, rpm: 800, mag: 30, reload: 2.6, range: 70, spread: 0.035 } }, rpm: 60, mag: 1, mags: 2, reload: 1, spread: 0, desc: '置くと、近くの見える敵を自動で撃ち続ける小さな砲台' },
  // 遊撃・特別装備：光学迷彩の型違い。被弾でSPが尽きるダメージ（hitHp）はwikiでは型によらず約12000なので、どれも4000
  // 光学迷彩・耐久型C404-D相当：連続28秒、満タンまで50秒（使い切らなければ45秒）
  camoD: { name: '光学迷彩・耐久型', type: 'camo', use: 28, charge: 50, chargeKeep: 45, still: 0.04, move: [0.25, 0.55], shot: 0.8, settle: 0.7, fade: 0.5, hitHp: 4000, desc: '長く消えていられるが、溜まるのが遅い' },
  // 光学迷彩・高出力型C404-H相当：連続11秒、満タンまで20秒（15秒）。ステルスLv3：止まっても動いても見えにくい
  camoH: { name: '光学迷彩・高出力型', type: 'camo', use: 11, charge: 20, chargeKeep: 15, still: 0.02, move: [0.15, 0.4], shot: 0.7, settle: 1, fade: 0.5, hitHp: 4000, desc: '一番見えにくく、すぐ溜まる。消えていられるのは短い' },
  // 支援・主武器
  // ASG-スィーパー相当（430×8、100発/分）を、初期装備のショットガンと同じく強化：380×12、100発/分、9×9、リロード2.3秒
  autosg: { sfx: 'shotgun', name: 'オートショットガン', type: 'gun', dmg: 380, pellets: 12, rpm: 100, mag: 9, mags: 9, reload: 2.3, spread: 0.09, falloff: [12, 30, 0.3], desc: 'ポンプ動作なしで続けて撃てる散弾銃。1発は少し軽い' },
  // ネイルガンT23N相当：690、480発/分、20×16、リロード1.1秒。散弾より遠くまで届く
  nail: { sfx: 'pistol', name: 'ネイルガン', type: 'gun', dmg: 690, rpm: 480, mag: 20, mags: 16, reload: 1.1, spread: 0.035, desc: '釘を連射する。散弾銃より遠くまで届くが、ばらつく' },
  // 支援・副武器
  // DAC22浮遊機雷相当：9100、爆発半径19m（16m）。地面の少し上に浮かび、7m以内に来た敵機で爆発。1×5、同時に5個まで
  fmine: { sfx: 'throw', name: '浮遊機雷', type: 'gun', proj: { dmg: 9100, blast: 16, kind: 'mine', speed: 16, grav: 24, life: 6, trigger: 7, float: 1.6, hp: 3000, max: 5 }, rpm: 60, mag: 1, mags: 5, reload: 1, spread: 0, desc: '少し浮かんで、近くに来た敵で爆発する機雷。踏まなくても反応する' },
  // リモートボムR1R-N相当：13200、爆発半径17m（14m）。置いて、持っている間に右クリックで全部起爆（Botは敵が近づくと起爆）。1×4、同時に4個まで
  remote: { sfx: 'throw', name: '遠隔爆弾', type: 'gun', proj: { dmg: 13200, blast: 14, core: true, kind: 'remote', speed: 16, grav: 24, life: 6, hp: 3000, max: 4 }, rpm: 60, mag: 1, mags: 4, reload: 1, spread: 0, desc: '置いておき、持っている間に右クリックで起爆する強力な爆弾' },
  // 支援・補助装備
  // 滞空索敵弾S1P-N相当：狙った所へ撃ち出し、着いた所の上空20mに50秒浮かんで、真下の半径70mの敵機を映す（範囲を出ても5秒）。所持数3、補給できない
  airsensor: { sfx: 'throw', name: '滞空センサー', type: 'gun', proj: { kind: 'sensor', speed: 70, grav: 12, life: 8, scan: 70, keep: 5, hover: 20, col: true, dur: 50, hp: 2000, max: 3 }, rpm: 60, mag: 3, mags: 1, reload: 1, spread: 0, noResupply: true, desc: '遠くへ撃ち出し、上空から50秒見張る。時間がたつと消える' },
  // BRトラッカーR8T-N相当：置いた向きの前方90度・150mの扇形を見張る（範囲を出ても8秒）。所持数2、耐久10000、補給できない
  fansensor: { sfx: 'throw', name: '扇形センサー', type: 'gun', proj: { kind: 'sensor', speed: 24, grav: 24, life: 6, scan: 150, cone: 90, keep: 8, hp: 10000, max: 2 }, rpm: 60, mag: 2, mags: 1, reload: 1, spread: 0, noResupply: true, desc: '置いた向きの前方90度を遠く150mまで見張る' },
  // 支援・特別装備
  // リペアユニットγ（FXU-C）相当：毎秒1700、射程50m、連続6秒、満タンまで23秒（使い切らなければ18秒）
  repairG: { name: 'リペアユニット・高出力型', type: 'repair', heal: 1700, range: 50, use: 6, charge: 23, chargeKeep: 18, desc: '回復が速いが、続けて使えるのは短い' },
  // リペアフィールドFXF-A相当：選ぶと作動し、自機と周り12mの味方を毎秒1000修理。連続50秒、満タンまで45秒（40秒）。持っている武器はそのまま
  field: { name: 'リペアフィールド', type: 'field', heal: 1000, radius: 12, use: 50, charge: 45, chargeKeep: 40, desc: '選ぶと自分と周り12mの味方を修理し、行動不能の味方も蘇生する。撃ちながら使える。対象の味方が多いほどSPが早く減る' },
  // ---- Codex 版の主武器の系統（v0.14、ユーザー指定「主武器バリエーションに関してはCodex版からある程度移植できると思うので検討願います」）----
  // Codex 版の weapons.js の主武器のうち、本作の撃ち方のまま数値だけで作れる7系統。数値は wiki（PS4版）の各系統の最初の型の強化前の値で、形は Codex 版のもの。
  // ばらつき（spread）と反動（recoil）は、wiki の精度・反動のランクを本作の近い武器から1段0.88倍で換算した。energy：光学兵器（弾の光が青緑寄りになる）。
  // チャージ撃ち・横に広がる弾・炸裂弾の系統は仕組みが要るので次の版
  // UK56速射機銃相当：350、840発/分、70×14、リロード2.2秒。精度D+、反動C+
  carbine: { sfx: 'ar', name: 'カービン', type: 'gun', dmg: 350, rpm: 840, mag: 70, mags: 14, reload: 2.2, spread: 0.007, recoil: 0.0065, desc: '大きな弾倉で撃ち続けられる連射銃。アサルトライフルより重く、反動も強い' },
  // SSG7－ゲイル相当：280×7、単発で240発/分、6×19、リロード1.4秒
  gale: { sfx: 'shotgun', name: '軽量散弾銃', type: 'gun', dmg: 280, pellets: 7, rpm: 240, semi: true, mag: 6, mags: 19, reload: 1.4, spread: 0.06, falloff: [10, 35, 0.25], recoil: 0.01, desc: '軽く、1発ずつ素早く撃てる散弾銃。弾倉が小さい' },
  // ヴルカンLG1相当：640、480発/分、45×19、リロード2.2秒。オーバーヒートしない。精度D、反動A-
  vulcan: { sfx: 'ar', name: 'エナジー機銃', type: 'gun', dmg: 640, rpm: 480, mag: 45, mags: 19, reload: 2.2, spread: 0.034, recoil: 0.0015, energy: true, desc: '光学式の機銃。オーバーヒートせず反動も小さいが、ばらつく' },
  // マーゲイM40相当：450×2、単発で360回/分、18×11、リロード1.3秒。精度B、反動C+
  margay: { sfx: 'pistol', name: '単射二丁拳銃', type: 'gun', dual: true, dmg: 450, rpm: 360, semi: true, mag: 18, mags: 11, reload: 1.3, spread: 0.011, desc: '左右から1発ずつの精密な単発弾。クリックの速さが火力になる' },
  // LMM－ジェミニ相当：400×2、360回/分、18×13、リロード1.6秒。精度B、反動A-
  gemini: { sfx: 'pistol', name: '二丁エナジー銃', type: 'gun', dual: true, dmg: 400, rpm: 360, mag: 18, mags: 13, reload: 1.6, spread: 0.011, recoil: 0.0036, energy: true, desc: '光学式の二丁拳銃。反動が小さく精度が高いが、弾倉は小さい' },
  // ハガードM50相当：2530、単発で120発/分、6×9、リロード1.3秒。精度B-、反動D+。
  // 本作では威力を0.85倍の2150、頭は2倍（v0.15、ユーザー指摘「マグナム強装型つよすぎ！3発で死ぬじゃん！DPSとびぬけすぎだあ」。型も同じ比で下がる。値は Claude の判断）
  haggard: { sfx: 'magnum', name: 'マグナム', type: 'gun', dmg: 2150, rpm: 120, semi: true, mag: 6, mags: 9, reload: 1.3, spread: 0.0041, recoil: 0.012, head: 2, desc: '1発が重い単発の拳銃。頭に当てると2倍' },
  // LSG－アヴローラ相当：920×5、単発で42発/分、5×9、リロード2.8秒。普通の散弾より遠くまで威力が落ちにくい
  // ---- 仕組みの要る Codex 版の系統（v0.15、ユーザー指定「残タスクで実装易いのも併せて武器の実装を進めてください」）----
  // チャージ撃ち：引いている間に溜まり（chargeTime 秒で満タン）、離すと1発撃つ。溜めた割合で威力が chargeMul 倍まで上がる。
  // 満タンのときだけ chargeBlast（当たった所で爆発。m）、chargeOrb（代わりに撃つ光弾の proj）。chargeFocus：満タンでばらつきが何倍になるか。
  // chargeHold：満タンのまま持っていられる秒（過ぎるとオーバーヒートして ohTime 秒撃てない）。
  // fan：散弾を横一列に並べる間隔（ラジアン）。blast：弾が当たった所で爆発する（半径 m、威力は爆風で与える）。爆発半径は wiki の0.82倍（本作のほかの爆発物と同じ）
  // ウェーブショット相当：900（満タンで1.8倍の1620）、21×13、300発/分、満タンまで1.2秒、リロード2.6秒。満タンのまま5.3秒でオーバーヒート（2秒）
  wave: { sfx: 'sniper', name: '波動ライフル', type: 'gun', dmg: 900, rpm: 300, mag: 21, mags: 13, reload: 2.6, spread: 0.006, recoil: 0.003, chargeTime: 1.2, chargeMul: 1.8, chargeHold: 5.3, ohTime: 2, energy: true, desc: '引いている間に溜め、離すと撃つ光学銃。軽く押せばすぐ撃て、満タンで威力1.8倍' },
  // LEC－シュトラル相当：1370（満タンで2倍の2740）、18×18、300発/分、満タンまで1.5秒、リロード2.6秒。満タンなら当たった所で爆発（11m（9m））
  lec: { sfx: 'sniper', name: '蓄積エナジー砲', type: 'gun', dmg: 1370, rpm: 300, mag: 18, mags: 18, reload: 2.6, spread: 0.006, recoil: 0.005, chargeTime: 1.5, chargeMul: 2, chargeBlast: 9, energy: true, desc: '溜めて撃つ光学砲。満タンで撃つと威力2倍で、当たった所が爆発する' },
  // 単式炸薬砲相当：1340、200発/分、30×9、リロード3.6秒、16発でオーバーヒート（3.1秒）。当たった所で爆発（9m（7.5m））。精度C-、反動B-
  explo: { sfx: 'magnum', name: '炸裂機関砲', type: 'gun', dmg: 1340, rpm: 200, mag: 30, mags: 9, reload: 3.6, spread: 0.014, recoil: 0.0035, blast: 7.5, heat: 16, ohTime: 3.1, cool: 3, desc: '弾が当たった所で爆発する機関砲。物陰の敵も巻き込めるが、近いと自分も巻き込まれる' },
  // ワイドショット相当：130×3を左右から（横一列）、480回/分、21×13、リロード1.4秒
  wide: { sfx: 'pistol', name: '二丁拡散銃', type: 'gun', dual: true, dmg: 130, pellets: 3, fan: 0.055, rpm: 480, mag: 21, mags: 13, reload: 1.4, spread: 0.006, recoil: 0.005, falloff: [12, 40, 0.35], desc: '左右の銃から横一列に3発ずつ撃つ。動く敵を近くで捉えやすい' },
  // グリントN72D相当：440×2、450回/分、24×10、リロード2.1秒、満タンまで1.5秒。満タンなら左右からゆっくり進む光弾（2400、爆発14m（11.5m））
  glint: { sfx: 'pistol', name: '二丁蓄積銃', type: 'gun', dual: true, dmg: 440, rpm: 450, mag: 24, mags: 10, reload: 2.1, spread: 0.009, recoil: 0.004, chargeTime: 1.5, chargeMul: 1.1, chargeOrb: { dmg: 2400, blast: 11.5, core: true, kind: 'shell', speed: 65, life: 1.6, energy: true }, energy: true, desc: '軽く押せば普通の弾。満タンで離すと左右から爆発する光弾を撃つ' },
  // CLS－ライオ相当：450×10、90発/分、3×14、リロード1.8秒、満タンまで1.2秒。溜めるほど散弾がまとまる（満タンでばらつき0.16倍）。威力は変わらない
  cls: { sfx: 'shotgun', name: '収束散弾銃', type: 'gun', dmg: 450, pellets: 10, rpm: 90, mag: 3, mags: 14, reload: 1.8, spread: 0.11, recoil: 0.009, chargeTime: 1.2, chargeFocus: 0.16, chargeHold: 6.15, ohTime: 2, falloff: [18, 55, 0.45], energy: true, desc: '溜めるほど散弾がまとまる光学散弾銃。近くは軽く押し、遠くは溜めて撃つ' },
  aurora: { sfx: 'shotgun', name: 'エナジー散弾銃', type: 'gun', dmg: 920, pellets: 5, rpm: 42, semi: true, mag: 5, mags: 9, reload: 2.8, spread: 0.04, falloff: [18, 55, 0.45], recoil: 0.012, energy: true, desc: '少ない光弾を狭くまとめて撃つ。連射は遅いが遠くまで届く' },
};
WEAPONS.sabre.normal = WEAPONS.sabre.combo[0]; // 1段目が通常攻撃（Bot の間合いなどは normal を見る）
// 初期装備の説明（機体カスタマイズの画面に出す）
Object.entries({
  ar: 'くせの無い連射銃。リロードが速い',
  sword: '横なぎは2回、ダッシュ中の回転斬りは一撃で倒せる剣',
  gatling: '空転のあと猛烈に連射する。撃ち続けるとオーバーヒート',
  rocket: '当たると爆発するロケット。防衛砲台を壊すのにも向く',
  pistols: '左右から1発ずつ撃つ二丁拳銃。リロードが速い',
  sniper: 'スコープを覗いて止まると照準が収束する。頭に当てると2.5倍',
  shotgun: '近くで当てれば2発で倒せる散弾銃。遠いと威力が落ちる',
  grenade: '何かに当たると爆発する手榴弾',
  weaken: '巻き込んだ敵の被ダメージを5秒間1.4倍にする',
  mine: '敵が踏むと爆発する地雷。同時に5個まで置ける',
  sensor: '貼りついた所の周り65mの敵を味方のミニマップに映す',
  drone: '屈んで打ち上げ、向いた方へ飛んで下の敵を映す',
  repair: '照準の先の味方と砲台を回復する。右クリックで自分も',
  charger: '作動中はShift長押しで前へ高速移動。撃ちながら使える',
  cannon: '構えると動けず、山なりの砲弾を6発撃てる',
  camo: '姿を消す。止まっているほど見えにくい',
}).forEach(([k, d]) => { WEAPONS[k].desc = d; });
// 4つの枠：主武器・副武器・補助装備・特別装備。中身は wiki（PS4版）の各兵装の初期装備に合わせた（強襲のソードは補助装備、支援のリペアユニットは特別装備）
const SLOTS = ['main', 'sub', 'aux', 'sp'];
const SLOT_NAMES = { main: '主武器', sub: '副武器', aux: '補助装備', sp: '特別装備' };
// hp：耐久（無ければ10000）、move：歩き・ショートダッシュ・ロングダッシュの速さの倍率（無ければ1。ジャンプとカタパルトは変わらない）
const CLASSES = {
  assault: { name: '強襲', main: 'ar', sub: 'grenade', aux: 'sword', sp: 'charger' },
  heavy: { name: '重火力', main: 'gatling', sub: 'rocket', aux: 'weaken', sp: 'cannon', hp: 14000 }, // 耐久1.4倍（ユーザー指定、v0.9.3）。v0.9.3 の歩き・ダッシュ0.85倍は、v0.12 から武器の重量（重量超過）で決まる
  raid: { name: '遊撃', main: 'pistols', sub: 'sniper', aux: 'drone', sp: 'camo' },
  support: { name: '支援', main: 'shotgun', sub: 'mine', aux: 'sensor', sp: 'repair' },
};
const CLASS_KEYS = ['assault', 'heavy', 'raid', 'support'];
// 機体カスタマイズで選べる武器（v0.11、ユーザー指定）。各枠の先頭が初期装備（CLASSES と同じ）。最初から全部選べる
const ARMORY = {
  assault: { main: ['ar', 'burst', 'marks', 'carbine', 'gale', 'wave', 'rail', 'pulse'], sub: ['grenade', 'timed', 'gl', 'flare', 'chain', 'dart', 'missile'], aux: ['sword', 'blade', 'spear', 'sabre', 'rod', 'claw', 'waveSword'], sp: ['charger', 'chargerD', 'chargerS', 'omni', 'mirage', 'mirageH', 'mirageL', 'mirageD'] },
  heavy: { main: ['gatling', 'mg', 'acannon', 'vulcan', 'lec', 'explo', 'coil'], sub: ['rocket', 'scrum', 'plasma', 'charge', 'mlrs', 'seeker'], aux: ['weaken', 'impactb', 'hsg', 'pike', 'jammer'], sp: ['cannon', 'cannonH', 'cannonM', 'barrier', 'artillery', 'reflector', 'beamCannon'] },
  raid: { main: ['pistols', 'dualmg', 'coyote', 'margay', 'gemini', 'wide', 'glint'], sub: ['sniper', 'battle', 'lzsniper', 'zoom', 'blastSniper', 'lightSniper', 'optSniper', 'jumpMine'], aux: ['drone', 'sonar', 'sentry', 'airTurret', 'flyTurret', 'stunGrenade', 'radarTool'], sp: ['camo', 'camoD', 'camoH', 'escort'] },
  support: { main: ['shotgun', 'autosg', 'nail', 'haggard', 'aurora', 'cls'], sub: ['mine', 'fmine', 'remote', 'delayMine', 'detonator'], aux: ['sensor', 'airsensor', 'fansensor', 'planeSensor', 'ammoBox', 'stunner'], sp: ['repair', 'repairG', 'field', 'repairPost'] },
};
// 武器のキー（形を選ぶのに使う）と、投げる物の形（v0.11.1）
// 射撃音（v0.11.3、ユーザー指定「射撃音のバリエーションを増やす」）：同じ音を使う武器は、音の種類と高さ（sfxRate）を変えて聞き分けられるようにする。
// 音の素材は同じ13個（sounds/CREDITS.md）。マグナムは Codex 版の音の設定
const SFX_TUNE = {
  missile: ['rocket', 1.2], mlrs: ['rocket', .85], seeker: ['rocket', 1.05],
  waveSword: ['swing', 1.15],
  sabre:['swing',.75],rod:['swing',1.05],claw:['swing',.9],pike:['swing',.7],jammer:['throw',.85],airTurret:['throw',1.15],flyTurret:['throw',1.25],stunGrenade:['throw',1.05],planeSensor:['throw',.95],ammoBox:['throw',.75],radarTool:['sensor',.8],
  flare: ['throw', .8], chain: ['throw', 1.2], dart: ['shotgun', 1.25], charge: ['heavy', .9], zoom: ['sniper', 1.1], blastSniper: ['magnum', .75], lightSniper: ['sniper', 1.4], optSniper: ['sniper', 1.15], jumpMine: ['throw', .95], delayMine: ['throw', 1.15], detonator: ['rocket', 1.1],
  beamCannon: ['beam', 1], artillery: ['heavy', .85], reflector: ['beam', .7],
  escort: ['pistol', 1.15], barrier: ['switch', .9], repairPost: ['switch', 1.1],
  rail: ['sniper', 1.1], pulse: ['pistol', 1.5], coil: ['magnum', 0.9],
  burst: ['ar', 0.9], mg: ['ar', 0.82], marks: ['magnum', 1.15], acannon: ['magnum', 0.8], battle: ['sniper', 1.2], lzsniper: ['sniper', 0.75],
  nail: ['pistol', 1.3], dualmg: ['pistol', 1.12], coyote: ['pistol', 0.9], autosg: ['shotgun', 1.15], hsg: ['shotgun', 0.85],
  scrum: ['rocket', 1.25], gl: ['rocket', 1.4], plasma: ['heavy', 1.35], cannonH: ['heavy', 1.2], cannonM: ['heavy', 0.85],
  carbine: ['ar', 1.08], gale: ['shotgun', 1.45], vulcan: ['ar', 1.3], margay: ['pistol', 0.95], gemini: ['pistol', 1.4], aurora: ['shotgun', 1.3],
  wave: ['sniper', 1.35], lec: ['sniper', 0.95], explo: ['magnum', 0.7], wide: ['pistol', 1.55], glint: ['pistol', 1.25], cls: ['shotgun', 1.2],
};
for (const [k, [name, rate]] of Object.entries(SFX_TUNE)) Object.assign(WEAPONS[k], { sfx: name, sfxRate: rate });
for (const [k, w] of Object.entries(WEAPONS)) { w.key = k; w.kg = WEAPON_KG[k] || 0; if (w.sfx === 'throw' && w.proj) w.proj.model = k; }
// 武器のシリーズ（v0.13、ユーザー決定）：撃ち方と形が同じ武器のまとまり。types は [武器のキー, 型番]。型の違いは数値だけ。
// 名前は「型番＋武器の名前」（例：SR-7 アサルトライフル）。型番とメーカーはオリジナル。今の48種のうち、特別装備の同じ仕組みの物（加速装置・重砲・光学迷彩・リペアユニット）は1つのシリーズの型
const SERIES = {
  li: { maker:'lumina', types:[['beamCannon','LI-5']] },
  mirage: { maker: 'iris', types: [['mirage', 'IM-7'], ['mirageH', 'IM-7H'], ['mirageL', 'IM-7L'], ['mirageD', 'IM-7D']] },
  vp: { maker: 'volca', types: [['missile', 'VP-4']] },
  gq: { maker: 'gard', types: [['mlrs', 'GQ-6']] },
  lj: { maker: 'lumina', types: [['waveSword', 'LJ-6']] },
  ik: { maker: 'iris', types: [['stunner', 'IK-3']] }, // 2026-11-06：前は ie で、索敵センサーの ie と重なり、支援の補助装備の一覧が開けなかった
  sy: { maker: 'sylph', types: [['sabre', 'SY-2']] },
  lk: { maker: 'lumina', types: [['rod', 'LK-4']] },
  sc: { maker: 'sylph', types: [['claw', 'SC-9']] },
  gj: { maker: 'gard', types: [['pike', 'GJ-8']] },
  ij: { maker: 'iris', types: [['jammer', 'IJ-2']] },
  io: { maker: 'iris', types: [['airTurret', 'IO-5']] },
  ic: { maker: 'iris', types: [['flyTurret', 'IC-7']] },
  vz: { maker: 'volca', types: [['stunGrenade', 'VZ-4']] },
  ix: { maker: 'iris', types: [['planeSensor', 'IX-3']] },
  ib: { maker: 'iris', types: [['ammoBox', 'IB-2']] },
  is: { maker: 'iris', types: [['radarTool', 'IS-6']] },
  vu: { maker: 'volca', types: [['flare', 'VU-2']] },
  vc: { maker: 'volca', types: [['chain', 'VC-8']] },
  vd: { maker: 'volca', types: [['dart', 'VD-3']] },
  lq: { maker: 'lumina', types: [['charge', 'LQ-9']] },
  sz: { maker: 'sylph', types: [['zoom', 'SZ-4']] },
  vx: { maker: 'volca', types: [['blastSniper', 'VX-4']] },
  ln: { maker: 'lumina', types: [['lightSniper', 'LN-2']] },
  lt: { maker: 'lumina', types: [['optSniper', 'LT-7']] },
  vj: { maker: 'volca', types: [['jumpMine', 'VJ-5']] },
  vk: { maker: 'volca', types: [['delayMine', 'VK-3']] },
  vn: { maker: 'volca', types: [['detonator', 'VN-6']] },
  vh: { maker: 'volca', types: [['artillery', 'VH-6']] },
  rf: { maker: 'lumina', types: [['reflector', 'RF-1']] },
  gb: { maker: 'gard', types: [['barrier', 'GB-6']] },
  it: { maker: 'iris', types: [['escort', 'IT-3']] },
  ip: { maker: 'iris', types: [['repairPost', 'IP-4']] },
  lr: { maker: 'lumina', types: [['rail', 'LR-12']] }, lb: { maker: 'lumina', types: [['pulse', 'LB-3']] }, lx: { maker: 'lumina', types: [['coil', 'LX-18']] },
  // 強襲
  sr: { maker: 'sylph', types: [['ar', 'SR-7']] }, sb: { maker: 'sylph', types: [['burst', 'SB-3']] }, gr: { maker: 'gard', types: [['marks', 'GR-11']] },
  vg: { maker: 'volca', types: [['grenade', 'VG-1']] }, vt: { maker: 'volca', types: [['timed', 'VT-2']] }, vl: { maker: 'volca', types: [['gl', 'VL-3']] },
  se: { maker: 'sylph', types: [['sword', 'SE-1'], ['blade', 'SE-9']] }, sl: { maker: 'sylph', types: [['spear', 'SL-2']] }, // 大剣はソード系の上位の型（v0.13.1、ユーザー指定）
  lc: { maker: 'lumina', types: [['charger', 'LC-3'], ['chargerD', 'LC-3D'], ['chargerS', 'LC-3S']] },
  // 重火力
  gg: { maker: 'gard', types: [['gatling', 'GG-9']] }, gm: { maker: 'gard', types: [['mg', 'GM-7']] }, ga: { maker: 'gard', types: [['acannon', 'GA-1']] },
  vr: { maker: 'volca', types: [['rocket', 'VR-8']] }, vs: { maker: 'volca', types: [['scrum', 'VS-4']] }, vq: { maker: 'volca', types: [['seeker', 'VQ-5']] }, lp: { maker: 'lumina', types: [['plasma', 'LP-2']] },
  vw: { maker: 'volca', types: [['weaken', 'VW-1']] }, vi: { maker: 'volca', types: [['impactb', 'VI-6']] }, gh: { maker: 'gard', types: [['hsg', 'GH-9']] },
  lv: { maker: 'lumina', types: [['vulcan', 'LV-1']] }, le: { maker: 'lumina', types: [['lec', 'LE-5']] }, ve: { maker: 'volca', types: [['explo', 'VE-16']] },
  gk: { maker: 'gard', types: [['cannon', 'GK-56'], ['cannonH', 'GK-56H'], ['cannonM', 'GK-56M']] },
  // 遊撃
  sk: { maker: 'sylph', types: [['carbine', 'SK-56']] }, ss: { maker: 'sylph', types: [['gale', 'SS-7']] }, // Codex 版の系統（v0.14）
  lw: { maker: 'lumina', types: [['wave', 'LW-28']] }, lo: { maker: 'lumina', types: [['omni', 'LO-1']] }, // 仕組みの要る Codex 版の系統（v0.15）
  sd: { maker: 'sylph', types: [['pistols', 'SD-20']] }, sm: { maker: 'sylph', types: [['dualmg', 'SM-90']] }, gd: { maker: 'gard', types: [['coyote', 'GD-68']] },
  gs: { maker: 'gard', types: [['sniper', 'GS-38']] }, sf: { maker: 'sylph', types: [['battle', 'SF-10']] }, ls: { maker: 'lumina', types: [['lzsniper', 'LS-6']] },
  sw: { maker: 'sylph', types: [['margay', 'SW-40']] }, lm: { maker: 'lumina', types: [['gemini', 'LM-6']] },
  st: { maker: 'sylph', types: [['wide', 'ST-3']] }, lg: { maker: 'lumina', types: [['glint', 'LG-72']] },
  id: { maker: 'iris', types: [['drone', 'ID-1']] }, iw: { maker: 'iris', types: [['sonar', 'IW-7']] }, gt: { maker: 'gard', types: [['sentry', 'GT-4']] },
  iv: { maker: 'iris', types: [['camo', 'IV-4'], ['camoD', 'IV-4D'], ['camoH', 'IV-4H']] },
  // 支援
  gp: { maker: 'gard', types: [['shotgun', 'GP-12']] }, sa: { maker: 'sylph', types: [['autosg', 'SA-8']] }, sn: { maker: 'sylph', types: [['nail', 'SN-23']] },
  vm: { maker: 'volca', types: [['mine', 'VM-5']] }, vf: { maker: 'volca', types: [['fmine', 'VF-22']] }, vb: { maker: 'volca', types: [['remote', 'VB-1']] },
  ie: { maker: 'iris', types: [['sensor', 'IE-2']] }, ia: { maker: 'iris', types: [['airsensor', 'IA-1']] }, if: { maker: 'iris', types: [['fansensor', 'IF-8']] },
  gn: { maker: 'gard', types: [['haggard', 'GN-50']] }, la: { maker: 'lumina', types: [['aurora', 'LA-1']] }, lf: { maker: 'lumina', types: [['cls', 'LF-4']] },
  ir: { maker: 'iris', types: [['repair', 'IR-1'], ['repairG', 'IR-1G']] }, ih: { maker: 'lumina', types: [['field', 'IH-1']] },
};
// ---- 武器の型（v0.14、ユーザー指定「兵装ふやしてこっか」）：wiki（PS4版）の各系統の表から、元の武器と撃ち方が同じで数値だけが違う型を足す ----
// 表は research/weapons/*.md、選んだ型と選ばなかった型の理由は docs/DESIGN.md。コラボ品と、撃ち方が違う型（3点射・チャージ・拡散など）は入れていない（チャージ撃ちなどは v0.15 で別の系統として足した）。
// WEAPON_TYPES：元の武器のキー → { w0：元にした wiki の型の強化前の値, types：[型の名前, wiki の値, 説明] }。行の終わりのコメントは wiki の名前。
// 型の数値は「wiki の値 ÷ w0」の比を本作の元の武器の値に掛けて作る（本作で強化・縮小した分はそのまま残る。重量は wiki の値そのまま）。
// 精度（acc）と反動（recoil）は、ランクが1段上がるごとに弾のばらつき・跳ね上がりを0.88倍にする。
// 近接の威力は wiki では連撃の合計なので比の平方根を掛け、横なぎは9600まで（どの型でも2回は要る）、ダッシュ斬りは20000まで。
// 近接は重いほど振りが遅く（重さの比の0.35乗）、踏み込みが短く（0.3乗で割る）、間合いが少し長い（0.12乗）。値の決め方は仮（Claude の判断）
const WEAPON_TYPES = {
  missile: {"w0":{"dmg":2600,"rpm":360,"mag":4,"mags":4,"reload":2.4,"kg":350,"blast":11,"speed":30,"rank":"D","turn":0.88,"maxSpeed":30,"accel":0,"shots":4,"locks":1,"recoilV":0.4,"recoilH":0.2},"types":[["強装型",{"dmg":3100,"rpm":240,"mag":3,"mags":4,"reload":2.6,"kg":360,"blast":13,"speed":30,"rank":"C-","turn":1.6,"maxSpeed":30,"accel":0,"shots":3,"locks":1,"recoilV":0.5,"recoilH":0.2},"誘導性能・弾速・一捕捉の発数が異なる"],["高速型",{"dmg":2700,"rpm":480,"mag":4,"mags":4,"reload":2.6,"kg":380,"blast":10,"speed":50,"rank":"E","turn":0.6,"maxSpeed":50,"accel":0,"shots":4,"locks":1,"recoilV":0.4,"recoilH":0.2},"誘導性能・弾速・一捕捉の発数が異なる"],["大容量型",{"dmg":2200,"rpm":540,"mag":6,"mags":3,"reload":3.4,"kg":420,"blast":11,"speed":30,"rank":"D+","turn":1.2,"maxSpeed":30,"accel":0,"shots":6,"locks":1,"recoilV":0.3,"recoilH":0.2},"誘導性能・弾速・一捕捉の発数が異なる"]]},
  mlrs: {"w0":{"dmg":2600,"rpm":480,"mag":6,"mags":3,"reload":3,"kg":500,"blast":12,"speed":30,"rank":"C+","turn":2,"maxSpeed":90,"accel":40,"shots":2,"locks":3,"recoilV":0.1,"recoilH":0.2},"types":[["高速型",{"dmg":2000,"rpm":600,"mag":6,"mags":4,"reload":3,"kg":520,"blast":11,"speed":30,"rank":"D+","turn":1.2,"maxSpeed":110,"accel":80,"shots":2,"locks":3,"recoilV":0.1,"recoilH":0.2},"誘導性能・弾速・一捕捉の発数が異なる"],["強装型",{"dmg":4200,"rpm":320,"mag":4,"mags":3,"reload":4,"kg":570,"blast":14,"speed":30,"rank":"A+","turn":4.5,"maxSpeed":50,"accel":10,"shots":1,"locks":4,"recoilV":0.2,"recoilH":0.2},"誘導性能・弾速・一捕捉の発数が異なる"],["大容量型",{"dmg":2300,"rpm":480,"mag":8,"mags":3,"reload":4,"kg":590,"blast":9,"speed":30,"rank":"B+","turn":3.2,"maxSpeed":85,"accel":35,"shots":2,"locks":4,"recoilV":0.1,"recoilH":0.2},"誘導性能・弾速・一捕捉の発数が異なる"]]},
  // レーザー誘導ロケット（2026-11-06）：アーケード版 シーカー系統の4行（シーカーロケット・トライシーカー・パワードシーカー・マルチシーカー）。maxSpeed・accel・turn は仮置き
  seeker: { w0: { dmg: 8000, rpm: 60, mag: 1, mags: 6, reload: 2.2, kg: 470, blast: 14, speed: 40, maxSpeed: 150, accel: 75, turn: 2.2, recoilV: 2 }, types: [
    ['三点射型', { dmg: 5200, rpm: 360, burst: 3, mag: 3, mags: 6, reload: 3.5, kg: 510, blast: 11, speed: 30, maxSpeed: 140, accel: 65, turn: 2, recoilV: .8 }, '1回で3発続けて撃つ。1発は軽く、少し曲がりにくい'],
    ['強装型', { dmg: 11500, rpm: 60, mag: 1, mags: 4, reload: 4, kg: 520, blast: 18, speed: 20, maxSpeed: 120, accel: 50, turn: 2.4, recoilV: 2 }, '威力と爆風が大きく、よく曲がる。出足がとても遅い'],
    ['連射型', { dmg: 4800, rpm: 210, mag: 5, mags: 4, reload: 4, kg: 490, blast: 13, speed: 60, maxSpeed: 160, accel: 90, turn: 2.2, recoilV: 1.2 }, '5発を続けて撃てる。1発は軽いが出足が速い'],
  ] },
  sabre: { w0: {"kg":180,"normalHits":[2000,3500],"strongHits":[4500]}, types: [
    ["強装型",{"kg":300,"normalHits":[2000,4000],"strongHits":[8000],"iai":{"chain":true}},SABRE_DESC+'。居合は「連閃」：満タンで抜けた直後にもう一度押すと、続けてもう一度抜ける'],
    ["重装型",{"kg":390,"normalHits":[2000,4000,4500],"strongHits":[9000],"iai":{"charge":1.5,"dmg":[3500,7000],"down":true}},SABRE_DESC+'。居合は「重閃」：溜めは1.5秒と長いが、当たった全員をダウンさせる'],
  ] },
  rod: { w0: {"kg":190,"normalHits":[2500,2500],"strongHits":[4500,3500]}, types: [
    ["強装型",{"kg":310,"normalHits":[2500,2500,3000],"strongHits":[4500,4500]},"左右の短刀で連撃。同時に当たった分は合算して姿勢異常を判定。ダッシュ中は右薙ぎ→両手で左薙ぎ→回転の三段連撃"],
    ["重装型",{"kg":420,"normalHits":[2500,2500,3000,4500],"strongHits":[2500,4500,2500,4500]},"左右の短刀で連撃。同時に当たった分は合算して姿勢異常を判定。ダッシュ中は右薙ぎ→両手で左薙ぎ→回転の三段連撃"],
  ] },
  claw: { w0: {"kg":200,"normalHits":[2500,2500],"strongHits":[3000,3000]}, types: [
    ["強装型",{"kg":300,"normalHits":[2500,2500,2250,2250],"strongHits":[3500,3500]},"左右の爪で近距離を連撃。ダッシュ中は伸びるレーザー刃で右袈裟→左袈裟の二段攻撃。上位型ほどリーチ・薙ぐ幅・隙が大きい"],
    ["連撃型",{"kg":400,"normalHits":[2500,2500,2500,2500],"strongHits":[2500,2500,3000,3000,4500]},"左右の爪で近距離を連撃。ダッシュ中は伸びるレーザー刃で右袈裟→左袈裟の二段攻撃。上位型ほどリーチ・薙ぐ幅・隙が大きい"],
    ["重装型",{"kg":500,"normalHits":[3500,3500],"strongHits":[4500,4500]},"左右の爪で近距離を連撃。ダッシュ中は伸びるレーザー刃で右袈裟→左袈裟の二段攻撃。上位型ほどリーチ・薙ぐ幅・隙が大きい"],
  ] },
  pike: { w0: {"kg":210,"normalLevels":[4500,6750,9000],"strongLevels":[6000,9000,12000],"chargeTime":2}, types: [
    ["強装型",{"kg":240,"normalLevels":[5000,8750,12500],"strongLevels":[7000,12250,17500],"chargeTime":2.5},"左長押しで二段階に蓄圧、離して突く。離す瞬間にダッシュすると強打。満充填は8秒保持できる"],
    ["重装型",{"kg":280,"normalLevels":[5500,11000,16500],"strongLevels":[9000,18000,30000],"chargeTime":3},"左長押しで二段階に蓄圧、離して突く。離す瞬間にダッシュすると強打。満充填は8秒保持できる"],
  ] },
  jammer: { w0: {"kg":140,"count":3,"jamSeconds":5,"blast":25,"fuse":2.5}, types: [
    ["即応型",{"kg":160,"count":3,"jamSeconds":2.5,"blast":30,"fuse":0.5},"時間で炸裂し、敵だけの視界・敵名表示・近距離ロックと他者への修理を妨害。自分と味方には効かない"],
    ["持続型",{"kg":120,"count":2,"jamSeconds":7,"blast":20,"fuse":2.5},"時間で炸裂し、敵だけの視界・敵名表示・近距離ロックと他者への修理を妨害。自分と味方には効かない"],
    ["改良型",{"kg":170,"count":3,"jamSeconds":4,"blast":22,"fuse":1},"時間で炸裂し、敵だけの視界・敵名表示・近距離ロックと他者への修理を妨害。自分と味方には効かない"],
  ] },
  airTurret: { w0: {"kg":410,"count":2,"dmg":70,"mag":20,"rpm":420,"reload":4,"gunEnergy":false}, types: [
    ["軽量弾型",{"kg":450,"count":3,"dmg":200,"mag":3,"rpm":120,"reload":2.5,"gunEnergy":false},"投げた空中で浮上し、全周60mの見える敵機を自動射撃。天井に当たると浮上を止める"],
    ["強装型",{"kg":460,"count":1,"dmg":720,"mag":10,"rpm":75,"reload":3.2,"gunEnergy":false},"投げた空中で浮上し、全周60mの見える敵機を自動射撃。天井に当たると浮上を止める"],
    ["光学型",{"kg":470,"count":1,"dmg":800,"mag":2,"rpm":120,"reload":2.7,"gunEnergy":true},"投げた空中で浮上し、全周60mの見える敵機を自動射撃。天井に当たると浮上を止める"],
  ] },
  flyTurret: { w0: {"kg":490,"count":5,"dmg":230,"mag":6,"rpm":120,"reload":1.5,"dur":8.4,"roamSpeed":10}, types: [
    ["速射型",{"kg":510,"count":6,"dmg":150,"mag":10,"rpm":150,"reload":1,"dur":7.6,"roamSpeed":15},"投げた方向へ巡航しながら、下方の見える敵を自動射撃。一定時間で消える。攻撃で破壊できる"],
    ["強装型",{"kg":540,"count":3,"dmg":490,"mag":4,"rpm":80,"reload":2,"dur":10,"roamSpeed":8},"投げた方向へ巡航しながら、下方の見える敵を自動射撃。一定時間で消える。攻撃で破壊できる"],
  ] },
  // スタンガンの型（2026-11-06 オーナー「ボーダーブレイクwikiのスタナーの項目を参照しバリエーションを追加」）：アーケード版 スタナー系統 pages/401
  // スタナーJ（基準）重量320・威力1800/2700/3600・効果持続 最大1秒・攻撃範囲Lv2・充填2秒、J2 350・1200/3000/4800・最大2秒・Lv1・4秒、K 370・2000/3000/4000・最大1秒・Lv3・3秒。
  // 本作の値＝本作の基本の値×型の値÷J の値（makeType の stunField の所）。威力は最小と最大を別々に、妨害の秒は最大の比、溜めは充填の比。
  // 攻撃範囲の Lv は長さと幅の倍率にする（Lv1 ×0.8・Lv2 ×1・Lv3 ×1.25。Claude の値）。重さも本作の基本 260kg × 型÷320。
  stunner: { w0: { kg: 320, dmg: [1800, 3600], shock: 1, area: 2, charge: 2 }, types: [
    ["持続型", { kg: 284, dmg: [1200, 4800], shock: 2, area: 1, charge: 4 }, '溜めに時間がかかるが、満タンの威力と痺れの長さ（最大2秒）が大きい。範囲は狭い。ロックオンでき、弾は無限'], // スタナーJ2
    ["広域型", { kg: 301, dmg: [2000, 4000], shock: 1, area: 3, charge: 3 }, '範囲が広く、威力も少し高い。溜めは少し長い。ロックオンでき、弾は無限'], // スタナーK
  ] },
  stunGrenade: { w0: {"kg":210,"count":3,"stunSeconds":2.5,"blast":15,"fuse":3,"reload":1}, types: [
    ["即応型",{"kg":200,"count":3,"stunSeconds":2,"blast":12,"fuse":1,"reload":1},"時間で炸裂し、範囲内の敵だけを立ったまま硬直させる。ダメージはない"],
    ["持続型",{"kg":250,"count":2,"stunSeconds":3,"blast":20,"fuse":4.5,"reload":1},"時間で炸裂し、範囲内の敵だけを立ったまま硬直させる。ダメージはない"],
  ] },
  planeSensor: { w0: {"kg":340,"count":2,"scan":160,"keep":10}, types: [
    ["軽量型",{"kg":310,"count":3,"scan":110,"keep":10},"設置した向きの真横へ、上下左右の円盤状の索敵面を展開。面を横切る敵を10秒表示する"],
    ["広域型",{"kg":370,"count":1,"scan":240,"keep":10},"設置した向きの真横へ、上下左右の円盤状の索敵面を展開。面を横切る敵を10秒表示する"],
  ] },
  ammoBox: { w0: {"kg":300,"count":3,"reload":1,"pickupRange":1.5,"pickupSpeed":20,"speed":15}, types: [
    ["広域型",{"kg":320,"count":3,"reload":1.5,"pickupRange":8,"pickupSpeed":20,"speed":30},"接地後、弾が減った敵味方へ引き寄せられ、主・副武器を全補給。装填・過熱も回復。補助・SPは補給しない"],
  ] },
  radarTool: { w0: {"kg":370,"range":210,"arc":60,"keep":12,"expand":1.98}, types: [
    ["広域型",{"kg":380,"range":170,"arc":120,"keep":12,"expand":1.98},"選ぶとその場で展開し、時間とともに前方の索敵距離が広がる。上下の制限なし。使用回数は無制限"],
    ["全周型",{"kg":410,"range":140,"arc":360,"keep":12,"expand":1.93},"選ぶとその場で展開し、時間とともに前方の索敵距離が広がる。上下の制限なし。使用回数は無制限"],
  ] },
  flare: { w0: {"kg":170,"dmg":1150,"heatDps":4600,"heatDur":1.8,"mag":1,"mags":5,"blast":10,"fuse":1.2,"reload":1.4,"speed":35}, types: [
    ["即応型",{"kg":160,"dmg":1600,"heatDps":6400,"heatDur":1.2,"mag":1,"mags":6,"blast":9,"fuse":1,"reload":1.4,"speed":45},"時間で炸裂し、障害物で遮られる熱球を残す。触れた相手へ一度の接触損傷と継続損傷。距離減衰・のけぞりなし"],
    ["持続型",{"kg":200,"dmg":1000,"heatDps":4000,"heatDur":2.5,"mag":1,"mags":3,"blast":12,"fuse":1.5,"reload":1.8,"speed":30},"時間で炸裂し、障害物で遮られる熱球を残す。触れた相手へ一度の接触損傷と継続損傷。距離減衰・のけぞりなし"],
  ] },
  chain: { w0: {"kg":140,"dmg":6000,"mag":1,"mags":4,"blast":12,"chainCount":6,"chainStep":12,"chainGap":0.18,"reload":1.5}, types: [
    ["軽量型",{"kg":120,"dmg":4800,"mag":1,"mags":5,"blast":10,"chainCount":8,"chainStep":10,"chainGap":0.12,"reload":1.2},"地面に着くと前方へ連続爆発。壁では反射し、連鎖中に障害物へ当たると止まる"],
    ["強装型",{"kg":190,"dmg":8000,"mag":1,"mags":3,"blast":14,"chainCount":4,"chainStep":10,"chainGap":0.25,"reload":1.8},"地面に着くと前方へ連続爆発。壁では反射し、連鎖中に障害物へ当たると止まる"],
    ["持続型",{"kg":210,"dmg":7200,"mag":1,"mags":4,"blast":13,"chainCount":5,"chainStep":3,"chainGap":0.5,"reload":2},"地面に着くと前方へ連続爆発。壁では反射し、連鎖中に障害物へ当たると止まる"],
  ] },
  dart: { w0: {"kg":340,"dmg":1400,"pellets":3,"mag":4,"mags":3,"blast":11,"rpm":90,"reload":3.5}, types: [
    ["拡散型",{"kg":370,"dmg":1100,"pellets":5,"mag":3,"mags":4,"blast":10,"rpm":90,"reload":3},"横並びの炸裂弾を同時に発射。直撃は部位・頭部判定、周囲へは爆風。1クリックで1射"],
    ["強装型",{"kg":440,"dmg":2550,"pellets":3,"mag":1,"mags":4,"blast":12,"rpm":60,"reload":3.5},"横並びの炸裂弾を同時に発射。直撃は部位・頭部判定、周囲へは爆風。1クリックで1射"],
  ] },
  charge: { w0: {"kg":490,"dmg":3500,"chargeStages":[3500,5250,7000],"chargeTime":1,"chargeHold":3,"ohTime":2,"mag":10,"mags":1,"blast":11,"rpm":100,"reload":4,"recoilV":6}, types: [
    ["強装型",{"kg":530,"dmg":3500,"chargeStages":[3500,7000,10500],"chargeTime":3,"chargeHold":4,"ohTime":2.5,"mag":3,"mags":3,"blast":12,"rpm":100,"reload":3.5,"recoilV":8},"左長押しで二段階に蓄圧し、離すと射撃。最大充填を保持し続けると過熱する"],
    ["重装型",{"kg":560,"dmg":7000,"chargeStages":[7000,17500,24000],"chargeTime":5,"chargeHold":4,"ohTime":2.5,"mag":1,"mags":3,"blast":12,"rpm":60,"reload":4,"recoilV":10},"左長押しで二段階に蓄圧し、離すと射撃。最大充填を保持し続けると過熱する"],
  ] },
  zoom: { w0: {"kg":220,"dmg":2600,"mag":7,"mags":5,"rpm":150,"scope":2.5,"scopeHigh":5,"settle":1.3,"reload":4,"recoilV":15}, types: [
    ["即応型",{"kg":260,"dmg":4000,"mag":1,"mags":9,"rpm":60,"scope":3.5,"scopeHigh":7,"settle":1.7,"reload":1.2,"recoilV":20},"右クリックで低倍率→高倍率→通常視点。静止して照準を収束させ、左クリックで1発"],
    ["強装型",{"kg":270,"dmg":6300,"mag":1,"mags":7,"rpm":60,"scope":3.5,"scopeHigh":7,"settle":3,"reload":2.4,"recoilV":26},"右クリックで低倍率→高倍率→通常視点。静止して照準を収束させ、左クリックで1発"],
    ["改良型",{"kg":290,"dmg":3500,"mag":5,"mags":6,"rpm":150,"scope":3,"scopeHigh":6,"settle":1,"reload":4,"recoilV":5},"右クリックで低倍率→高倍率→通常視点。静止して照準を収束させ、左クリックで1発"],
  ] },
  blastSniper: { w0: {"kg":350,"dmg":4100,"mag":2,"mags":8,"rpm":150,"scope":4,"settle":2.8,"blast":11,"reload":4.5,"recoilV":40}, types: [
    ["軽量型",{"kg":330,"dmg":2700,"mag":6,"mags":5,"rpm":150,"scope":3.5,"settle":2.4,"blast":10,"reload":5.5,"recoilV":30},"即着弾の炸裂弾。直撃は部位・頭部判定、周囲へ爆風。直撃と爆風は重複しない"],
    ["強装型",{"kg":400,"dmg":6400,"mag":1,"mags":4,"rpm":60,"scope":5,"settle":3.5,"blast":15,"reload":7,"recoilV":45},"即着弾の炸裂弾。直撃は部位・頭部判定、周囲へ爆風。直撃と爆風は重複しない"],
  ] },
  lightSniper: { w0: {"kg":260,"dmg":1930,"mag":9,"mags":3,"rpm":240,"scope":2.5,"settle":0.55,"reload":4,"recoilV":0.4}, types: [
    ["強装型",{"kg":340,"dmg":2480,"mag":6,"mags":4,"rpm":200,"scope":3,"settle":0.55,"reload":4.8,"recoilV":0.4},"低反動の光学ライフル。右長押しで照準、左クリックで1発。中距離の連射向け"],
  ] },
  optSniper: { w0: { kg: 280, dmg: 4750, mag: 1, mags: 10, rpm: 60, scope: 5, settle: 1.8, reload: 4.5, recoilV: 0.5 }, types: [ // LZ-デイライト（アーケード版 LZ-狙撃銃系統）
    ['精密型', { kg: 290, dmg: 5400, mag: 1, mags: 8, rpm: 60, scope: 7, settle: 1.8, reload: 5, recoilV: 0.5 }, '倍率が高く一発が重い。弾は少ない'], // LZ-デイライトS
    ['三点射型', { kg: 310, dmg: 2800, mag: 3, mags: 9, rpm: 600, scope: 5, settle: 1, reload: 4.3, recoilV: 0.2 }, '1回押すと3発続けて撃つ。3発で1回のリロード'], // LZ-トライアド
    ['強装型', { kg: 330, dmg: 7900, mag: 1, mags: 5, rpm: 60, scope: 5, settle: 1.8, reload: 5.5, recoilV: 0.5 }, '一発がとても重い。弾が少なくリロードが遅い'], // LZ-ヴェスパイン
    ['改良型', { kg: 320, dmg: 6600, mag: 1, mags: 6, rpm: 60, scope: 5, settle: 1.8, reload: 5, recoilV: 0.5 }, '重い一発と弾数の釣り合いを取った型'], // LZ-アキュレイト（反動は表に無いので標準と同じ）
  ] },
  jumpMine: { w0: {"kg":150,"dmg":9000,"mag":1,"mags":4,"blast":23,"reload":1,"jumpDelay":0.7}, types: [
    ["拡大型",{"kg":160,"dmg":7400,"mag":1,"mags":5,"blast":26,"reload":1,"jumpDelay":0.7},"敵の接近を感知すると垂直に跳ね上がり爆発。上昇中に障害物へ当たると即起爆"],
    ["強装型",{"kg":190,"dmg":13000,"mag":1,"mags":3,"blast":21,"reload":1,"jumpDelay":0.7},"敵の接近を感知すると垂直に跳ね上がり爆発。上昇中に障害物へ当たると即起爆"],
    ["重装型",{"kg":240,"dmg":15600,"mag":1,"mags":2,"blast":27,"reload":1,"jumpDelay":1},"敵の接近を感知すると垂直に跳ね上がり爆発。上昇中に障害物へ当たると即起爆"],
  ] },
  delayMine: { w0: {"kg":170,"dmg":7300,"mag":1,"mags":4,"blast":19,"reload":1,"knockMult":3}, types: [
    ["拡大型",{"kg":190,"dmg":5500,"mag":1,"mags":5,"blast":22,"reload":1,"knockMult":4},"壁にも貼りつく地雷。接近を感知して1秒後に炸裂。実ダメージより強く姿勢を崩す"],
    ["強装型",{"kg":220,"dmg":11000,"mag":1,"mags":3,"blast":17,"reload":1,"knockMult":3},"壁にも貼りつく地雷。接近を感知して1秒後に炸裂。実ダメージより強く姿勢を崩す"],
  ] },
  detonator: { w0: {"kg":260,"dmg":5800,"mag":2,"mags":4,"blast":17,"reload":3.2,"rpm":120}, types: [
    ["拡大型",{"kg":290,"dmg":4100,"mag":5,"mags":2,"blast":20,"reload":3.5,"rpm":120},"吸着爆弾を遠方へ射出。着弾後0.5秒で準備ができ、右クリックで設置済みを一括起爆"],
    ["強装型",{"kg":310,"dmg":9300,"mag":1,"mags":5,"blast":15,"reload":3,"rpm":60},"吸着爆弾を遠方へ射出。着弾後0.5秒で準備ができ、右クリックで設置済みを一括起爆"],
    ["連射型",{"kg":340,"dmg":3800,"mag":5,"mags":3,"blast":18,"reload":4,"rpm":240},"吸着爆弾を遠方へ射出。着弾後0.5秒で準備ができ、右クリックで設置済みを一括起爆"],
  ] },
  // AC NeLIS系統（pages/694）。追加型は原表の実秒を使い、標準だけの照射5秒調整は広げない。
  beamCannon: { w0: { kg: 700, dps: 7200, contact: 2700, use: 4.5, charge: 40, chargeKeep: 35 }, types: [
    ['持続型', { kg: 750, dps: 4800, contact: 1800, use: 7, charge: 30, chargeKeep: 25 }, '威力を抑えて7秒照射。SPが戻りやすい持続型。旋回は標準と同じ'], // AC NeLIS-T2
    ['高出力型', { kg: 820, dps: 10000, contact: 3750, use: 2.5, charge: 25, chargeKeep: null }, '両肩で毎秒20000の高出力。照射は2.5秒と短く、重い。旋回は標準と同じ'], // AC NeLIS-TXP。中断回復の原典値は不明
    ['即応型', { kg: 770, dps: 7800, contact: 3000, use: 1.8, charge: 12, chargeKeep: null }, '照射1.8秒・SP回復12秒で繰り返し使える。準備と旋回は標準と同じ'], // AC NeLIS-T3V。中断回復の原典値は不明
  ] },
  artillery: { w0: { kg: 900, dmg: 10000, shots: 6, range: 300, flight: 5.5, scatter: 15, blast: 25, interval: 1, charge: 54, chargeKeep: 44 }, types: [
    ['連射型', { kg: 940, dmg: 7200, shots: 12, range: 250, flight: 4.5, scatter: 25, blast: 24, interval: .5, charge: 59, chargeKeep: 48 }, '広い誤差範囲へ高速で12発。射程と一発の威力は低い'], // AC コロッサス榴弾砲
    ['長射程型', { kg: 1010, dmg: 12000, shots: 5, range: 500, flight: 8, scatter: 20, blast: 25, interval: .9, charge: 55, chargeKeep: 44 }, '遠方500mまで届くが、着弾に8秒かかり重い'], // AC アトラント榴弾砲
    ['強装型', { kg: 1050, dmg: 24000, shots: 1, range: 350, flight: 10, scatter: 0, blast: 40, interval: null, charge: 62, chargeKeep: null }, '誤差なしの大威力1発。着弾まで10秒、使い切りの再充填が必要'], // AC ギガノト榴弾砲
  ] },
  // 反射衛星砲の型（オーナーのオリジナル。数字は Claude の仮置き、2026-11-05。2026-11-12 オーナー「半径と移動速度双方1.5倍に強化」で speed と radius を全部1.5倍）
  reflector: { w0: { kg: 900, dps: 12000, speed: 6, fireTime: 6.7, radius: 6, range: 300, warn: .5, charge: 55, chargeKeep: 45 }, types: [
    ['広域型', { kg: 880, dps: 10000, speed: 12.45, fireTime: 4.8, radius: 4.5, range: 250, warn: .3, charge: 58, chargeKeep: 47 }, '細い光が速く追う。最長4.8秒'],
    ['高出力型', { kg: 960, dps: 15000, speed: 3, fireTime: 6.7, radius: 10.5, range: 250, warn: 1, charge: 62, chargeKeep: 50 }, '太い光がゆっくり追う。最長6.7秒'],
    ['長射程型', { kg: 940, dps: 9000, speed: 4.95, fireTime: 6, radius: 6, range: 500, warn: .7, charge: 56, chargeKeep: 45 }, '遠方500mまで届く。最長6秒'],
  ] },
  barrier: { w0: { kg: 710, shieldHp: 12500, use: 50, charge: 50, chargeKeep: 45 }, types: [
    ['軽量型', { kg: 680, shieldHp: 7500, use: 60, charge: 40, chargeKeep: 35, arc: 360, level: 1 }, '全周を守り長く使えるが、防御面と耐久が小さい'], // AC バリアユニットβ
    ['重装型', { kg: 740, shieldHp: 10500, use: 30, charge: 65, chargeKeep: null, arc: 360, level: 2 }, '広い全周を守るが重く、持続が短く再充填も遅い'], // AC バリアユニットγ
  ] },
  escort: { w0: { kg: 310, dmg: 270, mag: 20, rpm: 360, reload: 3.4, range: 50, use: 35, charge: 30 }, types: [
    ['連射型', { kg: 320, dmg: 90, mag: 50, rpm: 900, reload: 2.2, range: 40, use: 30, charge: 20, arc: 360 }, '全周へ高速連射できるが、一発が軽く射程も短い'], // AC EUS-T2
    ['強装型', { kg: 360, dmg: 900, mag: 5, rpm: 120, reload: 3.6, range: 70, use: 20, charge: 35, arc: 90, energy: true }, '強い光弾で遠くを狙えるが射角が狭く、弾倉が小さい'], // AC EUS-TLZ
  ] },
  repairPost: { w0: { kg: 480, heal: 1200, radius: 12, use: 80, charge: 20 }, types: [
    ['広域型', { kg: 520, heal: 1200, radius: 18, use: 65, charge: 35, healDrain: 3.35 }, '広い範囲を回復するが重く、再充填が遅い'], // AC リペアポストβ
    ['高出力型', { kg: 530, heal: 2000, radius: 10, use: 40, charge: 25, healDrain: 6.5 }, '回復と蘇生が速いが範囲が狭く、SP消費が多い'], // AC リペアポストγ
  ] },
  rail: { w0: {"kg": 280, "dmg": 1250, "mag": 14, "mags": 13, "rpm": 270, "acc": "A-", "reload": 2.2, "recoilV": 0.3}, types: [ // 電磁加速砲・壱式（AC現行表、https://w.atwiki.jp/borderbreak/pages/101.html）
    ["大容量型", {"kg": 310, "dmg": 860, "mag": 25, "mags": 15, "rpm": 360, "acc": "A", "reload": 2.4, "recoilV": 0.2}, "弾倉が大きいがリロードが遅い"], // 電磁加速砲・特式。横反動0.3度は記録のみ
    ["連射型", {"kg": 340, "dmg": 730, "mag": 16, "mags": 15, "rpm": 540, "acc": "A-", "reload": 1.7, "recoilV": 0.2}, "連射が速いが一発の威力が低い"], // 電磁加速砲・速式。横反動0.2度は記録のみ
  ] },
  pulse: { w0: {"kg": 190, "dmg": 580, "mag": 39, "mags": 8, "rpm": 480, "acc": "B+", "reload": 2.0, "recoilV": 0.2}, types: [ // VOLT-01（AC現行表、https://w.atwiki.jp/borderbreak/pages/101.html）
    ["大容量型", {"kg": 180, "dmg": 540, "mag": 51, "mags": 7, "rpm": 480, "acc": "A", "reload": 2.2, "recoilV": 0.1}, "弾倉が大きいがリロードが遅い"], // VOLT-02。横反動0.15度は記録のみ
    ["強装型", {"kg": 230, "dmg": 800, "mag": 30, "mags": 8, "rpm": 420, "acc": "B+", "reload": 2.2, "recoilV": 0.3}, "一発が重いが弾倉が小さい"], // VOLT-X。横反動0.35度は記録のみ
  ] },
  coil: { w0: {"kg": 410, "dmg": 1580, "mag": 22, "mags": 11, "rpm": 180, "acc": "B+", "reload": 2.5, "recoilV": 0.4}, types: [ // LAC-グローム（AC現行表、https://w.atwiki.jp/borderbreak/pages/105.html）
    ["精密型", {"kg": 430, "dmg": 1440, "mag": 30, "mags": 10, "rpm": 180, "acc": "A+", "reload": 2.5, "recoilV": 0.2}, "精度が高いが一発の威力が低い"], // LAC-グロームβ。横反動0.3度は記録のみ
    ["連射型", {"kg": 510, "dmg": 1000, "mag": 36, "mags": 10, "rpm": 320, "acc": "B-", "reload": 3.6, "recoilV": 0.4}, "連射が速いが一発の威力が低い"], // LAC-グロームγ。横反動0.5度は記録のみ
    ["持続型", {"kg": 540, "dmg": 950, "mag": 46, "mags": 8, "rpm": 320, "acc": "A-", "reload": 3.6, "recoilV": 0.3}, "弾倉が大きいが重く一発の威力が低い"], // LAC-タルナダ。横反動0.4度は記録のみ
  ] },
  ar: { w0: { dmg: 340, rpm: 780, mag: 62, mags: 15, reload: 1.4, kg: 140, acc: 'E+', recoil: 'A-' }, types: [ // M90サブマシンガン（サブマシンガン系統）
    ['強装型', { dmg: 420, rpm: 740, mag: 47, mags: 17, reload: 1.6, kg: 200, acc: 'D+', recoil: 'C+' }, '一発が重いが反動が大きい'], // XM94パイソン
    ['大容量型', { dmg: 330, rpm: 850, mag: 80, mags: 14, reload: 1.8, kg: 150, acc: 'E', recoil: 'B+' }, '装弾数と連射が増すがリロードが遅い'], // M91サブマシンガン
    ['精密型', { dmg: 360, rpm: 780, mag: 64, mags: 15, reload: 1.6, kg: 160, acc: 'C-', recoil: 'B' }, '集弾が良いが反動とリロードが増す'], // M99サーペント
  ] },
  burst: { w0: { dmg: 440, rpm: 810, mag: 57, mags: 10, reload: 2.2, kg: 240, acc: 'C-', recoil: 'C+' }, types: [ // ヴォルペ突撃銃（ヴォルペ突撃銃系統）
    ['大容量型', { dmg: 430, rpm: 810, mag: 60, mags: 11, reload: 2.1, kg: 230, acc: 'B-', recoil: 'B' }, '弾数と安定性が増すが一発が軽い'], // ヴォルペ突撃銃C
    ['精密型', { dmg: 460, rpm: 810, mag: 54, mags: 11, reload: 2.1, kg: 260, acc: 'B+', recoil: 'C+' }, '精度が高く威力も増すがやや重い'], // ヴォルペ・スコーピオ
    ['強装型', { dmg: 490, rpm: 810, mag: 51, mags: 10, reload: 2.2, kg: 270, acc: 'C+', recoil: 'C-' }, '一発が重いが反動が大きく弾が少ない'], // ヴォルペ・メガロ
  ] },
  marks: { w0: { dmg: 1140, rpm: 300, mag: 18, mags: 10, reload: 1.9, kg: 250, acc: 'A', recoil: 'B-' }, types: [ // STAR－10（STAR系統）
    ['大容量型', { dmg: 860, rpm: 400, mag: 30, mags: 9, reload: 2.4, kg: 300, acc: 'B-', recoil: 'D+' }, '装弾数と連射が増すが一発が軽い'], // STAR－10C
    ['精密型', { dmg: 970, rpm: 400, mag: 19, mags: 11, reload: 1.7, kg: 320, acc: 'A+', recoil: 'B+' }, '精度と反動が良いが一発が軽く重い'], // STAR－30F
    ['強装型', { dmg: 1370, rpm: 300, mag: 14, mags: 12, reload: 1.8, kg: 360, acc: 'B+', recoil: 'C+' }, '一発が最も重いが重く弾が少ない'], // STAR－X7D
  ] },
  grenade: { w0: { dmg: 7500, mag: 1, mags: 6, reload: 1, kg: 100, blast: 17, fuse: 2.5 }, types: [ // MK3クラッカー（クラッカー系統）
    ['瞬発型', { dmg: 6600, mag: 1, mags: 8, reload: 1, kg: 110, blast: 19, fuse: 0.8 }, '起爆が早く数も多いが威力が低い'], // MK4クラッカー
    ['広域型', { dmg: 7900, mag: 1, mags: 4, reload: 1.4, kg: 140, blast: 24, fuse: 3.5 }, '爆風が広いが数が少なく起爆が遅い'], // MK5クラッカー
    ['強装型', { dmg: 9200, mag: 1, mags: 6, reload: 0.8, kg: 130, blast: 16, fuse: 2 }, '威力が高いが爆風が狭くやや重い'], // MK6クラッカー
  ] },
  timed: { w0: { dmg: 8400, mag: 1, mags: 6, reload: 1, kg: 90, blast: 21, fuse: 2.5 }, types: [ // 38型手榴弾（手榴弾系統）
    ['軽量型', { dmg: 7500, mag: 1, mags: 8, reload: 0.8, kg: 80, blast: 19, fuse: 2.5 }, '軽く数が多いが威力と爆風が小さい'], // 40型軽量手榴弾
    ['広域型', { dmg: 12000, mag: 1, mags: 5, reload: 1.4, kg: 140, blast: 25, fuse: 3.5 }, '爆風が広く強力だが起爆が遅く重い'], // 41型強化手榴弾
    ['強装型', { dmg: 14700, mag: 1, mags: 4, reload: 1.6, kg: 120, blast: 24, fuse: 3.5 }, '威力が最大だが数が少なく起爆が遅い'], // 47型手榴弾・赫灼
  ] },
  gl: { w0: { dmg: 5400, rpm: 200, mag: 3, mags: 4, reload: 3, kg: 220, blast: 14 }, types: [ // グレネードランチャー（グレネードランチャー系統）
    ['連射型', { dmg: 2700, rpm: 350, mag: 9, mags: 3, reload: 2.8, kg: 320, blast: 11 }, '連射と装弾数が多いが一発が軽い'], // 連射式Gランチャー
    ['広域型', { dmg: 3300, rpm: 300, mag: 6, mags: 4, reload: 3.2, kg: 260, blast: 18 }, '爆風が広く弾も多いが一発が軽い'], // 拡散型Gランチャー
    ['強装型', { dmg: 6300, rpm: 400, mag: 3, mags: 4, reload: 3.2, kg: 310, blast: 17 }, '威力と爆風が増すが重い'], // 殲滅型Gランチャー
  ] },
  sword: { w0: { normal: 4500, strong: 6000, kg: 230 }, types: [ // デュエルソード（グレートソード系統）
    ['重装型', { normal: 9500, strong: 10000, kg: 560 }, '威力が高いがかなり重い'], // SW－ティアダウナー
    ['高出力型', { normal: 13500, strong: 26000, kg: 680 }, '特殊が桁違いに強いが非常に重い'], // SW－エグゼクター
  ] },
  spear: { w0: { normal: 4000, strong: 6000, kg: 200 }, types: [ // ロングスピア（スピア系統）
    ['強装型', { normal: 4500, strong: 9000, kg: 310 }, '特殊が強いが重い'], // ピアシングスピア
    ['重装型', { normal: 8500, strong: 9500, kg: 490 }, '通常が2段で強いがかなり重い'], // SP－ペネトレーター
  ] },
  charger: { w0: { kg: 270, charge: 35, chargeKeep: 30, use: 2.4, power: 1.6 }, types: [ // アサルトチャージャー（アサルトチャージャー系統）
    ['巡航型', { kg: 330, charge: 38, chargeKeep: 33, use: 3.2, power: 1.45 }, '長く使えるが出力が低く重い'], // AC－オーバーラップ
  ] },
  gatling: { w0: { dmg: 200, rpm: 1500, mag: 380, mags: 7, reload: 3.5, kg: 360, acc: 'A-', recoil: 'E', heat: 143, ohTime: 4 }, types: [ // GAXガトリングガン（GAXガトリングガン系統）
    ['強装型', { dmg: 420, rpm: 800, mag: 230, mags: 6, reload: 3.5, kg: 410, acc: 'B+', recoil: 'E+', heat: 75, ohTime: 4 }, '一発が重いが連射が遅い'], // GAXエレファント
    ['持続型', { dmg: 230, rpm: 1500, mag: 400, mags: 7, reload: 3.5, kg: 540, acc: 'A-', recoil: 'E', heat: 178, ohTime: 4.8 }, '長く撃ち続けられるが重い'], // GAXファフニール
    ['高出力型', { dmg: 340, rpm: 1200, mag: 310, mags: 6, reload: 4, kg: 470, acc: 'B+', recoil: 'E', heat: 96, ohTime: 4 }, '火力が高いが重くリロードが遅い'], // GAXダイナソア
  ] },
  mg: { w0: { dmg: 450, rpm: 660, mag: 170, mags: 8, reload: 3, kg: 290, acc: 'D+', recoil: 'D', heat: 64, ohTime: 2.8 }, types: [ // ウィーゼル機関銃（ウィーゼル機関銃系統）
    ['連射型', { dmg: 460, rpm: 700, mag: 190, mags: 7, reload: 3, kg: 330, acc: 'D-', recoil: 'D+', heat: 58, ohTime: 2 }, '連射が速いが精度が落ちる'], // ウィーゼル・ラピッド
    ['精密型', { dmg: 500, rpm: 660, mag: 170, mags: 7, reload: 3, kg: 340, acc: 'C-', recoil: 'C', heat: 53, ohTime: 2.2 }, '精度と威力が上がるが重い'], // ウィーゼル・コロナ
    ['大容量型', { dmg: 480, rpm: 700, mag: 200, mags: 7, reload: 3.2, kg: 360, acc: 'C-', recoil: 'C-', heat: 53, ohTime: 2 }, '装弾数が多いが重く過熱が早い'], // ウィーゼル・カルマ
  ] },
  acannon: { w0: { dmg: 1520, rpm: 220, mag: 30, mags: 10, reload: 3.6, kg: 400, acc: 'C-', recoil: 'C', heat: 18, ohTime: 3.1 }, types: [ // 単式機関砲（機関砲系統）
    ['精密型', { dmg: 1580, rpm: 220, mag: 33, mags: 9, reload: 3.8, kg: 440, acc: 'C+', recoil: 'A-', heat: 18, ohTime: 3.6 }, '反動が小さく精度も良いが重い'], // 単式機関砲・改
    ['大容量型', { dmg: 1280, rpm: 300, mag: 60, mags: 6, reload: 4, kg: 500, acc: 'B-', recoil: 'C-', heat: 18, ohTime: 2.3 }, '装弾数と連射が増すが一発が軽い'], // 単式機関砲・不動
    ['連射型', { dmg: 730, rpm: 540, mag: 100, mags: 6, reload: 4.2, kg: 560, acc: 'B', recoil: 'D', heat: 24, ohTime: 1.9 }, '連射が速いが一発が軽く重い'], // 双門機関砲・轟鉄
  ] },
  rocket: { w0: { dmg: 8500, mag: 1, mags: 5, reload: 2, kg: 490, blast: 12, speed: 80 }, types: [ // サワードロケット（サワードロケット系統）
    ['広域型', { dmg: 8500, mag: 1, mags: 6, reload: 2.4, kg: 500, blast: 16, speed: 100 }, '爆風が広く弾も速いがリロード遅め'], // サワード・スマイト
    ['強装型', { dmg: 15500, mag: 1, mags: 3, reload: 4, kg: 600, blast: 17, speed: 30 }, '威力絶大だが弾が遅く数が少ない'], // サワード・コング
    ['連射型', { dmg: 6800, rpm: 120, mag: 3, mags: 4, reload: 3, kg: 530, blast: 7, speed: 90 }, '3連発できるが威力と爆風が小さい'], // サワード・カスタム
  ] },
  scrum: { w0: { dmg: 2900, rpm: 480, mag: 6, mags: 4, reload: 4, kg: 520, blast: 13 }, types: [ // スクラムバスター（スクラムバスター系統）
    ['連射型', { dmg: 2120, rpm: 600, mag: 8, mags: 4, reload: 4.5, kg: 490, blast: 14 }, '連射が速く軽いが一発が軽い'], // スクラムバスターC
    ['強装型', { dmg: 4500, rpm: 400, mag: 4, mags: 4, reload: 4.7, kg: 540, blast: 15 }, '一発が重いが装弾数が少ない'], // SCB－ヘルファイア
    ['広域型', { dmg: 2600, rpm: 540, mag: 7, mags: 4, reload: 4.4, kg: 560, blast: 15 }, '爆風が広く連射も速いが重い'], // SCB－トライデント
  ] },
  plasma: { w0: { dmg: 5900, rpm: 80, mag: 4, mags: 3, reload: 3.5, kg: 460, blast: 13 }, types: [ // プラズマカノン（プラズマカノン系統）
    ['強装型', { dmg: 18500, mag: 1, mags: 3, reload: 3.6, kg: 490, blast: 7 }, '威力絶大だが爆風が狭く単発'], // プラズマカノン・ネオ
    ['連射型', { dmg: 6300, rpm: 120, mag: 3, mags: 3, reload: 3.5, kg: 480, blast: 14 }, '連射が速く爆風も広いが弾数減'], // プラズマカノンUG
    ['速装型', { dmg: 7100, rpm: 80, mag: 2, mags: 4, reload: 2.5, kg: 520, blast: 12 }, 'リロードが速いが装弾数が2発'], // プラズマカノンXM
    ['三点射型', { dmg: 4500, rpm: 750, mag: 3, mags: 7, reload: 2.5, kg: 460, blast: 8 }, '3発ずつ素早く撃つ。一発と爆風は小さいが弾数が多い'], // プラズマカノンMk-2（アーケード版 https://w.atwiki.jp/borderbreak/pages/358.html 、オーナー希望 2026-11-02）。3点射は下で
  ] },
  weaken: { w0: { count: 4, reload: 1, kg: 180, dur: 5, blast: 24, fuse: 1.2 }, types: [ // AN手榴弾（AN手榴弾系統）
    ['広域型', { count: 5, reload: 1, kg: 160, dur: 4, blast: 32, fuse: 1 }, '範囲が広く数も多いが効果が弱い'], // 試験型AN手榴弾
    ['持続型', { count: 3, reload: 1, kg: 150, dur: 7, blast: 27, fuse: 1.8 }, '効果が長く強いが起爆が遅い'], // 新型AN手榴弾
    ['軽量型', { count: 3, reload: 1, kg: 140, dur: 6, blast: 29, fuse: 1 }, '軽く効果も強いが所持数が少ない'], // 先進型AN手榴弾
  ] },
  impactb: { w0: { count: 5, reload: 1.6, kg: 140, blast: 16, fuse: 1.5 }, types: [ // インパクトボム（インパクトボム系統）
    ['瞬発型', { count: 3, reload: 1.8, kg: 120, blast: 14, fuse: 0.3 }, 'すぐ起爆するが範囲が狭い'], // インパクトボムS
    ['広域型', { count: 4, reload: 1.9, kg: 170, blast: 22, fuse: 2.5 }, '範囲が広いが起爆が遅く重い'], // インパクトボムV
    ['軽量型', { count: 3, reload: 2, kg: 110, blast: 20, fuse: 1 }, '軽く範囲も広いが所持数が少ない'], // インパクトボムX
  ] },
  hsg: { w0: { dmg: 380, pellets: 8, rpm: 90, mag: 3, mags: 4, reload: 2.5, kg: 200, diffuse: '中' }, types: [ // ハウルHSG9（ハウルHSG系統）
    ['大容量型', { dmg: 250, pellets: 10, rpm: 90, mag: 4, mags: 4, reload: 2.8, kg: 190, diffuse: '小' }, '装弾数が多く集弾も良いが威力低め'], // ハウルHSG9R
    ['広域型', { dmg: 320, pellets: 12, rpm: 90, mag: 2, mags: 4, reload: 3, kg: 240, diffuse: '大' }, '散弾が多く広がるが装弾数が少ない'], // ハウルHSG17
    ['強装型', { dmg: 700, pellets: 8, mag: 1, mags: 6, reload: 3.5, kg: 250, diffuse: '極小' }, '集弾が良く高威力だが単発'], // ハウル・アデッソ
  ] },
  cannon: { w0: { dmg: 7600, rpm: 60, shots: 6, charge: 35, kg: 800, blast: 21, speed: 60 }, types: [ // タウル重装砲（重装砲系統）
    ['大容量型', { dmg: 6800, rpm: 75, shots: 10, charge: 45, kg: 890, blast: 19, speed: 80 }, '弾数が多いが一発が軽くチャージ長い'], // ヴァーゴ重装砲
  ] },
  pistols: { w0: { dmg: 340, rpm: 400, mag: 26, mags: 12, reload: 1.2, kg: 180, acc: 'C', recoil: 'C+', range: 150 }, types: [ // レヴェラーMP20（レヴェラー系統）
    ['大容量型', { dmg: 270, rpm: 500, mag: 42, mags: 11, reload: 1.4, kg: 190, acc: 'C-', recoil: 'C+', range: 150 }, '弾数が多いが一発が軽い'], // レヴェラーR
    ['連射型', { dmg: 270, rpm: 560, mag: 32, mags: 15, reload: 1.3, kg: 230, acc: 'B-', recoil: 'B-', range: 150 }, '連射が速く精度も高いが重い'], // レヴェラーRR
    ['強装型', { dmg: 490, rpm: 320, mag: 16, mags: 15, reload: 1.5, kg: 240, acc: 'B', recoil: 'C', range: 150 }, '一発が重いが連射と装填が遅い'], // レヴェラー・ブルート
  ] },
  dualmg: { w0: { dmg: 270, rpm: 560, mag: 41, mags: 11, reload: 2.1, kg: 290, acc: 'D', recoil: 'B', range: 175 }, types: [ // D90デュアル（デュアルマシンガン系統）
    ['精密型', { dmg: 260, rpm: 560, mag: 46, mags: 10, reload: 1.9, kg: 270, acc: 'C+', recoil: 'B+', range: 175 }, '精度が高く軽いが一発がやや軽い'], // D90カスタム
    ['強装型', { dmg: 320, rpm: 500, mag: 34, mags: 12, reload: 1.7, kg: 340, acc: 'C-', recoil: 'C+', range: 175 }, '一発が重く装填も速いが重い'], // D102アシュヴィン
    ['連射型', { dmg: 290, rpm: 600, mag: 36, mags: 12, reload: 2.3, kg: 380, acc: 'E-', recoil: 'D+', range: 175 }, '連射が速いが精度が低く重い'], // D107カイラル
  ] },
  coyote: { w0: { dmg: 500, rpm: 360, mag: 12, mags: 18, reload: 1.4, kg: 250, acc: 'B-', recoil: 'B-', range: 150 }, types: [ // コヨーテM68（コヨーテ系統）
    ['強装型', { dmg: 550, rpm: 360, mag: 15, mags: 17, reload: 1.7, kg: 280, acc: 'B+', recoil: 'B-', range: 150 }, '一発が重く弾数も多いが装填が遅い'], // コヨーテ・ヴァーキン
    ['連射型', { dmg: 370, rpm: 600, mag: 18, mags: 18, reload: 1.2, kg: 290, acc: 'B', recoil: 'B', range: 150 }, '連射が速いが一発が軽い'], // コヨーテ・ヴェナラ
    ['瞬発型', { dmg: 520, rpm: 600, mag: 6, mags: 36, reload: 1.2, kg: 270, acc: 'B', recoil: 'C+', range: 150 }, '瞬間火力が高いが装弾数が6発'], // コヨーテ・ベイロウ
  ] },
  sniper: { w0: { dmg: 3600, rpm: 150, mag: 4, mags: 8, reload: 3.2, kg: 240 }, types: [ // 38式狙撃銃（38式狙撃銃系統）
    ['強装型', { dmg: 4500, rpm: 150, mag: 2, mags: 7, reload: 3, kg: 280 }, '一発が重いが装弾数が2発'], // 38式狙撃銃・改
    ['高出力型', { dmg: 7800, mag: 1, mags: 8, reload: 3.8, kg: 300 }, '一発7800だが単発装填で重い'], // 38式狙撃銃・遠雷
    ['重装型', { dmg: 10000, mag: 1, mags: 6, reload: 4, kg: 350 }, '一撃が最大だが最重量で装填が遅い'], // 38式狙撃銃・一閃
  ] },
  battle: { w0: { dmg: 1950, rpm: 300, mag: 10, mags: 5, reload: 2.9, kg: 230 }, types: [ // バトルライフル（バトルライフル系統）
    ['強装型', { dmg: 2700, rpm: 240, mag: 7, mags: 5, reload: 3, kg: 290 }, '一発が重いが連射が遅く重い'], // バトルライフルS
  ] },
  lzsniper: { w0: { dmg: 6100, mag: 1, mags: 10, reload: 4.5, kg: 290, settle: 1.8 }, types: [ // LZ－デイライト（LZ－デイライト系統）
    ['精密型', { dmg: 7700, mag: 1, mags: 7, reload: 5, kg: 330, settle: 1 }, '弾道安定が速く高威力だが重い'], // LZ－アキュレイト
    ['強装型', { dmg: 9500, mag: 1, mags: 6, reload: 5.5, kg: 340 }, '一発が非常に重いが弾数が少ない'], // LZ－ヴェスパイン
    ['重装型', { dmg: 8400, mag: 1, mags: 7, reload: 4.8, kg: 360 }, '威力が高いが最重量で弾数が少ない'], // LZ－クリパスキュール
  ] },
  drone: { w0: { count: 3, kg: 370, scan: 110, range: 250, speed: 28, keep: 10, dur: 5 }, types: [ // ラーク偵察機（偵察機系統）
    ['瞬発型', { count: 3, kg: 360, scan: 95, range: 500, speed: 50, keep: 10, dur: 3.5 }, '速く遠くまで飛ぶが索敵範囲が狭い'], // ファルコン偵察機
    ['持続型', { count: 2, kg: 390, scan: 130, range: 220, speed: 14, keep: 10, dur: 9 }, '長く滞空し範囲も広いが所持数2'], // アウル偵察機
    ['広域型', { count: 3, kg: 400, scan: 240, range: 80, speed: 25, keep: 10, dur: 5.6 }, '索敵範囲が最大だが飛距離が短い'], // カナリア偵察機
  ] },
  sonar: { w0: { count: 5, reload: 1, kg: 230, scan: 170, fuse: 1.5, keep: 15 }, types: [ // クリアリングソナー（クリアリングソナー系統）
    ['瞬発型', { count: 6, reload: 1, kg: 220, scan: 160, fuse: 0.8, keep: 15 }, '起爆が速く数も多いが範囲が狭い'], // クリアリングソナーM
    ['広域型', { count: 4, reload: 1, kg: 270, scan: 220, fuse: 2.5, keep: 15 }, '索敵範囲が広いが起爆が遅く数が少ない'], // クリアリングソナーW
  ] },
  sentry: { w0: { dmg: 110, rpm: 800, mag: 30, reload: 2.6, kg: 350, range: 90, hp: 10000, count: 1 }, types: [ // セントリーガンSMG（セントリーガン系統）
    ['強装型', { dmg: 620, rpm: 150, mag: 5, reload: 3.3, kg: 380, range: 90, hp: 10000, count: 1 }, '一発が重いが連射が遅い'], // セントリーガンAC
    ['広域型', { dmg: 270, pellets: 8, rpm: 800, mag: 3, reload: 2.9, kg: 410, range: 90, hp: 10000, count: 1 }, '散弾で近距離に強いが弾数3'], // セントリーガンSHG
    ['高出力型', { dmg: 1420, rpm: 90, mag: 2, reload: 2.6, kg: 400, range: 90, hp: 10000, count: 1 }, '一撃が最大だが連射が遅く2発'], // セントリーガンHV
  ] },
  camo: { w0: { kg: 240, use: 15, charge: 40, chargeKeep: 35, hp: 12000 }, types: [ // 光学迷彩・試作型（光学迷彩系統）
    ['即応型', { kg: 270, use: 13, charge: 35, chargeKeep: 30, hp: 12000 }, '隠密性が高く回復が速いが持続が短い'], // 光学迷彩・実用型
  ] },
  shotgun: { w0: { dmg: 460, pellets: 8, rpm: 50, mag: 8, mags: 8, reload: 2.6, kg: 220, diffuse: '中' }, types: [ // スマックショット（スマックショット系統）
    ['広域型', { dmg: 450, pellets: 12, rpm: 50, mag: 5, mags: 9, reload: 3, kg: 280, diffuse: '大' }, '散弾が多く広がるが重く装填が遅い'], // ワイドスマック
    ['強装型', { dmg: 600, pellets: 12, rpm: 50, mag: 2, mags: 14, reload: 2.5, kg: 320, diffuse: '特大' }, '威力絶大だが散弾が大きく広がり、装弾2発で重い'], // レイジスマック
    ['速装型', { dmg: 530, pellets: 10, rpm: 50, mag: 6, mags: 8, reload: 2.4, kg: 240 }, '装填が速く威力も上だが弾数減'], // スマックショットSP
  ] },
  autosg: { w0: { dmg: 430, pellets: 8, rpm: 100, mag: 9, mags: 9, reload: 2.3, kg: 190, diffuse: '中' }, types: [ // ASG－スィーパー（ASG系統）
    ['連射型', { dmg: 250, pellets: 10, rpm: 150, mag: 11, mags: 10, reload: 1.8, kg: 270, diffuse: '極小' }, '連射が速く散弾が絞られるが重い'], // ASG－アヴァランチ
    // 特性の型（2026-11-07 オーナー「特性4種ぐらい作って、特性別に性能調整して実装」）。行は参考にしたアーケード版の型。本作の値は下の「オートショットガンの特性」で決める
    ['速射型', { dmg: 150, pellets: 10, rpm: 240, mag: 11, mags: 12, reload: 1.7, kg: 330, diffuse: '中' }, ''], // ASG-スタンピード（240/min 連射）
    ['三点射型', { dmg: 110, pellets: 7, rpm: 480, mag: 18, mags: 14, reload: 1.3, kg: 290, diffuse: '小' }, ''], // ASG-デリュージ（480/min 3点射）
    ['精密型', { dmg: 600, pellets: 8, rpm: 90, mag: 6, mags: 10, reload: 2.4, kg: 260, diffuse: '小' }, ''], // 原典に無い（本作の特性。拡散・1発の威力・装弾数だけで差を付ける）
    ['大容量型', { dmg: 300, pellets: 12, rpm: 110, mag: 18, mags: 6, reload: 2.8, kg: 280, diffuse: '大' }, ''], // 原典に無い（本作の特性）
  ] },
  nail: { w0: { dmg: 690, rpm: 480, mag: 20, mags: 16, reload: 1.1, kg: 140, acc: 'D', recoil: 'C', range: 175 }, types: [ // ネイルガン（ネイルガン系統）
    ['連射型', { dmg: 570, rpm: 600, mag: 28, mags: 14, reload: 1.6, kg: 210, acc: 'C-', recoil: 'D', range: 175 }, '連射が速いが重く反動が大きい'], // ラピッドネイル
    ['大容量型', { dmg: 580, rpm: 480, mag: 30, mags: 20, reload: 1.6, kg: 150, acc: 'C+', recoil: 'C+', range: 175 }, '弾数と精度が上がるが一発が軽い'], // アッパーネイル
  ] },
  mine: { w0: { dmg: 10800, mag: 1, mags: 5, reload: 1, kg: 240, blast: 12, hp: 3000 }, types: [ // ヘヴィマイン（ヘヴィマイン系統）
    ['広域型', { dmg: 10200, mag: 1, mags: 6, reload: 1, kg: 220, blast: 20, hp: 3000 }, '爆風が広く軽いが威力は少し低い'], // ヘヴィマインS
    ['強装型', { dmg: 31500, mag: 1, mags: 4, reload: 1, kg: 300, blast: 10, hp: 3000 }, '威力約3倍だが範囲が狭く重い'], // ヘヴィマインV
  ] },
  fmine: { w0: { dmg: 9100, mag: 1, mags: 5, reload: 1, kg: 160, blast: 19, trigger: 11, hp: 4000 }, types: [ // DAC22浮遊機雷（浮遊機雷系統）
    ['広域型', { dmg: 7600, mag: 1, mags: 6, reload: 1, kg: 180, blast: 25, trigger: 11, hp: 4000 }, '爆風が広く数も多いが威力が低い'], // DAC24浮遊機雷
    ['強装型', { dmg: 11700, mag: 1, mags: 4, reload: 1, kg: 220, blast: 16, trigger: 11, hp: 4000 }, '威力が高いが範囲が狭く重い'], // DAC25浮遊機雷
  ] },
  sensor: { w0: { count: 2, kg: 260, scan: 65, keep: 5, hp: 10000 }, types: [ // 索敵センサー（索敵センサー系統）
    ['大容量型', { count: 3, kg: 280, scan: 60, keep: 5, hp: 10000 }, '数が多いが範囲がやや狭く重い'], // 小型索敵センサー
    ['広域型', { count: 1, kg: 330, scan: 115, keep: 5, hp: 10000 }, '範囲が大幅に広いが1個で重い'], // 広域索敵センサー
    ['高出力型', { count: 2, kg: 290, scan: 80, keep: 5, hp: 10000 }, '範囲が広めだがやや重い'], // 新型索敵センサー
  ] },
  airsensor: { w0: { count: 3, kg: 380, scan: 70, dur: 50, range: 350, keep: 5, hp: 20000 }, types: [ // 滞空索敵弾（滞空索敵弾系統）
    ['軽量型', { count: 3, kg: 370, scan: 60, dur: 60, range: 450, keep: 5, hp: 20000 }, '軽く遠くまで届くが範囲が狭い'], // 小型滞空索敵弾
    ['広域型', { count: 2, kg: 430, scan: 90, dur: 65, range: 250, keep: 5, hp: 20000 }, '範囲が広いが重く射程が短い'], // 広域滞空索敵弾
    ['高出力型', { count: 1, kg: 400, scan: 125, dur: 85, range: 300, keep: 5, hp: 20000 }, '範囲と稼働時間が大きいが1個'], // 高機能滞空索敵弾
  ] },
  fansensor: { w0: { count: 2, kg: 380, scan: 150, keep: 8, hp: 8000, cone: 90 }, types: [ // BRトラッカー（BRトラッカー系統）
    ['大容量型', { count: 3, kg: 360, scan: 130, keep: 8, hp: 8000, cone: 120 }, '数が多く角度が広いが半径が短い'], // 集中型BRトラッカー
    ['広域型', { count: 1, kg: 410, scan: 180, keep: 8, hp: 8000, cone: 150 }, '半径と角度が大きいが1個で重い'], // 広域型BRトラッカー
  ] },
  repair: { w0: { kg: 580, use: 10, heal: 1100, range: 60, charge: 35, chargeKeep: 30 }, types: [ // リペアユニット（リペアユニット系統）
    ['広域型', { kg: 620, use: 8, heal: 1100, range: 80, charge: 30, chargeKeep: 25 }, '射程が長いが使用時間が短く重い'], // リペアユニットβ
    ['持続型', { kg: 630, use: 14, heal: 1500, range: 70, charge: 80, chargeKeep: 75 }, '長く強く修理できるがチャージが遅い'], // リペアユニットδ
  ] },
  field: { w0: { kg: 550, use: 50, heal: 1000, radius: 12, charge: 45, chargeKeep: 40 }, types: [ // リペアフィールド（リペアフィールド系統）
    ['広域型', { kg: 590, use: 45, heal: 1000, radius: 18, charge: 25, chargeKeep: 20 }, '範囲が広くチャージが速いが重い'], // リペアフィールドβ
    ['高出力型', { kg: 620, use: 40, heal: 1300, radius: 9, charge: 30, chargeKeep: 25 }, '修理が速いが範囲が狭く重い'], // リペアフィールドγ
  ] },
  carbine: { w0: { dmg: 350, rpm: 840, mag: 70, mags: 14, reload: 2.2, kg: 320, acc: 'D+', recoil: 'C+' }, types: [ // UK56速射機銃（速射機銃系統）
    ['精密型', { dmg: 340, rpm: 840, mag: 75, mags: 13, reload: 2.3, kg: 300, acc: 'C', recoil: 'B+' }, '精度と反動が良いが威力が少し低い'], // UK56速射機銃・改
    ['大容量型', { dmg: 330, rpm: 900, mag: 100, mags: 9, reload: 3, kg: 340, acc: 'E+', recoil: 'C-' }, '装弾数と連射が多いが精度が低い'], // UK57速射機銃
    ['強装型', { dmg: 470, rpm: 700, mag: 54, mags: 14, reload: 2.4, kg: 350, acc: 'C-', recoil: 'C-' }, '一発が重いが連射が遅い'], // UK60速射機銃
  ] },
  gale: { w0: { dmg: 280, pellets: 7, rpm: 240, mag: 6, mags: 19, reload: 1.4, kg: 160, diffuse: '小' }, types: [ // SSG7－ゲイル（SSG系統）
    ['瞬発型', { dmg: 310, pellets: 10, rpm: 240, mag: 2, mags: 25, reload: 1.1, kg: 220, diffuse: '中' }, '一撃が重いが装弾数が2発しかない'], // SSG7－ガスト
    ['強装型', { dmg: 390, pellets: 8, rpm: 150, mag: 4, mags: 17, reload: 1.4, kg: 230 }, '一発が重いが連射が遅く重い'], // SSG7C－タイフーン
  ] },
  vulcan: { w0: { dmg: 640, rpm: 480, mag: 45, mags: 19, reload: 2.2, kg: 280, acc: 'D', recoil: 'A-' }, types: [ // ヴルカンLG1（ヴルカン系統）
    ['連射型', { dmg: 500, rpm: 600, mag: 49, mags: 21, reload: 2.1, kg: 300, acc: 'C+', recoil: 'A' }, '連射が速いが一発が軽い'], // ヴルカン・ジャラー
    ['強装型', { dmg: 740, rpm: 420, mag: 36, mags: 21, reload: 2.2, kg: 320, acc: 'B', recoil: 'B' }, '一発が重いが連射が遅く弾が少ない'], // ヴルカン・ラヴァ
    ['精密型', { dmg: 660, rpm: 480, mag: 36, mags: 22, reload: 2, kg: 330, acc: 'B', recoil: 'B+' }, '精度と反動が良いが装弾数が少なく重い'], // ヴルカン・ハーオス
  ] },
  margay: { w0: { dmg: 450, rpm: 360, mag: 18, mags: 11, reload: 1.3, kg: 190, acc: 'B', recoil: 'C+' }, types: [ // マーゲイM40（マーゲイ系統）
    ['大容量型', { dmg: 430, rpm: 360, mag: 22, mags: 10, reload: 1.4, kg: 200, acc: 'A-', recoil: 'C-' }, '装弾数と精度が良いが一発が軽い'], // マーゲイ・カスタム
    ['強装型', { dmg: 980, rpm: 200, mag: 7, mags: 14, reload: 1.6, kg: 250, acc: 'A+', recoil: 'C+' }, '一発が非常に重いが連射が遅く弾が少ない'], // マーゲイ・サヴァート
    ['精密型', { dmg: 570, rpm: 360, mag: 13, mags: 14, reload: 1.3, kg: 250, acc: 'A', recoil: 'C-' }, '威力と精度が高いが装弾数が少なく重い'], // マーゲイ・レベリオ
  ] },
  gemini: { w0: { dmg: 400, rpm: 360, mag: 18, mags: 13, reload: 1.6, kg: 280, acc: 'B', recoil: 'A-' }, types: [ // LMM－ジェミニ（LMM系統）
    ['大容量型', { dmg: 340, rpm: 400, mag: 23, mags: 12, reload: 1.5, kg: 290, acc: 'A-', recoil: 'A+' }, '装弾数と連射が多いが一発が軽い'], // LMM－ジェミニC
    ['強装型', { dmg: 540, rpm: 300, mag: 12, mags: 14, reload: 1.5, kg: 330, acc: 'A-', recoil: 'A-' }, '一発が重いが連射が遅く重い'], // LMM－アブレスト
    ['精密型', { dmg: 490, rpm: 360, mag: 11, mags: 18, reload: 1.2, kg: 320, acc: 'A+', recoil: 'A' }, '精度とリロードが良いが装弾数が少ない'], // LMM－ディオスクリ
  ] },
  haggard: { w0: { dmg: 2530, rpm: 120, mag: 6, mags: 9, reload: 1.3, kg: 210, acc: 'B-', recoil: 'D+' }, types: [ // ハガードM50（ハガード系統）
    ['大容量型', { dmg: 2150, rpm: 120, mag: 12, mags: 6, reload: 1.8, kg: 200, acc: 'A-', recoil: 'B+' }, '装弾数が倍で精度も良いが一発が軽い'], // ハガード・カスタム
    ['強装型', { dmg: 3200, rpm: 120, mag: 6, mags: 12, reload: 1.6, kg: 250, acc: 'B+', recoil: 'D-' }, '一発が重いが反動とリロードが悪い'], // ハガード・タフ
  ] },
  aurora: { w0: { dmg: 920, pellets: 5, rpm: 42, mag: 5, mags: 9, reload: 2.8, kg: 270, acc: 'C' }, types: [ // LSG－アヴローラ（LSG系統）
    ['広域型', { dmg: 550, pellets: 10, rpm: 42, mag: 6, mags: 6, reload: 3.2, kg: 310, acc: 'D+' }, '散弾が多く広がるが予備弾が少なく重い'], // LSG－アヴローラβ
    ['精密型', { dmg: 910, pellets: 6, rpm: 42, mag: 5, mags: 9, reload: 3.1, kg: 320, acc: 'B' }, '拡散が極小で威力も高いがリロードが遅い'], // LSG－ラドゥガ
    ['強装型', { dmg: 730, pellets: 9, rpm: 42, mag: 3, mags: 11, reload: 2.6, kg: 350 }, '総威力が高いが装弾数3発で重い'], // LSG－ミラージ
  ] },
  // ---- v0.15：チャージ撃ち・横に広がる弾・炸裂する弾・全方向の加速装置の系統。グリントの型は wiki の主武器性能比較（Ver.3.14）の値 ----
  wave: { w0: { dmg: 900, chargeDmg: 1620, rpm: 300, mag: 21, mags: 13, reload: 2.6, kg: 330, chargeTime: 1.2, ohTime: 2, range: 150 }, types: [ // ウェーブショット（ウェーブショット系統）
    ['広域型', { dmg: 800, chargeDmg: 1120, rpm: 300, mag: 18, mags: 13, reload: 2.5, kg: 350, chargeTime: 1, ohTime: 2, range: 150 }, '充填が速いが威力が低く弾も少ない'], // ウェーブショットC
    ['強装型', { dmg: 970, chargeDmg: 2037, rpm: 300, mag: 15, mags: 13, reload: 2.9, kg: 400, chargeTime: 1.5, ohTime: 2, range: 150 }, '溜め撃ちが重いが重く弾が少ない'], // ウェーブショットX
  ] },
  lec: { w0: { dmg: 1370, chargeDmg: 2740, rpm: 300, mag: 18, mags: 18, reload: 2.6, kg: 340, chargeTime: 1.5, blast: 11 }, types: [ // LEC－シュトラル（LEC系統）
    ['瞬発型', { dmg: 1280, chargeDmg: 1920, rpm: 300, mag: 22, mags: 16, reload: 2.4, kg: 330, chargeTime: 1, blast: 10 }, '充填が速く弾も多いが溜め弾が軽い'], // LEC－シュトラルβ
    ['強装型', { dmg: 1870, chargeDmg: 3740, rpm: 240, mag: 14, mags: 18, reload: 2.7, kg: 390, chargeTime: 2.5, blast: 12 }, '溜め弾が重く爆風も広いが充填が遅い'], // LEC－メテオール
  ] },
  explo: { w0: { dmg: 1340, rpm: 200, mag: 30, mags: 9, reload: 3.6, kg: 440, acc: 'C-', recoil: 'B-', blast: 9, heat: 16, ohTime: 3.1 }, types: [ // 単式炸薬砲（炸薬砲系統）
    ['大容量型', { dmg: 1520, rpm: 180, mag: 40, mags: 7, reload: 3.8, kg: 460, acc: 'B-', recoil: 'C', blast: 11, heat: 12, ohTime: 2.7 }, '弾倉が大きく爆風も広いが連射が遅い'], // 単式炸薬砲・猛虎
    ['強装型', { dmg: 1960, rpm: 160, mag: 34, mags: 7, reload: 3.4, kg: 490, acc: 'B+', recoil: 'C+', blast: 12, heat: 12, ohTime: 2.09 }, '一発が非常に重いが連射が遅く重い'], // 単式炸薬砲・金剛
  ] },
  cls: { w0: { dmg: 450, pellets: 10, rpm: 90, mag: 3, mags: 14, reload: 1.8, kg: 260, chargeTime: 1.2, ohTime: 2, range: 200 }, types: [ // CLS－ライオ（CLS系統）
    ['大容量型', { dmg: 470, pellets: 8, rpm: 90, mag: 5, mags: 12, reload: 2.4, kg: 290, chargeTime: 1, ohTime: 2, range: 200 }, '装弾数が多く充填も速いが散弾が少ない'], // CLS－ライオβ
    ['瞬発型', { dmg: 1060, pellets: 6, mag: 1, mags: 28, reload: 1.6, kg: 320, chargeTime: 2, ohTime: 2, range: 200 }, '一撃が最も重いが1発ごとにリロード'], // CLS－イルミナル
    ['強装型', { dmg: 640, pellets: 9, rpm: 90, mag: 2, mags: 19, reload: 1.7, kg: 320, chargeTime: 1.5, ohTime: 2, range: 200 }, '散弾が重いが装弾数が2発で重い'], // CLS－センテレオ
  ] },
  omni: { w0: { kg: 240, charge: 40, chargeKeep: 35, use: 3.4, power: 1.25 }, types: [ // SC－マルチウェイ（スライドチャージャー系統）
    ['高出力型', { kg: 280, charge: 30, chargeKeep: 25, use: 1.6, power: 1.7 }, '出力が高いが使用時間が短く重い'], // SC－マルチウェイX
    ['持続型', { kg: 300, charge: 45, chargeKeep: 40, use: 4.9, power: 1 }, '長く使えるが出力が低く重い'], // SC－マルチウェイⅡ
  ] },
  wide: { w0: { dmg: 130, pellets: 3, rpm: 480, mag: 21, mags: 13, reload: 1.4, kg: 230, recoil: 'C-', range: 150, fan: 1 }, types: [ // ワイドショット（ワイドショット系統）
    ['精密型', { dmg: 130, pellets: 3, rpm: 480, mag: 21, mags: 14, reload: 1.5, kg: 280, recoil: 'C-', range: 150, fan: 0.45 }, '拡散が極小で狙いやすいが重い'], // ワイドショットX2
  ] },
  glint: { w0: { dmg: 440, rpm: 450, mag: 24, mags: 10, reload: 2.1, kg: 340, chargeTime: 1.5, chargeDmg: 2400, blast: 14 }, types: [ // グリントN72D（グリント系統）
    ['瞬発型', { dmg: 410, rpm: 450, mag: 26, mags: 11, reload: 2.2, kg: 330, chargeTime: 1, chargeDmg: 1900 }, '充填が速く弾も多いが威力が低い'], // グリントN72DⅡ
    ['強装型', { dmg: 520, rpm: 360, mag: 17, mags: 12, reload: 2.3, kg: 360, chargeTime: 3, chargeDmg: 3700 }, '溜め弾が非常に重いが充填が遅い'], // グリントN72DS
    ['重装型', { dmg: 610, rpm: 360, mag: 15, mags: 11, reload: 2.1, kg: 390, chargeTime: 2, chargeDmg: 3000 }, '通常弾が重いが重く弾が少ない'], // グリントN77D
  ] },
};
const RANKS = ['E-', 'E', 'E+', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S'];
// 型番の末尾の文字（例：SR-7 の強装型は SR-7H）。キーは元のキー＋この文字（arH）
const TYPE_LETTER = { 三点射型:'K', 連撃型:'B', 軽量弾型:'T', 光学型:'O', 速射型:'V', 全周型:'A', 軽量型: 'L', 連射型: 'R', 強装型: 'H', 大容量型: 'X', 精密型: 'P', 速装型: 'Q', 広域型: 'W', 持続型: 'D', 瞬発型: 'S', 拡散型: 'E', 拡大型: 'U', 改良型: 'I', 高速型: 'F', 高出力型: 'G', 長射程型: 'F', 重装型: 'M', 巡航型: 'C', 即応型: 'Q' };
// 散弾の拡散率（wiki の 極小・小・中・大・特大）。型の拡散は系統の基準（w0.diffuse）との比で決める（2026-11-07。前は拡散率を写しておらず、「広がる」「絞られる」型も基準と同じ広がりだった）。倍率は Claude の判断
const DIFFUSE = { 極小: .5, 小: .75, 中: 1, 大: 1.25, 特大: 1.5 };
const snap = (v, step) => +(Math.round(v / step) * step).toFixed(2);
function makeType(base, w0, t) {
  const w = structuredClone(base), P = w.proj, G = P && P.gun, D = w.drone, gun = G || w;
  // 照射砲の型はACの実値。準備・射程・判定半径・旋回制限は標準を継承する。
  // 反射衛星砲の型は値をそのまま入れる（2026-11-05）
  if (w.type === 'reflector') {
    for (const k of ['dps', 'speed', 'fireTime', 'radius', 'range', 'warn', 'charge', 'chargeKeep']) if (t[k] != null) w[k] = t[k];
    return w;
  }
  if (w.stunField) { // スタンガンの型（2026-11-06）
    const F = w.stunField, area = { 1: .8, 2: 1, 3: 1.25 }, r = area[t.area] / area[w0.area];
    F.dmg = F.dmg.map((v, i) => snap(v * t.dmg[i] / w0.dmg[i], 10));
    F.shock = F.shock.map(v => snap(v * t.shock / w0.shock, .05));
    F.len = F.len.map(v => snap(v * r, .5)); F.width = F.width.map(v => snap(v * r, .5));
    w.chargeTime = snap(w.chargeTime * t.charge / w0.charge, .05);
    return w;
  }
  if (w.type === 'beamCannon') {
    for (const k of ['dps', 'contact', 'use', 'charge', 'chargeKeep']) if (t[k] != null) w[k] = t[k];
    if (t.chargeKeep === null) delete w.chargeKeep; // 原典不明時は既存SP規則でOH回復と同じ秒数
    return w;
  }
  const f = k => t[k] / w0[k], has = k => t[k] != null && !!w0[k];
  const by = (k, o, field, step) => { if (o && o[field] != null && has(k)) o[field] = snap(o[field] * f(k), step); };
  const n = (k, o, field) => { if (o && o[field] != null && has(k)) o[field] = Math.max(1, Math.round(o[field] * f(k))); };
  const steps = k => { const a = RANKS.indexOf(w0[k]), b = RANKS.indexOf(t[k]); return a < 0 || b < 0 ? 0 : b - a; };
  if (P && P.seek) { // レーザー誘導ロケットの型（2026-11-06）：表の値をそのまま入れる
    for (const k of ['rpm','mag','mags','reload','burst']) if (t[k] != null) w[k] = t[k];
    if (w.burst) w.gap = w.gap || 0;
    for (const k of ['dmg','blast','speed','maxSpeed','accel','turn']) if (t[k] != null) P[k] = t[k];
    if (t.recoilV != null) w.recoil = t.recoilV * Math.PI / 180;
    if (w.sfx) w.sfxRate = snap((base.sfxRate || 1) * (t.dmg / w0.dmg) ** -0.12, 0.01);
    return w;
  }
  if (w.missile) {
    for (const k of ['rpm','mag','mags','reload']) if (t[k] != null) w[k] = t[k];
    for (const k of ['dmg','blast','speed','maxSpeed','accel','turn']) if (t[k] != null) P[k] = t[k];
    for (const k of ['shots','locks','rank']) if (t[k] != null) w.missile[k] = t[k];
    if (t.recoilV != null) w.recoil = t.recoilV * Math.PI / 180;
    if (t.recoilH != null) w.recoilH = t.recoilH * Math.PI / 180;
    return w;
  }
  if (w.acMelee) {
    if (w.meleeCharge) {
      for(const k of ['normalLevels','strongLevels']) if(t[k]) w[k]=t[k].slice();
      w.normal.dmg=w.normalLevels[0];w.strong.dmg=w.strongLevels[0];
      by('chargeTime',w,'chargeTime',.01);
    } else {
      w.normal=auxiliaryMelee(t.normalHits,w.acMelee);
      if (w.combo) { w.combo = sabreCombo(t.normalHits, t.strongHits); w.normal = w.combo[0]; if (t.iai) Object.assign(w.iai, t.iai); } // 斬馬刀の連続技と型ごとの居合
      w.strong=auxiliaryMelee(t.strongHits,w.acMelee,true,w.acMelee==='claw'?Math.max(0,Math.round((t.kg-200)/100)):w.acMelee==='sabre'?(t.kg>=390?2:1):0);
    }
    return w;
  }
  if (w.type === 'sword') {
    const k = t.kg / w0.kg, slow = k ** 0.35;
    w.normal.dmg = Math.min(9600, snap(w.normal.dmg * Math.sqrt(t.normal / w0.normal), 100));
    w.strong.dmg = Math.min(20000, snap(w.strong.dmg * Math.sqrt(t.strong / w0.strong), 100));
    for (const a of [w.normal, w.strong]) {
      for (const p of ['windup', 'sweep', 'time', 'recover']) if (a[p]) a[p] = snap(a[p] * slow, 0.05);
      a.reach = snap(a.reach * k ** 0.12, 0.1);
      if (a.lunge) a.lunge = snap(a.lunge / k ** 0.3, 0.5);
      a.homing = snap(a.homing / slow, 0.1);
    }
    return w;
  }
  for (const k of ['scope', 'scopeHigh', 'settle', 'chargeHold']) if (t[k] != null && base[k] != null) w[k] = base[k] * t[k] / w0[k];
  if (base.chargeStages && t.chargeStages) w.chargeStages = base.chargeStages.map((v,i) => Math.round(v*t.chargeStages[i]/w0.chargeStages[i]));
  if (base.directBlast && t.blast != null) w.directBlast = base.directBlast*t.blast/w0.blast;
  for (const k of ['heatDps','heatDur','chainCount','chainStep','chainGap','jumpDelay','knockMult']) if (P && P[k] != null && t[k] != null) P[k] = base.proj[k]*t[k]/w0[k];
  for(const k of ['jamSeconds','stunSeconds','roamSpeed','pickupRange','pickupSpeed']) if(P && P[k]!=null && t[k]!=null) P[k]=base.proj[k]*t[k]/w0[k];
  if(P?.gun && t.gunEnergy!=null) P.gun.energy=t.gunEnergy;
  if(w.type==='radarTool') {by('keep',w,'keep',.01);by('expand',w,'expand',.01);}
  by('flight', w, 'flight', .1); by('scatter', w, 'scatter', .1); by('interval', w, 'interval', .01);
  if (t.interval === null) delete w.interval;
  by('shieldHp', w, 'shieldHp', 1);
  for (const k of ['arc', 'level', 'energy', 'healDrain']) if (t[k] != null) w[k] = t[k];
  by('dmg', G || P || w, 'dmg', 10);
  if (t.pellets != null) {
    if (w0.pellets) n('pellets', gun, 'pellets');
    else Object.assign(gun, { pellets: t.pellets, spread: Math.max(gun.spread, 0.07), falloff: [10, 30, 0.3] }); // 散弾の自動砲台
  }
  if (t.rpm != null) { if (w0.rpm) by('rpm', gun, 'rpm', 1); else gun.rpm = t.rpm; }
  n('mag', gun, 'mag'); n('mags', w, 'mags'); by('reload', gun, 'reload', 0.1);
  // 所持数：補給できない物（mags が1）は mag、ほかは mags。同時に置ける数（max）が所持数と同じなら一緒に変える
  const stockKey = w.mags === 1 && w.mag > 1 ? 'mag' : 'mags';
  n('count', w, stockKey);
  if (P && P.max != null && P.max === base[stockKey]) P.max = w[stockKey];
  by('blast', P, 'blast', 0.5); by('blast', w, 'blast', 0.5); by('blast', w, 'chargeBlast', 0.5); by('blast', w.chargeOrb, 'blast', 0.5); by('fuse', P, 'fuse', 0.1);
  // チャージ撃ち（v0.15）：満タンまでの秒。満タンの威力（chargeDmg）は、光弾ならその威力、ほかは満タンの倍率（満タンの威力÷1発の威力）の比で
  by('chargeTime', w, 'chargeTime', 0.05);
  if (has('fan')) w.fan = +(w.fan * f('fan')).toFixed(3); // 横の広がり（ワイドショットの拡散率 中・極小を比にした物）
  if (has('chargeDmg') && t.dmg && w0.dmg) { if (w.chargeOrb) by('chargeDmg', w.chargeOrb, 'dmg', 10); else if (w.chargeMul) w.chargeMul = +(w.chargeMul * (t.chargeDmg / t.dmg) / (w0.chargeDmg / w0.dmg)).toFixed(2); } by('trigger', P, 'trigger', 0.5); by('hp', P, 'hp', 100);
  if (D) { by('speed', D, 'speed', 1); by('range', D, 'dist', 10); by('dur', D, 'hover', 0.5); }
  else by('speed', P, 'speed', 5);
  if (G) by('range', G, 'range', 5);
  else if (P && P.grav && has('range')) P.speed = snap(P.speed * Math.sqrt(f('range')), 1); // 山なりに撃ち出す物は、届く距離が弾速の2乗に比例
  else by('range', w, 'range', 1);
  by('scan', D || P, 'scan', 1); by('keep', D || P, 'keep', 0.5);
  if (P && P.weak) by('dur', P.weak, 'time', 0.5); else by('dur', P, 'dur', 1);
  n('heat', w, 'heat'); by('ohTime', w, 'ohTime', 0.1);
  by('power', w, 'speed', 0.1); by('use', w, 'use', 0.1); by('heal', w, 'heal', 10); by('radius', w, 'radius', 0.5); n('shots', w, 'shots');
  // SP：満タンまでの秒が変わったら、使い切らなかったときの秒も同じ比で（wiki に値があればその比で）
  if (has('charge')) {
    const c0 = w.charge; w.charge = snap(w.charge * f('charge'), 1);
    if (t.chargeKeep != null) w.chargeKeep = has('chargeKeep') && base.chargeKeep != null ? snap(base.chargeKeep * f('chargeKeep'), 1) : snap(w.charge * t.chargeKeep / t.charge, 1);
    else if (w.chargeKeep != null) w.chargeKeep = snap(w.chargeKeep * w.charge / c0, 1);
  }
  if (t.chargeKeep === null) delete w.chargeKeep; // AC表が不明の型は通常充填と同じ扱い（本作の暫定規則）
  if (t.diffuse && w0.diffuse) gun.spread = +(gun.spread * DIFFUSE[t.diffuse] / DIFFUSE[w0.diffuse]).toPrecision(2);
  if (P && P.cone != null && t.cone != null) P.cone = t.cone; // 扇形センサーの角度（2026-11-07）
  if (steps('acc')) { const k = 0.88 ** steps('acc'); gun.spread = +(gun.spread * k).toPrecision(2); if (w.sway) w.sway = +(w.sway * k).toPrecision(2); }
  if (steps('recoil')) w.recoil = +(baseKick(base) * 0.88 ** steps('recoil')).toPrecision(2);
  // AC表で実数の縦反動（度）が分かる新系統。既存のランク換算は変えない。0度も扱う。
  if (Number.isFinite(t.recoilV)) w.recoil = t.recoilV * Math.PI / 180;
  if(base.proj?.airDeploy && t.dur!=null)w.proj.dur=t.dur;
  if (w.sfx && has('dmg')) w.sfxRate = snap((base.sfxRate || 1) * f('dmg') ** -0.12, 0.01); // 重い弾ほど少し低い音
  return w;
}
const seriesOfKey = {};
for (const [id, se] of Object.entries(SERIES)) for (const [k] of se.types) seriesOfKey[k] = id;
for (const [bk, { w0, types }] of Object.entries(WEAPON_TYPES)) {
  const base = WEAPONS[bk], se = SERIES[seriesOfKey[bk]], [cls, slot] = CLASS_KEYS.flatMap(c => SLOTS.map(s => [c, s])).find(([c, s]) => ARMORY[c][s].includes(bk));
  const list = ARMORY[cls][slot], [fam, v0] = MODEL_OF[bk], bm = se.types.find(([k]) => k === bk)[1];
  types.forEach(([label, t, desc], i) => {
    let key = bk + TYPE_LETTER[label], model = bm + TYPE_LETTER[label];
    while (WEAPONS[key]) key += '2';
    while (se.types.some(([, m]) => m === model)) model += '2';
    const w = makeType(base, w0, t);
    Object.assign(w, { key, name: base.name.split('・')[0] + '・' + label, desc, kg: t.kg });
    if (w.proj && w.proj.model === bk) w.proj.model = key; // 投げる物は型の形。遠隔ボムランチャーの弾（model: 'remote'）は爆弾の形のまま
    WEAPONS[key] = w; WEAPON_KG[key] = t.kg; MODEL_OF[key] = [fam, (v0 + i + 1) % 3];
    // カスタマイズの画面では同じシリーズの型の後ろに並べる
    const last = Math.max(...se.types.map(([k]) => list.indexOf(k)));
    list.splice(last + 1, 0, key);
    se.types.push([key, model]);
  });
}
// オーナー指定（2026-10-26）：重装型の爪は右→左→右。1段4500を増やし、原典の転記値は保つ。
{
  const w=WEAPONS.clawM,a=w.strong,first=a.strikes[0],last=a.strikes[1],gap=last.at-first.sweep;
  const third={...first,gripFrom:first.gripFrom.slice(),gripTo:first.gripTo.slice(),at:last.at+last.sweep+gap};
  a.strikes.push(third);a.sweep=third.at+third.sweep;a.time=a.windup+a.sweep+a.recover;
  a.dmg=a.strikes.reduce((sum,strike)=>sum+strike.dmg,0);a.dashName='レーザー刃の右袈裟→左袈裟→右袈裟';
  w.desc=w.desc.replace('右袈裟→左袈裟の二段攻撃','右袈裟→左袈裟→右袈裟の三段攻撃');
}
// オーナー調整（2026-10-25）：速装型は装填数を保ち、3点バースト・拡散率1/3。
// 0.1秒間隔で3発。次の組まで含む周期は変更前の1射分を保つ。
{
  const w = WEAPONS.shotgunQ, cycle = 60 / w.rpm, interval = .1;
  SFX.shotgunBurst = { ...SFX.shotgun, gap: .08 }; // 既存の散弾音を3発とも鳴らす。
  // オーナー調整（2026-10-27）：1射4粒、3点で計12粒。従来の速装型から拡散を15%縮小。
  Object.assign(w, { sfx: 'shotgunBurst', pellets: 4, burst: 3, rpm: 60 / interval, gap: cycle - 3 * interval, spread: w.spread / 3 * .85,
    desc: '狭くまとまる散弾を3点バーストで撃つ。装填6発で2組撃てる' });
}
// オートショットガンの特性（2026-11-07、オーナー「特性4種ぐらい作って、特性別に性能調整して実装してください」）。
// 標準（380×12・100発/分）と連射型に、撃ち方の違う4つを足す。参考はアーケード版 ASG系統（スタンピード・デリュージ）。値は Claude の判断
//   速射型：引きっぱなしでばらまく。秒間の威力は一番高いが1発が軽く、よろけは取りにくい。広がりが大きく近距離専用
//   三点射型：1回押すと0.1秒間隔で3発。散弾が絞られ、少し離れても組で大きく削る
//   精密型：散弾を絞り（広がり0.05）、1発を重く（600×8）、装弾は6発。少し離れても粒がまとまって当たる
//   大容量型：1発は軽い（300×12）が広がりやや大きく（0.1）、18発撃ち続けられる。リロードは長い
// （炸裂・溜めの仕組みは別の系統になるので入れない。2026-11-07 オーナー「拡散率や1発当たりのダメージや装弾数で変化つけて」）
Object.assign(WEAPONS.autosgV, { dmg: 150, pellets: 14, rpm: 240, mag: 16, mags: 8, reload: 2, spread: .11, falloff: [10, 26, .3],
  desc: '引きっぱなしで散弾をばらまく全自動型。秒間の威力は高いが、1発が軽く広がるので近距離専用' });
Object.assign(WEAPONS.autosgK, { dmg: 260, pellets: 7, burst: 3, rpm: 600, gap: .4, mag: 15, mags: 8, reload: 2.2, spread: .06, falloff: [16, 36, .3],
  desc: '絞られた散弾を3点射で撃つ。少し離れた相手にも1組でまとめて当てられる' });
Object.assign(WEAPONS.autosgP, { dmg: 600, pellets: 8, rpm: 90, mag: 6, mags: 10, reload: 2.4, spread: .05, falloff: [12, 30, .3],
  desc: '散弾を絞った重い1発。少し離れても粒がまとまって当たるが、装弾は6発で外すと痛い' });
Object.assign(WEAPONS.autosgX, { dmg: 300, pellets: 12, rpm: 110, mag: 18, mags: 6, reload: 2.8, spread: .1, falloff: [12, 30, .3],
  desc: '1発は軽いが18発撃ち続けられる。散弾はやや広がり、リロードは長い' });
// オーナー希望（2026-11-02）：プラズマ砲・三点射型（アーケード版 プラズマカノンMk-2、750/min の三点射）。
// 1回押すと0.08秒間隔で3発。次の組までの間（gap 0.3秒）は wiki に無いので Claude の仮置き。
Object.assign(WEAPONS.plasmaK, { burst: 3, gap: .3 });
// 光学狙撃銃・三点射型（LZ-トライアド、600/min の三点射）：1回押すと0.1秒間隔で3発。弾倉3発なので次はリロードの後
Object.assign(WEAPONS.optSniperK, { burst: 3, gap: .3 });
// オーナー指定（2026-10-25）：VR-8Hだけ40mで推進剤が尽きる。発射角の自動補正はせず、自分で上を狙う。
Object.assign(WEAPONS.rocketH.proj, { burnDistance: 40, coastGrav: 24 });
WEAPONS.rocketH.desc = '重い弾頭を撃つ。40mで噴射が止まり、その先は重力で落ちる';
// 武器バランスの見直し（2026-11-07、オーナー「根深いトコは修正していきたい」）。説明と性能が食い違っていた型を、説明に合わせる。値は Claude の判断
// 光学迷彩・即応型：説明「隠密性が高い」。原典の隠密は標準・耐久型 Lv1、即応型 Lv2、高出力型 Lv3 なので、見えにくさを標準と高出力型の間にする
Object.assign(WEAPONS.camoQ, { still: .03, move: [.2, .47], shot: .75 });
// 波動ライフル・広域型：「広域」の性能が無く、同じ溜めの威力も弾数も標準型より下だった。満タンの弾が当たった所で小さく爆ぜる（半径6m）
WEAPONS.waveW.chargeBlast = 6;
WEAPONS.waveW.desc = '充填が速く、満タンの弾は当たった所で爆ぜて周りも巻き込む。威力が低く弾も少ない';
// 波動ライフルの作り直し（2026-11-07、オーナー「あまりにも現状弱い」）。短押しは連打で毎秒5000台（マークスマン並み）、満タンは1発で敵をよろけさせる役。値は Claude の判断
// 短押しの威力 ×1.28、射程 150→300m。満タンの倍率：標準 1.8→3.2（3680）、広域型 1.4→2.4（爆ぜる）、強装型 2.1→3.8。chargeKnock：満タンの弾のよろけ判定だけ1.6倍に数える（一番固い装甲0.63で減っても3500に届く）
for (const [k, mul, knock] of [['wave', 3.2, 1.6], ['waveW', 2.4, 0], ['waveH', 3.8, 1.6]]) {
  const w = WEAPONS[k]; w.dmg = Math.round(w.dmg * 1.28 / 10) * 10; w.chargeMul = mul; w.range = 300; if (knock) w.chargeKnock = knock;
}
for (const k of ['wave', 'waveW', 'waveH']) WEAPONS[k].chargeSize = 5; // 溜めた分だけ弾が太くなる（満タンで5倍、先頭に光の玉。オーナー 2026-11-07）
WEAPONS.wave.desc = '短押しで撃てる光学銃。長押しで溜めて離すと、満タンで威力3.2倍の弾が当たった敵をよろけさせる';
WEAPONS.waveH.desc = '溜めが遅いが、満タンの弾は威力3.8倍で当たった敵をよろけさせる。重く弾が少ない';
// 蓄積エナジー砲（標準型）：短押しの連射に比べて溜める意味が薄かったので、満タンの倍率を 2→2.5（2740→3425）
WEAPONS.lec.chargeMul = 2.5;
WEAPONS.lec.desc = '溜めて撃つ光学砲。満タンで撃つと威力2.5倍で、当たった所が爆発する';
// cat：シリーズの武器の名前（型の名前の「・」より前）、label：型の名前（「・」より後。型が1つなら無し、先頭は標準型）
for (const [id, se] of Object.entries(SERIES)) {
  se.cat = WEAPONS[se.types[0][0]].name.split('・')[0];
  se.types.forEach(([k, model], i) => { const nm = WEAPONS[k].name; Object.assign(WEAPONS[k], { series: id, model, maker: se.maker, label: nm.includes('・') ? nm.split('・')[1] : se.types.length > 1 ? '標準型' : '' }); });
}
// 主武器の縦/横反動（度）。AC表との対応、不明値と本作調整は research/weapons/primary-recoil.json。
// マグナム2.75/0.6は操作感の本作調整。表のない型は系統の基準に既存の反動倍率を掛ける。
const PRIMARY_RECOIL_DEG = {
  rail: [0.3, 0.3],
  railX: [0.2, 0.3],
  railR: [0.2, 0.2],
  pulse: [0.2, 0.25],
  pulseX: [0.1, 0.15],
  pulseH: [0.3, 0.35],
  coil: [0.4, 0.5],
  coilP: [0.2, 0.3],
  coilR: [0.4, 0.5],
  coilD: [0.3, 0.4],
  ar: [0.2, 0.2],
  arX: [0.3, 0.2],
  arP: [0.4, 0.3],
  burst: [0.7, 0.2],
  burstX: [0.5, 0.1],
  burstP: [0.6, 0.2],
  burstH: [0.9, 0.5],
  marks: [1.2, 0.2],
  marksX: [1.3, 0.3],
  gale: [6.0, 0.03],
  galeS: [4.0, 0.03],
  vulcan: [0.2, 0.3],
  vulcanR: [0.15, 0.25],
  vulcanH: [0.4, 0.5],
  gatling: [0.3, 1.5],
  gatlingH: [0.2, 1.8],
  gatlingD: [0.4, 2.0],
  gatlingG: [0.4, 1.9],
  mg: [0.4, 1.0],
  mgR: [0.4, 0.9],
  mgP: [0.3, 0.7],
  acannon: [1.0, 1.4],
  acannonP: [0.5, 0.8],
  explo: [0.7, 1.4],
  exploX: [1.2, 1.6],
  wide: [0.9, 0.4],
  wideP: [0.9, 0.4],
  pistols: [0.9, 0.4],
  pistolsX: [0.8, 0.2],
  pistolsR: [0.5, 0.2],
  pistolsH: [1.4, 0.5],
  dualmg: [0.3, 0.5],
  dualmgP: [0.2, 0.4],
  dualmgH: [0.4, 0.8],
  haggard: [2.75, 0.6],
};
// 型の生成が済んでから反動を設定し、既存の威力・発数・精度などは変えない。
const primaryKickBefore = Object.fromEntries(Object.values(ARMORY).flatMap(s => s.main).map(k => [k, baseKick(WEAPONS[k])]));
for (const slots of Object.values(ARMORY)) for (const key of slots.main) {
  const w = WEAPONS[key], base = SERIES[w.series].types[0][0], oldBase = primaryKickBefore[base];
  const reference = PRIMARY_RECOIL_DEG[base] || [oldBase * 180 / Math.PI, Math.max(.12, oldBase * 180 / Math.PI * .6)];
  const ratio = oldBase > 0 ? primaryKickBefore[key] / oldBase : 1;
  const [v, h] = PRIMARY_RECOIL_DEG[key] || reference.map(x => x * ratio);
  Object.assign(w, { recoil: v * Math.PI / 180, recoilH: h * Math.PI / 180, recoilDelay: .1, recoilRecovery: .06 });
}
return { WEAPON_KG, auxiliaryMelee, WEAPONS, SLOTS, SLOT_NAMES, CLASSES, CLASS_KEYS, ARMORY, SFX_TUNE, SERIES, WEAPON_TYPES, RANKS, TYPE_LETTER, snap, makeType, seriesOfKey, PRIMARY_RECOIL_DEG, primaryKickBefore };
}
