import type { BrowserContext, Page } from "@playwright/test";

/** Observe the real Web Audio graph; do not replace sound generation or playback. */
export async function probeCallAudio(context: BrowserContext, blockUntilResume = false) {
  await context.addInitScript(({ blockUntilResume }) => {
    const NativeContext = window.AudioContext;
    let resumed = false;
    const sources: { context: AudioContext; source: AudioBufferSourceNode; connected: boolean }[] = [];
    window.AudioContext = class extends NativeContext {
      // Headless Chrome may allow autoplay even without a gesture. Simulate
      // that one policy state for the fallback check, keeping the real graph.
      get state() { return blockUntilResume && !resumed ? "suspended" : super.state; }
      resume() { resumed = true; return super.resume(); }
      createBufferSource() {
        const source = super.createBufferSource();
        const entry = { context: this, source, connected: false };
        sources.push(entry);
        const connect = source.connect.bind(source), disconnect = source.disconnect.bind(source);
        source.connect = ((...args: Parameters<typeof connect>) => { entry.connected = true; return connect(...args); }) as typeof source.connect;
        source.disconnect = (() => { entry.connected = false; disconnect(); }) as typeof source.disconnect;
        return source;
      }
    };
    Object.assign(window, { __callAudioProbe: () => sources.filter(s => s.source.loop && Math.abs((s.source.buffer?.duration ?? 0) - 3.6) < .01).map(s => ({
      running: s.connected && s.context.state === "running",
      peak: Math.max(...(s.source.buffer?.getChannelData(0).subarray(0, 3000) ?? [])),
    })) });
  }, { blockUntilResume });
}

export const callSounds = (page: Page) => page.evaluate(() => (window as unknown as { __callAudioProbe: () => { running: boolean; peak: number }[] }).__callAudioProbe());
