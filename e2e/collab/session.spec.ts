import { test, expect } from "@playwright/test";
import { Client } from "./client";
import { byKey, PASSWORD, WORKER } from "./people";

/**
 * "Keep me signed in": the active session (8 h) plus a rotating refresh
 * credential (30 days), through the real Worker and D1. Each "device" is a
 * cookie jar handled explicitly here, so what every request carries is
 * exactly what the test says.
 *
 * People: sx1–sx12 (exclusive to this file).
 */

// One administrator sign-in for the whole file: the login rate limit is per
// address, and the suite's files share this account.
let adminClient: Promise<Client> | null = null;
const admin = () => (adminClient ??= Client.login("admin"));

type Jar = { session?: string; refresh?: string };
type SetCookie = { name: string; value: string; attrs: string };

const parse = (headers: Headers): SetCookie[] =>
  headers.getSetCookie().map((line) => {
    const [pair, ...rest] = line.split(";");
    const at = pair.indexOf("=");
    return { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim(), attrs: rest.join(";").toLowerCase() };
  });

/** Applies Set-Cookie to a jar the way a browser would (empty/expired = removed). */
function apply(jar: Jar, cookies: SetCookie[]) {
  for (const c of cookies) {
    const gone = !c.value || c.attrs.includes("max-age=0") || /expires=thu, 01 jan 1970/.test(c.attrs);
    if (c.name === "enercore_session") jar.session = gone ? undefined : c.value;
    if (c.name === "enercore_refresh") jar.refresh = gone ? undefined : c.value;
  }
}

const header = (jar: Jar) =>
  [jar.session && `enercore_session=${jar.session}`, jar.refresh && `enercore_refresh=${jar.refresh}`].filter(Boolean).join("; ");

