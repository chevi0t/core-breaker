"""半縮尺都市の観覧車を、描画と三角形接触で共用する簡略形状へ展開する。

既存prototypeは編集しない。試遊HTMLの生成時と形状の計測時に同じパッチを使う。
"""

MODEL_INFO = {
    'kind': '静止した輪・スポーク・支持脚・ゴンドラ',
    'renderLayer': 'ferris',
    'rimSegments': 32,
    'rimRadialSegments': 4,
    'spokesPerSide': 8,
    'cabins': 12,
    'transparentDisc': False,
    'sharedRenderAndCollisionGeometry': True,
    'animation': False,
    'minimap': '輪の上面位置を赤い線で表示',
}


FERRIS_GEOMETRY = r'''
  // 遠景でも輪郭を読み取れる静止観覧車。透過円盤や見えない箱は置かない。
  const wheel=data.district.ferrisWheel;
  if(wheel){
    const {center,radius,roofY,yaw=0,color='#bf3548',cabins=12}=wheel;
    if(!Array.isArray(center)||center.length!==3||!center.every(Number.isFinite)||
       ![radius,roofY,yaw].every(Number.isFinite)||radius<=0||roofY>=center[1]||
       !Number.isInteger(cabins)||cabins<4||cabins>24)throw Error('観覧車の寸法が不正です');
    const world=new T.Matrix4().makeRotationY(-yaw);
    world.setPosition(...center);
    const up=new T.Vector3(0,1,0),identity=new T.Quaternion();
    // ローカルX軸が輪の水平軸、Y軸が高さ、Z軸が車軸。全パーツを1層へまとめる。
    const emit=(geometry,position,rotation=identity,paint=color)=>{
      const geo=geometry.index?geometry.toNonIndexed():geometry;
      const local=new T.Matrix4().compose(position,rotation,new T.Vector3(1,1,1));
      geo.applyMatrix4(world.clone().multiply(local));
      add('ferris',Array.from(geo.attributes.position.array),paint);
      geo.dispose();if(geo!==geometry)geometry.dispose();
    };
    const point=(x,y,z)=>new T.Vector3(x,y,z);
    const bar=(a,b,r=.08,segments=4,paint=color)=>{
      const direction=b.clone().sub(a),length=direction.length();
      emit(new T.CylinderGeometry(r,r,length,segments),a.clone().add(b).multiplyScalar(.5),
        new T.Quaternion().setFromUnitVectors(up,direction.divideScalar(length)),paint);
    };
    for(const depth of [-.65,.65]){
      emit(new T.TorusGeometry(radius,.18,4,32),point(0,0,depth));
      for(let i=0;i<8;i++){
        const angle=i*Math.PI/4;
        bar(point(0,0,depth),point(Math.cos(angle)*(radius-.2),Math.sin(angle)*(radius-.2),depth));
      }
    }
    bar(point(0,0,-1.7),point(0,0,1.7),.42,6,'#414b53');
    const footY=roofY-center[1],footX=wheel.supportHalfWidth??5,footZ=wheel.supportHalfDepth??1.5;
    if(![footX,footZ].every(v=>Number.isFinite(v)&&v>0))throw Error('観覧車の支持脚寸法が不正です');
    for(const side of [-1,1]){
      for(const x of [-footX,footX])bar(point(x,footY,side*footZ),point(0,0,side*1.3),.24,6);
      bar(point(-footX,footY+.12,side*footZ),point(footX,footY+.12,side*footZ),.12);
    }
    for(let i=0;i<cabins;i++){
      const angle=i*Math.PI*2/cabins,x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;
      bar(point(x,y,0),point(x,y-.6,0),.07);
      emit(new T.BoxGeometry(1.15,1.15,1.35),point(x,y-1.175,0));
      emit(new T.BoxGeometry(1.17,.42,1.37),point(x,y-1.05,0),identity,'#29424a');
    }
  }
'''


def _once(source, before, after):
    if source.count(before) != 1:
        raise ValueError('観覧車の接続箇所が一致しません: ' + before[:90])
    return source.replace(before, after)


def apply_ferris_patch(source):
    """都市データの任意ferrisWheelだけを展開し、同じ面を物理・射線・視点に使う。"""
    source = _once(source, '  const encode=a=>', FERRIS_GEOMETRY + '\n  const encode=a=>')
    source = _once(source, "const bridgeTriangles = triangles(['brid']);",
                   "const bridgeTriangles = triangles(['brid',...(arrays.ferris?['ferris']:[])]);")
    source = _once(source, 'rail:0xffffff,station:0xffffff',
                   'rail:0xffffff,ferris:0xffffff,station:0xffffff')
    source = _once(source, '      for(const road of data.district.groundPassages||[]){', '''
      // 観覧車を真上から見た位置。円盤で街路を覆わず、細い赤い目印にする。
      const wheel=data.district.ferrisWheel;
      if(wheel){
        const [x,,z]=wheel.center,dx=Math.cos(wheel.yaw||0)*wheel.radius,dz=Math.sin(wheel.yaw||0)*wheel.radius;
        c.strokeStyle=wheel.color||'#bf3548';c.lineWidth=2;
        c.beginPath();c.moveTo(x-dx+half,z-dz+half);c.lineTo(x+dx+half,z+dz+half);c.stroke();
      }
      for(const road of data.district.groundPassages||[]){''')
    return _once(source, "mesh.castShadow=['bldg','rail','station','shops'].includes(k);",
                 "mesh.castShadow=['bldg','rail','station','shops','ferris'].includes(k);")
