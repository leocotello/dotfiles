"""Original soundtrack for the Marsh Energy Upstream video (45 s).

Synthesised from scratch with numpy, so there is no third-party licensing.
Tempo is 106.67 BPM: one bar = 2.25 s, so each scene cut in video.html lands
on a bar line (4.5, 11.25, 18, 24.75, 31.5, 36, 40.5 s).

Usage: python3 music.py [out.wav]
"""
import sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
DUR = 45.0
BAR = 2.25
BEAT = BAR / 4
N = int(SR * DUR)
rng = np.random.default_rng(7)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env_adsr(n, a, d, s, r, sr=SR):
    a, d, r = int(a * sr), int(d * sr), int(r * sr)
    e = np.full(n, s, dtype=float)
    e[:a] = np.linspace(0, 1, a, endpoint=False) if a else e[:a]
    e[a:a + d] = np.linspace(1, s, max(1, min(d, n - a)))[: len(e[a:a + d])]
    if r and n > r:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def lowpass(x, fc, order=2):
    return sosfilt(butter(order, fc, 'low', fs=SR, output='sos'), x)


def highpass(x, fc, order=2):
    return sosfilt(butter(order, fc, 'high', fs=SR, output='sos'), x)


def place(buf, sig, t):
    i = int(t * SR)
    j = min(len(buf), i + len(sig))
    if i < len(buf):
        buf[i:j] += sig[: j - i]


# Chords per bar (MIDI notes). D minor / F major colour, cadence into F at the end card.
Dm9 = [50, 57, 60, 64, 65]      # D A C E F
Bbmaj7 = [46, 53, 57, 62, 65]   # Bb F A D F
Fadd9 = [41, 53, 57, 60, 67]    # F F A C G
Csus = [48, 55, 60, 62, 67]     # C G C D G
Gm9 = [43, 55, 58, 62, 69]      # G G Bb D A
Asus = [45, 52, 57, 62, 64]     # A E A D E
C = [48, 55, 60, 64, 67]
F_end = [41, 48, 57, 60, 64, 67, 72]

loop = [Dm9, Bbmaj7, Fadd9, Csus]
bars = [loop[i % 4] for i in range(14)] + [Gm9, Asus, Bbmaj7, C, F_end, F_end]
ROOTS = [c[0] for c in bars]

t_all = np.arange(N) / SR

# ---------- pad: detuned saw stack, slow attack, low-passed ----------
pad = np.zeros(N)
for b, chord in enumerate(bars[:18]):
    t0 = b * BAR
    L = int((BAR + 1.2) * SR)
    tt = np.arange(L) / SR
    s = np.zeros(L)
    for n in chord[1:]:
        for det in (-0.08, 0.0, 0.07):
            f = midi(n + det)
            ph = rng.random()
            s += 2 * ((tt * f + ph) % 1) - 1
    s = lowpass(s, 1400) * env_adsr(L, 0.6, 0.5, 0.8, 1.2)
    place(pad, s * 0.035, t0)
# final chord: long swell and ring-out
L = int((DUR - 18 * BAR) * SR)
tt = np.arange(L) / SR
s = np.zeros(L)
for n in F_end[1:]:
    for det in (-0.06, 0.0, 0.06):
        s += 2 * ((tt * midi(n + det) + rng.random()) % 1) - 1
s = lowpass(s, 2200) * env_adsr(L, 0.05, 1.0, 0.7, 2.5)
place(pad, s * 0.04, 18 * BAR)
# pad breathes: darker in the intro, open in the body
pad = highpass(lowpass(pad, 3000), 110)

# ---------- sub bass on roots from bar 2 ----------
bass = np.zeros(N)
for b in range(2, 20):
    f = midi(ROOTS[b] - 12 if ROOTS[b] > 44 else ROOTS[b])
    dur = BAR if b < 18 else (DUR - 18 * BAR)
    L = int(dur * SR)
    tt = np.arange(L) / SR
    s = np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(4 * np.pi * f * tt)
    s *= env_adsr(L, 0.02, 0.3, 0.75, 0.25 if b < 18 else 2.5)
    place(bass, s * 0.09, b * BAR)

