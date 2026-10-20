// 昇降設備を実際に操作して確かめる試験場。白煙循環区の既存の地形・施設は変更しない。
(window.MAP_DATA = window.MAP_DATA || {}).mobility = {
  order: 6, name: '昇降設備試験場', subtitle: '垂直射出と運搬', asym: true,
  size: [135, 240], team: 5, time: 300, baseZ: 210, baseLine: 165,
  desc: '中央の高さ12mの台地へ、西のジャンプパッドか東の往復リフトで上がる。通常のジャンプでは届かない。設備の操作検証用。',
  testOnly: true, // 試験用。マップ選択には出さない
  terrain: [
    {type:'block', x:0, z:0, hx:12, hz:27, h:12, slope:2},
    {type:'block', x:0, z:141, hx:18, hz:3, h:5, slope:2.5},
    {type:'block', x:-21, z:151, hx:3, hz:10, h:5, slope:2.5},
    {type:'block', x:21, z:151, hx:3, hz:10, h:5, slope:2.5},
    {type:'trench', x:0, z0:147, z1:158, w:12, slope:3, h:-2},
    {type:'block', x:0, z:-141, hx:18, hz:3, h:5, slope:2.5},
    {type:'block', x:-21, z:-151, hx:3, hz:10, h:5, slope:2.5},
    {type:'block', x:21, z:-151, hx:3, hz:10, h:5, slope:2.5},
    {type:'trench', x:0, z0:-158, z1:-147, w:12, slope:3, h:-2},
  ],
  layout: [], plants: [['A',0,120,'B'],['B',0,0,null],['C',0,-120,'R']],
  turrets: [[-33,177],[33,177]], radar: [-50,220],
  catapults: [[-62,190,-70,90],[62,190,70,90],[-100,190,-100,105],[100,190,100,105]],
  basePods: [[-21,190],[21,190]], plantPods: [['A',0,153],['C',0,-153]],
  barricades: [], bridges: [], water: [],
  jumpPads: [{at:[-20,0,0], rise:28, radius:3, exit:[-6,0,12]}],
  lifts: [{from:[24,0,0], to:[16,0,12], size:[8,8], speed:5, wait:2}],
  paved: [[-135,135,-240,240]],
};
