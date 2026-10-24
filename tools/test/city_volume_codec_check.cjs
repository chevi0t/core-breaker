// Pythonの保存器とブラウザ共用JSの復元器を照合し、省略した属性を正確に戻せることを確認する。
const assert=require('node:assert/strict'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {decodeCityVolumes}=require('../city_volume_codec.js');
const root=path.resolve(__dirname,'../..');
const fixture=JSON.parse(execFileSync('python3',['-c',`
import sys,json,base64,struct
sys.path.insert(0,'tools')
from build_hoshimichi_west import pack_volumes
def ring(count):
    return base64.b64encode(b''.join(struct.pack('<hh',i%32768,-(i%32768)) for i in range(count))).decode()
rows=[]
for kind,lo,hi in [(0,-.25,8),(0,-.5,8),(1,4,10),(2,-.5,12),(3,9,10),(3,9.4,10),(1,-327.68,-300)]:
    rows.append([kind,lo,hi,[ring(3)],{}])
for n in [254,255,256,65535]: rows.append([0,-.25,9,[ring(n)],{}])
rows.append([0,-.25,9,[ring(3)]*256,{}])
for i in range(1,16):rows.append([0,-.25,9,[ring(3)],{'landmarkColor':'#%06x'%i}])
packed,colors=pack_volumes(rows)
failures=0
for invalid in [rows+[[0,-.25,9,[ring(3)],{'landmarkColor':'#ffffff'}]], [[4,-.25,9,[ring(3)],{}]], [[0,8,8,[ring(3)],{}]], [[0,-.25,9,[ring(2)],{}]], [[0,-.25,9,[ring(3)]*257,{}]]]:
    try:pack_volumes(invalid)
    except ValueError:failures+=1
    else:raise AssertionError('保存範囲外を拒否しなかった')
print(json.dumps({'layout':{'volumes':packed,'volumeColors':colors,'volumeKinds':['grounded','upper','infill','elevated'],'volumeCount':len(rows),'volumeEncoding':'kind2-color4-flags2-y01-i16-rings-u8'},'expected':rows,'rejected':failures}))
`],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
assert.deepEqual(decodeCityVolumes(fixture.layout),fixture.expected,'種類別の既定高さ・任意高さ・16色・256輪郭・頂点数の境界を復元');
assert.equal(fixture.rejected,5,'保存範囲外を拒否');
const damaged={...fixture.layout,volumes:fixture.layout.volumes.slice(0,-8)};
assert.throws(()=>decodeCityVolumes(damaged),/途中|不足|件数|不正/,'途中で切れた整数列を拒否');
assert.throws(()=>decodeCityVolumes({...fixture.layout,volumeCount:0}),/件数/,'件数の不一致を拒否');
assert.throws(()=>decodeCityVolumes({...fixture.layout,volumeEncoding:'unknown'}),/未対応/,'未対応形式を拒否');
console.log(JSON.stringify({records:fixture.expected.length,invalidEncoderInputs:fixture.rejected,invalidDecoderInputs:3,errors:[]}));
