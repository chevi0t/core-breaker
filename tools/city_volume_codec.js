// 地形確認用の建物整数列を復元する。座標・高さ・色の精度は変更しない。
function decodeCityVolumes(layout) {
  if (Array.isArray(layout.volumes)) return layout.volumes;
  const old = layout.volumeEncoding === 'kind-u8-color-u8-y01-i16-rings-u16';
  if (!old && layout.volumeEncoding !== 'kind2-color4-flags2-y01-i16-rings-u8') throw Error('未対応の建物保存形式');
  const a = Uint8Array.from(atob(layout.volumes), c => c.charCodeAt(0)), view = new DataView(a.buffer), out = [];
  let offset = 0;
  const take = n => { if (offset + n > a.length) throw Error('建物の整数列が途中で切れています'); const start = offset; offset += n; return start; };
  const u8 = () => view.getUint8(take(1)), u16 = () => view.getUint16(take(2), true), i16 = () => view.getInt16(take(2), true);
  while (offset < a.length) {
    let kind, colorIndex, bottom, top, n;
    if (old) { kind = u8(); colorIndex = u8(); bottom = i16(); top = i16(); n = u16(); }
    else {
      const tag = u8(); kind = tag & 3; colorIndex = tag >> 2 & 15; top = i16();
      bottom = tag & 128 ? i16() : [-25, null, -50, top - 100][kind];
      n = tag & 64 ? u8() + 1 : 1;
    }
    if (kind >= layout.volumeKinds.length || colorIndex >= layout.volumeColors.length || !n || bottom === null || top <= bottom) throw Error('建物の種類・色・寸法が不正です');
    const rings = [];
    for (let i = 0; i < n; i++) {
      let count = old ? u16() : u8();
      if (!old && count === 255) count = u16();
      if (count < 3) throw Error('建物の頂点不足');
      const start = take(count * 4);
      let text = '';
      for (let p = start; p < start + count * 4; p += 32768) text += String.fromCharCode(...a.subarray(p, Math.min(p + 32768, start + count * 4)));
      rings.push(btoa(text));
    }
    const color = layout.volumeColors[colorIndex];
    out.push([kind, bottom / 100, top / 100, rings, color ? { landmarkColor: color } : {}]);
  }
  if (out.length !== layout.volumeCount) throw Error('建物の件数が一致しません');
  return out;
}
if (typeof module !== 'undefined') module.exports = { decodeCityVolumes };
