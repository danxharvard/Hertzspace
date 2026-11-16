// Circular oscilloscope with breathing halo rings, drawn from the live signal.

export class Viz {
  constructor(canvas, getAnalyser) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.getAnalyser = getAnalyser;
    this.color = "#7fb7be";
    this.active = false;
    this.level = 0;
    this.phase = 0;
    this.reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this._frame = this._frame.bind(this);
    new ResizeObserver(() => this._resize()).observe(canvas);
    document.addEventListener("visibilitychange", () => this._kick());
    this._resize();
  }

  setColor(c) { this.color = c; this._kick(); }
  setActive(on) { this.active = on; this._kick(); }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
    this._kick(true);
  }

  _kick(force) {
    clearTimeout(this._idle);
    if (this._raf && !force) return;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(this._frame);
  }

  _frame(now) {
    this._raf = null;
    const { g, canvas } = this;
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.3;
    g.clearRect(0, 0, w, h);

    const an = this.getAnalyser();
    let data = null;
    if (an && this.active) {
      data = this._data && this._data.length === an.fftSize ? this._data : (this._data = new Float32Array(an.fftSize));
      an.getFloatTimeDomainData(data);
      let s = 0;
      for (let i = 0; i < data.length; i++) s += data[i] * data[i];
      const rms = Math.sqrt(s / data.length);
      this.level += (Math.min(rms * 4, 1) - this.level) * 0.08;
    } else {
      this.level *= 0.92;
    }
    if (!this.reduce) this.phase = now / 1000;

    // Halo rings
    for (let k = 0; k < 4; k++) {
      const t = (this.phase * 0.12 + k / 4) % 1;
      const rr = R * (1.05 + t * 0.75);
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.strokeStyle = this.color;
      g.globalAlpha = (1 - t) * 0.22 * (0.25 + this.level);
      g.lineWidth = 1.2 * this.dpr;
      g.stroke();
    }

    // Soft core glow
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.4);
    glow.addColorStop(0, this.color);
    glow.addColorStop(1, "transparent");
    g.globalAlpha = 0.06 + this.level * 0.12;
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);

    // Waveform ring
    g.globalAlpha = 0.9;
    g.lineWidth = 2 * this.dpr;
    g.strokeStyle = this.color;
    g.beginPath();
    const N = 256;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      let v = 0;
      if (data) v = data[Math.floor((i % N) / N * Math.min(data.length, 1024))] || 0;
      else v = Math.sin(a * 6 + this.phase * 0.8) * 0.02;
      const r = R * (1 + v * 0.55);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.stroke();
    g.globalAlpha = 1;

    const busy = (this.active || this.level > 0.002) && !document.hidden;
    if (busy || !this.reduce) {
      // Idle: slow redraw to save battery.
      if (busy) this._raf = requestAnimationFrame(this._frame);
      else this._idle = setTimeout(() => this._kick(), 1000 / 15);
    }
  }
}
