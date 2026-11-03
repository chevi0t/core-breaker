// 遊撃の自動銃3系統：旧版との1.8倍比較、外周への実射/破壊、砲口・狙う中心・浮上/巡航を確認。
// node tools/test/sentry_size_check.js <旧dbg> <新dbg> [結果の保存先]
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const oldDir=path.resolve(process.argv[2]),newDir=path.resolve(process.argv[3]),out=path.resolve(process.argv[4]||'dbg/sentry-size-results');
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  const pages=[],errors=[],checks=[];
  const yes=(v,s)=>{assert(v,s);checks.push(s);};
  try{
    for(const dir of [oldDir,newDir]){
      const p=await browser.newPage({viewport:{width:1280,height:720}});pages.push(p);
      p.on('pageerror',e=>errors.push(e.message));
      await p.route('https://**/*',r=>r.fulfill({body:''}));
      await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
      await p.goto(pathToFileURL(path.join(dir,'dbg.html')).href);
      await p.evaluate(()=>{
        const g=__g,T=g.T;g.selectMap('dock');document.getElementById('start').click();g.running=false;
        for(const u of g.units){u.alive=false;u.downT=0;u.frozen=true;u.pos.set(-3000,0,-3000);u.group.position.copy(u.pos);}
        for(const t of g.turrets)t.alive=false;
        const owner=g.player,enemy=g.units.find(u=>u.team!==owner.team),scene=g.scene;
        const base=new T.Vector3(2000,g.terrainH(2000,2000),2000);
        const keys=Object.keys(g.WEAPONS).filter(k=>g.WEAPONS[k].proj?.kind==='sentry'&&g.ARMORY.raid.aux.includes(k));
        const clear=()=>{for(const d of [...g.gadgets])g.removeGadget(d);for(const s of g.shells)scene.remove(s.mesh);g.shells.length=0;};
        const place=key=>{clear();const spec=g.WEAPONS[key].proj,at=base.clone().add(new T.Vector3(0,spec.airDeploy?6:0,0));g.placeGadget({owner,team:owner.team,spec,vel:new T.Vector3(0,0,-1),weaponName:g.WEAPONS[key].name},at,null);const d=g.gadgets.at(-1);d.mesh.updateMatrixWorld(true);return d;};
        const size=mesh=>new T.Box3().setFromObject(mesh).getSize(new T.Vector3()).toArray();
        window.sentryTest={g,T,owner,enemy,scene,base,keys,clear,place,size};
      });
    }
    const snapshots=[];
    for(const p of pages)snapshots.push(await p.evaluate(()=>{
      const{g,T,owner,base,keys,clear,place,size}=sentryTest,result={};
      for(const key of [...keys,'sensor','remote','mine','ammoBox']){
        const d=place(key),spec=g.WEAPONS[key].proj;d.mesh.geometry.computeBoundingBox();
        const shot=g.shoot(owner,base.clone().add(new T.Vector3(0,8,0)),new T.Vector3(0,0,-spec.speed),spec);
        result[key]={size:size(d.mesh),local:d.mesh.geometry.boundingBox.getSize(new T.Vector3()).toArray(),scale:d.mesh.scale.toArray(),lift:d.mesh.position.y-d.pos.y,shotSize:size(shot.mesh),shotScale:shot.mesh.scale.toArray()};
      }
      clear();return{keys,result,weapons:g.WEAPONS,parts:g.PARTS,armory:g.ARMORY};
    }));
    const [old,now]=snapshots;
    assert.deepEqual(now.weapons,old.weapons);assert.deepEqual(now.parts,old.parts);assert.deepEqual(now.armory,old.armory);checks.push('全武器・パーツの性能値と選択順は旧版と同一');
    assert.deepEqual(now.keys,old.keys);yes(now.keys.length>=9,'3系統の全派生型を対象にする：'+now.keys.join(','));
    for(const key of now.keys){
      const a=old.result[key],b=now.result[key];
      yes(b.size.every((n,i)=>Math.abs(n/a.size[i]-1.8)<1e-5),key+'：設置本体と被弾メッシュが縦横奥行き1.8倍');
      yes(b.shotSize.every((n,i)=>Math.abs(n/a.shotSize[i]-1.8)<1e-5),key+'：投擲中の見た目も1.8倍');
      assert.deepEqual(b.local,a.local);checks.push(key+'：手持ちにも使う形状データは維持');
      yes(Math.abs(b.lift-a.lift*1.8)<1e-5,key+'：設置オフセットを同倍率に合わせる');
    }
    for(const key of ['sensor','remote','mine','ammoBox']){assert.deepEqual(now.result[key],old.result[key]);checks.push(key+'：対象外の設置物は旧版と同一');}
    const actual=await pages[1].evaluate(old=>{
      const{g,T,owner,enemy,scene,base,keys,place,clear}=sentryTest,checks=[];
      const yes=(v,s)=>{if(!v)throw Error(s);checks.push(s);};
      const savedHits=g.hittables.slice(),up=new T.Vector3(0,1,0);
      try{
        for(const key of keys){
          const d=place(key),legacy=new T.Mesh(d.mesh.geometry,d.mesh.material);
          legacy.scale.fromArray(old.result[key].scale);legacy.position.copy(d.pos).y+=old.result[key].lift;legacy.updateMatrixWorld(true);
          const previousBox=new T.Box3().setFromObject(legacy),geometry=d.mesh.geometry,p=geometry.getAttribute('position'),idx=geometry.index,count=idx?idx.count:p.count;
          g.hittables.splice(0,g.hittables.length,d.mesh);
          let edge;
          for(let i=0;i<count&&!edge;i+=3){
            const vertex=j=>new T.Vector3().fromBufferAttribute(p,idx?idx.getX(i+j):i+j);
            const a=vertex(0),b=vertex(1),c=vertex(2),point=a.clone().add(b).add(c).multiplyScalar(1/3).applyMatrix4(d.mesh.matrixWorld);
            if(previousBox.containsPoint(point)||point.y<d.pos.y+.04)continue;
            const normal=b.sub(a).cross(c.sub(a)).normalize().transformDirection(d.mesh.matrixWorld),from=point.clone().addScaledVector(normal,2),dir=normal.negate();
            if(from.y<d.pos.y+.04)continue;
            const ray=new T.Raycaster(from,dir,0,2.01);
            if(ray.intersectObject(legacy,false).length)continue;
            const hit=g.castFrom(from,dir,enemy,2.01);
            if(hit?.ref===d)edge={from,to:point};
          }
          yes(!!edge,key+'：旧判定の外側でも新しい本体にレイが命中');
          const hp=d.hp;g.fire(enemy,edge.to,0,{dmg:37,range:2.05},edge.from);
          yes(d.hp===hp-37,key+'：拡大した外周への実射で37ダメージ');
          const target=g.targetPoint(d),from=target.clone().add(new T.Vector3(0,0,-10));
          yes(g.castFrom(from,target.clone().sub(from).normalize(),enemy,11)?.ref===d,key+'：Botが狙う本体中心にも実際に当たる');
          g.fire(enemy,edge.to,0,{dmg:d.hp+1,range:2.05},edge.from);
          yes(!d.alive&&!d.mesh.parent&&!g.gadgets.includes(d)&&!g.hittables.includes(d.mesh),key+'：実射で破壊すると表示・判定とも消える');
        }
        // 散布だけ0に固定し、拡大後の砲口から敵機まで実射が通ることを確かめる。
        for(const key of ['sentry','airTurret','flyTurret']){
          g.hittables.splice(0,g.hittables.length,...savedHits);
          const d=place(key);d.spec={...d.spec,gun:{...d.spec.gun,spread:0}};
          Object.assign(enemy,{alive:true,downT:0,hp:100000,maxHp:100000,invulT:0,barrierOn:false,cloak:false,weakT:0,stun:'',electricT:0});
          enemy.pos.set(d.pos.x,base.y,d.pos.z-6);enemy.group.position.copy(enemy.pos);enemy.group.rotation.y=0;scene.updateMatrixWorld(true);
          d.target=enemy;d.scanT=1;const hp=enemy.hp;g.sentryTick(d,.01);
          yes(enemy.hp<hp&&d.hp===d.maxHp,key+'：拡大後の銃口から撃ち、自分の本体で弾を塞がない');
          enemy.alive=false;
        }
        g.hittables.splice(0,g.hittables.length,...savedHits);
        const ground=place('sentry'),bottom=new T.Box3().setFromObject(ground.mesh).min.y;
        yes(bottom>=ground.pos.y-.01&&bottom<ground.pos.y+.06,'拡大した地上型が地面に埋まらない');
        const air=place('airTurret'),y=air.pos.y;g.gadgetUpdate(.2);
        yes(Math.abs(air.pos.y-y-1)<1e-5&&air.mesh.scale.x===1.8,'浮遊自動銃は拡大したまま従来の速度で浮上');
        const cruise=place('flyTurret'),z=cruise.pos.z;g.gadgetUpdate(.2);
        yes(Math.abs(cruise.pos.z-(z-cruise.spec.roamSpeed*.2))<1e-5,'巡航自動銃の移動速度を維持');
        g.gadgetUpdate(cruise.spec.dur+.1);yes(!cruise.alive&&!cruise.mesh.parent,'巡航自動銃の寿命と退場を維持');
        const ceiling=place('airTurret'),roof=new T.Mesh(new T.BoxGeometry(8,.2,8),new T.MeshBasicMaterial());
        roof.position.copy(ceiling.pos).y+=1;scene.add(roof);g.hittables.push(roof);roof.updateMatrixWorld(true);
        for(let i=0;i<80;i++)g.gadgetUpdate(.01);
        yes(!ceiling.riseLeft&&new T.Box3().setFromObject(ceiling.mesh).max.y<roof.position.y-.09,'拡大した上端が天井を突き抜ける前に浮上を止める');
        scene.remove(roof);g.hittables.splice(g.hittables.indexOf(roof),1);roof.geometry.dispose();roof.material.dispose();
      }finally{clear();g.hittables.splice(0,g.hittables.length,...savedHits);}
      return checks;
    },old);
    checks.push(...actual);assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({checks,errors,keys:now.keys,before:old.result,after:now.result},null,2));
    console.log(checks.join('\n'));console.log('PASS '+checks.length+' / '+now.keys.length+'型');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
