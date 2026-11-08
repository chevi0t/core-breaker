/* #214 ゲストの手持ちhitscan専用。時計の検査と、一時的な被弾形状の差替え。 */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CBOnlineLagComp=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const limits=Object.freeze({historyMs:250,rewindMs:200,maxFrames:128,extrapolationMs:100,queueMs:500});
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  // view.timeはhost写真の時刻。sentAtは時計差補正済みの送信時刻で、別の値である。
  function validateViewTime(view,{now,sentAt,receivedAt,rttMs,snapshots}={}){
    const no=reason=>({ok:false,reason});
    if(!view||!Number.isFinite(view.time)||!Number.isSafeInteger(view.frame)||view.frame<0||!Number.isFinite(view.delayMs)||view.delayMs<60||view.delayMs>200)return no('view');
    if(![now,sentAt,receivedAt,rttMs].every(Number.isFinite)||rttMs<0||rttMs>2000)return no('clock');
    const anchor=snapshots?.get(view.frame);
    if(!Number.isFinite(anchor)||anchor>receivedAt||view.time>anchor+limits.extrapolationMs)return no('anchor');
    if(view.time>receivedAt||view.time>sentAt+25||receivedAt>now||sentAt>receivedAt+25)return no('future');
    if(now-receivedAt>limits.queueMs)return no('stale-input');
    // 到着差基準の描画時計には写真の片道遅延も含まれる。受信時はRTT+補間が目安。
    // clientの申告だけで任意の過去を選べないよう、host実測RTTと有界な補間量で制限する。
    const tolerance=50,age=receivedAt-view.time;
    if(receivedAt-sentAt>500||age<Math.max(0,rttMs/2+view.delayMs-100-tolerance))return no('timing');
    // 低RTT/短い補間でも常に最大200msを選べるわけではない。host内の待ち時間は別に加算する。
    const allowedAge=Math.min(limits.rewindMs,rttMs+view.delayMs+tolerance+(now-receivedAt));
    const time=Math.max(view.time,now-allowedAge);
    return {ok:true,time,clamped:time!==view.time,ageMs:now-time,reason:null};
  }

  class ColliderHistory{
    constructor(T,{historyMs=limits.historyMs,maxFrames=limits.maxFrames,skinHit=null,refOf=null}={}){
      this.T=T;this.historyMs=historyMs;this.maxFrames=maxFrames;this.skinHit=skinHit;this.refOf=refOf;this.frames=[];this.lastRewound=0;
    }
    clear(){this.frames.length=0;this.lastRewound=0;}
    pose(matrix){const T=this.T,p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();matrix.decompose(p,q,s);return {p,q,s};}
    matrix(a,b,f){const T=this.T;return new T.Matrix4().compose(a.p.clone().lerp(b.p,f),a.q.clone().slerp(b.q,f),a.s.clone().lerp(b.s,f));}
    meshes(units,hittables){
      const by=new Map(units.map(u=>[u,[]]));
      for(const mesh of hittables){const u=this.refOf?this.refOf(mesh):mesh.userData?.ref;if(by.has(u))by.get(u).push(mesh);}
      return by;
    }
    signature(u){return JSON.stringify([u.mech,Object.entries(u.slots||{}).map(([k,s])=>[k,s.w?.key])]);}
    capture(time,units,hittables){
      if(!Number.isFinite(time)||this.frames.length&&time<this.frames.at(-1).time)return false;
      this.hittables=hittables;
      const by=this.meshes(units,hittables),entries=new Map();
      for(const u of units){
        if(!u.entityId||!u.group?.updateMatrixWorld)continue;
        u.group.updateMatrixWorld(true);
        entries.set(u.entityId,{unit:u,group:u.group,rig:u.rig,lifeId:u.lifeId,motionEpoch:u.onlineMotionEpoch||0,lagEpoch:u.onlineLagEpoch||0,
          alive:!!u.alive&&!u.downT,signature:this.signature(u),
          meshes:by.get(u).map(mesh=>({mesh,geometry:mesh.geometry,hitGeometry:mesh.userData?.hitGeometry,visible:mesh.visible,
            weaponId:mesh.userData?.weaponId,passThrough:mesh.userData?.passThrough,pose:this.pose(mesh.matrixWorld)})),
          bones:(u.rig?.list||[]).map(bone=>({bone,pose:this.pose(bone.matrix)}))});
      }
      if(this.frames.at(-1)?.time===time)this.frames.pop();this.frames.push({time,entries});
      // 最大200msより50ms長く保持する。長い停止を跨ぐ古いアンカーは残さない。
      while(this.frames.length>1&&this.frames[0].time<time-this.historyMs)this.frames.shift();
      while(this.frames.length>this.maxFrames)this.frames.shift();
      return true;
    }
    compatible(u,a,b,currentMeshes){
      if(!a||!b||!u.alive||u.downT||!a.alive||!b.alive)return false;
      const signature=this.signature(u);
      for(const v of [a,b])if(v.unit!==u||v.group!==u.group||v.rig!==u.rig||v.lifeId!==u.lifeId||v.motionEpoch!==(u.onlineMotionEpoch||0)||v.lagEpoch!==(u.onlineLagEpoch||0)||v.signature!==signature)return false;
      if(a.meshes.length!==b.meshes.length||a.bones.length!==b.bones.length)return false;
      if(currentMeshes.length!==a.meshes.length||a.meshes.some((v,i)=>currentMeshes[i]!==v.mesh))return false;
      return a.meshes.every((v,i)=>{const other=b.meshes[i],m=v.mesh;return other.mesh===m&&other.geometry===v.geometry&&other.hitGeometry===v.hitGeometry&&m.geometry===v.geometry&&m.userData?.hitGeometry===v.hitGeometry&&m.userData?.weaponId===v.weaponId&&other.weaponId===v.weaponId&&m.userData?.passThrough===v.passThrough&&other.passThrough===v.passThrough;})&&a.bones.every((v,i)=>v.bone===b.bones[i].bone);
    }
    // tryの内側で準備する。途中の例外でも、既に差し替えた全対象を元へ戻す。
    withRewind(time,units,ignore,cast,unitTimes=null){
      this.lastRewound=0;
      const frames=this.frames;
      const interval=t=>{
        if(!Number.isFinite(t)||!frames.length||t<frames[0].time||t>frames.at(-1).time)return null;
        let a=frames[0],b=a;
        for(let i=1;i<frames.length;i++){a=frames[i-1];b=frames[i];if(t<=b.time)break;}
        return {a,b,f:clamp((t-a.time)/Math.max(.000001,b.time-a.time),0,1)};
      };
      const common=interval(time);if(!common&&!unitTimes)return cast();
      const restore=[],current=this.meshes(units,this.hittables||[]);
      try{
        for(const u of units){
          if(u===ignore)continue;
          // guestへ実送信した可視機だけ。省略時は従来どおり共通時計を使う。
          const selected=unitTimes?(unitTimes.has(u.entityId)?interval(unitTimes.get(u.entityId)):null):common;
          if(!selected)continue;const {a,b,f}=selected;
          const old=a.entries.get(u.entityId),next=b.entries.get(u.entityId);if(!this.compatible(u,old,next,current.get(u)))continue;
          const saved={meshes:[],bones:[],hits:[]};restore.push(saved);
          for(let i=0;i<old.meshes.length;i++){
            const v=old.meshes[i],m=v.mesh;saved.meshes.push({m,matrix:m.matrixWorld.clone(),visible:m.visible});
            m.matrixWorld.copy(this.matrix(v.pose,next.meshes[i].pose,f));m.visible=f<1?v.visible:next.meshes[i].visible;
          }
          for(let i=0;i<old.bones.length;i++){
            const v=old.bones[i];saved.bones.push({bone:v.bone,matrix:v.bone.matrix.clone()});v.bone.matrix.copy(this.matrix(v.pose,next.bones[i].pose,f));
          }
          // lazy raycastが書き換える頂点・キャッシュも復元する。表示形状/生命状態には触れない。
          for(const entry of u.rig?.hitMeshes||[]){
            const g=entry.mesh.geometry;
            saved.hits.push({entry,g,position:g.attributes.position.array.slice(),normal:g.attributes.normal.array.slice(),box:g.boundingBox,hitBounds:entry.hitBounds?.clone(),boundGroups:entry.boundGroups,
              ranges:entry.ranges.map(r=>({r,previous:r.hitPrevious?.slice()}))});
            if(!entry.rigid&&this.skinHit)this.skinHit(entry);
          }
          this.lastRewound++;
        }
        return cast();
      }finally{
        for(let i=restore.length-1;i>=0;i--){const s=restore[i];
          for(const {m,matrix,visible}of s.meshes){m.matrixWorld.copy(matrix);m.visible=visible;}
          for(const {bone,matrix}of s.bones)bone.matrix.copy(matrix);
          for(const h of s.hits){h.g.attributes.position.array.set(h.position);h.g.attributes.normal.array.set(h.normal);h.g.boundingBox=h.box;
            if(h.hitBounds)h.entry.hitBounds.copy(h.hitBounds);else delete h.entry.hitBounds;
            if(h.boundGroups)h.entry.boundGroups=h.boundGroups;else delete h.entry.boundGroups;
            for(const {r,previous}of h.ranges){if(previous){if(r.hitPrevious)r.hitPrevious.set(previous);else r.hitPrevious=previous;}else delete r.hitPrevious;}
          }
        }
      }
    }
  }
  return {limits,validateViewTime,ColliderHistory};
});
