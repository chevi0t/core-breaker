#!/usr/bin/env node
// b3dm/glTFのDracoを復号。コード用依存は draco3d@1.5.7（Apache-2.0）。
const fs=require('fs'),path=require('path');
const cache=path.resolve(process.argv[2]||'.');
const draco=require(process.env.PLATEAU_DRACO_MODULE||'draco3d');
(async()=>{
 const mod=await draco.createDecoderModule({}), dec=new mod.Decoder(),manifest=JSON.parse(fs.readFileSync(path.join(cache,'inputs.json')));
 const output=path.join(cache,'decoded');fs.mkdirSync(output,{recursive:true});const records=[];
 for(const item of manifest.models){
  const b=fs.readFileSync(path.join(cache,item.file));let o=0;
  if(b.toString('ascii',0,4)==='b3dm'){
   if(b.readUInt32LE(8)!==b.length)throw Error('b3dmヘッダ不正');
   const ft=JSON.parse(b.subarray(28,28+b.readUInt32LE(12)).toString().trim());
   if(ft.RTC_CENTER)throw Error('feature table側のRTCは未対応');
   o=28;for(let i=12;i<28;i+=4)o+=b.readUInt32LE(i);
  }
  if(b.toString('ascii',o,o+4)!=='glTF'||b.readUInt32LE(o+4)!==2)throw Error('glTF2が必要');
  const n=b.readUInt32LE(o+12),g=JSON.parse(b.subarray(o+20,o+20+n)),bin=b.subarray(o+28+n);
  if(g.nodes.some(v=>v.matrix||v.rotation||v.scale||v.children?.length))throw Error('平行移動以外のnode変換を確認してください');
  for(const [mi,mesh] of g.meshes.entries())for(const [pi,pr]of mesh.primitives.entries()){
   const nodes=g.nodes.filter(n=>n.mesh===mi);if(nodes.length!==1)throw Error('meshとnodeの対応を確認してください');
   const t=nodes[0].translation||[0,0,0],center=g.extensions?.CESIUM_RTC?.center||[0,0,0];
   // node平行移動はglTF Y-up、CESIUM_RTC中心はECEF。順序と軸を分ける。
   const rtc=[center[0]+t[0],center[1]-t[2],center[2]+t[1]];
   if(pr.mode!==undefined&&pr.mode!==4)throw Error('三角形以外');
   const ex=pr.extensions?.KHR_draco_mesh_compression;if(!ex)throw Error('Draco以外は未対応');
   const bv=g.bufferViews[ex.bufferView],bytes=bin.subarray(bv.byteOffset||0,(bv.byteOffset||0)+bv.byteLength),db=new mod.DecoderBuffer(),m=new mod.Mesh();
   db.Init(new Int8Array(bytes),bytes.length);const status=dec.DecodeBufferToMesh(db,m);if(!status.ok())throw Error(status.error_msg());
   const attr=dec.GetAttributeByUniqueId(m,ex.attributes.POSITION),values=new mod.DracoFloat32Array();
   dec.GetAttributeFloatForAllPoints(m,attr,values);const pos=new Float32Array(values.size());for(let i=0;i<pos.length;i++)pos[i]=values.GetValue(i);
   const faces=new Uint32Array(m.num_faces()*3),face=new mod.DracoInt32Array();for(let i=0;i<m.num_faces();i++){dec.GetFaceFromMesh(m,i,face);for(let c=0;c<3;c++)faces[i*3+c]=face.GetValue(c);}
   const name=item.file.replace(/\.(b3dm|glb)$/,'')+'-'+mi+'-'+pi;
   fs.writeFileSync(path.join(output,name+'.pos'),Buffer.from(pos.buffer));fs.writeFileSync(path.join(output,name+'.idx'),Buffer.from(faces.buffer));
   records.push({name,kind:item.kind,source:item.file,rtc,vertices:m.num_points(),triangles:m.num_faces()});
   for(const v of [face,values,m,db])mod.destroy(v);
  }
 }
 mod.destroy(dec);fs.writeFileSync(path.join(output,'meshes.json'),JSON.stringify(records,null,2)+'\n');
 console.log(JSON.stringify({meshes:records.length,triangles:records.reduce((s,v)=>s+v.triangles,0)}));
})().catch(e=>{console.error(e);process.exitCode=1;});
