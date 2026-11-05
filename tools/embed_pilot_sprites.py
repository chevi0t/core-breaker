"""キャラ別の静止画をHTMLへ埋め込む。

ページに入れるのは「標準」と「やられ顔」の2枚（オーナー指定 2026-11-02）。ブースト中の動きはゲーム側の揺れ（PILOT_RIGS）で出すので、
boost_left/right の絵は原画として残しても埋め込まない。

原画（<キャラ>/<状態>.png か .webp）はそのまま残し、ページへは次の順で探した物を入れる：
  embed/<状態>.webp（縮小版） → <状態>.webp（小さい原画はそのまま） → <状態>.png
やられ顔の差分：embed/damage_patch.webp と embed/damage_patch.json があれば、やられ顔は1枚まるごとではなく
「標準の絵に顔の切り抜きを重ねる」形で入れる（ポーズが標準と同じ絵だけ。2026-11-02）。

層：<キャラ>/layers/manifest.json があれば（tools/pilot_layers.py が作る）、層の絵だけを PILOT_LAYERS として入れる。
ゲームはそのキャラを層ごとに揺らし、止まった絵（標準とやられ顔）もページを開いた時に層を重ねて作る（2026-11-02）。

縮小版と差分の作り直し：python3 tools/embed_pilot_sprites.py --shrink（Pillow が要る）
  - 320pxより大きい原画は 320px・WebP 品質88 に縮める（表示は最大156px）
  - 標準とやられ顔の違いが顔のまわりに収まっていれば（外側の違いが圧縮の誤差 PATCH_NOISE 以下）、その範囲を切り抜く"""
import base64, json, pathlib, re, struct, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
STATES={'NORMAL':'normal','DAMAGE':'damage'}
SIZE=320            # 縮小版の大きさ
PATCH_DIFF=32       # これより色が違う画素を「描き変えた所」とみなす
PATCH_PAD=0.025     # 切り抜きの余白（絵の幅に対する割合）
PATCH_NOISE=40      # 切り抜きの外で許す違い（圧縮の誤差）

def webp_size(data):
    kind=data[12:16]
    if kind==b'VP8X': return (int.from_bytes(data[24:27],'little')+1,int.from_bytes(data[27:30],'little')+1)
    if kind==b'VP8 ': return (struct.unpack('<H',data[26:28])[0]&0x3fff,struct.unpack('<H',data[28:30])[0]&0x3fff)
    if kind==b'VP8L': b=int.from_bytes(data[21:25],'little');return ((b&0x3fff)+1,((b>>14)&0x3fff)+1)
    raise ValueError('WebPの形式が分かりません')

def original(char,state):
    for ext in ('.png','.webp'):
        p=char/(STATES[state]+ext)
        if p.exists(): return p
    return None

def source(char,state):
    for p in (char/'embed'/(STATES[state]+'.webp'),char/(STATES[state]+'.webp'),char/(STATES[state]+'.png')):
        if p.exists(): return p
    return None

def shrink(folder):
    from PIL import Image, ImageChops
    for char in sorted(folder.iterdir()):
        if not char.is_dir(): continue
        if (char/'layers'/'manifest.json').exists(): continue  # 層のキャラは止まった絵もページで層から作る
        imgs={}
        for state in STATES:
            src=original(char,state)
            if not src: continue
            im=Image.open(src).convert('RGBA')
            if im.width>SIZE or src.suffix=='.png':
                (char/'embed').mkdir(exist_ok=True)
                im=im.resize((SIZE,SIZE),Image.LANCZOS); im.save(char/'embed'/(STATES[state]+'.webp'),quality=88,method=6)
            imgs[state]=im  # 差分は圧縮する前の絵で比べる（別々に圧縮すると誤差が全体に出る）
        for f in ('damage_patch.webp','damage_patch.json'):
            if (char/'embed'/f).exists(): (char/'embed'/f).unlink()
        n,d=imgs.get('NORMAL'),imgs.get('DAMAGE')
        if not n or not d or n.size!=d.size: continue
        # 透明な所の色は見えないので比べない（縮めると透明な所の色がばらつく）
        diff=ImageChops.multiply(ImageChops.difference(n,d).convert('RGB').convert('L'),ImageChops.lighter(n.getchannel('A'),d.getchannel('A')))
        box=diff.point(lambda v:255 if v>PATCH_DIFF else 0).getbbox()
        if not box: continue
        pad=round(n.width*PATCH_PAD); box=(max(0,box[0]-pad),max(0,box[1]-pad),min(n.width,box[2]+pad),min(n.height,box[3]+pad))
        outside=diff.copy(); outside.paste(0,box)
        if outside.getextrema()[1]>PATCH_NOISE or (box[2]-box[0])*(box[3]-box[1])>n.width*n.height*.4:
            print(char.name,': やられ顔の違いが顔の外にもあるので、1枚まるごと入れる'); continue
        (char/'embed').mkdir(exist_ok=True)
        d.crop(box).save(char/'embed'/'damage_patch.webp',quality=90,method=6)
        if (char/'embed'/'damage.webp').exists(): (char/'embed'/'damage.webp').unlink()  # まるごとの縮小版は要らない
        (char/'embed'/'damage_patch.json').write_text(json.dumps({'box':[box[0]/n.width,box[1]/n.height,(box[2]-box[0])/n.width,(box[3]-box[1])/n.height]})+'\n')
        print(char.name,': やられ顔は顔の切り抜き',box)