# ---------- pluck arpeggio (8ths) from bar 2 ----------
arp = np.zeros(N)
pattern = [0, 2, 1, 3, 2, 4, 3, 1]
for b in range(2, 18):
    if b in (14, 15):  # thinner during the "complexity" bars: quarter notes only
        steps = range(0, 8, 2)
    else:
        steps = range(8)
    chord = bars[b]
    for k in steps:
        n = chord[1:][pattern[k] % 4] + 12
        f = midi(n)
        L = int(0.9 * SR)
        tt = np.arange(L) / SR
        s = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt)
             + 0.12 * np.sin(6 * np.pi * f * tt)) * np.exp(-tt * 6.5)
        s *= np.minimum(1, tt / 0.004)
        vel = 0.9 if k % 2 == 0 else 0.6
        place(arp, s * 0.05 * vel, b * BAR + k * BEAT / 2)
# stereo ping-pong delay (dotted 8th)
d = int(BEAT * 0.75 * SR)
arpL, arpR = arp.copy(), arp.copy()
arp_lp = lowpass(arp, 3500)
for i, g in enumerate([0.34, 0.3, 0.17, 0.15]):
    off = d * (i + 1)
    tgt = arpR if i % 2 == 0 else arpL
    tgt[off:] += arp_lp[:-off] * g

# ---------- soft kick + shaker from bar 5 (scene 3), pause during bars 14-15 ----------
kick = np.zeros(N)
shaker = np.zeros(N)
for b in range(5, 18):
    if b in (14, 15):
        continue
    for q in range(4):
        L = int(0.35 * SR)
        tt = np.arange(L) / SR
        f = 110 * np.exp(-tt * 18) + 45
        ph = 2 * np.pi * np.cumsum(f) / SR
        s = np.sin(ph) * np.exp(-tt * 9)
        place(kick, s * (0.22 if q in (0, 2) else 0.14), b * BAR + q * BEAT)
    for e in range(8):
        L = int(0.08 * SR)
        s = highpass(rng.standard_normal(L), 7000) * np.exp(-np.arange(L) / SR * 45)
        place(shaker, s * (0.018 if e % 2 else 0.01), b * BAR + e * BEAT / 2)

# ---------- riser into the Marsh scene (bar 16) and impact at the end card (bar 18) ----------
fx = np.zeros(N)
L = int(2 * BAR * SR)
tt = np.arange(L) / SR
noise = rng.standard_normal(L)
rise = np.zeros(L)
# swept band of noise
for i, fc in enumerate(np.geomspace(300, 6000, 16)):
    seg = slice(i * L // 16, (i + 1) * L // 16)
    rise[seg] = lowpass(noise, fc)[seg]
rise *= (tt / tt[-1]) ** 2.2
place(fx, rise * 0.05, 14 * BAR)
# low drone under the "complexity" bars
L = int(2 * BAR * SR)
tt = np.arange(L) / SR
drone = np.sin(2 * np.pi * midi(38) * tt) * np.sin(np.pi * tt / tt[-1])
place(fx, drone * 0.06, 14 * BAR)
for tb in (16 * BAR, 18 * BAR):
    L = int(3.5 * SR)
    tt = np.arange(L) / SR
    boom = np.sin(2 * np.pi * (55 * np.exp(-tt * 3) + 32) * tt) * np.exp(-tt * 2.2)
    air = lowpass(rng.standard_normal(L), 1800) * np.exp(-tt * 3.5)
    place(fx, boom * 0.25 + air * 0.05, tb)

# ---------- mix + reverb ----------
def reverb(x, secs=2.8, mix=0.28):
    L = int(secs * SR)
    ir = rng.standard_normal(L) * np.exp(-np.arange(L) / SR * (6.9 / secs))
    ir = lowpass(ir, 5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    return x * (1 - mix) + fftconvolve(x, ir)[: len(x)] * mix * 1.6


dry_mid = pad + bass + kick * 0.8 + fx
left = dry_mid + arpL + shaker * 0.8
right = dry_mid + arpR + shaker * 1.2
left, right = reverb(left), reverb(right)

# master: gentle fade in/out, glue, normalise to -1 dBFS peak
fade = np.ones(N)
fi, fo = int(0.8 * SR), int(2.2 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fade[-fo:] = np.linspace(1, 0, fo) ** 1.5
st = np.stack([left, right], 1) * fade[:, None]
st = np.tanh(st * 1.6) / 1.6
st /= np.max(np.abs(st)) / 10 ** (-1.5 / 20)

out = sys.argv[1] if len(sys.argv) > 1 else 'music.wav'
from scipy.io import wavfile
wavfile.write(out, SR, (st * 32767).astype(np.int16))
print('wrote', out, f'{DUR:.1f}s')
