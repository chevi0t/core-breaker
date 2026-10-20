"""登録データから、両基地を自陣の正面を上にして比較する平面図を作る。"""
import json, pathlib, subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
data = json.loads(subprocess.check_output(['node', '-e', "global.window={};require('./prototype/maps/tidal.js');console.log(JSON.stringify(window.MAP_DATA.tidal))"], cwd=ROOT))
font_path = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
font = lambda size: ImageFont.truetype(font_path, size)
im = Image.new('RGB', (1440, 690), '#101b25')
d = ImageDraw.Draw(im)
d.text((35, 18), '潮路搬送区 — 基地内の攻防と非対称性', font=font(30), fill='#edf4f7')
d.text((35, 62), '登録済みの配置から作図。両軍とも「正面 → コア → 後方施設」の向きで表示。', font=font(18), fill='#bacbd8')
colors = {'baseWall':'#6e8192', 'office':'#a1b8ca', 'barracks':'#677f68', 'container':'#4a8b76', 'trailer':'#c5c6b8', 'hesco':'#b3a276', 'prefab':'#a8ae8b'}
for col, (team, sign, title) in enumerate([('B',1,'青：常設の駐屯基地'), ('R',-1,'橙：侵攻側の野戦拠点')]):
    ox = 35 + col*710
    color = '#58b6ff' if sign>0 else '#ffa65e'
    d.text((ox, 106), title, font=font(25), fill=color)
    scale=1.85
    def p(x,z): return ox+320+x*scale, 166+(z-408)*scale
    def rect(x,z,w,h,**kwargs): d.rectangle([p(x-w/2,z-h/2),p(x+w/2,z+h/2)],**kwargs)
    rect(0,488,342,160,fill='#34434a',outline='#647a86',width=2)
    rect(*data['baseDefense']['yard'], fill='#46545a')
    for b in data['layout']:
        x,z,w,h,height,*skin=b
        if z*sign<416: continue
        kind=skin[0] if skin else ''
        rect(x*sign,z*sign,w,h,fill=colors.get(kind,'#7e8589'),outline='#1b2931',width=2)
        if kind=='hesco':
            for xx in range(int(x*sign-w/2)+3,int(x*sign+w/2),5):
                d.line([p(xx,z*sign-h/2),p(xx,z*sign+h/2)],fill='#756946',width=1)
    for x,z,w,h,y,th in data['bridges']:
        if z*sign<410: continue
        rect(x*sign,z*sign,w,h,outline='#ddbf78',width=3)
    for x,z in data['turrets']:
        rect(x,z,4,4,fill='#e2a165')
    for x,z in data['basePods']:
        a,b=p(x,z);d.ellipse((a-5,b-5,a+5,b+5),fill='#69e7a9')
    for x,z in data['baseDefense']['posts']:
        a,b=p(x,z);d.ellipse((a-6,b-6,a+6,b+6),fill=color,outline='#edf4f7',width=2)
    cx,cy=p(0,data['baseZ']);d.ellipse((cx-14,cy-14,cx+14,cy+14),fill=color,outline='#ffffff',width=2)
    d.text((cx+18,cy-14),'コア',font=font(17),fill='#ffffff')
    rx,ry=p(*data['radar']);d.rectangle((rx-6,ry-6,rx+6,ry+6),fill='#c79df5')
    d.text((rx-33,ry+9),'レーダー',font=font(15),fill='#e3d0ff')
    bx,by=p(-170,data['baseLine']);ex,ey=p(170,data['baseLine']);
    for x in range(int(bx),int(ex),16): d.line((x,by,x+8,by),fill=color,width=2)
    d.text((ox+12,by-24),'警報の境界',font=font(14),fill=color)
    def arrow(points, label, offset=(0,0), fill='#f4d071'):
        pts=[p(x,z) for x,z in points];d.line(pts,fill=fill,width=4)
        x,y=pts[-1];px,py=pts[-2];dx,dy=x-px,y-py;l=(dx*dx+dy*dy)**.5;dx,dy=dx/l,dy/l
        d.polygon([(x,y),(x-11*dx+5*dy,y-11*dy-5*dx),(x-11*dx-5*dy,y-11*dy+5*dx)],fill=fill)
        d.text((pts[0][0]+offset[0],pts[0][1]+offset[1]),label,font=font(15),fill=fill)
    arrow([(-36,412),(-36,458)],'正面',(-22,-26))
    arrow([(-158,504),(-96,504)],'搬入口',(-15,-30))
    arrow([(158,504),(96,504)],'搬入口',(-30,-30))
    arrow([(148,531.2),(126,531.2),(106,531.2)],'J → 屋根',(-50,14),'#70edbb')
    labels = [('事務所',-82,531.2),('兵舎',82,531.2)] if sign>0 else [('プレハブ',-82,531.2),('プレハブ',82,531.2)]
    for text,x,z in labels:
        a,b=p(x,z);d.text((a-30,b-8),text,font=font(13),fill='#121f29')
    d.text((ox,487), 'コンクリート壁 10m／兵舎・事務所 12m' if sign>0 else 'HESCO壁 8m／プレハブ 8m・厚みと内壁で防御',font=font(18),fill='#e0e9ef')
    d.text((ox,520), 'コンテナ・トレーラー・建屋で内部の射線を分割' if sign>0 else '低い壁と、位置をずらした内壁・仮設建屋',font=font(18),fill='#bacbd8')
d.text((35,580),'● 守備位置　■ レーダー　緑：補給／パッド　金枠：上層の床・門の梁　矢印：侵入口',font=font(18),fill='#e5edf2')
d.text((35,620),'侵入後も遮蔽を使える。両側の搬入口＋屋根から迂回可能。索敵→帰還待機→迎撃の時間を争う。',font=font(19),fill='#bacbd8')
out=ROOT/'mapdesign/tidal/v3/base-plan.png';im.save(out);print(out)
