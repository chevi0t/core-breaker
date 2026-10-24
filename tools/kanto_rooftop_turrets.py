"""半縮尺都市の屋上防衛砲台を、既存の砲台生成経路へ追加する。

prototypeは編集しない。rooftopTurretsのatは既存マップに合わせて[x,z,y]。
所属はプラントの所有状態に連動せず、指定した陣営に固定する。
"""


def _once(source, before, after):
    if source.count(before) != 1:
        raise ValueError('屋上砲台の接続箇所が一致しません: ' + before[:90])
    return source.replace(before, after)


def apply_rooftop_turrets_patch(source):
    """台座の世界座標・向きだけを拡張し、性能と射撃処理は既存のまま使う。"""
    source = _once(source, '''function buildTurrets(list) {
for (const [x, z] of list) for (const k of ['B', 'R']) {
  const s = k === 'B' ? 1 : -1;
  const [px,pz]=baseCoords(k,x,z),pos = new T.Vector3(px, terrainH(px,pz), pz);''', '''function buildTurrets(list) {
const sites=[];
for (const [x,z] of list) for (const team of ['B','R']) {
  const [px,pz]=baseCoords(team,x,z);
  sites.push({team,at:[px,pz,terrainH(px,pz)]});
}
// 屋上の追加砲台だけは世界座標。基地用の対称展開やプラント占拠による所属変更はしない。
for (const site of curMap.rooftopTurrets||[]) {
  if(!['B','R'].includes(site.team)||!Array.isArray(site.at)||site.at.length!==3||
     !site.at.every(Number.isFinite)||typeof site.plant!=='string'||!site.plant||
     (site.yaw!==undefined&&!Number.isFinite(site.yaw)))throw Error('屋上砲台の配置が不正です');
  sites.push({...site,rooftop:true});
}
for (const site of sites) {
  const k=site.team,s=k==='B'?1:-1;
  const [px,pz,py]=site.at,pos=new T.Vector3(px,py,pz);''')
    source = _once(source,
        'obstacles.push({ minX: pos.x - 1.5, maxX: pos.x + 1.5, minZ: pos.z - 1.5, maxZ: pos.z + 1.5, top: pos.y + 2.4 });',
        'obstacles.push({ minX: pos.x - 1.5, maxX: pos.x + 1.5, minZ: pos.z - 1.5, maxZ: pos.z + 1.5, top: pos.y + 2.4, ...(site.rooftop?{bottom:pos.y}:{}) });')
    return _once(source,
        'base, baseMat, head, parts: [dome, barrel], yaw: s > 0 ? 0 : Math.PI,',
        'base, baseMat, head, parts: [dome, barrel], yaw: site.yaw ?? (s > 0 ? 0 : Math.PI),\n'
        '    rooftop:!!site.rooftop, rooftopPlant:site.rooftop?site.plant:null,')
