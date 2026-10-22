"""既存の衝突体積と頂点を共有し、形状を変えずに試走用データを小さくする。"""
import base64
import numpy as np


def pack_meshes(meshes, volumes):
    shared = []; known = {}
    for v in volumes:
        for ring in v['rings']:
            for x, z in ring:
                for y in [v['bottom'], v['top']]:
                    row = np.asarray([x,y,z],dtype='<f4'); key = row.tobytes()
                    if key not in known:
                        known[key] = len(shared); shared.append(row)
    shared = np.asarray(shared,dtype='<f4').reshape(-1,3)
    result = {}; stats = {}; before = after = 0
    for name, source in meshes.items():
        a = source.astype('<f4'); extras = []; local = {}; indices = []
        for row in a:
            key = row.tobytes(); i = known.get(key)
            if i is None:
                if key not in local:
                    local[key] = len(shared)+len(extras); extras.append(row)
                i = local[key]
            indices.append(i)
        extra = np.asarray(extras,dtype='<f4').reshape(-1,3)
        index = np.asarray(indices,dtype='<u2' if len(shared)+len(extra)<=65536 else '<u4')
        # 符号付きゼロも含め、元のfloat32列とビット単位で一致することを要求する。
        restored = np.concatenate([shared,extra])[index]
        assert restored.tobytes()==a.tobytes(), f'頂点の復元が一致しない: {name}'
        result[name] = {'indices':base64.b64encode(index.tobytes()).decode(),
                        'extra':base64.b64encode(extra.tobytes()).decode(),'indexBytes':index.dtype.itemsize}
        stats[name] = {'triangles':len(a)//3,'vertices':len(a),'extraVertices':len(extra),
                       'beforeBytes':a.nbytes,'afterBytes':index.nbytes+extra.nbytes}
        before += a.nbytes; after += index.nbytes+extra.nbytes
    return result, {'encoding':'volume-pool-v1','sharedVertices':len(shared),
                    'beforeBytes':before,'afterBytes':after,'layers':stats,'bitExact':True}
