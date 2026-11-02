"""キャラ別の静止画をHTMLへ埋め込む。

原画（<キャラ>/<状態>.png）はそのまま残し、ページへは軽い縮小版を入れる。
<キャラ>/embed/<状態>.webp があればそれを使い、無ければ原画PNGを使う。
縮小版の作り直し：python3 tools/embed_pilot_sprites.py --shrink（Pillow が要る。320px、WebP 品質88）。
表示は最大156pxなので、320pxあれば高解像度の画面でもぼやけない。"""
import base64, json, pathlib, re, struct, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
STATES={'NORMAL':'normal.png','BOOST_LEFT':'boost_left.png','BOOST_RIGHT':'boost_right.png','DAMAGE':'damage.png'}
def webp_size(data):
    kind=data[12:16]
    if kind==b'VP8X': return (int.from_bytes(data[24:27],'little')+1,int.from_bytes(data[27:30],'little')+1)
    if kind==b'VP8 ': return (struct.unpack('<H',data[26:28])[0]&0x3fff,struct.unpack('<H',data[28:30])[0]&0x3fff)
    if kind==b'VP8L': b=int.from_bytes(data[21:25],'little');return ((b&0x3fff)+1,((b>>14)&0x3fff)+1)
    raise ValueError('WebPの形式が分かりません')
def shrink(folder,size=320):
    from PIL import Image
    for char in sorted(folder.iterdir()):
        if not char.is_dir(): continue
        for png in STATES.values():
            if not (char/png).exists(): continue
            (char/'embed').mkdir(exist_ok=True)
            Image.open(char/png).convert('RGBA').resize((size,size),Image.LANCZOS).save(char/'embed'/png.replace('.png','.webp'),quality=88,method=6)
def collect(folder):
    css=['.pilotSprite { background-size:contain; background-position:center; border-radius:0; }']; registry={}
    for char in sorted(folder.iterdir()):
        if not char.is_dir() or not (char/'normal.png').exists(): continue
        if not re.fullmatch(r'[a-z0-9_]+',char.name): raise ValueError('キャラIDは小文字英数字/_: '+char.name)
        keys=list(STATES) if all((char/f).exists() for f in STATES.values()) else ['NORMAL']
        size=None
        for state in keys:
            small=char/'embed'/STATES[state].replace('.png','.webp')
            if small.exists():
                data=small.read_bytes();mime='image/webp'
                if data[:4]!=b'RIFF' or data[8:12]!=b'WEBP': raise ValueError('WebPではありません: '+str(small))
                dimensions=webp_size(data)
            else:
                data=(char/STATES[state]).read_bytes();mime='image/png'
                if data[:8]!=b'\x89PNG\r\n\x1a\n': raise ValueError('PNGではありません')
                dimensions=struct.unpack('>II',data[16:24])
            if size and size!=dimensions: raise ValueError('4枚の寸法不一致: '+char.name)
            size=dimensions
            css.append('.pilotSprite[data-pilot="'+char.name+'"][data-state="'+state+'"] { background-image:url("data:'+mime+';base64,'+base64.b64encode(data).decode()+'"); }')
        registry[char.name]=keys
    return '\n'.join(css),registry
if __name__=='__main__':
    if '--shrink' in sys.argv: shrink(ROOT/'prototype/avatars/pilots')
    css,registry=collect(ROOT/'prototype/avatars/pilots');page=ROOT/'prototype/index.html';src=page.read_text()
    for kind,content in [('CSS',css),('DATA','const PILOT_SPRITES = '+json.dumps(registry)+';')]:
        pat=r'/\* PILOT_SPRITES_'+kind+r'_BEGIN \*/.*?/\* PILOT_SPRITES_'+kind+r'_END \*/'
        assert len(re.findall(pat,src,re.S))==1
        src=re.sub(pat,lambda m:'/* PILOT_SPRITES_'+kind+'_BEGIN */\n'+content+'\n/* PILOT_SPRITES_'+kind+'_END */',src,flags=re.S)
    page.write_text(src);print(registry)
