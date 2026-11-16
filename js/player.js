// Gapless looping audio engine on the Web Audio API.
// Loops are decoded once into memory and repeated sample-accurately,
// which <audio loop> can't do without a small gap on most browsers.

const FADE_IN = 1.2;
const FADE_OUT = 0.6;

export class Player extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.buffers = new Map();
    this.source = null;
    this.env = null;
    this.current = null;
    this.playing = false;
    this.volume = 0.35;
    this._loadToken = 0;
  }

  _ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: "playback" });
    // iOS: keep playing when the ring/silent switch is on.
    if (navigator.audioSession) {
      try { navigator.audioSession.type = "playback"; } catch {}
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.85;
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  async _buffer(item, fetchAudio) {
    if (this.buffers.has(item.id)) return this.buffers.get(item.id);
    const data = await fetchAudio(item);
    const buf = await this.ctx.decodeAudioData(data);
    this.buffers.set(item.id, buf);
    return buf;
  }

  /** Must be called from a user gesture the first time (autoplay rules). */
  async play(item, fetchAudio) {
    this._ensureContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    const token = ++this._loadToken;
    const switching = !this.current || this.current.id !== item.id;
    this.current = item;
    this._emit("loading", true);
    let buf;
    try {
      buf = await this._buffer(item, fetchAudio);
    } catch (err) {
      if (token === this._loadToken) this._emit("loading", false);
      throw err;
    }
    if (token !== this._loadToken) return; // user picked something else meanwhile
    this._emit("loading", false);

    if (switching || !this.playing) this._stopSource(FADE_OUT);

    if (!this.source) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const env = this.ctx.createGain();
      const t = this.ctx.currentTime;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(1, t + FADE_IN);
      src.connect(env).connect(this.master);
      src.start(t + 0.02);
      this.source = src;
      this.env = env;
    }
    this.playing = true;
    this._emit("state");
  }

  pause() {
    this._loadToken++;
    this._stopSource(FADE_OUT);
    this.playing = false;
    this._emit("loading", false);
    this._emit("state");
  }

  /** Long, gentle fade for the sleep timer. */
  fadeOutAndStop(seconds = 8) {
    if (!this.playing) return;
    this._stopSource(seconds);
    this.playing = false;
    this._emit("state");
  }

  _stopSource(fade) {
    if (!this.source) return;
    const { source, env } = this;
    const t = this.ctx.currentTime;
    env.gain.cancelScheduledValues(t);
    env.gain.setValueAtTime(Math.max(env.gain.value, 0.0001), t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    source.stop(t + fade + 0.05);
    source.onended = () => { source.disconnect(); env.disconnect(); };
    this.source = null;
    this.env = null;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
