#!/usr/bin/env python3
"""Render every frequency in data/catalog.json to audio.

Streaming loops (20 s, seamless):
  free tier  -> audio/free/<id>.flac   (committed, served by the site)
  plus tier  -> premium/stream/<id>.flac (NOT committed; upload to your paid storage)

Paid downloads (--downloads, 30 min each, all tiers):
  premium/downloads/<id>.flac and .mp3   (NOT committed)

Every loop contains a whole number of cycles of every component, so it
repeats with no click. Noise is synthesised in the frequency domain,
which makes it circular (seamless) by construction.

Usage: python3 tools/generate.py [--downloads] [--minutes 30]
Needs numpy and ffmpeg.
"""
import argparse, json, os, subprocess, sys, tempfile, wave
import numpy as np

SR = 44100
LOOP_S = 20
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rng = np.random.default_rng(1729)


def snap(f, seconds):
    """Nearest frequency with a whole number of cycles in `seconds`."""
    return round(f * seconds) / seconds


def sine(f, n):
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * f * t)


def noise(color, n):
    spec = rng.normal(size=n // 2 + 1) + 1j * rng.normal(size=n // 2 + 1)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    f = np.maximum(freqs, 1.0)
    shape = {"white": np.ones_like(f), "pink": 1 / np.sqrt(f), "brown": 1 / f}[color]
    shape[freqs < 20] = 0  # no DC / sub-audio rumble
    x = np.fft.irfft(spec * shape, n)
    return x / np.sqrt(np.mean(x ** 2))


def render(item, seconds):
    n = SR * seconds
    kind = item["type"]
    if kind == "noise":
        x = noise(item["color"], n) * 0.12
        return np.clip(x, -0.9, 0.9)[:, None]
    if kind == "swell":
        x = noise(item["color"], n)
        lfo = 0.55 + 0.45 * np.sin(2 * np.pi * snap(0.1, seconds) * np.arange(n) / SR - np.pi / 2)
        return np.clip(x * lfo * 0.14, -0.9, 0.9)[:, None]
    if kind == "tone":
        return (sine(snap(item["freq"], seconds), n) * 0.3)[:, None]
    if kind == "bath":
        f = item["freq"]
        parts = [(f, 0.5), (snap(f + 0.5, seconds), 0.35), (f / 2, 0.3), (f * 1.5, 0.12), (f * 2, 0.1)]
        x = sum(sine(snap(p, seconds), n) * a for p, a in parts)
        return (x / np.max(np.abs(x)) * 0.3)[:, None]
    if kind == "cascade":
        return cascade(item, n, seconds)
    if kind == "binaural":
        c = item["carrier"]
        left = sine(snap(c, seconds), n)
        right = sine(snap(c + item["beat"], seconds), n)
        return np.stack([left, right], axis=1) * 0.3
    raise ValueError(kind)


PHI = (1 + 5 ** 0.5) / 2


def cascade(item, n, seconds):
    """Golden-ratio cascade.

    Tones at base * phi^k (k = kmin..kmax) enter one by one from the highest
    down, `step` seconds apart, hold, then all release together at the end of
    each `cycle`. Even k sits in the left ear, odd k in the right. Highs are
    gently tilted down so the stack isn't harsh.
    """
    base, cycle, step = item["freq"], item.get("cycle", 7.0), item.get("step", 0.5)
    kmin, kmax = item.get("kmin", -5), item.get("kmax", 7)
    attack, release = item.get("attack", 0.04), item.get("release", 0.15)
    t = np.arange(n) / SR
    pos = t % cycle
    out = np.zeros((n, 2))
    for i, k in enumerate(range(kmax, kmin - 1, -1)):
        f = base * PHI ** k
        if not 30 <= f <= 16000:
            continue
        f = snap(f, cycle)  # whole cycles per loop -> seamless
        start = i * step
        if start >= cycle - release:
            continue
        # raised-cosine gate: fade in at `start`, fade out over the last `release` s
        a = np.clip((pos - start) / attack, 0, 1)
        r = np.clip((cycle - pos) / release, 0, 1)
        gate = (0.5 - 0.5 * np.cos(np.pi * a)) * (0.5 - 0.5 * np.cos(np.pi * r))
        tilt = 1.0 if f < 3000 else (3000 / f) ** 0.5   # -3 dB/octave above 3 kHz
        ch = 0 if k % 2 == 0 else 1
        out[:, ch] += np.sin(2 * np.pi * f * t) * gate * tilt
        if k == 0:  # the base tone sits in both ears
            out[:, 1] += np.sin(2 * np.pi * f * t) * gate * tilt
    return out / np.max(np.abs(out)) * 0.3


def fade(x, seconds=4):
    """Fade in/out for downloads (loops must not be faded)."""
    k = SR * seconds
    ramp = np.linspace(0, 1, k)[:, None]
    x = x.copy()
    x[:k] *= ramp
    x[-k:] *= ramp[::-1]
    return x


def write(x, path, fmt="flac"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        with wave.open(tmp.name, "wb") as w:
            w.setnchannels(pcm.shape[1]); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes(pcm.tobytes())
    codec = ["-c:a", "flac", "-compression_level", "12"] if fmt == "flac" else ["-c:a", "libmp3lame", "-b:a", "192k"]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name, *codec, path], check=True)
    os.unlink(tmp.name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--downloads", action="store_true", help="also render long paid downloads")
    ap.add_argument("--minutes", type=int, default=30)
    args = ap.parse_args()

    catalog = json.load(open(os.path.join(ROOT, "data", "catalog.json")))
    for item in catalog["frequencies"]:
        sub = "audio/free" if item["tier"] == "free" else "premium/stream"
        out = os.path.join(ROOT, sub, item["id"] + ".flac")
        write(render(item, item.get("loop", LOOP_S)), out)
        print(f"{item['tier']:5} {out[len(ROOT)+1:]}  {os.path.getsize(out)//1024} KB")
        if args.downloads:
            long = fade(render(item, args.minutes * 60))
            for fmt in ("flac", "mp3"):
                write(long, os.path.join(ROOT, "premium", "downloads", f"{item['id']}.{fmt}"), fmt)


if __name__ == "__main__":
    sys.exit(main())
