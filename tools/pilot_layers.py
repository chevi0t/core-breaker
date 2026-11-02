"""パイロットの絵を層に分ける（後ろ髪・体・左腕・右腕・顔・前髪、やられ顔の顔）。2026-11-02、オーナーの決定で導入。

ゲームでは層ごとに網目に貼って別々のばねで揺らす（index.html「パイロット絵の揺れ」の createPilotLayers）。
胸は体の層の中で網目で弾ませ、腕は上の層なので胸に巻き込まれない。手は操縦桿に固定、肩は体について行く。

  python3 tools/pilot_layers.py moss4        # prototype/avatars/pilots/moss4/layers/ を作り直す
  python3 tools/embed_pilot_sprites.py       # ページへ埋め込む（manifest.json がある キャラは層も入る）

使う物（<キャラ>/）：
  normal.webp|png・damage.webp|png  標準とやられ顔（ポーズが同じ2枚）
  layers/rig.json                    層の範囲。位置は絵の幅と高さを1とした値
    hairMaxY      髪を拾う下端の高さ
    hairLight     白い髪のキャラ：[彩度の上限, 明るさの下限]。色で拾わず、体（bodyHull）・腕の外の明るい所を髪とする
    strayMaxY     体の外の細い毛を拾う下端（既定 hairMaxY+0.04）
    notHair       髪から除く楕円 [中心x,中心y,半径x,半径y]（目など）
    notHairPoly   髪から除く多角形、またはその並び（服の紫、操縦桿の頭など）
    hairPoly      白い髪のキャラ：体（bodyHull）の中でも明るい所を髪にする多角形の並び（肩に掛かる三つ編みなど）
    frontHair     この中の髪は前髪（顔と白衣の前）。外は後ろ髪
    head・armL・armR  顔・左腕・右腕の多角形（髪を除いた所）
    armRefine     腕の多角形の中を袖の色で絞る {"armL": {"mode": "light"（白い袖）|"dark"（黒い袖）, "keep": 手と袖口の多角形}}
    bodyHull      体の外形。外にある細い線も髪として扱う（白い髪のキャラでは、この中は髪にしない）
  layers/plate_body.png・plate_face.png（無くてよい）  ComfyUI で腕と前の髪・前髪を消して描き足した絵
                                       （MOSS_layers_v11）。あれば隠れていた所はこの絵を使い、無ければ色をにじませて仮に描き足す
作る物（layers/）：<層>.webp と manifest.json（層の並び・範囲）。重ねると元の絵に戻ることを確かめる。
Pillow・numpy・scipy が要る。"""
import io, json, pathlib, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = 450   # 切り分ける大きさ（マスクの太さはこの大きさで決めてある）
OUT = 320    # ページに入れる大きさ（今の1枚絵と同じ）
ORDER = ['hairB', 'body', 'armL', 'armR', 'head', 'hairF']   # 奥から手前

def load(char, state):
    for ext in ('.png', '.webp'):
        p = char / (state + ext)
        if p.exists(): return Image.open(p).convert('RGBA').resize((WORK, WORK), Image.LANCZOS)
    return None

def hsv(rgb):
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn + 1e-6
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return hue, d / (mx + 1e-6), mx

def poly(pts):
    m = Image.new('L', (WORK, WORK), 0); ImageDraw.Draw(m).polygon([(x * WORK, y * WORK) for x, y in pts], fill=255)
    return np.asarray(m) > 127

