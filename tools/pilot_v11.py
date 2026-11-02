"""ComfyUI の「層の描き足し」（v11）に渡す材料を、tools/pilot_layers.py と同じ層分けから作る。

  python3 tools/pilot_v11.py <キャラID> <出力フォルダ>

作る物（出力フォルダ）：
  <id>_normal.png            元絵（1024px。ComfyUI の「06 標準の元絵」で読む）
  <id>_fill_body.png・<id>_fill_face.png   マスク（1024px、白＝描き直す所）
  fill_masks_preview.png     マスクを絵に重ねた物（橙＝体、水色＝顔）
  <ID>_layers_v11_fill.json  ComfyUI のワークフロー（MOSS 編集を SetLatentNoiseMask でマスクの中だけ、ImageCompositeMasked で元絵に重ねる）
  README_JA.txt              オーナー向けの使い方
キャラごとの指示文は prototype/avatars/pilots/<id>/layers/v11.json（name・seed・body/face の label・prompt・result）。
オーナーが返す <id>_body_plate・<id>_face_plate を layers/plate_body.png・plate_face.png に置いて pilot_layers.py を回す。"""
import sys, json, pathlib, uuid
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as nd
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pilot_layers as pl
cid, out = sys.argv[1], pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
c = pl.ROOT / 'prototype/avatars/pilots' / cid
V = json.loads((c / 'layers/v11.json').read_text(encoding='utf8'))
R = json.loads((c / 'layers/rig.json').read_text())
img = np.asarray(pl.load(c, 'normal')).astype(np.float32) / 255
M = pl.split(img, R)
hull, head = pl.poly(R['bodyHull']), pl.poly(R['head'])
body = M['armL'] | M['armR'] | (M['hairF'] & ~head & ~nd.binary_dilation(M['head'], iterations=2))
body = nd.binary_dilation(body, iterations=4) & nd.binary_erosion(img[..., 3] > 0.5, iterations=1)
face = M['hairF'] & nd.binary_dilation(M['head'], iterations=14)
face = nd.binary_dilation(face, iterations=3) & ~nd.binary_erosion(M['head'], iterations=6)
def save(m, name):
    im = Image.fromarray((m * 255).astype(np.uint8)).resize((1024, 1024), Image.BILINEAR).filter(ImageFilter.GaussianBlur(4))
    im.convert('RGB').save(out / name)
save(body, f'{cid}_fill_body.png'); save(face, f'{cid}_fill_face.png')
src = Image.open([p for p in (c / 'normal.png', c / 'normal.webp') if p.exists()][0]).convert('RGBA').resize((pl.WORK, pl.WORK))
bg = Image.new('RGBA', src.size, (200, 200, 190, 255)); bg.alpha_composite(src); base = np.asarray(bg.convert('RGB')).astype(float)
ov = base.copy(); ov[body] = ov[body] * .4 + np.array([255, 140, 40]) * .6; ov[face] = ov[face] * .4 + np.array([60, 220, 255]) * .6
Image.fromarray(ov.astype(np.uint8)).resize((900, 900)).save(out / 'fill_masks_preview.png')
Image.open([p for p in (c / 'normal.png', c / 'normal.webp') if p.exists()][0]).convert('RGBA').resize((1024, 1024), Image.LANCZOS).save(out / f'{cid}_normal.png')
print('body px', int(body.sum()), 'face px', int(face.sum()))

# ---- ワークフロー ----
nodes=[];links=[];nid=[0];lid=[0]
def node(typ,title,pos,size,inputs,outputs,widgets=None,named=None,props=None,color=None):
  nid[0]+=1
  n={"id":nid[0],"type":typ,"title":title,"pos":pos,"size":size,"flags":{},"order":nid[0],"mode":0,
     "inputs":[dict({"name":a,"type":t,"link":None},**({"widget":{"name":a}} if wd else {}),**({"shape":7} if opt else {})) for a,t,wd,opt in inputs],
     "outputs":[{"name":a,"type":t,"links":[]} for a,t in outputs],
     "properties":dict({"Node name for S&R":typ},**(props or {}))}
  if widgets is not None: n["widgets_values"]=widgets
  if named: n["widgets_values_named"]=named
  if color: n["color"],n["bgcolor"]=color
  nodes.append(n); return n
def I(name,typ,widget=False,opt=False): return (name,typ,widget,opt)
def connect(a,aslot,b,bname):
  idx=next(k for k,i in enumerate(b['inputs']) if i['name']==bname); assert b['inputs'][idx]['link'] is None
  lid[0]+=1; links.append([lid[0],a['id'],aslot,b['id'],idx,b['inputs'][idx]['type']])
  b['inputs'][idx]['link']=lid[0]; a['outputs'][aslot]['links'].append(lid[0])

