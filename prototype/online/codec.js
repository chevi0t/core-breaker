/* 状態写真の通信形式。各差分は直前の写真でなく、確認可能な共通基準から復元する。 */
(function(root){
  'use strict';
  const VERSION=2;
  const clone=x=>JSON.parse(JSON.stringify(x));
  const forbidden=new Set(['__proto__','prototype','constructor']);
  function validValue(v,depth=0){
    if(depth>32||v===undefined)return false;
    if(v===null||typeof v==='string'||typeof v==='boolean')return true;
    if(typeof v==='number')return Number.isFinite(v);
    return typeof v==='object'&&Object.entries(v).every(([k,x])=>!forbidden.has(k)&&validValue(x,depth+1));
  }
  function validSchema(schema){
    if(!Array.isArray(schema)||schema.length>20000)return false;
    const seen=new Set();
    return schema.every(e=>{
      if(!Array.isArray(e)||e.length!==2)return false;
      const [path,type]=e;
      if(!Array.isArray(path)||!path.length||path.length>32||typeof path[0]!=='string'||![100,1000,'s','b','j'].includes(type))return false;
      if(!path.every(k=>typeof k==='string'?!forbidden.has(k):Number.isSafeInteger(k)&&k>=0&&k<20000))return false;
      const key=JSON.stringify(path);if(seen.has(key))return false;seen.add(key);return true;
    });
  }
  function typedValue(type,value){
    if(typeof type==='number')return Number.isSafeInteger(value)&&Math.abs(value)<=Math.floor(Number.MAX_SAFE_INTEGER/2);
    if(type==='b')return value===0||value===1;
    if(type==='s')return typeof value==='string';
    return type==='j'&&validValue(value);
  }
  const atoms=new Set(['shells','spotted','spotSrc','swing','transfer','equipmentObjects']);
  const facilities=new Set(['plants','turrets','radars','barricades']);
  const facilityNumbers=new Set(['gauge','hp','yaw','revive','headYaw']);
  const facilityFlags=new Set(['alive','contested']);
  function rounded(x){
    if(typeof x==='number')return Math.round(x*1000)/1000;
    if(Array.isArray(x))return x.map(v=>v===undefined?null:rounded(v));
    if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).filter(([,v])=>v!==undefined).map(([k,v])=>[k,rounded(v)]));
    return x;
  }
  // 固定機体はnullableな各項目だけを原子化し、機体全体・装備全体は差分の単位にしない。
  // これによりnull/値・可視/不可視の切替だけではschemaを作り直さない。
  const fixedUnitScalars=new Set(['fixedUnit','id','hidden','visibilityEpoch','team','idx','cls','controller',
    'motionEpoch','lagEpoch','renderCrouch','predictionBlocked','jumpPadIndex','zipLine']);
  const fixedUnitContainers=new Set(['pos','vel','motionVectors','slots']);
  const fixedUnitVisibility=new Set(['id','fixedUnit','hidden','visibilityEpoch']);
  function fixedUnitAtom(path){
    return path.length===3&&!fixedUnitScalars.has(path[2])&&!fixedUnitContainers.has(path[2])||
      path.length===4&&path[2]==='motionVectors'||path.length===5&&path[2]==='slots'&&path[4]!=='key';
  }
  function flatten(value,path=[],out=[],fixedUnit=false){
    if(value===undefined)return out; // オブジェクトの未定義値はJSON同様に省略。配列では呼出元がnull化。
    const key=path[path.length-1],parent=path[path.length-2];
    if(path.length===2&&path[0]==='units'&&value?.fixedUnit===true)fixedUnit=true;
    if(fixedUnit&&fixedUnitAtom(path)){
      const v=typeof value==='number'&&['yaw','pitch','downYaw'].includes(key)?Math.atan2(Math.sin(value),Math.cos(value)):value;
      out.push([path,'j',rounded(v)]);return out;
    }
    // 固定施設は一覧でなく項目ごとの差分。owner/capturing等のnull切替もschemaを保つ。
    if(path.length===3&&facilities.has(path[0])&&!facilityNumbers.has(key)&&!facilityFlags.has(key)){out.push([path,'j',rounded(value)]);return out;}
    // 設置物は固定スロットのtupleごとに置換し、空/秘匿/公開で長さが変わっても道筋を保つ。
    if(path.length===2&&path[0]==='gadgets'){out.push([path,'j',rounded(value)]);return out;}
    // hostが実適用した可変dt/累積dtは丸めずIEEE値をJSON roundtripで保つ。
    if(key==='inputAcks'){out.push([path,'j',clone(value)]);return out;}
    if(atoms.has(key)||value===null||(typeof value==='object'&&Object.keys(value).filter(k=>value[k]!==undefined).length===0)){out.push([path,'j',rounded(value)]);return out;}
    if(typeof value==='object'){
      for(const k of Object.keys(value).sort((a,b)=>Array.isArray(value)?Number(a)-Number(b):a.localeCompare(b)))flatten(Array.isArray(value)&&value[k]===undefined?null:value[k],path.concat(Array.isArray(value)?Number(k):k),out,fixedUnit);
      return out;
    }
    let type='s',v=value;
    if(typeof value==='number'){
      type=(parent==='pos'||parent==='vel')?100:1000;
      const n=!facilities.has(path[0])&&['yaw','pitch','downYaw'].includes(key)?Math.atan2(Math.sin(value),Math.cos(value)):value;v=Math.round(n*type);
    }else if(typeof value==='boolean'){type='b';v=value?1:0;}
    out.push([path,type,v]);return out;
  }
  function inflate(schema,values){
    const result={};
    schema.forEach(([path,type],i)=>{
      let o=result;for(let j=0;j<path.length-1;j++){const k=path[j];if(!Object.hasOwn(o,k))o[k]=typeof path[j+1]==='number'?[]:{};o=o[k];}
      const v=values[i];o[path[path.length-1]]=typeof type==='number'?v/type:type==='b'?!!v:typeof v==='object'&&v!==null?clone(v):v;
    });return result;
  }
  // hiddenだけで非公開枠を消去する。直前のhideが欠落しても共通基準の可視値を復活させない。
  // game側の中立テンプレートと同じ値をschemaから作り、現在の秘密値は参照しない。
  function neutralHiddenValues(schema,values){
    const hidden=new Set(),fixed=new Set();
    schema.forEach(([path],i)=>{if(path.length!==3||path[0]!=='units'||values[i]!==1)return;if(path[2]==='hidden')hidden.add(path[1]);if(path[2]==='fixedUnit')fixed.add(path[1]);});
    for(const i of hidden)if(!fixed.has(i))hidden.delete(i);
    if(!hidden.size)return values;
    schema.forEach(([path,type],i)=>{
      if(path[0]!=='units'||!hidden.has(path[1])||path.length===3&&fixedUnitVisibility.has(path[2]))return;
      values[i]=typeof type==='number'?(path.length===3&&['jumpPadIndex','zipLine'].includes(path[2])?-type:0):type==='s'?'':type==='b'?0:null;
    });return values;
  }
  const utf8=new TextEncoder(),text=new TextDecoder();
  const to64=bytes=>{if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.slice(i,i+32768));return btoa(text);};
  const from64=s=>typeof Buffer!=='undefined'?new Uint8Array(Buffer.from(s,'base64')):Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  function packChanges(changes,schema){
    const bytes=[],put=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('状態写真の整数範囲外');while(n>=128){bytes.push(n%128+128);n=Math.floor(n/128);}bytes.push(n);};
    let prev=-1;
    for(const [i,v] of changes){put(i-prev-1);prev=i;const type=schema[i][1];
      if(typeof type==='number')put(v<0?-v*2-1:v*2);
      else if(type==='b')put(v);
      else{const data=utf8.encode(JSON.stringify(v));put(data.length);for(const b of data)bytes.push(b);}
    }return to64(bytes);
  }
  function unpackChanges(encoded,schema){
    const bytes=from64(encoded);let at=0,index=-1;const changes=[];
    const get=()=>{let n=0,mul=1,count=0;while(true){if(at>=bytes.length||++count>8)throw Error('不正な状態写真');const b=bytes[at++];n+=(b&127)*mul;if(!Number.isSafeInteger(n))throw Error('状態写真の整数範囲外');if(b<128)return n;mul*=128;}};
    while(at<bytes.length){index+=get()+1;if(index>=schema.length)throw Error('状態写真の項目範囲外');const type=schema[index][1];let v;
      if(typeof type==='number'){const n=get();v=n%2?-(n+1)/2:n/2;}
      else if(type==='b'){v=get();if(v>1)throw Error('不正な状態フラグ');}
      else{const length=get();if(at+length>bytes.length)throw Error('状態写真の長さ不足');v=JSON.parse(text.decode(bytes.subarray(at,at+length)));at+=length;}
      changes.push([index,v]);
    }return changes;
  }
  class Encoder{
    constructor(){this.id=0;this.base=null;this.created=0;}
    willRebase(snapshot,{forceBaseline=false}={}){
      return !this.base||forceBaseline||snapshot.time-this.created>=10000||
        JSON.stringify(flatten(snapshot).map(([p,t])=>[p,t]))!==this.signature;
    }
    encode(snapshot,{forceBaseline=false,includePath}={}){
      const entries=flatten(snapshot),schema=entries.map(([p,t])=>[p,t]),values=entries.map(e=>e[2]);
      if(!validSchema(schema)||!values.every(v=>validValue(v)))throw Error('不正な状態写真');
      const signature=JSON.stringify(schema);let baseline=null;
      // 基準も写真専用線に載せる。欠落は再同期で復旧し、静的変更もここで反映する。
      // 完全再同期はforceBaselineを使う。固定スロットの可視切替は通常の差分で扱う。
      if(!this.base||forceBaseline||signature!==this.signature||snapshot.time-this.created>=10000){
        this.signature=signature;this.created=snapshot.time;
        const old=this.base;
        this.base={v:VERSION,id:++this.id,s:schema,d:clone(values)};
        if(old&&!forceBaseline){
          // 定期更新でも不変の名前・装備は繰り返さない。項目増減時も同じ道筋の値を再利用。
          const same=JSON.stringify(old.s)===signature,lookup=new Map(old.s.map((p,i)=>[JSON.stringify(p),old.d[i]]));
          const patch=[];
          for(let i=0;i<values.length;i++){
            const path=schema[i][0],u=path[0]==='units'?snapshot.units?.[path[1]]:null;
            if(u?.fixedUnit&&u.hidden&&!(path.length===3&&fixedUnitVisibility.has(path[2])))continue;
            const previous=same?old.d[i]:lookup.get(JSON.stringify(schema[i]));
            if(JSON.stringify(values[i])!==JSON.stringify(previous))patch.push(i,values[i]);
          }
          baseline={v:VERSION,id:this.base.id,parent:old.id,p:patch};if(!same)baseline.s=schema;
        }else baseline=clone(this.base);
      }
      const changes=[];
      // 間引く機体は基準値との差を繰り返し送らない。復元後の古い基準値を現在値へ
      // 適用しない責任はunitUpdatesを扱うゲーム側にある。基準作成時は全項目を更新する。
      // 不可視機体は識別子・hidden・epochだけ送る。受信時に基準由来の全非公開値を中立化する。
      for(let i=0;i<values.length;i++){
        const path=schema[i][0],fixed=path[0]==='units'&&snapshot.units?.[path[1]]?.fixedUnit===true;
        // 可視に戻った後の間引きでも、不可視だった基準のフラグ・epochへ戻さない。
        const required=fixed&&path.length===3&&fixedUnitVisibility.has(path[2]);
        if(fixed&&snapshot.units[path[1]].hidden&&!required)continue;
        if((required||!includePath||includePath(path))&&JSON.stringify(values[i])!==JSON.stringify(this.base.d[i]))changes.push([i,values[i]]);
      }
      return {baseline,delta:[VERSION,this.base.id,packChanges(changes,schema)]};
    }
    currentBase(){return this.base?clone(this.base):null;}
  }
  class Decoder{
    constructor(){this.bases=new Map();}
    seed(base){
      if(!base||base.v!==VERSION||!Number.isSafeInteger(base.id)||base.id<1||!validValue(base))return false;
      if(base.s!==undefined&&!validSchema(base.s))return false;
      if(base?.parent){
        const parent=this.bases.get(base.parent);if(!parent||!Array.isArray(base.p)||base.p.length%2)return false;
        const schema=base.s||parent.s,lookup=new Map(parent.s.map((p,i)=>[JSON.stringify(p),parent.d[i]]));
        const d=base.s?schema.map(p=>lookup.get(JSON.stringify(p))):parent.d.slice();
        for(let i=0;i<base.p.length;i+=2){const n=base.p[i];if(!Number.isSafeInteger(n)||n<0||n>=d.length)return false;d[n]=base.p[i+1];}
        neutralHiddenValues(schema,d);
        if(d.some(v=>v===undefined))return false;
        base={v:base.v,id:base.id,s:schema,d};
      }
      if(base?.v!==VERSION||!Number.isSafeInteger(base.id)||!Array.isArray(base.s)||!Array.isArray(base.d)||base.s.length!==base.d.length)return false;
      if(!base.d.every((v,i)=>typedValue(base.s[i][1],v)))return false;
      base={...base,d:neutralHiddenValues(base.s,base.d.slice())};
      this.bases.set(base.id,clone(base));while(this.bases.size>3)this.bases.delete(this.bases.keys().next().value);return true;
    }
    decode(delta){
      if(!Array.isArray(delta)||delta[0]!==VERSION||delta.length!==3||typeof delta[2]!=='string')return null;
      const base=this.bases.get(delta[1]);if(!base)return null;
      try{const values=base.d.slice();for(const [index,v] of unpackChanges(delta[2],base.s)){if(!typedValue(base.s[index][1],v))return null;values[index]=v;}return inflate(base.s,neutralHiddenValues(base.s,values));}catch(_){return null;}
    }
  }
  const api={Encoder,Decoder,VERSION};root.CBOnlineCodec=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
