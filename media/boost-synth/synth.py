"""クイックブーストの「ボッ」を雑音から合成する（外部素材なし）。
python3 synth.py <出力フォルダ>
各案について、ゲーム用の単発（<名前>.wav）と、単発→3連発の試聴（<名前>-preview.wav）を書く。
"""
import math, sys, wave, pathlib
import numpy as np

SR = 44100
rng = np.random.default_rng(20261027)


def biquad(x, kind, f0, q=0.707, gain_db=0.0):
    # RBJ Audio EQ Cookbook の2次フィルター
    w0 = 2 * math.pi * f0 / SR
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    A = 10 ** (gain_db / 40)
    if kind == 'lp':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'hp':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'bp':
        b = [alpha, 0, -alpha]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'peak':
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]; a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    else:
        raise ValueError(kind)
    b = [v / a[0] for v in b]; a1, a2 = a[1] / a[0], a[2] / a[0]
    y = np.zeros_like(x); x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b[0] * v + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def noise(n):
    return rng.standard_normal(n)


def smooth_random(n, rate):
    # rate Hz ほどで揺れる 0..1 の揺らぎ（燃焼のばたつき）
    k = max(2, int(n * rate / SR) + 2)
    pts = rng.random(k)
    t = np.linspace(0, k - 1, n)
    i = np.floor(t).astype(int); f = t - i
    i2 = np.minimum(i + 1, k - 1)
    f = f * f * (3 - 2 * f)
    return pts[i] * (1 - f) + pts[i2] * f


def envelope(n, attack, peak_t, sustain, release_at, release):
    t = np.arange(n) / SR
    e = np.where(t < attack, (t / attack) ** 1.5, 1.0)
    # 山の後は持続の高さへ下がる
    after = t > peak_t
    e = np.where(after, sustain + (1 - sustain) * np.exp(-(t - peak_t) / 0.035), e)
    r = np.clip((t - release_at) / release, 0, 1)
    return e * (1 - r * r * (3 - 2 * r))


def normalize(x, peak_db=-1.0):
    return x / (np.abs(x).max() + 1e-9) * 10 ** (peak_db / 20)


def fade_edges(x, head=0.003, tail=0.02):
    h, t = int(head * SR), int(tail * SR)
    x = x.copy()
    x[:h] *= np.linspace(0, 1, h)
    x[-t:] *= np.linspace(1, 0, t) ** 2
    return x


def roar(n, center, width_q, low_cut, high_cut):
    x = noise(n)
    x = biquad(x, 'hp', low_cut, .6)
    x = biquad(x, 'lp', high_cut, .6)
    x = biquad(x, 'peak', center, width_q, 9)
    return x


def variant_a(dur=0.30):
    # 低い燃焼の「ボォッ」：気球のバーナーに近い太い轟き
    n = int(dur * SR)
    body = roar(n, 160, 1.1, 45, 900)
    mid = biquad(biquad(noise(n), 'bp', 520, .8), 'lp', 1500)
    hiss = biquad(biquad(noise(n), 'hp', 6000, .7), 'lp', 13000, .7)
    flutter = .7 + .3 * smooth_random(n, 32)
    x = body * 1.0 + mid * .45 + hiss * .10
    x *= flutter * envelope(n, .018, .045, .62, .23, .07)
    return fade_edges(normalize(x))


def variant_b(dur=0.25):
    # 明るい噴射の「シュボッ」：空気の吹き出しが前に出る
    n = int(dur * SR)
    body = roar(n, 260, .9, 60, 1600) + roar(n, 110, 1.2, 40, 500) * .55
    air = biquad(biquad(noise(n), 'bp', 1800, .7), 'lp', 4500)
    hiss = biquad(biquad(noise(n), 'hp', 5000, .7), 'lp', 14000, .7)
    puff_n = int(.03 * SR)
    puff = np.zeros(n)
    puff[:puff_n] = biquad(noise(puff_n), 'lp', 2500) * np.exp(-np.arange(puff_n) / (SR * .008))
    flutter = .75 + .25 * smooth_random(n, 40)
    x = body * .85 + air * .5 + hiss * .22
    x *= flutter * envelope(n, .010, .030, .55, .18, .06)
    x += puff * 1.6
    return fade_edges(normalize(x), head=.002)


