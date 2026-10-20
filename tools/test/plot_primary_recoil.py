"""実射した弾道の100m面への投影を、変更前後で比較する。"""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Rectangle

folder = Path(sys.argv[1] if len(sys.argv) > 1 else 'media/primary-recoil')
data = json.loads((folder / 'shots.json').read_text())
fonts = {f.name for f in font_manager.fontManager.ttflist}
for candidate in ['Noto Sans CJK JP', 'Noto Sans JP', 'IPAexGothic', 'IPAGothic']:
    if candidate in fonts:
        plt.rcParams['font.family'] = candidate
        break
plt.rcParams['axes.unicode_minus'] = False
fig, axes = plt.subplots(2, 2, figsize=(12, 10), layout='constrained')
for row, (key, name) in enumerate([('haggard', 'マグナム'), ('gatling', 'ガトリング')]):
    runs = [s for s in data['plots'] if s['key'] == key and not s['pause']]
    points = [p for s in runs for p in s['points']]
    xmin = min(-3, min(p['x'] for p in points) - 1)
    xmax = max(3, max(p['x'] for p in points) + 1)
    ymin = min(-3, min(p['y'] for p in points) - .5)
    ymax = max(4, max(p['y'] for p in points) + 1)
    for col, version in enumerate(['before', 'after']):
        ax = axes[row, col]
        s = next(s for s in runs if s['version'] == version)
        ax.add_patch(Rectangle((-1.3, -2.6), 2.6, 4, color='#cbd3db', alpha=.5, label='機体の大きさの目安'))
        ax.axhline(0, color='#667788', lw=.7)
        ax.axvline(0, color='#667788', lw=.7)
        ax.plot([p['x'] for p in s['points']], [p['y'] for p in s['points']], color='#54788b', lw=.6, alpha=.5)
        ax.scatter([p['x'] for p in s['points']], [p['y'] for p in s['points']], c=[p['time'] for p in s['points']], cmap='plasma', s=28, edgecolors='#172839', linewidths=.4, zorder=3)
        if key == 'haggard':
            for i, p in enumerate(s['points']):
                ax.annotate(str(i + 1), (p['x'], p['y']), xytext=(5, 3), textcoords='offset points', fontsize=9)
            if version == 'after':
                paced = next(s for s in data['plots'] if s['key'] == key and s['pause'] and s['version'] == 'after')
                ax.scatter([p['x'] for p in paced['points']], [p['y'] for p in paced['points']], marker='x', color='#087b55', s=60, label='1秒間隔で射撃', zorder=4)
                ax.legend(loc='upper right', fontsize=9)
        ax.set(xlim=(xmin, xmax), ylim=(ymin, ymax), xlabel='照準からの左右の距離（m）', ylabel='照準より上への距離（m）')
        ax.set_title(f"{name}・{'変更前' if version == 'before' else '変更後'}  ({len(s['points'])}発)")
        ax.grid(alpha=.2)
fig.suptitle('照準を補正せずに撃ったときの弾道の比較', fontsize=18)
fig.supxlabel('100m先の面へ弾道を投影。標準機体・同じ初期乱数・武器本来のばらつき。\n色は発射順（暗い→明るい）。灰色は機体の大きさの目安。', fontsize=11)
fig.savefig(folder / 'comparison.png', dpi=160)
fig.savefig(folder / 'comparison.svg')
svg = folder / 'comparison.svg'
svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines()) + '\n')
print('弾道の比較画像を保存:', folder / 'comparison.png')