unet=node("UNETLoader","01｜MOSS SFT model",[40,80],[380,100],[],[("MODEL","MODEL")],["moss_image_sft_bf16.safetensors","default"],{"unet_name":"moss_image_sft_bf16.safetensors","weight_dtype":"default"})
clip=node("CLIPLoader","02｜Text encoder (moss_image)",[40,220],[380,130],[],[("CLIP","CLIP")],["qwen3.5_9b_int8_convrot.safetensors","moss_image","default"],{"clip_name":"qwen3.5_9b_int8_convrot.safetensors","type":"moss_image","device":"default"})
vae=node("VAELoader","03｜VAE",[40,390],[380,100],[],[("VAE","VAE")],["flux2-vae.safetensors"],{"vae_name":"flux2-vae.safetensors"})
lora=node("LoraLoaderModelOnly","04｜armV5（被撃破と同じ編集用）",[40,530],[380,120],[I("model","MODEL")],[("MODEL","MODEL")],["armV5.safetensors",1],{"lora_name":"armV5.safetensors","strength_model":1},
  {"models":[{"name":"armV5.safetensors","url":"https://huggingface.co/akhaliq/MOSS-Image-Edit-HQ/resolve/main/weights/armV5/armV5.safetensors","directory":"loras"}]})
slg=node("SkipLayerGuidanceDiTSimple","05｜SLG 22",[40,690],[380,180],[I("model","MODEL")],[("MODEL","MODEL")],["","22",0,1],{"double_layers":"","single_layers":"22","start_percent":0,"end_percent":1})
connect(unet,0,lora,"model"); connect(lora,0,slg,"model")
src=node("LoadImage",f"06｜標準の元絵（{V['name']}の標準・1024px）",[40,910],[380,420],[],[("IMAGE","IMAGE"),("MASK","MASK")],[f"{cid}_normal.png","image"],{"image":f"{cid}_normal.png","upload":"image"})
NEG=("low quality, bad anatomy, extra arms, extra hands, extra fingers, deformed hands, duplicate subject, multiple people, altered costume design, "
     "changed garment colors, new accessories, changed face, changed expression, changed hairstyle on the head, watermark, text, border")
COL={"body":("#3a5a3a","#4a6e4a"),"face":("#3a4a66","#4a5c80")}
NEG=("low quality, bad anatomy, extra arms, extra hands, extra fingers, deformed hands, duplicate subject, multiple people, altered costume design, "
     "changed garment colors, new accessories, changed face, changed expression, changed hairstyle on the head, watermark, text, border")
for j,key in enumerate(('body','face')):
  label,prompt,col=V[key]['label'],V[key]['prompt'],COL[key]; maskfile=f"{cid}_fill_{key}.png"; prefix=f"{cid.upper()}_layers/{cid}_{key}_plate"
  X=480+j*760; Y=80; W=700
  mk=node("LoadImageMask",f"{label}｜マスク（白＝描き直す所。Claude が作る）",[X,Y],[W,420],[],[("MASK","MASK")],[maskfile,"red","image"],{"image":maskfile,"channel":"red","upload":"image"})
  pt=node("PrimitiveStringMultiline",f"{label}｜指示",[X,Y+460],[W,260],[],[("STRING","STRING")],[prompt],{"value":prompt},color=col)
  pos=node("TextEncodeMOSSImageEdit",f"{label}｜元絵を編集",[X,Y+760],[W,200],[I("clip","CLIP"),I("images.image_0","IMAGE"),I("images.image_1","IMAGE",opt=True),I("vae","VAE",opt=True),I("prompt","STRING",widget=True)],[("CONDITIONING","CONDITIONING")],["","ai-toolkit",1],{"prompt":"","edit_format":"ai-toolkit","image_strength":1})
  pos["showAdvanced"]=True
  neg=node("TextEncodeMOSSImageEdit",f"{label}｜negative",[X,Y+1000],[W,240],[I("clip","CLIP"),I("images.image_0","IMAGE"),I("images.image_1","IMAGE",opt=True),I("vae","VAE",opt=True)],[("CONDITIONING","CONDITIONING")],[NEG,"ai-toolkit",1],{"prompt":NEG,"edit_format":"ai-toolkit","image_strength":1})
  enc=node("VAEEncode",f"{label}｜元絵を潜在へ",[X,Y+1280],[W,100],[I("pixels","IMAGE"),I("vae","VAE")],[("LATENT","LATENT")])
  snm=node("SetLatentNoiseMask",f"{label}｜マスクの中だけ描き直す",[X,Y+1420],[W,100],[I("samples","LATENT"),I("mask","MASK")],[("LATENT","LATENT")])
  ks=node("KSampler",f"{label}｜25 steps / CFG3 / euler-normal",[X,Y+1560],[W,320],[I("model","MODEL"),I("positive","CONDITIONING"),I("negative","CONDITIONING"),I("latent_image","LATENT")],[("LATENT","LATENT")],[V.get("seed",834574918175329)+j,"fixed",25,3,"euler","normal",1],{"seed":V.get("seed",834574918175329)+j,"control_after_generate":"fixed","steps":25,"cfg":3,"sampler_name":"euler","scheduler":"normal","denoise":1})
  dec=node("VAEDecode",f"{label}｜絵へ",[X,Y+1920],[W,100],[I("samples","LATENT"),I("vae","VAE")],[("IMAGE","IMAGE")])
  cmp=node("ImageCompositeMasked",f"{label}｜マスクの中だけ元絵に重ねる",[X,Y+2060],[W,200],[I("destination","IMAGE"),I("source","IMAGE"),I("mask","MASK")],[("IMAGE","IMAGE")],[0,0,False],{"x":0,"y":0,"resize_source":False})
  sv=node("SaveImage",f"{label}｜保存（PNG・1024px）",[X,Y+2300],[W,600],[I("images","IMAGE")],[],[prefix],{"filename_prefix":prefix})
  connect(clip,0,pos,"clip"); connect(src,0,pos,"images.image_0"); connect(vae,0,pos,"vae"); connect(pt,0,pos,"prompt")
  connect(clip,0,neg,"clip"); connect(src,0,neg,"images.image_0"); connect(vae,0,neg,"vae")
  connect(src,0,enc,"pixels"); connect(vae,0,enc,"vae"); connect(enc,0,snm,"samples"); connect(mk,0,snm,"mask")
  connect(slg,0,ks,"model"); connect(pos,0,ks,"positive"); connect(neg,0,ks,"negative"); connect(snm,0,ks,"latent_image")
  connect(ks,0,dec,"samples"); connect(vae,0,dec,"vae")
  connect(src,0,cmp,"destination"); connect(dec,0,cmp,"source"); connect(mk,0,cmp,"mask"); connect(cmp,0,sv,"images")
