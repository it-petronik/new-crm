import { test, expect } from "@playwright/test";
import { Client } from "./client";
import { callsSince, expireSnooze, gstToday, lastCallId, query } from "./ai-helpers";
import { byKey } from "./people";

/**
 * Enercore AI Phase 5 — the Action Center — through the real Worker and D1
 * with the fake Workers AI: deterministic signals (no model call to detect,
 * rank, count, snooze or resolve), scope, stage-aware Quick Complete through
 * the records API (version guard, audit), follow-up auto-resolution, what
 * changed (from the audit trail), and the on-demand brief (one fast call,
 * then cached).
 *
 * Data: e2e/collab/proactive-data.ts (PX-*, Petronex / Sharjah). People:
 * pxse1, pxse2, pxsm, pxmd, pxacc, pxhr, pxout. PX-U* belong to the UI suite
 * (changed in parallel), so no assertion here depends on them.
 */

test.describe.configure({ mode: "serial" });

const FAST = "@cf/meta/llama-3.1-8b-instruct-fast";
const sessions = new Map<string, Promise<Client>>();
const login = (k: string) => {
  if (!sessions.has(k)) sessions.set(k, Client.login(k));
  return sessions.get(k)!;
};
const center = (c: Client, q = "") => c.request("GET", `/api/proactive${q}`);
const all = (body: any) => Object.values(body.sections).flat() as any[];
const keys = (body: any) => all(body).map((s) => s.key);
const px = (body: any) => keys(body).filter((k: string) => /PX-(L|Q|O|S|I|C)\d/.test(k)).sort();
const state = (c: Client, body: unknown, options?: { origin?: string | null; cookie?: string | null }) => c.request("POST", "/api/proactive/state", body, options);
const tomorrow = () => new Date(Date.now() + 20 * 3600_000).toISOString();
const version = (id: string) => (query<{ version: number }>(`SELECT version FROM "BusinessRecord" WHERE id = ?`, id)[0]).version;

