/* #214 ゲストごとの公開範囲。描画や優先度で秘匿の判定を迂回しない。 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CBOnlineVisibility=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const limits=Object.freeze({near:80,far:160,unitCount:20,extrapolationMs:100});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  function facing(observer,at){
    const dx=at.x-observer.pos.x,dy=at.y-observer.pos.y-3,dz=at.z-observer.pos.z,n=Math.hypot(dx,dy,dz);
    if(n<.001)return 1;
    const pitch=observer.pitch||0,cp=Math.cos(pitch),yaw=observer.yaw||0;
    return (-Math.sin(yaw)*cp*dx+Math.sin(pitch)*dy-Math.cos(yaw)*cp*dz)/n;
  }
  function createView({viewer,units,spotted,noticed,canSee,targetPoint,lineOfSight,locksPlayer}={}){
    const visible=new Set(),cadence=new Map(),allies=units.filter(u=>u.alive&&u.team===viewer.team);
    const seen=spotted?.[viewer.team]||new Map(),near=limits.near;
    const scope=viewer.scoped?Math.max(1,viewer.slots?.[viewer.weapon]?.w?.scopeHigh&&viewer.scopeStep===2?viewer.slots[viewer.weapon].w.scopeHigh:viewer.slots?.[viewer.weapon]?.w?.scope||1):1;
    // 設定上限の縦100度・32:9画面の外接円をhost固定上限とする。clientの画角申告は信用しない。
    const directCos=Math.cos(Math.atan(Math.tan(50/scope*Math.PI/180)*Math.hypot(32/9,1))),aimCos=Math.cos(12*Math.PI/180);
    // 同じ公開判定内だけで共有する。次のcreateViewでは位置・遮蔽を必ず取り直す。
    const points=new Map(),sight=new Map();
    function point(e){
      if(!points.has(e))points.set(e,targetPoint(e));
      return points.get(e);
    }
    function hasSight(e){
      if(!sight.has(e))sight.set(e,!!canSee(viewer,e,point(e)));
      return sight.get(e);
    }
    const direct=e=>facing(viewer,point(e))>=directCos&&hasSight(e);
    for(const e of units){
      const d=distance(viewer.pos,e.pos),friend=e.team===viewer.team;
      const cloakKnown=!e.cloak||allies.some(a=>noticed(e,distance(a.pos,e.pos)));
      const allowed=friend||cloakKnown&&(e.cloak||d<=near||seen.has(e)||direct(e));
      if(!allowed)continue;
      visible.add(e.entityId);
      const threat=e.target===viewer||e.controlTarget===viewer||locksPlayer?.(e,viewer);
      const locked=viewer.controlTarget===e;
      // 公開可否を決めた後で、射線に関係なく毎回更新する機体を先に選ぶ。
      if(e===viewer||d<=near||threat||locked){
        cadence.set(e.entityId,1);
        continue;
      }
      const aimed=facing(viewer,point(e))>=aimCos&&hasSight(e);
      cadence.set(e.entityId,aimed||viewer.scoped&&direct(e)?1:d<=limits.far?2:4);
    }
    const pointVisible=at=>!!at&&(distance(viewer.pos,at)<=near||facing(viewer,at)>=directCos)&&!!lineOfSight(viewer,at);
    const gadgetVisible=g=>g.team===viewer.team||allies.some(a=>distance(a.pos,g.pos)<=(g.onCore?60:({mine:30,remote:30,sensor:50,sentry:60,decoy:80,repairPost:60,ammo:50}[g.kind]||0))&&lineOfSight(a,g.mesh?targetPoint(g):g.pos,g));
    const sourceVisible=e=>!e||e.entityId?(!e||visible.has(e.entityId)):e.gadget?gadgetVisible(e):e.kind==='turret'||e.kind==='radar'||e.kind==='core'||e.kind==='barricade'?true:pointVisible(e.pos);
    return {viewer,visible,cadence,pointVisible,gadgetVisible,sourceVisible};
  }
  // 入力の最新5件へ重ねても8KiBに収まる短いtuple。座標・clientの命中申告は含めない。
  function copyView(view){
    if(!view||!Number.isFinite(view.time)||!Number.isSafeInteger(view.frame)||view.frame<0||!Number.isFinite(view.delayMs))return null;
    const result={time:view.time,frame:view.frame,delayMs:view.delayMs};
    if(view.units!==undefined){
      if(!Array.isArray(view.units)||view.units.length>limits.unitCount)return null;
      const ids=new Set();result.units=[];
      for(const row of view.units){
        if(!Array.isArray(row)||row.length!==5||!Number.isSafeInteger(row[0])||row[0]<0||row[0]>=20||ids.has(row[0])||
           !Number.isSafeInteger(row[1])||row[1]<0||!Number.isSafeInteger(row[2])||row[2]<row[1]||!Number.isFinite(row[3])||
           !Number.isSafeInteger(row[4])||row[4]<1)return null;
        ids.add(row[0]);result.units.push(row.slice());
      }
    }
    return result;
  }
  const unitNumber=id=>typeof id==='string'&&/^[BR]:[0-9]$/.test(id)?Number(id.slice(2))+(id[0]==='R'?10:0):-1;
  const unitId=n=>(n>=10?'R:':'B:')+(n%10);
  return {limits,createView,copyView,unitNumber,unitId};
});