NOTE=f"""v11 / 層の描き足し（{V['name']} {cid}）

ゲームでは絵を層（後ろ髪・体・左腕・右腕・顔・前髪）に分けて別々に揺らすので、前の層に隠れていた所を描き足します。

使い方
1. 「06 標準の元絵」に {cid}_normal.png を読み込む（1024px）。
2. 2つのマスク（{cid}_fill_body.png・{cid}_fill_face.png）を ComfyUI の input フォルダに置き、各「マスク」で選ぶ。
   どこを描き直すかは fill_masks_preview.png（橙＝体、水色＝顔）で見られます。
3. 実行すると {cid.upper()}_layers/ に2枚できます。
   ・{cid}_body_plate：{V['body']['result']}
   ・{cid}_face_plate：{V['face']['result']}
   マスクの外は元絵と1画素も変わりません。
4. 2枚を渡してください。層を作り直してゲームに入れます。

うまくいかない時
・腕や房が消えずに描き直される：seed を変える、「指示」の Do not draw new arms を強める。
・服の柄や顔が変わる：seed を変えて何回か出し、良い物を選ぶ。
・描き足しは層が数画素ずれた時にしか見えないので、完璧でなくて大丈夫です。"""

node("Note","説明",[2000,80],[640,760],[],[],[NOTE])
groups=[{"id":1,"title":"共通（モデルと元絵）","bounding":[20,10,420,1340],"color":"#444","font_size":24,"flags":{}},
        {"id":2,"title":"A / 体の層","bounding":[470,10,720,2990],"color":"#3f6e3f","font_size":24,"flags":{}},
        {"id":3,"title":"B / 顔の層","bounding":[1230,10,720,2990],"color":"#3f5a8e","font_size":24,"flags":{}}]
w={"id":str(uuid.uuid4()),"revision":0,"last_node_id":nid[0],"last_link_id":lid[0],"nodes":nodes,"links":links,"groups":groups,"config":{},"extra":{"ds":{"scale":0.4,"offset":[20,20]}},"version":0.4}
# 整合の確認
ids={n['id'] for n in nodes}
for l in links:
  a=next(n for n in nodes if n['id']==l[1]); b=next(n for n in nodes if n['id']==l[3])
  assert b['inputs'][l[4]]['link']==l[0] and l[0] in a['outputs'][l[2]]['links']
for n in nodes:
  for i in n['inputs']:
    if i['link'] is None and not i.get('shape') and not i.get('widget'): raise SystemExit(f"unlinked {n['id']} {n['title']} {i['name']}")
json.dump(w,open(out/f'{cid.upper()}_layers_v11_fill.json','w',encoding='utf8'),ensure_ascii=False,indent=2)
print('nodes',len(nodes),'links',len(links))
(out/'README_JA.txt').write_text(NOTE+'\n',encoding='utf8')
