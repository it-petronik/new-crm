import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREFS,
  OFFICE_BACKGROUNDS,
  QUALITY_LABELS,
  QUALITY_PRESETS,
  SOLID_COLOURS,
  classifyMediaError,
  diagnosticsLog,
  effectLabel,
  fallbackDevice,
  mediaMessage,
  noteMedia,
  parsePrefs,
  sameEffect,
} from "../src/lib/meeting-media";
import { tileState } from "../src/components/meetings/media-tile";
import { ConnectionQuality, Track } from "livekit-client";
import { existsSync, statSync } from "node:fs";

/** Meeting media logic that doesn't need a browser. */

test("quality presets: 720p/30 by default, a real data saver, no 1080p camera for anyone", () => {
  assert.deepEqual(QUALITY_PRESETS.auto.capture, { width: 1280, height: 720, frameRate: 30 });
  assert.ok(QUALITY_PRESETS.saver.capture.width < QUALITY_PRESETS.auto.capture.width);
  assert.ok(QUALITY_PRESETS.saver.encoding.maxBitrate < QUALITY_PRESETS.auto.encoding.maxBitrate);
  assert.ok(QUALITY_PRESETS.high.encoding.maxBitrate > QUALITY_PRESETS.auto.encoding.maxBitrate);
  for (const p of Object.values(QUALITY_PRESETS)) {
    assert.ok(p.capture.height <= 720);
    // Simulcast layers sit below the top layer.
    for (const l of p.layers) assert.ok(l.height < p.capture.height && l.maxBitrate < p.encoding.maxBitrate);
  }
  // People see words, not numbers.
  for (const { label, hint } of Object.values(QUALITY_LABELS)) assert.doesNotMatch(`${label} ${hint}`, /\d|kbps|bitrate/i);
});

test("preferences: validated, defaulting safely; custom images are never kept", () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("not json"), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs(JSON.stringify({ quality: "saver", effect: { kind: "blur", strength: "strong" } })), { quality: "saver", effect: { kind: "blur", strength: "strong" } });
  assert.deepEqual(parsePrefs(JSON.stringify({ quality: "ultra", effect: { kind: "image", id: "../../etc" } })), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs(JSON.stringify({ quality: "high", effect: { kind: "custom" } })), { quality: "high", effect: { kind: "none" } });
  assert.deepEqual(parsePrefs(JSON.stringify({ effect: { kind: "colour", id: "navy" } })).effect, { kind: "colour", id: "navy" });
  assert.ok(sameEffect({ kind: "blur", strength: "normal" }, { kind: "blur", strength: "normal" }));
  assert.ok(!sameEffect({ kind: "blur", strength: "normal" }, { kind: "blur", strength: "strong" }));
});

test("backgrounds: bundled, small, labelled; a tasteful handful of colours", () => {
  for (const b of OFFICE_BACKGROUNDS) {
    for (const file of [`public/meetings/backgrounds/${b.id}.jpg`, `public/meetings/backgrounds/${b.id}-thumb.jpg`]) {
      assert.ok(existsSync(file), file);
      assert.ok(statSync(file).size < 200_000, `${file} is compressed`);
    }
    assert.match(effectLabel({ kind: "image", id: b.id }), /background$/);
  }
  assert.ok(SOLID_COLOURS.length >= 5 && SOLID_COLOURS.length <= 8);
  assert.ok(existsSync("public/meetings/segmenter/selfie_segmenter.tflite"), "segmentation model is served locally");
});

test("device errors: classified by name, explained in plain words, never raw", () => {
  const cases: [string, string][] = [
    ["NotAllowedError", "blocked"],
    ["NotFoundError", "missing"],
    ["NotReadableError", "busy"],
    ["OverconstrainedError", "constraints"],
    ["InvalidStateError", "interrupted"],
    ["SomethingElse", "other"],
  ];
  for (const [name, problem] of cases) assert.equal(classifyMediaError({ name, message: "C:\\secret\\path" }), problem);
  for (const kind of ["camera", "microphone"] as const)
    for (const [, problem] of cases) {
      const message = mediaMessage(kind, problem as never);
      assert.doesNotMatch(message, /Error|DOMException|secret|undefined/);
    }
  assert.equal(mediaMessage("microphone", "publish"), "Couldn't start your microphone. Check your connection and try again.");
});

test("device fallback: only when the chosen device has gone", () => {
  const list = [{ deviceId: "default" }, { deviceId: "a" }];
  assert.equal(fallbackDevice(list, "a"), null);
  assert.equal(fallbackDevice(list, "b"), "default");
  assert.equal(fallbackDevice(list, "default"), null);
  assert.equal(fallbackDevice(list, undefined), null);
});

test("diagnostics: event names only; details that could carry data are dropped", () => {
  noteMedia("camera_start_failed", "NotReadableError");
  noteMedia("camera_start_failed", "C:\\Users\\me\\device {id=abc123}");
  const log = diagnosticsLog();
  assert.equal(log.counts.camera_start_failed, 2);
  const last = log.recent.slice(-2);
  assert.equal(last[0].detail, "NotReadableError");
  assert.equal(last[1].detail, undefined);
});

/* ------------------------------------------------ tile states (no browser) */

const participant = (opts: { local?: boolean; quality?: ConnectionQuality } = {}) => ({ isLocal: !!opts.local, connectionQuality: opts.quality ?? ConnectionQuality.Good }) as never;
const pub = (opts: { muted?: boolean; subscribed?: boolean; track?: unknown }) => ({ isMuted: !!opts.muted, isSubscribed: opts.subscribed ?? true, track: opts.track }) as never;
const liveTrack = { mediaStreamTrack: { readyState: "live" }, streamState: Track.StreamState.Active };

test("tiles: every state is explicit — off, starting, connecting, paused, reconnecting, unavailable", () => {
  assert.equal(tileState(participant(), undefined, {}), "off");
  assert.equal(tileState(participant(), pub({ muted: true }), {}), "off");
  assert.equal(tileState(participant(), pub({ subscribed: false }), {}), "connecting");
  assert.equal(tileState(participant(), pub({ track: { ...liveTrack, streamState: Track.StreamState.Paused } }), {}), "paused");
  assert.equal(tileState(participant(), pub({ track: liveTrack }), {}), "video");
  assert.equal(tileState(participant({ quality: ConnectionQuality.Lost }), pub({ track: liveTrack }), {}), "reconnecting");
  assert.equal(tileState(participant({ local: true }), pub({ track: liveTrack }), { starting: true }), "starting");
  assert.equal(tileState(participant({ local: true }), pub({ track: { mediaStreamTrack: { readyState: "ended" } } }), {}), "unavailable");
  assert.equal(tileState(participant({ local: true }), pub({}), {}), "starting");
  assert.equal(tileState(participant(), undefined, { screen: true }), "connecting");
});