test("the Action Center is deterministic and scoped — and makes no AI call", async () => {
  const [seller, other, manager, md, acc, hr, outsider] = await Promise.all(["pxse1", "pxse2", "pxsm", "pxmd", "pxacc", "pxhr", "pxout"].map(login));
  const before = lastCallId();

  const mine = await center(seller);
  expect(mine.status).toBe(200);
  expect(mine.body.scope).toBe("mine");
  expect(mine.body.teamAvailable).toBe(false);
  expect(px(mine.body)).toEqual(["DATA_INCOMPLETE:PX-L2", "DATA_INCOMPLETE:PX-L3", "DUPLICATE:PX-C1:PX-C2", "FOLLOW_UP_OVERDUE:PX-L1"]);
  const byKeyOf = (k: string) => all(mine.body).find((s) => s.key === k);
  const overdue = byKeyOf("FOLLOW_UP_OVERDUE:PX-L1");
  expect([overdue.section, overdue.severity, overdue.label, overdue.entity.value, overdue.snoozable, overdue.dismissible]).toEqual(["needs_action", "important", "Follow-up overdue 3 days", "$30,000", true, false]);
  // Stage-aware: Negotiation needs quantity and destination; a new enquiry only a way to reach them.
  const l2 = byKeyOf("DATA_INCOMPLETE:PX-L2");
  expect([l2.type, l2.section, l2.severity, l2.missing, l2.dismissible, l2.actions]).toEqual(["LEAD_INCOMPLETE", "data", "important", ["quantity", "destination"], false, ["complete_details", "open"]]);
  const l3 = byKeyOf("DATA_INCOMPLETE:PX-L3");
  expect([l3.severity, l3.missing, l3.dismissible]).toEqual(["normal", ["contact"], true]);
  const dup = byKeyOf("DUPLICATE:PX-C1:PX-C2");
  expect([dup.related, dup.facts.evidence, dup.actions]).toEqual([[{ type: "customers", id: "PX-C2", title: "Sharjah Gulf Star Trading" }], "same name (ignoring legal suffixes)", ["review_duplicates"]]);
  // The owner never approves their own quotation; nobody else's work is "mine".
  expect(keys(mine.body).some((k: string) => k.includes("PX-Q1") || k.includes("PX-L4"))).toBe(false);
  // A Sales Executive has no team scope: asking for it returns their own.
  const asTeam = await center(seller, "?scope=team");
  expect([asTeam.body.scope, px(asTeam.body)]).toEqual(["mine", px(mine.body)]);
  expect(px((await center(other)).body)).toEqual(["FOLLOW_UP_OVERDUE:PX-L4"]);

  // The manager: approvals are theirs; the team view has everyone's.
  const mgrMine = await center(manager);
  expect(px(mgrMine.body)).toEqual(["ORDER_DELAYED:PX-O1", "QUOTATION_APPROVAL:PX-Q1", "SHIPMENT_DELAYED:PX-S1"]);
  const approval = all(mgrMine.body).find((s) => s.key === "QUOTATION_APPROVAL:PX-Q1");
  expect([approval.type, approval.severity, approval.label, approval.snoozable, approval.actions]).toEqual(["QUOTATION_APPROVAL_OVERDUE", "urgent", "Awaiting your approval for 3 days", false, ["review_approval"]]);
  const team = await center(manager, "?scope=team");
  expect(team.body.scope).toBe("team");
  expect(px(team.body)).toEqual(expect.arrayContaining(["FOLLOW_UP_OVERDUE:PX-L1", "FOLLOW_UP_OVERDUE:PX-L4", "QUOTATION_APPROVAL:PX-Q1", "DATA_INCOMPLETE:PX-L2"]));
  // Filters: the same signals, grouped.
  const ops = await center(manager, "?scope=team&group=operations");
  expect(px(ops.body)).toEqual(["ORDER_DELAYED:PX-O1", "SHIPMENT_DELAYED:PX-S1"]);
  expect(ops.body.counts.operations).toBe(2);
  const data = await center(manager, "?scope=team&group=data");
  expect(all(data.body).every((s) => s.section === "data")).toBe(true);

  // The MD's exceptions: counts and money per currency — never a score of people.
  const mdTeam = await center(md, "?scope=team");
  const tiles = Object.fromEntries(mdTeam.body.summary.tiles.map((t: any) => [t.id, t]));
  expect([tiles.decisions.count, tiles.operations.count, tiles.money.count, tiles.money.detail]).toEqual([1, 2, 1, "$4,000"]);
  expect(mdTeam.body.summary.overdueFollowUpsByOwner).toEqual(expect.arrayContaining([{ owner: "Parveen Sharjah", count: 1 }, { owner: "Pavel Sharjah", count: 1 }]));
  expect(JSON.stringify(mdTeam.body)).not.toMatch(/score|performance|rating/i);

  // Accounts: the overdue invoice, exactly as the ledger says.
  const accMine = await center(acc);
  expect(px(accMine.body)).toEqual(["PAYMENT_OVERDUE:PX-I1"]);
  expect(all(accMine.body)[0].label).toBe("$4,000 overdue by 10 days");

  // Another branch, or no sales modules: nothing from Sharjah.
  expect(px((await center(outsider, "?scope=team")).body)).toEqual([]);
  const hrView = await center(hr, "?scope=team");
  expect(hrView.status).toBe(200);
  expect(px(hrView.body)).toEqual([]);

  expect((await seller.request("GET", "/api/proactive", undefined, { cookie: null })).status).toBe(401);
  expect((await center(seller, "?scope=everyone")).status).toBe(400);
  // Not one model call, not one AI usage row.
  expect(callsSince(before, "Sharjah")).toHaveLength(0);
  const ids = ["pxse1", "pxse2", "pxsm", "pxmd", "pxacc", "pxhr", "pxout"].map((k) => byKey(k).id);
  expect(query(`SELECT id FROM "AiUsage" WHERE "userId" IN (${ids.map(() => "?").join(",")})`, ...ids)).toHaveLength(0);
});

