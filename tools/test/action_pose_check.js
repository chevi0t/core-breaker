// 肩当て0.8秒＋硬直0.3秒。見た目と同じ骨格を使う被弾形状も確認する。
const path=require('node:path');
const {check}=require('./lib');
check('タックルの肩当て',async({page,ev,ok,sortie,out})=>{
  await sortie('dock',{render:true});
  await ev(()=>{
    const g=__g,p=g.player;
    for(const u of g.units)if(u!==p){u.alive=false;u.group.visible=false;u.pos.set(10000,0,10000);}
    g.obstacles.length=0;g.obstacles.push({minX:-150,maxX:150,minZ:-150,maxZ:150,top:200});g.waters.length=0;
    p.mech={...g.MECH_DEFAULT};g.equip(p,'assault');g.spawn(p);g.resetLifeState(p);
    Object.assign(p,{alive:true,onGround:true,actionId:'tackle',yaw:0,pitch:0,invulT:0});p.pos.set(0,200,20);p.vel.set(0,0,0);
    g.running=false;
    window.__poseRender=()=>{
      p.group.position.copy(p.pos);p.group.rotation.set(0,p.yaw,0);g.weaponLook(p,1/120);g.scene.updateMatrixWorld(true);
      g.camera.position.set(7,204,12);g.camera.lookAt(0,202,19.5);g.renderer.render(g.scene,g.camera);
    };
    window.__poseTick=t=>{for(let x=0;x<t-1e-9;){const dt=Math.min(1/120,t-x);g.physics(p,g.STOP,false,false,dt);__poseRender();x+=dt;}};
    __poseRender();window.__neutralShoulder=p.rig.bones.armR.node.getWorldPosition(new g.T.Vector3()).z-p.pos.z;
  });
  await page.screenshot({path:path.join(out,'tackle-neutral.png')});
  ok(await ev(()=>__g.actionMoveStart(__g.player)),'タックルを開始');
  await ev(()=>__poseTick(.18));
  ok(await ev(()=>{
    const g=__g,p=g.player,b=p.rig.bones;
    return b.armR.node.getWorldPosition(new g.T.Vector3()).z-p.pos.z<__neutralShoulder-.3&&b.chest.node.rotation.x<-.3&&b.chest.node.rotation.y>.5;
  }),'右肩が前へ出て、胴を前傾・ひねりする');
  await page.screenshot({path:path.join(out,'tackle-shoulder.png')});
  await ev(()=>__poseTick(.61));
  ok(await ev(()=>!!__g.player.actionMove&&Math.abs(__g.player.actionMove.elapsed-.79)<.001),'0.79秒では突撃モーションが続く');
  await ev(()=>__poseTick(.01));
  ok(await ev(()=>!__g.player.actionMove&&Math.abs(__g.player.actionRecoverT-.3)<.001&&Math.abs(__g.player.pos.z-19)<.001),'0.8秒で1mの踏み込みが終わり、硬直0.3秒へ移る');
  await ev(()=>__poseTick(.15));
  ok(await ev(()=>Math.abs(__g.player.rig.bones.chest.node.rotation.y-.325)<.03),'硬直中に肩を滑らかに元へ戻す');
  await page.screenshot({path:path.join(out,'tackle-recovery.png')});
  await ev(()=>__poseTick(.15));
  ok(await ev(()=>__g.player.actionRecoverT<1e-8&&Math.abs(__g.player.rig.bones.chest.node.rotation.y)<.001),'合計1.1秒で通常姿勢へ戻る');
  ok(await ev(()=>{
    const p=__g.player;
    for(const mesh of p.group.children.filter(m=>m.userData.armorSlot)){
      for(const v of mesh.geometry.attributes.position.array)if(!Number.isFinite(v))return false;
      if(mesh.userData.hitGeometry)for(const v of mesh.userData.hitGeometry.attributes.position.array)if(!Number.isFinite(v))return false;
    }return true;
  }),'描画用・被弾用の頂点に無効値がない');
});
