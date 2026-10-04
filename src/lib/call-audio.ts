/** Original, gently enveloped call tones. No remote sound files or microphone access. */
export type CallTone = "incoming" | "outgoing";
export type CallAudioState = "idle" | "playing" | "blocked" | "unavailable" | "expired";
export const CALL_RING_MS = 45_000;

export function callToneSamples(kind: CallTone, sampleRate: number) {
  const samples = new Float32Array(Math.ceil(sampleRate * 3.6));
  const notes = kind === "incoming"
    ? [{ at: 0, length: .23, hz: 660 }, { at: .28, length: .34, hz: 880 }, { at: .86, length: .23, hz: 660 }, { at: 1.14, length: .34, hz: 880 }]
    : [{ at: 0, length: .48, hz: 440 }, { at: .66, length: .48, hz: 440 }];
  for (const note of notes) {
    const offset = Math.floor(note.at * sampleRate);
    for (let i = 0; i < note.length * sampleRate; i++) {
      const t = i / sampleRate;
      const envelope = Math.min(1, t / .018, (note.length - t) / .06);
      samples[offset + i] += .11 * envelope * (Math.sin(2 * Math.PI * note.hz * t) + .25 * Math.sin(2 * Math.PI * note.hz * 1.5 * t));
    }
  }
  return samples;
}

/** One output channel per workspace. Cleanup of an older call cannot stop a newer one. */
export class CallAudio {
  private context: AudioContext | null = null;
  private active: { kind: CallTone; until: number; report: (state: CallAudioState) => void; source: AudioBufferSourceNode | null; timer: ReturnType<typeof setTimeout> } | null = null;
  constructor(private createContext: () => AudioContext, private now = Date.now) {}

  private ensureContext() {
    if (!this.context || this.context.state === "closed") {
      this.context = this.createContext();
      this.context.addEventListener("statechange", this.sync);
    }
    return this.context;
  }

  /** Called from a trusted click/key gesture, never requires media permissions. */
  unlock = () => {
    try {
      const context = this.ensureContext();
      if (context.state !== "running") void context.resume().then(this.sync).catch(() => this.active?.report("blocked"));
      this.sync();
    } catch { this.active?.report("unavailable"); }
  };

  start(kind: CallTone, until: number, report: (state: CallAudioState) => void) {
    this.stop();
    if (until <= this.now()) { report("expired"); return () => {}; }
    const active = { kind, until, report, source: null as AudioBufferSourceNode | null, timer: setTimeout(() => {
      if (this.active === active) { this.stop(); report("expired"); }
    }, until - this.now()) };
    this.active = active;
    try { this.ensureContext(); this.sync(); }
    catch { report("unavailable"); }
    return () => { if (this.active === active) this.stop(); };
  }

  private sync = () => {
    const active = this.active, context = this.context;
    if (!active || !context) return;
    if (active.until <= this.now()) { this.stop(); active.report("expired"); return; }
    if (context.state !== "running") { active.report("blocked"); return; }
    try {
      if (!active.source) {
        const samples = callToneSamples(active.kind, context.sampleRate);
        const buffer = context.createBuffer(1, samples.length, context.sampleRate);
        buffer.copyToChannel(samples, 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(context.destination);
        source.start();
        // Audio-clock cutoff as well as the wall-clock timer: background tabs
        // cannot leave the ringtone running indefinitely if timers are throttled.
        source.stop(context.currentTime + (active.until - this.now()) / 1000);
        active.source = source;
      }
      active.report("playing");
    } catch { this.stop(); active.report("unavailable"); }
  };

  stop() {
    const active = this.active;
    this.active = null;
    if (!active) return;
    clearTimeout(active.timer);
    if (active.source) {
      try { active.source.stop(); } catch { /* Already stopped. */ }
      active.source.disconnect();
    }
    active.report("idle");
  }

  dispose = () => {
    this.stop();
    if (this.context) {
      this.context.removeEventListener("statechange", this.sync);
      void this.context.close().catch(() => {});
      this.context = null;
    }
  };
}
