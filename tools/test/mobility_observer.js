// 読み取り専用の0.05秒標本。射出・乗車と、高所への着地/下車を区別する。
module.exports=function observeMobility(){
  const g=__g,s=window.__mobilityObservation ||= {},events=[],round=n=>Math.round(n*100)/100;
  for(const u of g.units){
    const id=u.team+(u.idx+1),old=s[id] ||= {};
    const emit=(type,facility)=>events.push({type,facility,unit:id,team:u.team,t:round(g.MATCH-g.timeLeft),pos:u.pos.toArray().map(round)});
    if(!u.alive){s[id]={};continue;}
    const pad=g.jumpPads.indexOf(u.jumpPad),lift=g.lifts.indexOf(u.lift);
    if(pad>=0 && pad!==old.pad){old.padTrip=pad;emit('padLaunch','J'+(pad+1));}
    if(lift>=0 && lift!==old.lift){old.liftTrip={index:lift,startY:u.pos.y};emit('liftBoard','L'+(lift+1));}
    if(old.padTrip!==undefined && u.onGround && !u.flying){
      const p=g.jumpPads[old.padTrip];
      if(u.pos.y>=p.exit.y-.5 && Math.hypot(u.pos.x-p.exit.x,u.pos.z-p.exit.z)<12)emit('padLand','J'+(old.padTrip+1));
      delete old.padTrip;
    }
    if(old.liftTrip && lift<0 && u.onGround){
      const trip=old.liftTrip,l=g.lifts[trip.index];
      if(u.pos.y>=trip.startY+4.5 && g.terrainH(u.pos.x,u.pos.z)>=u.pos.y-.5)emit('liftExit','L'+(trip.index+1));
      delete old.liftTrip;
    }
    old.pad=pad;old.lift=lift;
  }
  return events;
};
