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
    ap=argparse.ArgumentParser(); ap.add_argument('cache',type=pathlib.Path); ap.add_argument('--config',type=pathlib.Path,default=ROOT/'research/maps/plateau-sources.json'); args=ap.parse_args(); cache=args.cache;cache.mkdir(parents=True,exist_ok=True)
    sources=json.loads(args.config.read_text());center=sources.get('referenceCenter',CENTER);rotation=sources.get('rotationDegrees',12);half=sources.get('halfExtent',300)
    # キャッシュの地理範囲と出典を固定し、別の地域の標高・タイル一覧を混ぜない。
    if (cache/'inputs.json').exists():
        previous=json.loads((cache/'inputs.json').read_text())
        if (previous['center']!=center or previous['rotationDegrees']!=rotation or previous['halfExtent']!=half or
                [v['url'] for v in previous['tilesets']]!=[v['url'] for v in sources['tilesets']]):
            raise ValueError('中心・範囲・出典が既存キャッシュと異なります。別のキャッシュを指定してください。')
    # 回転した街区を包含する矩形へ8mの余白を加える。モデル側で正確に切り出す。
    lon,lat=map(math.radians,center); extent=half*(abs(math.cos(math.radians(rotation)))+abs(math.sin(math.radians(rotation))))+8
    dl=extent/(6371008.8*math.cos(lat));dp=extent/6371008.8
    jobs=[];sets=[]
    for source in sources['tilesets']:
        kind=source['type'];ident=source.get('id',kind);record=get(source['url'],cache/f'{ident}-tileset.json');sets.append({'kind':kind,**record})
        tree=json.loads((cache/record['file']).read_text())
        def visit(node, transform=None):
            if node.get('transform') or transform: raise ValueError('未対応のタイル変換行列')
            if node.get('refine','REPLACE')!='REPLACE':raise ValueError('ADDの親子重複を確認してください')
            # 一部の配信データは親の範囲が子全体を覆わないため、末端の実content範囲で選ぶ。
            if node.get('children'):
                for ch in node['children']:visit(ch)
            elif node.get('content'):
                content=node['content'];uri=content.get('uri',content.get('url'));r=content.get('boundingVolume',node['boundingVolume'])['region']
                if r[0]>lon+dl or r[2]<lon-dl or r[1]>lat+dp or r[3]<lat-dp:return
                jobs.append((kind,source['url'].rsplit('/',1)[0]+'/'+uri,cache/(ident+'-'+hashlib.sha256(uri.encode()).hexdigest()[:10]+'-'+uri.split('/')[-1]),r))
        visit(tree['root'])
    def work(job):
        kind,url,path,region=job;return {'kind':kind,'bounds':region,**get(url,path)}
    jobs=list({job[1]:job for job in jobs}.values())
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
    geoid=get(f'https://vldb.gsi.go.jp/sokuchi/surveycalc/geoid/calcgh/cgi/geoidcalc.pl?outputType=json&latitude={center[1]}&longitude={center[0]}',cache/'geoid.txt')
    reference=get(f'https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon={center[0]}&lat={center[1]}&outtype=JSON',cache/'gsi-elevation.json')
    manifest={'geoid':geoid,'referenceElevation':reference,'center':center,'rotationDegrees':rotation,'halfExtent':half,'display':sources.get('display',{}),'checks':sources.get('checks',{'minimumReliefMeters':10,'multiLevelWitnesses':[[165,-75],[165,120]]}),'sourceLinks':[{'url':v.get('datasetUrl',sources.get('officialDatasetUrl')),'label':v.get('label',sources.get('areaName','新宿区')+str(sources.get('year',2025))+'年度3D都市モデル')} for v in sources['tilesets']],'tilesets':sets,'models':models,'dem':dem}
    (cache/'inputs.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'models':len(models),'modelBytes':sum(m['bytes'] for m in models),'demTiles':len(dem)}))
if __name__=='__main__':main()
