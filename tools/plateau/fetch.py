#!/usr/bin/env python3
"""公式公開3D Tilesの最詳細タイルと国土地理院DEMを作業キャッシュへ取得。"""
import argparse, concurrent.futures, hashlib, json, math, pathlib, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
CENTER = (139.6918, 35.68975)

def get(url, path):
    if not path.exists():
        with urllib.request.urlopen(url, timeout=90) as r:
            path.write_bytes(r.read())
    b = path.read_bytes()
    return {'url':url, 'file':path.name, 'bytes':len(b), 'sha256':hashlib.sha256(b).hexdigest()}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('cache',type=pathlib.Path); args=ap.parse_args(); cache=args.cache;cache.mkdir(parents=True,exist_ok=True)
    sources=json.loads((ROOT/'research/maps/plateau-sources.json').read_text())
    # 回転した600m四方を包含する地理座標の矩形。モデル側で正確に切り出す。
    lon,lat=map(math.radians,CENTER); extent=300*(math.cos(math.radians(12))+math.sin(math.radians(12)))
    dl=extent/(6371008.8*math.cos(lat));dp=extent/6371008.8
    jobs=[];sets=[]
    for source in sources['tilesets']:
        kind=source['type'];record=get(source['url'],cache/f'{kind}-tileset.json');sets.append(record)
        tree=json.loads((cache/record['file']).read_text())
        def visit(node, transform=None):
            if node.get('transform') or transform: raise ValueError('未対応のタイル変換行列')
            if node.get('refine','REPLACE')!='REPLACE':raise ValueError('ADDの親子重複を確認してください')
            r=node['boundingVolume']['region']
            if r[0]>lon+dl or r[2]<lon-dl or r[1]>lat+dp or r[3]<lat-dp:return
            if node.get('children'):
                for ch in node['children']:visit(ch)
            elif node.get('content'):
                content=node['content'];uri=content.get('uri',content.get('url'))
                jobs.append((kind,source['url'].rsplit('/',1)[0]+'/'+uri,cache/(kind+'-'+uri.split('/')[-1])))
        visit(tree['root'])
    def work(job):
        kind,url,path=job;return {'kind':kind,**get(url,path)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:models=list(pool.map(work,jobs))
    # 5m DEM（レーザ）のPNG、必要なタイルだけ。標高値の画像であり背景地図ではない。
    z=15;n=2**z
    def pixel(lo,la):return ((lo+180)/360*n,(1-math.asinh(math.tan(math.radians(la)))/math.pi)/2*n)
    a=pixel(math.degrees(lon-dl),math.degrees(lat+dp));b=pixel(math.degrees(lon+dl),math.degrees(lat-dp))
    dem=[]
    for x in range(int(a[0]),int(b[0])+1):
        for y in range(int(a[1]),int(b[1])+1):
            url=f'https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png'
            dem.append({'x':x,'y':y,'z':z,**get(url,cache/f'dem5a_png-{z}-{x}-{y}.png')})
    geoid=get('https://vldb.gsi.go.jp/sokuchi/surveycalc/geoid/calcgh/cgi/geoidcalc.pl?outputType=json&latitude=35.68975&longitude=139.6918',cache/'geoid.txt')
    reference=get('https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=139.6918&lat=35.68975&outtype=JSON',cache/'gsi-elevation.json')
    manifest={'geoid':geoid,'referenceElevation':reference,'center':CENTER,'rotationDegrees':12,'halfExtent':300,'tilesets':sets,'models':models,'dem':dem}
    (cache/'inputs.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'models':len(models),'modelBytes':sum(m['bytes'] for m in models),'demTiles':len(dem)}))
if __name__=='__main__':main()