def read_image(path):
    data=path.read_bytes()
    if data[:4]==b'RIFF' and data[8:12]==b'WEBP': return data,'image/webp',webp_size(data)
    if data[:8]==b'\x89PNG\r\n\x1a\n': return data,'image/png',struct.unpack('>II',data[16:24])
    raise ValueError('PNGでもWebPでもありません: '+str(path))

def url(data,mime): return 'url("data:'+mime+';base64,'+base64.b64encode(data).decode()+'")'

layers={}
def collect(folder):
    css=['.pilotSprite { background-size:contain; background-position:center; border-radius:0; }']; registry={}; patches={}; layers.clear()
    for char in sorted(folder.iterdir()):
        if not char.is_dir(): continue
        man=char/'layers'/'manifest.json'
        if man.exists():
            # 層に分けたキャラは層だけ入れる。止まった絵（メニューのカードなど）はページが層を重ねて作る（オーナー 2026-11-02「省きましょっか」）
            m=json.loads(man.read_text()); ls={}
            for k,v in m['layers'].items():
                data,mime,_=read_image(char/'layers'/(k+'.webp'))
                ls[k]={'bbox':v['bbox'],'src':'data:'+mime+';base64,'+base64.b64encode(data).decode()}
            layers[char.name]={'order':m['order'],'layers':ls}
            registry[char.name]=['NORMAL','DAMAGE'] if 'headD' in ls else ['NORMAL']
            continue
        if not source(char,'NORMAL'): continue
        if not re.fullmatch(r'[a-z0-9_]+',char.name): raise ValueError('キャラIDは小文字英数字/_: '+char.name)
        keys=[k for k in STATES if source(char,k)]
        size=None
        patch=char/'embed'/'damage_patch.webp'
        for state in keys:
            sel='.pilotSprite[data-pilot="'+char.name+'"][data-state="'+state+'"]'
            if state=='DAMAGE' and patch.exists():
                x,y,w,h=json.loads((char/'embed'/'damage_patch.json').read_text())['box']
                pdata,pmime,_=read_image(patch)
                # 切り抜きを標準の絵の上に重ねる（background の位置の % は x/(1-w) で表す）
                pos=lambda a,s: 0 if s>=1 else a/(1-s)*100
                css.append(sel+' { background-image:'+url(pdata,pmime)+',var(--pilot-normal); background-size:'+f'{w*100:.3f}% {h*100:.3f}%,contain'+'; background-position:'+f'{pos(x,w):.3f}% {pos(y,h):.3f}%,center'+'; background-repeat:no-repeat; }')
                patches[char.name]={'DAMAGE':[round(v,5) for v in (x,y,w,h)]}
                continue
            data,mime,dimensions=read_image(source(char,state))
            if size and size!=dimensions: raise ValueError('絵の寸法不一致: '+char.name)
            size=dimensions
            if state=='NORMAL':
                # 標準の絵は変数に1回だけ書き、やられ顔の重ね絵からも使う（同じ絵を2回埋め込まない）
                css.append('.pilotSprite[data-pilot="'+char.name+'"] { --pilot-normal:'+url(data,mime)+'; }')
                css.append(sel+' { background-image:var(--pilot-normal); }'); continue
            css.append(sel+' { background-image:'+url(data,mime)+'; }')
        registry[char.name]=keys
    return '\n'.join(css),registry,patches

if __name__=='__main__':
    folder=ROOT/'prototype/avatars/pilots'
    if '--shrink' in sys.argv: shrink(folder)
    css,registry,patches=collect(folder);page=ROOT/'prototype/pilots.js';src=page.read_text();sheet=ROOT/'prototype/style.css';style=sheet.read_text()  # 絵の CSS は style.css、表は pilots.js（2026-11-05 から。前は index.html）
    data='const PILOT_SPRITES = '+json.dumps(registry)+';\nconst PILOT_PATCHES = '+json.dumps(patches)+';\nconst PILOT_LAYERS = '+json.dumps(layers)+';'
    def put(text,kind,content):
        pat=r'/\* PILOT_SPRITES_'+kind+r'_BEGIN \*/.*?/\* PILOT_SPRITES_'+kind+r'_END \*/'
        assert len(re.findall(pat,text,re.S))==1
        return re.sub(pat,lambda m:'/* PILOT_SPRITES_'+kind+'_BEGIN */\n'+content+'\n/* PILOT_SPRITES_'+kind+'_END */',text,flags=re.S)
    style=put(style,'CSS',css);src=put(src,'DATA',data)
    sheet.write_text(style);page.write_text(src);print(registry,patches,{k:sorted(v['layers']) for k,v in layers.items()})
