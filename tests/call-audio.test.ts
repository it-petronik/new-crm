import { test } from "node:test";
import assert from "node:assert/strict";
import { CallAudio, CALL_RING_MS, callToneSamples } from "../src/lib/call-audio";

class FakeContext extends EventTarget {
  state = "running";
  currentTime = 10;
  sampleRate = 8000;
  destination = {};
  sources: { loop: boolean; stops: (number | undefined)[]; connected: boolean; started: boolean }[] = [];
  createBuffer() { return { copyToChannel() {} }; }
  createBufferSource() {
    const source = { buffer: null, loop: false, stops: [] as (number | undefined)[], connected: false, started: false,
      connect() { this.connected = true; }, disconnect() { this.connected = false; },
      start() { this.started = true; }, stop(at?: number) { this.stops.push(at); } };
    this.sources.push(source);
    return source;
  }
  async resume() { this.state = "running"; this.dispatchEvent(new Event("statechange")); }
  async close() { this.state = "closed"; }
}
const engine = (context: FakeContext, now = () => 0) => new CallAudio(() => context as unknown as AudioContext, now);

test("original ring and ringback have audible bounded samples, smooth edges and silent pauses", () => {
  const a = callToneSamples("incoming", 8000), b = callToneSamples("outgoing", 8000);
  for (const samples of [a, b]) {
    assert.equal(samples.length, 28800);
    assert.equal(samples[0], 0);
    assert.ok(samples.some(v => Math.abs(v) > .08));
    assert.ok(samples.every(v => Number.isFinite(v) && Math.abs(v) < .14));
    assert.ok(samples.slice(16000).every(v => v === 0));
    assert.ok(samples.every((v, i) => !i || Math.abs(v - samples[i - 1]) < .12));
  }
  assert.notDeepEqual(a, b);
});

test("ring cleanup cuts sound immediately; an old cleanup cannot stop a newer call", () => {
  const context = new FakeContext(), audio = engine(context);
  const stopOld = audio.start("incoming", CALL_RING_MS, () => {});
  assert.equal(context.sources[0].loop, true);
  assert.deepEqual(context.sources[0].stops, [55]);
  const stopNew = audio.start("outgoing", CALL_RING_MS, () => {});
  assert.equal(context.sources[0].connected, false);
  stopOld();
  assert.equal(context.sources[1].connected, true);
  stopNew();
  assert.equal(context.sources[1].connected, false);
  assert.equal(context.sources[1].stops.at(-1), undefined);
  audio.dispose();
});

test("blocked autoplay reports the fallback, resumes after consent and never revives dismissed tones", async () => {
  const context = new FakeContext(), audio = engine(context);
  context.state = "suspended";
  const states: string[] = [];
  const stop = audio.start("incoming", CALL_RING_MS, state => states.push(state));
  assert.equal(states.at(-1), "blocked");
  assert.equal(context.sources.length, 0);
  audio.unlock();
  await Promise.resolve();
  assert.equal(states.at(-1), "playing");
  assert.equal(context.sources.length, 1);
  stop();
  context.state = "suspended";
  audio.unlock();
  await Promise.resolve();
  assert.equal(states.at(-1), "idle");
  assert.equal(context.sources.length, 1);
  audio.dispose();
});

test("rings expire on the wall clock and delayed unlock cannot play an expired invitation", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const context = new FakeContext(), audio = engine(context, () => Date.now());
  const states: string[] = [];
  audio.start("outgoing", CALL_RING_MS, s => states.push(s));
  t.mock.timers.tick(CALL_RING_MS);
  assert.equal(states.at(-1), "expired");
  assert.equal(context.sources[0].connected, false);
  audio.start("incoming", CALL_RING_MS - 1, s => states.push(s));
  audio.unlock();
  assert.equal(context.sources.length, 1);
  audio.dispose();
});

test("missing browser audio is recoverable and teardown releases the context", () => {
  const audio = new CallAudio(() => { throw new Error("Unavailable"); }, () => 0);
  const states: string[] = [];
  const stop = audio.start("incoming", CALL_RING_MS, s => states.push(s));
  assert.equal(states.at(-1), "unavailable");
  stop(); audio.dispose();
  const context = new FakeContext(), available = engine(context);
  available.unlock(); available.dispose();
  assert.equal(context.state, "closed");
});