def armRefine(R, k, P, fg, sat, mx):
    """腕の多角形の中を、袖の色で絞る（armRefine：{"mode": "light"|"dark", "keep": 手と袖口の多角形}）。
    腕に掛かった髪の筋や、腕の脇の髪を腕の層に入れない（エース：白い袖と黒い袖、2026-11-02）"""
    ref = R.get('armRefine', {}).get(k)
    if not ref: return P
    cond = (sat < ref.get('sat', 0.06)) & (mx > ref.get('v', 0.7)) if ref['mode'] == 'light' else (mx < ref.get('v', 0.5))
    core = nd.binary_opening(P & cond & fg, iterations=ref.get('open', 3))   # 細い髪の筋を落とす
    lab, n = nd.label(core); sizes = nd.sum(core, lab, range(1, n + 1))
    core = np.isin(lab, 1 + np.where(sizes >= ref.get('minArea', 300))[0])
    core = nd.binary_fill_holes(nd.binary_closing(core, iterations=4))
    core = nd.binary_dilation(core, iterations=2) & P & fg   # 袖の縁取りの線も腕に入れる
    if ref.get('keep'): core |= poly(ref['keep']) & P
    return core

def split(img, R):
    """層のマスク（重ならず、合わせると絵の全部）"""
    rgb, a = img[..., :3], img[..., 3]
    hue, sat, mx = hsv(rgb)
    yy, xx = np.mgrid[0:WORK, 0:WORK]; u = (xx + .5) / WORK; v = (yy + .5) / WORK
    fg = a > 0.02
    head, armL, armR, hull = poly(R['head']), poly(R['armL']), poly(R['armR']), poly(R['bodyHull'])
    armL, armR = (armRefine(R, k, P, fg, sat, mx) for k, P in (('armL', armL), ('armR', armR)))
    notHair = np.zeros_like(fg)
    for e in R.get('notHair', []): notHair |= ((u - e[0]) / e[2]) ** 2 + ((v - e[1]) / e[3]) ** 2 < 1
    nhp = R.get('notHairPoly') or []
    for q in ([nhp] if nhp and isinstance(nhp[0][0], (int, float)) else nhp): notHair |= poly(q)
    hairIn = np.zeros_like(fg)   # 体の中でも髪にする所（体に掛かる三つ編みや房）
    for q in R.get('hairPoly', []): hairIn |= poly(q)
    skin = (hue < 50) & (sat > 0.12) & (mx > 0.55)
    if R.get('hairLight'):
        # 白い髪（服と同じ色）：色では分けず、体・腕の多角形の外の明るい所を髪とする。顔の多角形の中は肌でない明るい所（前髪）
        sMax, vMin = R['hairLight']
        skin |= (hue > 3) & (hue < 45) & (sat > 0.05) & (mx > 0.55)   # 白い肌（彩度が低い）
        light = fg & (sat < sMax) & (mx > vMin) & (v < R['hairMaxY']) & ~skin & ~notHair
        hair0 = light & ((~hull & ~armL & ~armR) | hairIn)
        hair = nd.binary_closing(hair0, iterations=2) & fg & ((~hull & ~armL & ~armR) | hairIn) & ~notHair & ~skin
    else:
        hair0 = (hue > 235) & (hue < 315) & (sat > 0.18) & (mx > 0.16) & (v < R['hairMaxY']) & fg & ~notHair
        hair0 = nd.binary_opening(hair0, iterations=1)
        lab, n = nd.label(hair0); sizes = nd.sum(hair0, lab, range(1, n + 1))
        hair0 = np.isin(lab, 1 + np.where(sizes >= 12)[0])
        coat = (sat < 0.12) & (mx > 0.72)
        hair = nd.binary_dilation(hair0, iterations=2) & fg & ~coat & ~skin   # 髪の縁の線も髪に入れる
        hair = nd.binary_closing(hair, iterations=2) & fg
    stray = fg & ~hull & ~head & ~armL & ~armR & ~notHair & (v < R.get('strayMaxY', R['hairMaxY'] + .04))  # 体の外の細い毛
    hair |= stray & ~skin if R.get('hairLight') else stray
    front = poly(R['frontHair'])
    M = {'hairF': hair & front, 'hairB': hair & ~front}
    rest = fg & ~hair
    M['head'] = rest & head
    M['armL'] = rest & armL & ~M['head']
    M['armR'] = rest & armR & ~M['head'] & ~M['armL']
    M['body'] = rest & ~M['head'] & ~M['armL'] & ~M['armR']
    return M

