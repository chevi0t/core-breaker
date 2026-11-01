"""キャラ別の静止PNGをHTMLへ埋め込む。画素は変更しない。"""
import base64, json, pathlib, re, struct
ROOT=pathlib.Path(__file__).resolve().parents[1]
STATES={'NORMAL':'normal.png','BOOST_LEFT':'boost_left.png','BOOST_RIGHT':'boost_right.png','DAMAGE':'damage.png'}
def collect(folder):
    css=['.pilotSprite { background-size:contain; background-position:center; border-radius:0; }']; registry={}
    for char in sorted(folder.iterdir()):
        if not char.is_dir() or not (char/'normal.png').exists(): continue
        if not re.fullmatch(r'[a-z0-9_]+',char.name): raise ValueError('キャラIDは小文字英数字/_: '+char.name)
        keys=list(STATES) if all((char/f).exists() for f in STATES.values()) else ['NORMAL']
        size=None
        for state in keys:
            data=(char/STATES[state]).read_bytes()
            if data[:8]!=b'\x89PNG\r\n\x1a\n': raise ValueError('PNGではありません')
            dimensions=struct.unpack('>II',data[16:24])
            if size and size!=dimensions: raise ValueError('4枚の寸法不一致: '+char.name)
            size=dimensions
            css.append('.pilotSprite[data-pilot="'+char.name+'"][data-state="'+state+'"] { background-image:url("data:image/png;base64,'+base64.b64encode(data).decode()+'"); }')
        registry[char.name]=keys
    return '\n'.join(css),registry
if __name__=='__main__':
    css,registry=collect(ROOT/'prototype/avatars/pilots');page=ROOT/'prototype/index.html';src=page.read_text()
    for kind,content in [('CSS',css),('DATA','const PILOT_SPRITES = '+json.dumps(registry)+';')]:
        pat=r'/\* PILOT_SPRITES_'+kind+r'_BEGIN \*/.*?/\* PILOT_SPRITES_'+kind+r'_END \*/'
        assert len(re.findall(pat,src,re.S))==1
        src=re.sub(pat,lambda m:'/* PILOT_SPRITES_'+kind+'_BEGIN */\n'+content+'\n/* PILOT_SPRITES_'+kind+'_END */',src,flags=re.S)
    page.write_text(src);print(registry)
