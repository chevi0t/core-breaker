#!/usr/bin/env python3
"""Node回帰から渡された実製品トークンでPython独立復元と拒否を確かめる。"""
import base64
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zlib
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from decode_diagnostic_log import decode, MAX_INPUT, MAX_TEXT, MAX_PACKED
from diagnostic_log_format import pack, unpack, strict_json_loads

def b36(n):
    chars = '0123456789abcdefghijklmnopqrstuvwxyz'; out = ''
    while n: n, r = divmod(n, 36); out = chars[r] + out
    return out or '0'

def token(raw, size=None, suffix=b''):
    compressor=zlib.compressobj(9,wbits=-15); compressed=compressor.compress(raw)+compressor.flush()+suffix
    return 'CBL2.D.'+b36(len(raw) if size is None else size)+'.'+f'{zlib.crc32(raw)&0xffffffff:08x}'+'.'+base64.urlsafe_b64encode(compressed).decode().rstrip('=')

def reject(fn):
    global checks
    try: fn()
    except (ValueError, TypeError, RecursionError): checks += 1
    else: raise AssertionError('不正入力を受理')

checks=0
text=Path(sys.argv[1]).read_text(); original=json.loads(Path(sys.argv[2]).read_text())
assert decode(text)==original
assert decode(' \n'+text[:45]+'\r\n'+text[45:]+'\t')==original
payload=pack(original); raw=json.dumps(payload,separators=(',',':')).encode()
assert decode(token(raw))==original
for bad in ['',text[:-1],text+'A',text.replace('CBL2','CBL9'),text.replace('.D.','.G.'),text.replace('.D.','.D.00'),text+'.',text+'=',text+'\u200b','x'*(MAX_INPUT+1)]:reject(lambda bad=bad:decode(bad))
parts=text.split('.');parts[3]='00000000';reject(lambda:decode('.'.join(parts)))
for data,size,suffix in [(raw,len(raw)-1,b''),(raw,len(raw)+1,b''),(b'x'*(MAX_PACKED+1),1,b''),(raw,MAX_PACKED+1,b''),(raw,None,b'junk'),(raw,None,zlib.compress(raw)),(b'\xff',None,b''),(b'['*2000+b'0'+b']'*2000,None,b''),(b'{"a":1,"a":2}',None,b''),(b'NaN',None,b''),(b'Infinity',None,b''),(b'{"__proto__":1}',None,b'')]:reject(lambda:decode(token(data,size,suffix)))
for bad in [None,[],['CBP2',payload[1]],['CBP1',[]],['CBP1',[True,[]]],['CBP1',payload[1],1],['CBP1',[1,[payload[1][1][0]]*4]]]:reject(lambda bad=bad:decode(token(json.dumps(bad,separators=(',',':')).encode())))
mutations=[lambda v:v.update({'secret':'PRIVATE'}),lambda v:v.update({'schema':True}),lambda v:v['sessions'][0]['samples'][0]['data'].update({'fps':True}),lambda v:v['sessions'][0]['samples'][0]['data'].update({'humans':101}),lambda v:v['sessions'][0]['samples'][0]['data'].update({'map':'PRIVATE'}),lambda v:v['sessions'][0]['samples'][0]['data']['corrections']['reasons'].update({'__proto__':0}),lambda v:v['sessions'][0].update({'samples':[v['sessions'][0]['samples'][0]]*301})]
for mutation in mutations:
    v=copy.deepcopy(original);mutation(v);reject(lambda:pack(v))
# CRCを再計算できる相手の、許可範囲内の偽装は検出できない（署名ではない）。
forged=copy.deepcopy(original);forged['sessions'][0]['samples'][0]['data']['fps']=1
assert decode(token(json.dumps(pack(forged),separators=(',',':')).encode()))==forged
with tempfile.TemporaryDirectory() as tmp:
    out=Path(tmp)/'restored.json';cmd=[sys.executable,str(Path(__file__).resolve().parents[1]/'decode_diagnostic_log.py'),sys.argv[1],'--output',str(out)]
    assert subprocess.run(cmd,capture_output=True).returncode==0
    assert json.loads(out.read_text())==original and out.stat().st_size<=512*1024
    before=out.read_bytes();assert subprocess.run(cmd,capture_output=True).returncode==1;assert out.read_bytes()==before
print('Python復元: 正常/改行/独立圧縮/署名限界/非上書き 成功、不正拒否',checks,'件')
