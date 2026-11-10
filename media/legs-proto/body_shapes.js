// ドーザー（重量級の四脚）とホッパー（軽量級の逆脚）の頭・胴・肩の形（#227、オーナーの指定「全身作って」）。
// ゲーム本体の seriesHead・seriesChest・seriesShoulder と同じ書き方（a(幅,高さ,奥行き,色,x,y,z,骨,形,傾き)）なので、#228 でそのまま index.html の分岐に移せる。
// silhouette は MECH_SILHOUETTES に足す行。outlines は MECH_OUTLINES（index.html）の名前で指す。公式や他作品の素材は使っていない。
(function(){
const BODY_SHAPES={
  dozer:{
    silhouette:{chest:2.10,depth:1.36,waist:1.06,shoulder:.86,leg:.80,head:1.0,taper:.84,sweep:.04},
    // 頭：低い箱の上に、左右へ張り出した測距儀（両端が目）
    head(a,p,O){const h=(w,hh,d,c,x,y,z,shape={},tilt=0)=>a(w,hh,d,c,x,y,z,'head',shape,tilt);
      h(.30,.20,.34,'frame',0,3.3,.05,{bottom:1});
      h(1.02,.34,.92,'armor',0,3.55,.08,{outline:O.slab,rake:.05});
      h(1.56,.15,.24,'metal',0,3.75,-.14,{bottom:.85});
      for(const sd of[-1,1]){h(.24,.21,.30,'armor',sd*.70,3.75,-.14,{bottom:.8});h(.15,.12,.035,'visor',sd*.70,3.75,-.31,{bottom:1});}
      h(.44,.19,.16,'frame',0,3.55,-.43,{bottom:.8});h(.50,.085,.20,'trim',0,3.40,-.22,{bottom:1});
      h(.12,.30,.12,'metal',.34,3.86,.34,{bottom:1});
    },
    // 胸：砲塔のような八角の箱、下の防盾、前の2枚の傾いた装甲
    chest(a,p,O){const c=(w,h,d,col,x,y,z,shape={},tilt=0)=>a(w,h,d,col,x,y,z,'chest',shape,tilt);
      c(2.14,.62,1.34,'armor',0,2.92,.08,{outline:O.octagon,rake:.04});
      c(1.46,.42,.96,'metal',0,2.56,.12,{bottom:.84});
      for(const sd of[-1,1])c(.74,.46,.20,'armor',sd*.50,2.88,-.66,{bottom:.7,sweep:-.10},sd*-.10);
      c(.30,.34,.16,'frame',0,2.86,-.66,{bottom:1});c(.56,.09,.06,'trim',0,3.08,-.70,{bottom:1});
      c(1.60,.12,1.0,'armor',0,3.26,.10,{bottom:.9});
    },
    // 肩：厚い板の肩当てと、外側の当て板
    shoulder(a,p,sd,O){const bone='arm'+(sd<0?'L':'R');
      a(.90,.46,1.14,'armor',sd*1.47,3.02,.06,bone,{outline:O.slab,rake:.03},0);
      a(.16,.70,.92,'metal',sd*1.87,2.74,.08,bone,{bottom:.85});
      a(.50,.09,.10,'trim',sd*1.47,3.06,-.56,bone,{bottom:1});
    },
  },
  hopper:{
    silhouette:{chest:1.50,depth:.92,waist:.62,shoulder:.45,leg:.45,head:.68,taper:.50,sweep:.24},
    // 頭：前へ突き出たくさび形、後ろへ流れるとさか
    head(a,p,O){const h=(w,hh,d,c,x,y,z,shape={},tilt=0)=>a(w,hh,d,c,x,y,z,'head',shape,tilt);
      h(.30,.20,.34,'frame',0,3.3,.05,{bottom:1});
      h(.52,.34,.92,'armor',0,3.60,-.04,{outline:O.keel,rake:.22});
      h(.40,.09,.14,'frame',0,3.60,-.44,{bottom:.8});h(.34,.055,.05,'visor',0,3.61,-.52,{bottom:1});
      h(.10,.36,.62,'trim',0,3.84,.22,{top:.3,bottom:1,sweep:.26});
      for(const sd of[-1,1])h(.13,.20,.44,'metal',sd*.31,3.55,.12,{bottom:.6},sd*-.2);
    },
    // 胸：前へ傾いた翼形の板と細い芯、背の小さな尾
    chest(a,p,O){const c=(w,h,d,col,x,y,z,shape={},tilt=0)=>a(w,h,d,col,x,y,z,'chest',shape,tilt);
      c(1.44,.62,.86,'armor',0,2.90,.02,{outline:O.wing,rake:.20});
      c(.48,.56,.52,'metal',0,2.62,.04,{bottom:.42,sweep:-.14});
      for(const sd of[-1,1])c(.22,.44,.15,'metal',sd*.38,2.80,-.36,{bottom:.3},sd*-.22);
      c(.86,.08,.08,'trim',0,3.00,-.42,{bottom:.75});
      c(.18,.26,.5,'armor',0,3.04,.52,{top:.4,bottom:1,sweep:.3});
    },
    // 肩：後ろへ流れる細い羽根
    shoulder(a,p,sd,O){const bone='arm'+(sd<0?'L':'R');
      a(.45,.36,1.06,'armor',sd*1.41,2.99,.18,bone,{top:.85,bottom:.5,sweep:.30},sd*-.20);
      a(.12,.30,.5,'trim',sd*1.60,2.90,.34,bone,{top:.4,bottom:1,sweep:.2},sd*-.2);
    },
  },
};
if(typeof module!=='undefined')module.exports=BODY_SHAPES;else window.BODY_SHAPES=BODY_SHAPES;
})();