test("snooze and dismiss are personal UI state, limited by type — business data is untouched", async () => {
  const [seller, acc, outsider] = await Promise.all(["pxse1", "pxacc", "pxout"].map(login));
  const v1 = version("PX-L1");

  expect((await state(seller, { key: "FOLLOW_UP_OVERDUE:PX-L1", action: "snooze", until: tomorrow() })).status).toBe(200);
  let mine = (await center(seller)).body;
  expect(px(mine)).not.toContain("FOLLOW_UP_OVERDUE:PX-L1");
  expect(mine.hidden).toEqual({ snoozed: 1, dismissed: 0 });
  // Only for this person: the manager still sees it.
  expect(px((await center(await login("pxsm"), "?scope=team")).body)).toContain("FOLLOW_UP_OVERDUE:PX-L1");
  expect((await state(seller, { key: "FOLLOW_UP_OVERDUE:PX-L1", action: "restore" })).status).toBe(200);
  expect(px((await center(seller)).body)).toContain("FOLLOW_UP_OVERDUE:PX-L1");
  expect(version("PX-L1")).toBe(v1);

  // Dismiss only what is advisory; an important data gap clears when it is filled in.
  expect((await state(seller, { key: "FOLLOW_UP_OVERDUE:PX-L1", action: "dismiss" })).status).toBe(409);
  expect((await state(seller, { key: "DATA_INCOMPLETE:PX-L2", action: "dismiss" })).status).toBe(409);
  expect((await state(seller, { key: "DATA_INCOMPLETE:PX-L3", action: "dismiss" })).status).toBe(200);
  mine = (await center(seller)).body;
  expect(px(mine)).not.toContain("DATA_INCOMPLETE:PX-L3");
  expect(mine.hidden.dismissed).toBe(1);
  // Money owed can't be snoozed or dismissed.
  expect((await state(acc, { key: "PAYMENT_OVERDUE:PX-I1", action: "snooze", until: tomorrow() })).status).toBe(409);
  expect((await state(acc, { key: "PAYMENT_OVERDUE:PX-I1", action: "dismiss" })).status).toBe(409);

  // Bounds and ownership.
  expect((await state(seller, { key: "FOLLOW_UP_OVERDUE:PX-L1", action: "snooze", until: new Date(Date.now() + 20 * 86_400_000).toISOString() })).status).toBe(400);
  expect((await state(seller, { key: "FOLLOW_UP_OVERDUE:PX-L1", action: "snooze", until: "2020-01-01T00:00:00.000Z" })).status).toBe(400);
  expect((await state(seller, { key: "FOLLOW_UP_OVERDUE:PX-L4", action: "snooze", until: tomorrow() })).status).toBe(404);
  expect((await state(outsider, { key: "FOLLOW_UP_OVERDUE:PX-L1", action: "snooze", until: tomorrow() })).status).toBe(404);
  expect((await state(seller, { key: "FOLLOW_UP_OVERDUE:PX-L1", action: "snooze", until: tomorrow() }, { origin: "https://evil.example" })).status).toBe(403);
  expect((await state(seller, { key: "FOLLOW_UP_OVERDUE:PX-L1", action: "snooze", until: tomorrow() }, { cookie: null })).status).toBe(401);
  expect((await state(seller, { key: "FOLLOW_UP_OVERDUE:PX-L1", action: "delete" })).status).toBe(400);
  expect(query(`SELECT "signalKey" FROM "ProactiveState" WHERE "userId" = ?`, byKey("pxout").id)).toEqual([]);
  expect(version("PX-L1")).toBe(v1);

  // What is stored: keys, a hash and times — no title, customer, amount or text.
  const rows = query<Record<string, unknown>>(`SELECT * FROM "ProactiveState" WHERE "userId" = ?`, byKey("pxse1").id);
  expect(rows.map((r) => Object.keys(r).sort())).toEqual(rows.map(() => ["dismissedAt", "fingerprint", "signalKey", "snoozedUntil", "updatedAt", "userId"]));
  expect(rows.every((r) => /^[0-9a-f]{8}$/.test(String(r.fingerprint)))).toBe(true);
  expect(JSON.stringify(rows)).not.toMatch(/Sharjah|Test Contact|30000|\$/);

  // An expired snooze: back, because the condition still exists.
  expect((await state(seller, { key: "FOLLOW_UP_OVERDUE:PX-L1", action: "snooze", until: tomorrow() })).status).toBe(200);
  expect(px((await center(seller)).body)).not.toContain("FOLLOW_UP_OVERDUE:PX-L1");
  await expireSnooze(byKey("pxse1").id, "FOLLOW_UP_OVERDUE:PX-L1");
  expect(px((await center(seller)).body)).toContain("FOLLOW_UP_OVERDUE:PX-L1");

  // A dismissal covers the condition as it was: a materially different one
  // on the same record (a new stage) shows again.
  expect((await seller.request("PATCH", "/api/records", { action: "status", id: "PX-L3", status: "Contacted" })).status).toBe(200);
  mine = (await center(seller)).body;
  expect(px(mine)).toContain("DATA_INCOMPLETE:PX-L3");
  expect(mine.hidden.dismissed).toBe(0);
});

