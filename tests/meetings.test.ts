import { test } from "node:test";
import assert from "node:assert/strict";
import { configFrom, joinToken, signJwt, verifyJwt, verifyWebhook } from "../src/lib/livekit";
import { joinable, providerRoomName, EARLY_JOIN_MS, STALE_AFTER_MS } from "../src/lib/meetings";
import { businessInstant, businessClock } from "../src/lib/gst";
import { targetFor } from "../src/lib/notification-types";

/**
 * Meetings: the security-critical pure parts — provider tokens, webhook
 * verification, join windows, GST scheduling and notification targets.
 * (Real calls are exercised in the final meeting test phase.)
 */

const config = { url: "wss://example.livekit.cloud", apiKey: "APIkey123", apiSecret: "a-long-test-secret-value-0123456789" };
const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

test("join tokens are short-lived, for one person and one room, and carry no secret", async () => {
  const now = Date.UTC(2026, 8, 25, 10, 0, 0);
  const token = await joinToken(config, { identity: "user-1", name: "Leila", room: "enc-room", ttlSeconds: 600, host: false, now });
  const claims = decode(token);
  assert.equal(claims.iss, config.apiKey);
  assert.equal(claims.sub, "user-1");
  assert.equal(claims.exp - Math.floor(now / 1000), 600);
  assert.deepEqual(claims.video.room, "enc-room");
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.roomAdmin, undefined);
  assert.equal(claims.video.canUpdateOwnMetadata, false);
  assert.deepEqual(claims.video.canPublishSources, ["camera", "microphone", "screen_share", "screen_share_audio"]);
  assert.ok(!token.includes(config.apiSecret));
  assert.ok(await verifyJwt(token, config.apiSecret, now));
  // Expired, or signed with anything else: rejected.
  assert.equal(await verifyJwt(token, config.apiSecret, now + 700_000), null);
  assert.equal(await verifyJwt(token, "another-secret", now), null);
});

test("a webhook is trusted only with our signature over this exact body", async () => {
  const body = JSON.stringify({ event: "participant_joined", room: { name: "enc-room" }, participant: { identity: "user-1" } });
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))).toString("base64");
  const now = Math.floor(Date.now() / 1000);
  const good = await signJwt({ iss: config.apiKey, nbf: now - 5, exp: now + 300, sha256 }, config.apiSecret);
  assert.equal((await verifyWebhook(config, body, `Bearer ${good}`))?.event, "participant_joined");
  assert.equal(await verifyWebhook(config, body.replace("user-1", "user-2"), `Bearer ${good}`), null);
  assert.equal(await verifyWebhook(config, body, null), null);
  const wrongKey = await signJwt({ iss: "someone-else", nbf: now - 5, exp: now + 300, sha256 }, config.apiSecret);
  assert.equal(await verifyWebhook(config, body, wrongKey), null);
  const forged = await signJwt({ iss: config.apiKey, nbf: now - 5, exp: now + 300, sha256 }, "guessed-secret");
  assert.equal(await verifyWebhook(config, body, forged), null);
});

test("provider settings must be complete and use wss", () => {
  assert.deepEqual(configFrom({ LIVEKIT_URL: config.url, LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" }), { url: config.url, apiKey: "k", apiSecret: "s" });
  assert.equal(configFrom({ LIVEKIT_URL: "https://x.livekit.cloud", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" }), null);
  assert.equal(configFrom({ LIVEKIT_URL: config.url, LIVEKIT_API_KEY: "k" }), null);
  assert.equal(configFrom({}), null);
});

test("join windows: live always; scheduled from 15 minutes before until two hours after", () => {
  const at = Date.UTC(2026, 8, 25, 10, 0, 0);
  const scheduled = { status: "scheduled" as const, scheduledAt: new Date(at).toISOString() };
  assert.equal(joinable({ status: "live", scheduledAt: null }), true);
  assert.equal(joinable(scheduled, at - EARLY_JOIN_MS - 1), false);
  assert.equal(joinable(scheduled, at - EARLY_JOIN_MS + 1), true);
  assert.equal(joinable(scheduled, at + STALE_AFTER_MS + 1), false);
  assert.equal(joinable({ status: "ended", scheduledAt: null }), false);
  assert.equal(joinable({ status: "cancelled", scheduledAt: scheduled.scheduledAt }, at), false);
  assert.match(providerRoomName(), /^enc-[0-9a-f]{32}$/);
  assert.notEqual(providerRoomName(), providerRoomName());
});

test("scheduled times are read as Gulf time, whatever the device's zone", () => {
  assert.equal(businessInstant("2026-09-25", "14:30")?.toISOString(), "2026-09-25T10:30:00.000Z");
  assert.equal(businessInstant("2026-12-31", "23:45")?.toISOString(), "2026-12-31T19:45:00.000Z");
  assert.equal(businessInstant("2026-02-30", "10:00") === null || businessInstant("2026-02-30", "10:00")!.getUTCDate() !== 30, true);
  assert.equal(businessInstant("bad", "10:00"), null);
  assert.equal(businessClock(new Date("2026-09-25T10:30:00Z")), "14:30");
});

test("a meeting notification opens the pre-join screen of that meeting only", () => {
  assert.deepEqual(targetFor({ entityType: "meeting", entityId: "m1", conversationId: "c1", messageId: null }), {
    kind: "meeting",
    meetingId: "m1",
    conversationId: "c1",
  });
  // A standalone meeting has no conversation: it opens by id alone, and the
  // server still decides access (organiser or invitee, else the same 404).
  assert.deepEqual(targetFor({ entityType: "meeting", entityId: "m1", conversationId: null, messageId: null }), {
    kind: "meeting",
    meetingId: "m1",
    conversationId: null,
  });
  assert.equal(targetFor({ entityType: "meeting", entityId: "", conversationId: "c1", messageId: null }), null);
});
