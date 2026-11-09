// Node回帰とブラウザの同じ判定。instrument()で関数ごとdbgへ渡すので外部参照を持たない。
function publicStateChecks(actual,expected){
  // オブジェクトのキー順だけを無視する。配列の順序・型・値・項目の有無は保つ。
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?
    Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  return ['cores','plants','timeLeft'].map(key=>({
    name:({cores:'CORE',plants:'プラント',timeLeft:'残り時間'})[key]+'を保存',
    value:equal(actual[key],expected[key]),
    data:{field:key,actual:actual[key],expected:expected[key]}
  }));
}
module.exports={publicStateChecks};