test("Quick Complete fills only the missing details — permission, version guard, audit", async () => {
  const [seller, other, outsider] = await Promise.all(["pxse1", "pxse2", "pxout"].map(login));
  const current = (await seller.request("GET", "/api/records?id=PX-L2")).body.record;
  const complete = (c: Client, body: Record<string, unknown>) => c.request("PATCH", "/api/records", { action: "complete", id: "PX-L2", expectedUpdatedAt: current.updatedAt, ...body });
  const v = version("PX-L2");

  // Nothing but the missing-detail fields; never status or ownership.
  expect((await complete(seller, { values: { status: "Won" } })).status).toBe(400);
  expect((await complete(seller, { values: { ownerId: byKey("pxse1").id } })).status).toBe(400);
  expect((await complete(seller, { values: {} })).status).toBe(400);
  expect((await complete(seller, { values: { quantity: -5 } })).status).toBe(400);
  // Stale version, someone else's lead, another branch: refused.
  const stale = await seller.request("PATCH", "/api/records", { action: "complete", id: "PX-L2", expectedUpdatedAt: "2020-01-01T00:00:00.000Z", values: { quantity: 25 } });
  expect([stale.status, stale.body.error]).toEqual([400, "This record changed. Close the editor, refresh and try again."]);
  expect((await complete(other, { values: { quantity: 25 } })).status).toBe(400);
  expect((await complete(outsider, { values: { quantity: 25 } })).status).toBe(400);
  // Only leads, customers and suppliers: never a quotation, order or invoice.
  const quote = (await seller.request("GET", "/api/records?id=PX-Q1")).body.record;
  const onQuote = await seller.request("PATCH", "/api/records", { action: "complete", id: "PX-Q1", expectedUpdatedAt: quote.updatedAt, values: { quantity: 1 } });
  expect([onQuote.status, onQuote.body.error]).toEqual([400, "Only missing lead, customer or supplier details can be completed here."]);
  expect(version("PX-L2")).toBe(v);

  const ok = await complete(seller, { values: { quantity: 25, unit: "MT", destination: "Hamriyah" } });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  const after = (await seller.request("GET", "/api/records?id=PX-L2")).body.record;
  expect([after.quantity, after.unit, after.destination, after.status, after.due, after.ownerId, after.amount]).toEqual([25, "MT", "Hamriyah", current.status, current.due, current.ownerId, current.amount]);
  expect(version("PX-L2")).toBe(v + 1);
  const audit = query<{ actor: string; action: string }>(`SELECT actor, action FROM "AuditEvent" WHERE "recordId" = 'PX-L2' ORDER BY at DESC LIMIT 1`);
  expect(audit[0].actor).toBe("Parveen Sharjah");
  // Resolved by re-derivation: the data gap is gone.
  expect(px((await center(seller)).body)).not.toContain("DATA_INCOMPLETE:PX-L2");
});

