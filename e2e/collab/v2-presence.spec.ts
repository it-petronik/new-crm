import { test, expect } from "@playwright/test";
import { Client, openSocket, type Socket } from "./client";

/**
 * Presence against the real hubs and directory, with the test server's
 * shortened timings (heartbeat 1.5 s, dead tab after 5 s, entry TTL 6 s).
 * People used here: v25–v30, vf2 (exclusive to this file).
 */

let admin: Client;
test.beforeAll(async () => {
  admin = await Client.login("admin");
});

const presenceOf = async (viewer: Client, id: string) =>
  (await viewer.get(`/presence?ids=${id}`)).body.presence[id] as { status: string; lastSeenAt: string | null } | undefined;

/** A tab that keeps pinging, as the real client does. */
function keepAlive(socket: Socket, every = 1000) {
  const timer = setInterval(() => {
    try {
      socket.ws.send("ping");
    } catch {}
  }, every);
  return () => clearInterval(timer);
}

const eventually = (fn: () => Promise<unknown>, value: unknown, timeout = 15_000) =>
  expect.poll(fn, { timeout, intervals: [250, 500, 1000] }).toEqual(value);

test("tabs and devices: online, away, and offline only when the last one goes", async () => {
  test.setTimeout(90_000);
  const [person, colleague] = await Promise.all(["v25", "v26"].map(Client.login));
  await person.createRoom({ members: ["v26"] }); // shares a conversation → presence events
  const watcher = await openSocket(colleague.cookie);
  const laptop = await openSocket(person.cookie);
  const phoneLogin = await Client.login("v25");
  const phone = await openSocket(phoneLogin.cookie);
  const stops = [keepAlive(laptop), keepAlive(phone)];

  await eventually(async () => (await presenceOf(colleague, person.id))?.status, "online");
  await watcher.waitFor((e) => e.type === "presence" && e.userId === person.id && e.status === "online");

  laptop.ws.close();
  await new Promise((r) => setTimeout(r, 1500));
  expect((await presenceOf(colleague, person.id))?.status).toBe("online");

  phone.ws.send(JSON.stringify({ type: "activity", state: "idle" }));
  await eventually(async () => (await presenceOf(colleague, person.id))?.status, "away");
  await watcher.waitFor((e) => e.type === "presence" && e.userId === person.id && e.status === "away");
  phone.ws.send(JSON.stringify({ type: "activity", state: "active" }));
  await eventually(async () => (await presenceOf(colleague, person.id))?.status, "online");

  phone.ws.close();
  await eventually(async () => (await presenceOf(colleague, person.id))?.status, "offline");
  const seen = (await presenceOf(colleague, person.id))!.lastSeenAt!;
  expect(Date.now() - Date.parse(seen)).toBeLessThan(15_000);
  await watcher.waitFor((e) => e.type === "presence" && e.userId === person.id && e.status === "offline" && !!e.lastSeenAt);

  // Reconnecting: online again, no last-seen while online; the next
  // disconnect records a later last-seen, never an earlier one.
  const again = await openSocket(person.cookie);
  const stop = keepAlive(again);
  await eventually(async () => (await presenceOf(colleague, person.id))?.lastSeenAt, null);
  stop();
  again.ws.close();
  await eventually(async () => (await presenceOf(colleague, person.id))?.status, "offline");
  expect(Date.parse((await presenceOf(colleague, person.id))!.lastSeenAt!)).toBeGreaterThanOrEqual(Date.parse(seen));
  stops.forEach((s) => s());
  watcher.ws.close();
});

test("a dead tab expires on its own; a live device keeps its owner online", async () => {
  test.setTimeout(90_000);
  const [person, colleague] = await Promise.all(["v27", "v28"].map(Client.login));
  const live = await openSocket(person.cookie);
  const deadLogin = await Client.login("v27");
  const dead = await openSocket(deadLogin.cookie); // never pings: an abnormal disconnect
  const stopLive = keepAlive(live);

  // After the stale window the heartbeat prunes the silent tab on the server:
  // it no longer receives anything, while the live device still does, and
  // its owner stays online throughout.
  const room = await colleague.createRoom({ members: ["v27"] });
  await new Promise((r) => setTimeout(r, 8000));
  expect((await presenceOf(colleague, person.id))?.status).toBe("online");
  await colleague.send(room.id, "are you there?");
  await live.waitFor((e) => e.type === "message.created" && e.message.body === "are you there?");
  await dead.none((e) => e.type === "message.created" && e.message.body === "are you there?", 1500);

  // Now the live device goes silent too (network dropped, no close frame).
  stopLive();
  const lastPing = Date.now();
  await eventually(async () => (await presenceOf(colleague, person.id))?.status, "offline", 20_000);
  const seen = Date.parse((await presenceOf(colleague, person.id))!.lastSeenAt!);
  // Last seen is the final sign of life, not the moment we noticed.
  expect(seen).toBeLessThanOrEqual(Date.now());
  expect(Math.abs(seen - lastPing)).toBeLessThan(6000);
});

test("presence is visible only to active people sharing a company", async () => {
  const [person, sameCompany, otherCompany, watcherToMove] = await Promise.all(["v29", "v30", "vf2", "v26"].map(Client.login));
  const ws = await openSocket(person.cookie);
  const stop = keepAlive(ws);
  await eventually(async () => (await presenceOf(sameCompany, person.id))?.status, "online");
  expect(await presenceOf(otherCompany, person.id)).toBeUndefined();
  expect((await otherCompany.get(`/presence?ids=${person.id}`)).body.presence).toEqual({});
  expect((await sameCompany.get(`/presence?ids=../../x`)).status).toBe(400);

  // Scope change: moved to another company, the watcher no longer sees them.
  expect((await presenceOf(watcherToMove, person.id))?.status).toBe("online");
  await admin.moveUser("v26", ["Afrilube"], []);
  const moved = await Client.login("v26");
  expect(await presenceOf(moved, person.id)).toBeUndefined();

  // An inactive account is not visible at all.
  stop();
  ws.ws.close();
  await admin.updateUser("v29", { active: false });
  expect(await presenceOf(sameCompany, person.id)).toBeUndefined();
});