async function call(jar: Jar, method: string, path: string, body?: unknown) {
  const response = await fetch(`${WORKER}${path}`, {
    method,
    headers: { Origin: WORKER, ...(header(jar) ? { Cookie: header(jar) } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookies = parse(response.headers);
  apply(jar, cookies);
  const text = await response.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: response.status, body: json, cookies, text };
}

async function signIn(key: string, remember?: boolean) {
  const jar: Jar = {};
  const r = await call(jar, "POST", "/api/auth", { email: byKey(key).email, password: PASSWORD, ...(remember === undefined ? {} : { remember }) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { jar, cookies: r.cookies };
}

const works = async (jar: Jar) => (await call(jar, "GET", "/api/collab/summary")).status;
const refresh = (jar: Jar) => call(jar, "POST", "/api/auth/refresh");
/** The active session has lapsed: the browser no longer sends it. */
const lapse = (jar: Jar) => ({ ...jar, session: undefined });

test("keep me signed in (the default): an active session and a separate HttpOnly refresh cookie", async () => {
  const { jar, cookies } = await signIn("sx1");
  const session = cookies.find((c) => c.name === "enercore_session")!;
  const refreshCookie = cookies.find((c) => c.name === "enercore_refresh")!;
  for (const c of [session, refreshCookie]) {
    expect(c.value).toMatch(/^[0-9a-f]{64}$/);
    expect(c.attrs).toContain("httponly");
    expect(c.attrs).toContain("samesite=lax");
    expect(c.attrs).toContain("path=/");
  }
  expect(session.value).not.toBe(refreshCookie.value);
  // Session: about 8 hours. Refresh: about 30 days.
  const expiry = (c: SetCookie) => new Date(/expires=([^;]+)/.exec(c.attrs)![1]).getTime() - Date.now();
  expect(expiry(session)).toBeGreaterThan(7.9 * 3600_000);
  expect(expiry(session)).toBeLessThan(8.1 * 3600_000);
  expect(expiry(refreshCookie)).toBeGreaterThan(29.9 * 86_400_000);
  expect(expiry(refreshCookie)).toBeLessThan(30.1 * 86_400_000);
  expect(await works(jar)).toBe(200);
  expect((await call(jar, "GET", "/api/auth")).body).toEqual({ signedIn: true });
});

test("a lapsed session renews silently; the refresh token rotates and the old one is dead", async () => {
  test.setTimeout(90_000);
  const { jar } = await signIn("sx2");
  const device = lapse(jar);
  expect(await works(device)).toBe(401);
  expect((await call(device, "GET", "/api/auth")).body).toEqual({ signedIn: false });
  const oldRefresh = device.refresh!;

  const renewed = await refresh(device);
  expect(renewed.status).toBe(200);
  expect(renewed.body).toEqual({ ok: true }); // no token in the JSON
  expect(renewed.text).not.toContain(device.session!);
  expect(renewed.text).not.toContain(device.refresh!);
  expect(device.session).toMatch(/^[0-9a-f]{64}$/);
  expect(device.refresh).toMatch(/^[0-9a-f]{64}$/);
  expect(device.refresh).not.toBe(oldRefresh);
  expect(await works(device)).toBe(200);
  // The session it replaced is gone.
  expect(await works(jar)).toBe(401);

  // Two tabs presenting the same token at the same moment: one renews, the
  // other is told to use its cookies — nobody is signed out.
  const tabA: Jar = { refresh: device.refresh };
  const tabB: Jar = { refresh: device.refresh };
  const [a, b] = await Promise.all([refresh(tabA), refresh(tabB)]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  const winner = a.status === 200 ? tabA : tabB;
  expect(await works(winner)).toBe(200);

  // A used token presented again later is a replay: the whole device is
  // revoked, including the tokens issued after it.
  await new Promise((r) => setTimeout(r, 31_000));
  const replay = await refresh({ refresh: oldRefresh });
  expect(replay.status).toBe(401);
  expect(await works(winner)).toBe(401);
  expect((await refresh({ refresh: winner.refresh })).status).toBe(401);
});

test("keep me signed in OFF: the plain session only, nothing to renew with", async () => {
  const { jar, cookies } = await signIn("sx3", false);
  expect(cookies.some((c) => c.name === "enercore_refresh" && c.value)).toBe(false);
  expect(jar.refresh).toBeUndefined();
  expect(await works(jar)).toBe(200);
  expect((await refresh(lapse(jar))).status).toBe(401);
});

test("invalid, forged or cross-site refreshes are refused", async () => {
  expect((await refresh({})).status).toBe(401);
  expect((await refresh({ refresh: "0".repeat(64) })).status).toBe(401);
  expect((await refresh({ refresh: "not-a-token" })).status).toBe(401);
  const { jar } = await signIn("sx4");
  const evil = await fetch(`${WORKER}/api/auth/refresh`, { method: "POST", headers: { Origin: "https://evil.example", Cookie: `enercore_refresh=${jar.refresh}` } });
  expect(evil.status).toBe(403);
  // …and did not spend the token.
  expect((await refresh(lapse(jar))).status).toBe(200);
});

test("each device is independent; signing out ends only this device", async () => {
  const office = (await signIn("sx5")).jar;
  const laptop = (await signIn("sx5")).jar;
  const phone = (await signIn("sx5")).jar;
  expect(new Set([office.refresh, laptop.refresh, phone.refresh]).size).toBe(3);
  const laptopRefresh = laptop.refresh;
  const out = await call(laptop, "DELETE", "/api/auth");
  expect(out.status).toBe(200);
  // Both cookies cleared on that device…
  expect(laptop.session).toBeUndefined();
  expect(laptop.refresh).toBeUndefined();
  // …and both revoked on the server.
  expect((await refresh({ refresh: laptopRefresh })).status).toBe(401);
  // The other devices carry on, including renewing.
  expect(await works(office)).toBe(200);
  expect((await refresh(lapse(phone))).status).toBe(200);
});

test("sign out everywhere ends every device", async () => {
  const a = (await signIn("sx6")).jar;
  const b = (await signIn("sx6")).jar;
  expect((await call(a, "DELETE", "/api/auth", { everywhere: true })).status).toBe(200);
  expect(await works(b)).toBe(401);
  expect((await refresh(lapse(b))).status).toBe(401);
});

test("a password reset ends every session and every kept-signed-in device", async () => {
  const md = await admin();
  const a = (await signIn("sx7")).jar;
  const b = (await signIn("sx7")).jar;
  const issued = await md.request("POST", "/api/users/reset-link", { userId: byKey("sx7").id });
  expect(issued.status).toBe(200);
  const token = new URL(issued.body.link).searchParams.get("token");
  const done = await fetch(`${WORKER}/api/password-reset/confirm`, {
    method: "POST",
    headers: { Origin: WORKER, "Content-Type": "application/json" },
    body: JSON.stringify({ token, password: PASSWORD }),
  });
  expect(done.status).toBe(200);
  for (const device of [a, b]) {
    expect(await works(device)).toBe(401);
    expect((await refresh(lapse(device))).status).toBe(401);
  }
  expect(await works((await signIn("sx7")).jar)).toBe(200);
});

test("deactivation ends every session and every kept-signed-in device", async () => {
  const md = await admin();
  const a = (await signIn("sx8")).jar;
  const b = (await signIn("sx8")).jar;
  await md.updateUser("sx8", { active: false });
  try {
    for (const device of [a, b]) {
      expect(await works(device)).toBe(401);
      expect((await refresh(lapse(device))).status).toBe(401);
    }
  } finally {
    await md.updateUser("sx8", { active: true });
  }
  // Reactivation does not bring old devices back.
  expect((await refresh(lapse(b))).status).toBe(401);
});

/* --------------------------------------------------------- in the browser */

test("browser: an expired session renews with no login page; API calls recover mid-use", async ({ browser }) => {
  const { jar } = await signIn("sx9");
  const context = await browser.newContext();
  const cookie = (name: string, value: string) => ({ name, value, domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax" as const });
  // Only the refresh cookie: yesterday's session has expired.
  await context.addCookies([cookie("enercore_refresh", jar.refresh!)]);
  const page = await context.newPage();
  const seen: string[] = [];
  page.on("framenavigated", (f) => f === page.mainFrame() && seen.push(new URL(f.url()).pathname));
  await page.goto("/workspace/all-companies/collaboration?tab=meetings");
  await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("tab")).toBe("meetings");
  // Never shown the sign-in form on the way.
  await expect(page.getByRole("button", { name: "Sign in to workspace" })).toHaveCount(0);

  // Mid-use the session lapses again: the next API call renews and succeeds.
  await context.clearCookies({ name: "enercore_session" });
  const statuses = await page.evaluate(async () => Promise.all([1, 2, 3].map(async () => (await fetch("/api/collab/summary")).status)));
  expect(statuses).toEqual([200, 200, 200]);
  // Three calls, one renewal: only one new refresh token in the jar.
  const refreshes = (await context.cookies()).filter((c) => c.name === "enercore_refresh");
  expect(refreshes).toHaveLength(1);
  expect(refreshes[0].value).not.toBe(jar.refresh);
  await context.close();
});

test("browser: with nothing valid to renew with, the sign-in page — then back to the page asked for", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([{ name: "enercore_refresh", value: "f".repeat(64), domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto("/workspace/all-companies/collaboration?tab=meetings");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole("button", { name: "Sign in to workspace" })).toBeVisible();
  const remember = page.getByRole("checkbox", { name: /Keep me signed in on this device/ });
  await expect(remember).toBeChecked();
  await page.getByLabel("Work email").fill(byKey("sx10").email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL(/\/workspace\/all-companies\/collaboration\?tab=meetings/);
  expect((await context.cookies()).some((c) => c.name === "enercore_refresh" && c.httpOnly)).toBe(true);
  // Unticked on a shared computer: no refresh cookie.
  const shared = await browser.newContext();
  const p2 = await shared.newPage();
  await p2.goto("/login");
  await p2.getByLabel("Work email").fill(byKey("sx11").email);
  await p2.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await p2.getByRole("checkbox", { name: /Keep me signed in on this device/ }).uncheck();
  await p2.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(p2).not.toHaveURL(/\/login/);
  expect((await shared.cookies()).some((c) => c.name === "enercore_refresh")).toBe(false);
  // Refresh tokens never reach page storage.
  expect(await p2.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes("refresh"))).toBe(false);
  await Promise.all([context.close(), shared.close()]);
});

test("the internal meeting link still requires signing in", async ({ browser }) => {
  // A browser with no Enercore cookies (a guest given the wrong link).
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/workspace/all-companies/collaboration?tab=meetings&meeting=0000000001aaaaaaaaaaaa");
  await expect(page).toHaveURL(/\/login\?next=%2Fworkspace%2Fall-companies%2Fcollaboration%3Ftab%3Dmeetings%26meeting%3D0000000001aaaaaaaaaaaa$/);
  await expect(page.getByRole("button", { name: "Sign in to workspace" })).toBeVisible();
  // The data behind it refuses too.
  expect((await fetch(`${WORKER}/api/collab/meetings/0000000001aaaaaaaaaaaa`)).status).toBe(401);
  await context.close();
});
