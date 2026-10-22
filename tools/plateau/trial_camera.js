// 肩越し視点の起点とカメラの幅を、同じ街並みの当たり判定に収める。
function createCityCamera(T, solids, terrainH, ceilingAt, free) {
  const ray=new T.Raycaster(),up=new T.Vector3(0,1,0);
  let state=null;
  function solve(u,camera,dir,dt) {
    const nearH=camera.near*Math.tan(camera.fov*Math.PI/360);
    const radius=Math.max(.38,Math.hypot(nearH,nearH*camera.aspect)+.15);
    const anchor=u.pos.clone();
    anchor.y=Math.min(u.pos.y+4.6,ceilingAt(u.pos.x,u.pos.z,u.pos.y)-radius-.12);
    anchor.y=Math.max(anchor.y,terrainH(u.pos.x,u.pos.z)+radius+.12);
    const bounds=new T.Box3(anchor.clone().addScalar(-12),anchor.clone().addScalar(12));
    const nearby=solids.filter(m=>bounds.intersectsBox(m.geometry.boundingBox));
    const probes=[[0,0],[1,0],[-1,0],[0,1],[0,-1],[.707,.707],[.707,-.707],[-.707,.707],[-.707,-.707]];
    function sweep(from,direction,length) {
      const side=new T.Vector3().crossVectors(direction,up);
      if(side.lengthSq()<.001)side.set(1,0,0);else side.normalize();
      const vertical=new T.Vector3().crossVectors(side,direction).normalize();
      let safe=length;
      for(const [x,y] of probes){
        const origin=from.clone().addScaledVector(side,x*radius).addScaledVector(vertical,y*radius);
        ray.set(origin,direction);ray.far=length+radius;
        const hit=ray.intersectObjects(nearby,false)[0];
        if(hit)safe=Math.min(safe,Math.max(0,hit.distance-radius));
      }
      // 面の角や、複数の壁に挟まれる場所でも画面端を壁の外へ出さない。
      while(safe>0&&!free(from.clone().addScaledVector(direction,safe),radius))safe=Math.max(0,safe-.12);
      return safe;
    }
    const right=new T.Vector3(Math.cos(u.yaw),0,-Math.sin(u.yaw));
    const sideSpace=sweep(anchor,right,2.2);
    // 狭い路地では壁際に肩を寄せ続けず、機体の中心から見る。
    const sideLimit=sideSpace<1.8?0:sideSpace;
    if(!state||state.unit!==u||state.life!==u.lifeId)state={unit:u,life:u.lifeId,side:sideLimit,distance:8};
    const release=1-Math.exp(-8*Math.min(.1,dt));
    state.side=sideLimit<state.side?sideLimit:state.side+(sideLimit-state.side)*release;
    const pivot=anchor.clone().addScaledVector(right,state.side),back=dir.clone().negate();
    const distanceLimit=sweep(pivot,back,8);
    state.distance=distanceLimit<state.distance?distanceLimit:state.distance+(distanceLimit-state.distance)*release;
    const desired=pivot.clone().addScaledVector(back,state.distance),offset=desired.sub(anchor),length=offset.length();
    offset.normalize();
    const visibilityLimit=sweep(anchor,offset,length);
    if(state.visibility===undefined)state.visibility=length;
    state.visibility=visibilityLimit<state.visibility?visibilityLimit:state.visibility+(visibilityLimit-state.visibility)*release;
    const position=anchor.clone().addScaledVector(offset,state.visibility);
    state.radius=radius;state.sideLimit=sideLimit;state.distanceLimit=distanceLimit;
    state.occluded=state.side<2.19||state.distance<7.99||state.visibility<length-.01;
    return {position,target:pivot.clone().addScaledVector(dir,50)};
  }
  function tooClose(u,camera){
    return !!u?.alive&&camera.position.y<u.pos.y+5.4&&Math.hypot(camera.position.x-u.pos.x,camera.position.z-u.pos.z)<2;
  }
  return {solve,tooClose,get state(){return state;}};
}