def smear(rgb, known, region, iters=120):
    """known の色を region へにじませる（仮の描き足し）"""
    out = rgb.copy(); got = known.copy()
    for _ in range(iters):
        c = nd.uniform_filter(out * got[..., None], size=(3, 3, 1)); w = nd.uniform_filter(got.astype(np.float32), size=3)
        new = region & ~got & (w > 1e-3)
        if not new.any(): break
        out[new] = c[new] / w[new, None]; got |= new
    return out, got

def layer(img, M, name, fill, core=None, plate=None, fade=None):
    """name の層。fill=[(手前の層, 幅px)]：その層に隠れていた所のうち、name から幅px以内を描き足す。
    fade=(縁px, 幅px)：描き足しを、絵の外形の縁から縁px以内と、name から幅pxの所へ向けて薄くする
    （大きくずれて見えた時に、手前の層の輪郭の形がそのまま出ないように）"""
    m = M[name]; a = img[..., 3] * m; rgb = img[..., :3].copy()
    region = np.zeros_like(m)
    for other, band in fill: region |= M[other] & nd.binary_dilation(m, iterations=band)
    region &= nd.binary_erosion(img[..., 3] > 0.5, iterations=2)   # 絵の外形の内側だけ（縁の半透明に色を足さない）
    if plate is not None:
        rgb[region] = plate[..., :3][region]; got = region.copy()
    else:
        solid = m & (img[..., 3] > 0.9)
        if core is not None: solid &= core
        rgb, got = smear(rgb, solid, region)
        fr = region & got
        if fr.any():  # にじませた筋をぼかす
            w = np.maximum(nd.gaussian_filter(fr.astype(np.float32), 2.5), 1e-4)
            bl = np.dstack([nd.gaussian_filter(rgb[..., i] * fr, 2.5) for i in range(3)]) / w[..., None]
            rgb[fr] = bl[fr]
    fa = nd.gaussian_filter(np.where(region & got, 1.0, 0.0), 0.7) * (region | m)
    if fade:
        edge, far = fade
        # 髪の下端より下（手や操縦桿のあたり）には描き足さない。列ごとの下端を横に少し広げる
        rows = np.where(m.any(0), m.shape[0] - 1 - np.argmax(m[::-1], 0), -1)
        low = nd.maximum_filter1d(rows, 15) + 3
        fa *= np.arange(m.shape[0])[:, None] <= low[None, :]
        dBg = nd.distance_transform_edt(img[..., 3] > 0.5); dIn = nd.distance_transform_edt(~m)
        fa *= np.clip(dBg / edge, 0, 1) * np.clip((far - dIn) / (far * .5), 0, 1)
    alpha = np.maximum(a, fa)
    return np.dstack([rgb, alpha])

