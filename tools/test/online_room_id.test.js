'use strict';
// 貼り付けた部屋IDの掃除（2026-11-10 オーナー「コピペのときに半角スペース混じって入れなかった人居る疑惑」）。
// node --test tools/test/online_room_id.test.js
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Transport=require('../../prototype/online/transport.js');
const id='3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',clean=Transport.cleanRoomId;
test('前後・途中の空白や改行、見えない文字が混じっても同じ部屋IDになる',()=>{
  for(const s of [' '+id,id+' ',id+'\n','\t'+id+'\r\n','　'+id+'　',id.slice(0,10)+' '+id.slice(10),id.slice(0,20)+'\n'+id.slice(20),'​'+id,id+'﻿',id.slice(0,13)+' '+id.slice(13)])
    assert.equal(clean(s),id,JSON.stringify(s));
});
test('全角で貼られた英数字と横棒、大文字を直す',()=>{
  const wide=id.replace(/-/g,'－').replace(/[0-9a-f]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xFEE0));
  assert.equal(clean(wide),id);assert.equal(clean(id.toUpperCase()),id);assert.equal(clean(id.replace(/-/g,'‐')),id);
});
test('文ごと貼られたときは中の部屋IDだけを拾う',()=>{
  assert.equal(clean('部屋ID: '+id+'　ゲストの入室を待っています'),id);assert.equal(clean('「'+id+'」'),id);assert.equal(clean('ID→ '+id+' ←これで入って'),id);
});
test('UUIDの形でないIDは空白だけを取り、ほかは変えない。文字列以外と空は空を返す',()=>{
  assert.equal(clean(' Test-Room_1 '),'Test-Room_1');assert.equal(clean('   '),'');assert.equal(clean(null),'');assert.equal(clean(undefined),'');
});
test('入室のボタンと通信の入口の両方が掃除を通す',()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,'../../prototype/online',f),'utf8');
  assert.match(read('ui.js'),/onlineJoin'\)\.onclick=.*CBOnlineTransport\.cleanRoomId\(el\('onlineRoom'\)\.value\)/);
  assert.match(read('transport.js'),/roomId = cleanRoomId\(roomId\);/);
});