def variant_c(dur=0.32):
    # 重い衝撃の「ドゥッ」：踏み出しの低い押しを足す
    n = int(dur * SR)
    t = np.arange(n) / SR
    body = roar(n, 120, 1.2, 35, 700)
    mid = biquad(biquad(noise(n), 'bp', 420, .9), 'lp', 1200)
    freq = 45 + 50 * np.exp(-t / .03)
    thump = np.sin(2 * math.pi * np.cumsum(freq) / SR) * np.exp(-t / .045)
    flutter = .7 + .3 * smooth_random(n, 26)
    hiss = biquad(biquad(noise(n), 'hp', 5000, .7), 'lp', 11000, .7)
    x = body + mid * .35 + hiss * .07
    x *= flutter * envelope(n, .015, .040, .58, .24, .07)
    x = x / (np.abs(x).max() + 1e-9) + thump * .9
    x = biquad(x, 'hp', 28, .7)
    return fade_edges(normalize(x))


def smoothstep(t, a, b):
    k = np.clip((t - a) / (b - a), 0, 1)
    return k * k * (3 - 2 * k)


def morph(dur, thump_gain, low_center, shift_at, tail_at, tail_len, keep=.2):
    # 低い「ド／ボ」の轟きから、明るい「シュー」の吹き出しへ移す（A→B）
    n = int(dur * SR)
    t = np.arange(n) / SR
    low = roar(n, low_center, 1.1, 40, 900) + biquad(biquad(noise(n), 'bp', 480, .8), 'lp', 1400) * .4
    sh = biquad(biquad(noise(n), 'bp', 3800, .55), 'lp', 9000)          # 「シュ」の帯域
    air = biquad(biquad(noise(n), 'bp', 1700, .7), 'lp', 4500)
    hiss = biquad(biquad(noise(n), 'hp', 6500, .7), 'lp', 14000, .7)
    m = smoothstep(t, .02, shift_at)                                    # 0 = 低い頭、1 = シュー
    flutter = .72 + .28 * smooth_random(n, 34)
    head = low * (1 - (1 - keep) * m) * flutter  # keep：シューの下に残す轟きの割合
    head *= np.where(t < .012, (t / .012) ** 1.5, 1) * (.55 + .45 * np.exp(-t / .06))
    # シューは頭の後ろから立ち上がり、終わりに向けて少し暗く細くなる
    dark = smoothstep(t, shift_at, tail_at + tail_len)
    tail = (sh * (1 - .35 * dark) + air * (.55 + .2 * dark) + hiss * (.35 * (1 - .6 * dark))) * m
    tail *= .85 + .15 * smooth_random(n, 18)
    x = head / (np.abs(head).max() + 1e-9) + tail / (np.abs(tail).max() + 1e-9) * .75
    if thump_gain:
        freq = 42 + 55 * np.exp(-t / .028)
        x += np.sin(2 * math.pi * np.cumsum(freq) / SR) * np.exp(-t / .05) * thump_gain
    r = smoothstep(t, tail_at, tail_at + tail_len)
    x *= 1 - r
    x = biquad(x, 'hp', 30, .7)
    return fade_edges(normalize(x))


def variant_d():
    # 「ドシュー」：低い押しのある頭から長めのシュー
    return morph(.44, .85, 130, .11, .30, .13)


def variant_e():
    # 「ボシュー」：押しは付けず、太い燃焼の頭から長めのシュー
    return morph(.44, 0, 170, .12, .30, .13, keep=.4)


def variant_f():
    # 「ボシュッ」：Eを短くして連発でも重なりにくくした物
    return morph(.32, .4, 160, .09, .20, .11, keep=.3)


def write(path, x):
    pcm = np.clip(x * 32767, -32768, 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())


def preview(one):
    # 単発 → 0.6秒あけて 0.35秒間隔の3連発
    gap = np.zeros(int(.6 * SR))
    step = int(.35 * SR)
    burst = np.zeros(step * 2 + len(one))
    for k in range(3):
        burst[k * step:k * step + len(one)] += one
    return normalize(np.concatenate([np.zeros(int(.1 * SR)), one, gap, burst, np.zeros(int(.3 * SR))]))


if __name__ == '__main__':
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    for name, fn in [('boost-a-low', variant_a), ('boost-b-bright', variant_b), ('boost-c-heavy', variant_c),
                     ('boost-d-doshu', variant_d), ('boost-e-boshu', variant_e), ('boost-f-boshu-short', variant_f)]:
        x = fn()
        write(out / f'{name}.wav', x)
        write(out / f'{name}-preview.wav', preview(x))
        print(name, f'{len(x) / SR:.2f}s')