def build(char):
    R = json.loads((char / 'layers/rig.json').read_text())
    n, d = load(char, 'normal'), load(char, 'damage')
    img = np.asarray(n).astype(np.float32) / 255
    M = split(img, R)
    plates = {}
    for k in ('body', 'face'):
        p = char / 'layers' / f'plate_{k}.png'
        if p.exists(): plates[k] = np.asarray(Image.open(p).convert('RGBA').resize((WORK, WORK), Image.LANCZOS)).astype(np.float32) / 255
    hue, sat, mx = hsv(img[..., :3])
    core = (sat < R['hairLight'][0]) & (mx > 0.8) & ((hue > 200) | (sat < 0.03)) if R.get('hairLight') else (hue > 235) & (hue < 315) & (sat > 0.25)   # にじませる元（髪の地の色）
    # 後ろ髪は揺れると体・腕の縁から大きくずれる（倍率×3、オプションでさらに×3）ので、体と腕の下へ広く描き足す（12px では縁に隙間が出た 2026-11-02）。
    # 描き足しは絵の外形の縁と、髪から遠い所で薄くする（手前の腕や肩の輪郭の形の髪の塊がはみ出して見えないように）
    B = R.get('hairBFill', 40)
    L = {'hairB': layer(img, M, 'hairB', [('body', B), ('armL', B), ('armR', B), ('head', 10), ('hairF', 10)], core=core, fade=(14, B)),
         # 白い服のキャラは、前髪の下を服の白からにじませる（黒い縁取りや紐をにじませると、髪が揺れた時に黒いしみに見える）
         'body': layer(img, M, 'body', [('armL', 12), ('armR', 12), ('head', 8), ('hairF', 14)], core=(sat < 0.3) & (mx > 0.75) if R.get('hairLight') else None, plate=plates.get('body')),
         'armL': layer(img, M, 'armL', []), 'armR': layer(img, M, 'armR', []),
         'head': layer(img, M, 'head', [('hairF', 8)], plate=plates.get('face')),
         'hairF': layer(img, M, 'hairF', [])}
    if d is not None:  # やられ顔は顔の層だけ（ポーズが同じ2枚）
        dimg = np.asarray(d).astype(np.float32) / 255
        diff = (np.abs(dimg - img).max(-1) > 0.16) & (img[..., 3] > 0.5)
        outside = nd.binary_opening(diff & ~nd.binary_dilation(M['head'], iterations=2), iterations=1)
        if outside.sum() > 40: print(char.name, ': やられ顔の違いが顔の層の外にもある（', int(outside.sum()), 'px）。顔の層だけ差し替える')
        L['headD'] = layer(dimg, M, 'head', [('hairF', 8)], plate=plates.get('face'))
    # 重ねると元の絵に戻るか
    comp = np.zeros((WORK, WORK, 4), np.float32)
    for k in ORDER:
        s = np.clip(L[k], 0, 1); sa = s[..., 3:4]
        comp[..., :3] = s[..., :3] * sa + comp[..., :3] * (1 - sa); comp[..., 3:4] = sa + comp[..., 3:4] * (1 - sa)
    err = np.maximum(np.abs(comp[..., :3] - img[..., :3] * img[..., 3:4]).max(-1), np.abs(comp[..., 3] - img[..., 3]))
    assert err.max() < 0.15, f'重ねた絵が元と違う（最大 {err.max():.3f}）'
    out = char / 'layers'
    for f in out.glob('*.webp'): f.unlink()
    man = {'size': OUT, 'order': ORDER, 'layers': {}}; total = 0
    for k, v in L.items():
        im = Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8), 'RGBA')
        im = im.convert('RGBa').resize((OUT, OUT), Image.LANCZOS).convert('RGBA')   # 透明の縁が黒ずまないよう乗算して縮める
        bb = im.getbbox(); b = io.BytesIO(); im.crop(bb).save(b, 'WEBP', quality=88, method=6)
        (out / f'{k}.webp').write_bytes(b.getvalue()); total += len(b.getvalue())
        man['layers'][k] = {'bbox': [round(bb[0] / OUT, 5), round(bb[1] / OUT, 5), round((bb[2] - bb[0]) / OUT, 5), round((bb[3] - bb[1]) / OUT, 5)]}
    man['plates'] = sorted(plates)
    (out / 'manifest.json').write_text(json.dumps(man, ensure_ascii=False, indent=1) + '\n')
    print(char.name, ': 層', list(L), f'{total} バイト', '描き足し：' + ('、'.join(plates) + ' は ComfyUI の絵' if plates else 'すべて仮（にじませ）'), f'重ねた誤差 {err.max():.3f}')

if __name__ == '__main__':
    for name in sys.argv[1:] or ['moss4']: build(ROOT / 'prototype/avatars/pilots' / name)
