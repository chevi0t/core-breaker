// 四脚（ドーザー）と逆脚（ホッパー）の形（#227 の仕上げ。オーナーが選んだ 四脚B案・逆脚A案 から作り込んだ物）。
// ゲーム本体にはまだ入れていない。#228 で buildMech に移すときの元になる。公式や他作品の素材は使っていない。
// 使い方：LEG_SHAPES.quad(add, T, pose) / LEG_SHAPES.reverse(add, T, pose)
//   add(geometry, 色の名前)：色は 'armor'・'frame'・'metal'・'trim'。座標は機体の基準姿勢（腰の骨の基準 y=1.85、前は −z）。
//   pose：{ name:'stand'|'walk'|'crouch'|'jump', drop: 腰が下がる量（しゃがみは 0.6） }。足先は地面（y = drop）に置く。
// 脚は関節の位置（腰の付け根 → 膝 → 足首）から箱を張るので、姿勢を変えても同じ部品で組める。膝の位置は2節の IK で決める。
(function(){
const kit=(add,T)=>{
  const V=(x,y,z)=>new T.Vector3(x,y,z),lerp=(a,b,t)=>a.clone().lerp(b,t);
  // a→b に沿った箱。fwd は箱の奥行き（z）を向けたい方向。taper は b 側の太さの倍率
  const basis=(a,b,fwd)=>{const y=b.clone().sub(a).normalize(),x=new T.Vector3().crossVectors(y,fwd);if(x.lengthSq()<1e-6)x.set(1,0,0);x.normalize();const z=new T.Vector3().crossVectors(x,y);return{x,y,z};};
  const seg=(a,b,w,d,c,fwd,o={})=>{const B=basis(a,b,fwd),len=a.distanceTo(b),geo=new T.BoxGeometry(w,len,d);
    if(o.taper){const p=geo.attributes.position;for(let i=0;i<p.count;i++)if(p.getY(i)>0){p.setX(i,p.getX(i)*o.taper);p.setZ(i,p.getZ(i)*o.taper);}geo.computeVertexNormals();}
    const m=new T.Matrix4().makeBasis(B.x,B.y,B.z).setPosition(lerp(a,b,.5).addScaledVector(B.z,o.out||0).addScaledVector(B.x,o.side||0));geo.applyMatrix4(m);add(geo,c);};
  const box=(w,h,d,p,c,yaw=0,pitch=0)=>{const geo=new T.BoxGeometry(w,h,d);geo.rotateX(pitch);geo.rotateY(yaw);geo.translate(p.x,p.y,p.z);add(geo,c);};
  const cyl=(r,len,p,c,axis='x',yaw=0,n=6,r2=r)=>{const geo=new T.CylinderGeometry(r2,r,len,n);if(axis==='x')geo.rotateZ(Math.PI/2);if(axis==='z')geo.rotateX(Math.PI/2);geo.rotateY(yaw);geo.translate(p.x,p.y,p.z);add(geo,c);};
  // 足：足首 a を原点に組み、つま先の上げ下げ（pitch）と向き（yaw）を付けて置く
  const foot=(a,yaw,pitch,parts)=>{for(const [w,h,d,x,y,z,c,px=0] of parts){const geo=new T.BoxGeometry(w,h,d);geo.rotateX(px);geo.translate(x,y,z);geo.rotateX(pitch);geo.rotateY(yaw);geo.translate(a.x,a.y,a.z);add(geo,c);}};
  // 2節の IK：付け根 h、足首 a、腿 L1、脛 L2、膝を張り出す向き pole
  const knee=(h,a,L1,L2,pole)=>{const d=a.clone().sub(h),D=Math.min(d.length(),L1+L2-.02),u=d.clone().normalize(),x=(L1*L1-L2*L2+D*D)/(2*D),y=Math.sqrt(Math.max(0,L1*L1-x*x));
    const p=pole.clone().addScaledVector(u,-pole.dot(u)).normalize();return h.clone().addScaledVector(u,x).addScaledVector(p,y);};
  return {V,lerp,seg,box,cyl,foot,knee};
};
const LEG_SHAPES={
  // ---- 四脚（重機型）：低い胴から、外へ張った腿と太い柱の脛 ----
  quad(add,T,pose={}){
    const {V,lerp,seg,box,cyl,foot,knee}=kit(add,T),name=pose.name||'stand',drop=pose.drop||0;
    // 胴（腰の下の台）：芯、上の装甲板、前の張り出し、後ろの短い箱、下の旋回台
    box(1.16,.44,1.24,V(0,1.5,0),'frame');box(1.42,.18,1.0,V(0,1.76,0),'armor');box(1.2,.1,.8,V(0,1.88,0),'armor');
    box(.96,.34,.3,V(0,1.5,-.74),'armor',0,-.25);box(.7,.07,.3,V(0,1.6,-.79),'trim',0,-.25);
    box(.9,.3,.24,V(0,1.52,.7),'armor',0,.25);box(.6,.18,.1,V(0,1.5,.84),'metal');
    for(const sx of[-1,1]){box(.16,.3,.9,V(sx*.66,1.52,0),'armor');}
    cyl(.46,.24,V(0,1.18,0),'metal','y',0,6,.3);
    const L1=.82,L2=1.16;
    for(const sx of[-1,1])for(const sz of[-1,1]){
      const yaw=Math.atan2(sx*.56,sz*.52),out=V(Math.sin(yaw),0,Math.cos(yaw)),h=V(sx*.62,1.5,sz*.52),diag=sx*sz>0;
      let a;
      if(name==='crouch')a=V(sx*1.32,drop+.32,sz*1.3);                              // 踏ん張り：足を外へ広げ、胴を落とす
      else if(name==='walk')a=diag?V(sx*1.04,drop+.64,sz*1.04-.42):V(sx*1.04,drop+.32,sz*1.04+.22); // 対角の2本を上げて前へ
      else if(name==='jump')a=V(sx*.96,.62,sz*.94);                                // 空中：脚を畳む
      else a=V(sx*1.04,drop+.32,sz*1.04);
      const k=knee(h,a,L1,L2,V(out.x*.5,1,out.z*.5)),pitch=name==='jump'?.25*(sz<0?-1:1):name==='walk'&&diag?-.12:0;
      // 付け根
      cyl(.26,.34,h.clone().addScaledVector(out,.06),'metal','x',yaw+Math.PI/2);
      // 腿：フレームと、上に被せる装甲板
      const dn=V(0,-1,0);seg(h,k,.34,.36,'frame',dn);seg(lerp(h,k,.08),lerp(h,k,1.02),.56,.2,'armor',dn,{out:-.2,taper:.9});seg(lerp(h,k,.3),lerp(h,k,.42),.6,.22,'trim',dn,{out:-.21});
      
      // 膝
      cyl(.3,.72,k,'metal','x',yaw);
      // 脛：芯、太い装甲の柱、帯、外側の当て板
      seg(k,a,.3,.3,'frame',out);seg(lerp(k,a,.16),lerp(k,a,.94),.6,.6,'armor',out,{taper:1.12});seg(lerp(k,a,.3),lerp(k,a,.4),.66,.66,'trim',out);
      seg(lerp(k,a,.42),lerp(k,a,.9),.46,.14,'metal',out,{out:.36});
      // 油圧の棒（胴の下から脛へ）
      seg(h.clone().add(V(0,-.24,0)),lerp(k,a,.3),.1,.1,'metal',out);
      // 足：足首、広い底板、前の爪、後ろの踵
      foot(a,yaw,pitch,[[.7,.16,.76,0,-.22,0,'metal'],[.5,.16,.5,0,-.08,0,'frame'],[.52,.18,.28,0,-.17,.45,'armor',-.35],[.46,.14,.2,0,-.2,-.42,'frame',.3]]);
    }
  },
  // ---- 逆脚（2節）：太い腿が後ろへ曲がり、細い脛が前へ戻る。長いつま先と踵の爪 ----
  reverse(add,T,pose={}){
    const {V,lerp,seg,box,cyl,foot,knee}=kit(add,T),name=pose.name||'stand',drop=pose.drop||0,fwd=V(0,0,-1),L1=1.0,L2=1.14;
    // 腰の下の小さな台（左右の付け根をつなぐ）
    box(.9,.26,.5,V(0,1.72,.04),'frame');box(.5,.2,.2,V(0,1.7,-.26),'armor',0,-.2);box(.36,.05,.2,V(0,1.76,-.29),'trim',0,-.2);
    [-1,1].forEach((sx,i)=>{
      const h=V(sx*.6,1.8,.02);let a,pitch=0;
      if(name==='crouch')a=V(sx*.64,drop+.3,-.02);                                         // 溜め：深く畳む
      else if(name==='walk'){a=i?V(sx*.64,drop+.3,.42):V(sx*.64,drop+.54,-.5);pitch=i?.0:-.2;} // 片脚を上げて前へ
      else if(name==='jump'){a=V(sx*.64,-.12,.5);pitch=.75;}                                 // 踏み切り：脚を伸ばし、つま先を下げる
      else a=V(sx*.64,drop+.3,-.08);
      const k=knee(h,a,L1,L2,V(0,name==='crouch'?.0:-.1,1));
      // 付け根
      cyl(.25,.5,h,'metal');
      // 腿：フレーム、付け根側が太い装甲、帯、後ろの推進器のような箱
      seg(h,k,.34,.4,'frame',fwd);seg(lerp(h,k,-.06),lerp(h,k,.5),.6,.66,'armor',fwd,{taper:.92});seg(lerp(h,k,.46),lerp(h,k,.86),.52,.54,'armor',fwd,{taper:.86});
      seg(lerp(h,k,.3),lerp(h,k,.4),.64,.7,'trim',fwd);
      seg(lerp(h,k,.2),lerp(h,k,.62),.3,.2,'metal',fwd,{out:-.4});
      // 膝（後ろ向き）：軸と、後ろへ出る膝当て
      cyl(.26,.62,k,'metal');seg(lerp(h,k,.86),lerp(k,a,.16),.4,.16,'armor',fwd,{out:-.26});
      // 脛：細い芯、前の装甲板、帯
      seg(k,a,.22,.26,'frame',fwd);seg(lerp(k,a,.14),lerp(k,a,.8),.36,.14,'armor',fwd,{out:.18,taper:.8});seg(lerp(k,a,.34),lerp(k,a,.42),.4,.16,'trim',fwd,{out:.19});
      
      // 油圧の棒（腿の後ろから脛へ）
      seg(lerp(h,k,.5).add(V(0,-.1,.0)),lerp(k,a,.5),.09,.09,'metal',fwd,{out:-.02});
      // 足：足首、長いつま先、先の2本の爪、踵の爪
      cyl(.17,.46,a,'metal');
      foot(a,0,pitch,[[.4,.12,1.0,0,-.2,-.42,'metal'],[.32,.12,.44,0,-.1,-.5,'armor',-.2],[.24,.05,.2,0,-.05,-.36,'trim',-.2],[.15,.1,.24,-.13,-.2,-1.0,'frame'],[.15,.1,.24,.13,-.2,-1.0,'frame'],[.2,.12,.5,0,-.15,.3,'frame',.35]]);
    });
  },
};
if(typeof module!=='undefined')module.exports=LEG_SHAPES;else window.LEG_SHAPES=LEG_SHAPES;
})();