test("setting the next follow-up resolves the overdue signal; approving resolves the approval", async () => {
  const [seller, manager] = await Promise.all(["pxse1", "pxsm"].map(login));
  const date = gstToday(2);
  const r = await seller.request("PATCH", "/api/records", { action: "note", id: "PX-L1", text: `Next follow-up set for ${date} (Action Center).`, due: date });
  expect(r.status).toBe(200);
  const mine = (await center(seller)).body;
  expect(px(mine)).not.toContain("FOLLOW_UP_OVERDUE:PX-L1");
  expect(keys(mine).some((k: string) => k.includes("PX-L1"))).toBe(false);

  expect((await manager.request("PATCH", "/api/records", { action: "status", id: "PX-Q1", status: "Approved" })).status).toBe(200);
  expect(px((await center(manager)).body)).not.toContain("QUOTATION_APPROVAL:PX-Q1");
  expect((await (await login("pxse2")).request("PATCH", "/api/records", { action: "status", id: "PX-L4", status: "Lost" })).status).toBe(200);
});

test("what changed comes from the audit trail of records the person may read", async () => {
  const [md, outsider] = await Promise.all(["pxmd", "pxout"].map(login));
  const before = lastCallId();
  const r = await md.request("GET", "/api/proactive/changes");
  expect(r.status).toBe(200);
  const facts = Object.fromEntries(r.body.facts.map((f: any) => [f.id, f.count]));
  expect([facts.approved, facts.lost]).toEqual([1, 1]);
  expect(r.body.notable.map((n: any) => [n.recordId, n.change, n.by])).toEqual(
    expect.arrayContaining([
      ["PX-Q1", "Pending Approval → Approved", "Priya Sharjahmanager"],
      ["PX-L4", "Qualified → Lost", "Pavel Sharjah"],
    ]),
  );
  const week = await md.request("GET", "/api/proactive/changes?days=7");
  expect(week.body.days).toBe(7);
  // Another branch sees none of it.
  const out = await outsider.request("GET", "/api/proactive/changes");
  expect(out.body.notable.filter((n: any) => n.recordId.startsWith("PX-"))).toEqual([]);
  expect(callsSince(before, "Sharjah")).toHaveLength(0);
});

test("the AI brief is on demand: one fast-model call over the facts, then cached", async () => {
  const md = await login("pxmd");
  const before = lastCallId();
  const first = await md.request("POST", "/api/proactive/brief", { kind: "changes" });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  const calls = callsSince(before, "Sharjah");
  expect(calls.map((c) => c.model)).toEqual([FAST]);
  expect(calls[0].prompt).toContain("Quotations approved");
  expect(first.body.cached).toBe(false);
  const again = await md.request("POST", "/api/proactive/brief", { kind: "changes" });
  expect([again.status, again.body.cached]).toEqual([200, true]);
  expect(callsSince(before, "Sharjah")).toHaveLength(1);
  const usage = query<{ feature: string; status: string }>(`SELECT feature, status FROM "AiUsage" WHERE "userId" = ? ORDER BY rowid`, byKey("pxmd").id);
  expect(usage.map((u) => [u.feature, u.status])).toEqual([["proactive", "ok"], ["proactive", "cached"]]);

  expect((await md.request("POST", "/api/proactive/brief", { kind: "everything" })).status).toBe(400);
  expect((await md.request("POST", "/api/proactive/brief", { kind: "today" }, { origin: "https://evil.example" })).status).toBe(403);
  expect((await md.request("POST", "/api/proactive/brief", { kind: "today" }, { cookie: null })).status).toBe(401);
});
