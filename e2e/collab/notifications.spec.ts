import { test, expect, type Page } from "@playwright/test";
import { Client, openSocket } from "./client";
import { byKey } from "./people";

/**
 * CRM-wide notifications through the real Worker, D1 and CollabHub: record
 * assignment and its rules, approvals and hand-offs, chat notifications, the
 * inbox API, and the live browser experience (bell, toast, inbox, deep link,
 * multi-tab). People: nm*, ns*, nsd, nsf, nlog, nacc, nacc2, nhr, nemp, nit
 * (exclusive to this file; company Petronex, so no other suite reaches them).
 */

const today = new Date().toISOString().slice(0, 10);
const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

const base = {
  company: "Petronex",
  branch: "Main",
  contact: "",
  product: "Base Oil SN500",
  quantity: 1,
  unit: "MT",
  amount: 0,
  currency: "USD",
  due: today,
  detail: "",
  source: "",
};

async function create(client: Client, fields: Record<string, unknown>) {
  const result = await client.request("POST", "/api/records", { ...base, ...fields });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body.record as { id: string; title: string; ownerId: string; [k: string]: any };
}
const lead = (client: Client, title = `ABC Trading ${Math.random().toString(36).slice(2, 7)}`) =>
  create(client, { kind: "leads", title });
const change = (client: Client, body: Record<string, unknown>) => client.request("PATCH", "/api/records", body);
const assignTo = (client: Client, id: string, key: string) =>
  change(client, { action: "assign", id, assigneeId: byKey(key).id });
const status = (client: Client, id: string, next: string) => change(client, { action: "status", id, status: next });

async function inbox(client: Client) {
  const result = await client.request("GET", "/api/notifications");
  expect(result.status).toBe(200);
  return result.body as { items: any[]; unread: number };
}
/** Notifications are written just after the response; wait for them. */
async function waitFor(client: Client, match: (n: any) => boolean) {
  let found: any;
  await expect
    .poll(async () => ((found = (await inbox(client)).items.find(match)), !!found), { timeout: 10_000 })
    .toBe(true);
  return found;
}
const about = (id: string, type?: string) => (n: any) =>
  n.target?.recordId === id && (!type || n.type === type);

/* ------------------------------------------------------------ assignment */

test("a manager assigns a lead: the owner changes and the salesperson is told live, once", async () => {
  const [manager, sales] = await Promise.all(["nm1", "ns1"].map(Client.login));
  const socket = await openSocket(sales.cookie);
  const record = await lead(manager);
  expect((await assignTo(manager, record.id, "ns1")).status).toBe(200);

  const live = await socket.waitFor((e) => e.type === "notification.created" && e.notification.target?.recordId === record.id);
  expect(live.notification).toMatchObject({
    type: "record.assigned",
    title: "New lead assigned to you",
    category: "assignment",
    actor: { id: manager.id, name: "Nadia Manager1" },
    needsAction: true,
  });
  expect(live.notification.body).toContain(`${record.title} · Base Oil SN500`);

  // The owner really changed, and the new owner can open it by id.
  const opened = await sales.request("GET", `/api/records?id=${record.id}`);
  expect(opened.status).toBe(200);
  expect(opened.body.record).toMatchObject({ ownerId: sales.id, owner: "Nour Sales1" });

  // Assigning again to the same person is a no-op: no second notification.
  expect((await assignTo(manager, record.id, "ns1")).status).toBe(200);
  await socket.none((e) => e.type === "notification.created" && e.notification.target?.recordId === record.id && e.notification.id !== live.notification.id, 1500);
  expect((await inbox(sales)).items.filter(about(record.id))).toHaveLength(1);
  // Nobody else was told.
  expect((await inbox(await Client.login("ns2"))).items.filter(about(record.id))).toHaveLength(0);
  socket.ws.close();
});

test("only managers assign, and only to people who could own the record", async () => {
  const [manager, sales] = await Promise.all(["nm2", "ns2"].map(Client.login));
  const record = await lead(manager);

  // An executive cannot assign, nor list candidates.
  const refused = await assignTo(sales, record.id, "ns3");
  expect(refused.status).toBe(400);
  expect(refused.body.error).toMatch(/permission to assign/);
  expect((await sales.request("GET", `/api/records/assignees?id=${record.id}`)).status).toBe(403);

  // Wrong branch, wrong company, wrong department, unknown: all refused.
  for (const key of ["nsd", "nsf", "nlog"]) {
    const result = await assignTo(manager, record.id, key);
    expect(result.status, key).toBe(400);
    expect(result.body.error).toBe("That person can't be given this record.");
  }
  const unknown = await change(manager, { action: "assign", id: record.id, assigneeId: "no-such-person" });
  expect(unknown.status).toBe(400);

  // The picker offers exactly the people the server would accept.
  const candidates = (await manager.request("GET", `/api/records/assignees?id=${record.id}`)).body.people as { id: string }[];
  const offered = candidates.map((p) => p.id);
  expect(offered).toContain(byKey("ns3").id);
  for (const key of ["nsd", "nsf", "nlog", "nacc"]) expect(offered).not.toContain(byKey(key).id);
  // The record is unchanged after all the refusals.
  expect((await manager.request("GET", `/api/records?id=${record.id}`)).body.record.ownerId).toBe(manager.id);
});

test("reassignment: the new owner is told; an executive who lost it is not; self-assignment is silent", async () => {
  const [manager, first, second] = await Promise.all(["nm3", "ns3", "ns4"].map(Client.login));
  const record = await lead(manager);
  await assignTo(manager, record.id, "ns3");
  const original = await waitFor(first, about(record.id, "record.assigned"));

  await assignTo(manager, record.id, "ns4");
  await waitFor(second, about(record.id, "record.assigned"));
  // ns3 can no longer read it: no reassignment note, and the earlier
  // notification keeps its title but loses its details and link.
  const stale = (await inbox(first)).items.filter(about(record.id));
  expect(stale).toHaveLength(0);
  const redacted = (await inbox(first)).items.find((n) => n.id === original.id);
  expect(redacted).toMatchObject({ body: "No longer available to you.", target: null, needsAction: false });
  expect((await first.request("GET", `/api/records?id=${record.id}`)).status).toBe(404);

  // Taking it back yourself notifies nobody, yourself included.
  await assignTo(manager, record.id, "nm3");
  await new Promise((r) => setTimeout(r, 1500));
  expect((await inbox(manager)).items.filter(about(record.id))).toHaveLength(0);
  expect((await inbox(second)).items.filter(about(record.id, "record.reassigned"))).toHaveLength(0);
});

/* ------------------------------------------------------------- the inbox */

test("the inbox is the reader's own: read, unread and read-all, synced live", async () => {
  const [manager, sales, other] = await Promise.all(["nm1", "ns5", "ns6"].map(Client.login));
  const records = [await lead(manager), await lead(manager)];
  for (const r of records) await assignTo(manager, r.id, "ns5");
  const [a, b] = [await waitFor(sales, about(records[0].id)), await waitFor(sales, about(records[1].id))];
  const device = await openSocket(sales.cookie);
  expect((await inbox(sales)).unread).toBe(2);

  // Another person cannot touch these ids.
  expect((await other.request("PATCH", "/api/notifications", { action: "read", ids: [a.id] })).status).toBe(200);
  expect((await inbox(sales)).unread).toBe(2);
  expect((await inbox(other)).items.some((n) => n.id === a.id)).toBe(false);

  expect((await sales.request("PATCH", "/api/notifications", { action: "read", ids: [a.id] })).status).toBe(200);
  expect(await device.waitFor((e) => e.type === "notification.read" && e.read && e.ids.includes(a.id))).toBeTruthy();
  expect((await inbox(sales)).unread).toBe(1);
  await sales.request("PATCH", "/api/notifications", { action: "unread", ids: [a.id] });
  expect((await inbox(sales)).unread).toBe(2);
  const newest = (await inbox(sales)).items[0].id;
  await sales.request("PATCH", "/api/notifications", { action: "read_all", upTo: newest });
  expect(await device.waitFor((e) => e.type === "notification.read_all")).toBeTruthy();
  const after = await inbox(sales);
  expect(after.unread).toBe(0);
  expect(after.items.filter((n) => [a.id, b.id].includes(n.id)).every((n) => n.readAt)).toBe(true);

  // Malformed commands are refused; a request from another site is refused.
  expect((await sales.request("PATCH", "/api/notifications", { action: "read", ids: ["../x"] })).status).toBe(400);
  expect((await sales.request("PATCH", "/api/notifications", { action: "read", ids: [a.id] }, { origin: "https://evil.example" })).status).toBe(400);
  expect((await sales.request("GET", "/api/notifications", undefined, { cookie: null })).status).toBe(401);
  device.ws.close();
});

/* ------------------------------------------- approvals and the hand-offs */

test("quotation approval, decision, acceptance hand-offs, delay and overdue", async () => {
  const [sales, approver, logistics, accounts, accountant] = await Promise.all(
    ["ns7", "nm4", "nlog", "nacc", "nacc2"].map(Client.login),
  );
  const quote = await create(sales, {
    kind: "quotations",
    title: `Quote ${Math.random().toString(36).slice(2, 7)}`,
    due: inAWeek,
    lines: [{ description: "Base Oil SN500", quantity: 2, unitPriceCents: 10000 }],
    attributes: { issuedDate: today },
  });
  expect((await status(sales, quote.id, "Pending Approval")).status).toBe(200);
  const asked = await waitFor(approver, about(quote.id, "approval.requested"));
  expect(asked).toMatchObject({ title: "Quotation approval required", category: "approval", priority: "important", needsAction: true });

  expect((await status(approver, quote.id, "Approved")).status).toBe(200);
  await waitFor(sales, about(quote.id, "approval.approved"));
  // Decided: the request is cleared for every approver.
  await expect.poll(async () => (await inbox(approver)).items.find((n) => n.id === asked.id)?.readAt).toBeTruthy();

  expect((await status(sales, quote.id, "Accepted")).status).toBe(200);
  const shipmentId = `${quote.id}-SHP`;
  const invoiceId = `${quote.id}-INV`;
  expect(await waitFor(logistics, about(shipmentId, "shipment.to_plan"))).toMatchObject({ title: "New shipment to plan" });
  expect(await waitFor(accounts, about(invoiceId, "invoice.to_issue"))).toMatchObject({ title: "Invoice ready to issue" });
  // The salesperson may not read invoices and is never told about one.
  expect((await inbox(sales)).items.filter(about(invoiceId))).toHaveLength(0);

  expect((await status(logistics, shipmentId, "Delayed")).status).toBe(200);
  expect(await waitFor(sales, about(shipmentId, "shipment.delayed"))).toMatchObject({ title: "Shipment delayed", priority: "important" });

  expect((await status(accounts, invoiceId, "Sent")).status).toBe(200);
  expect((await status(accounts, invoiceId, "Overdue")).status).toBe(200);
  expect(await waitFor(accountant, about(invoiceId, "payment.overdue"))).toMatchObject({ title: "Payment overdue" });
  // No amounts in any of it.
  for (const n of (await inbox(accountant)).items) expect(n.body).not.toMatch(/\$|USD/);
});

test("leave requests reach HR and the decision returns; IT tickets reach IT", async () => {
  const [employee, hr, it] = await Promise.all(["nemp", "nhr", "nit"].map(Client.login));
  const approve = await create(employee, { kind: "leave", title: "Annual leave", product: "" });
  const reject = await create(employee, { kind: "leave", title: "Extra leave", product: "" });
  await waitFor(hr, about(approve.id, "approval.requested"));
  await waitFor(hr, about(reject.id, "approval.requested"));
  expect((await status(hr, approve.id, "Approved")).status).toBe(200);
  expect((await status(hr, reject.id, "Rejected")).status).toBe(200);
  expect(await waitFor(employee, about(approve.id))).toMatchObject({ title: "Your leave request was approved" });
  expect(await waitFor(employee, about(reject.id))).toMatchObject({ title: "Your leave request was rejected" });
  const leaveTarget = (await inbox(employee)).items.find(about(approve.id)).target;
  expect(leaveTarget).toEqual({ kind: "record", recordKind: "leave", recordId: approve.id });

  const ticket = await create(employee, { kind: "it", title: "Laptop broken", product: "", attributes: { priority: "Urgent" } });
  expect(await waitFor(it, about(ticket.id, "ticket.created"))).toMatchObject({ title: "Urgent support ticket", priority: "urgent" });
  expect((await status(it, ticket.id, "In Progress")).status).toBe(200);
  expect(await waitFor(employee, about(ticket.id, "ticket.status"))).toMatchObject({ title: "Your ticket is in progress" });
});

/* ---------------------------------------------------------- collaboration */

test("DMs, mentions and replies notify; room chatter does not; reading clears them", async () => {
  const [leila, omar, sara] = await Promise.all(["nm5", "ns8", "ns9"].map(Client.login));
  const count = async (c: Client, conversationId: string) =>
    (await inbox(c)).items.filter((n) => n.target?.conversationId === conversationId).length;

  const room = await leila.createRoom({ name: "Ops floor", members: ["ns8", "ns9"] });
  const plain = (await leila.send(room.id, "Morning all")).body.message;
  const mention = (await leila.send(room.id, "@Nour Sales9 please check", { mentionIds: [sara.id] })).body.message;
  const reply = (await leila.send(room.id, "Replying", { replyToId: (await omar.send(room.id, "Question?")).body.message.id })).body.message;

  const onMention = await waitFor(sara, (n) => n.type === "chat.mention");
  expect(onMention).toMatchObject({ title: "Nadia Manager5 mentioned you in Ops floor", priority: "important" });
  expect(onMention.target).toEqual({ kind: "conversation", conversationId: room.id, messageId: mention.id });
  expect(await waitFor(omar, (n) => n.type === "chat.reply")).toMatchObject({ title: "Nadia Manager5 replied to you in Ops floor" });
  // Only those two; the plain message and the author's own messages notify nobody.
  await new Promise((r) => setTimeout(r, 1000));
  expect(await count(sara, room.id)).toBe(1);
  expect(await count(omar, room.id)).toBe(1);
  expect(await count(leila, room.id)).toBe(0);
  expect((await inbox(sara)).items.some((n) => n.target?.messageId === plain.id)).toBe(false);

  const dm = (await leila.openDirect("ns8")).body.conversation;
  await leila.send(dm.id, "Private note");
  expect(await waitFor(omar, (n) => n.type === "chat.direct")).toMatchObject({ title: "Nadia Manager5", body: "Private note" });

  // Reading the room clears the reply notification, not the DM.
  expect((await omar.post(`/conversations/${room.id}/read`, { messageId: reply.id })).status).toBe(200);
  await expect.poll(async () => (await inbox(omar)).items.find((n) => n.type === "chat.reply")?.readAt).toBeTruthy();
  expect((await inbox(omar)).items.find((n) => n.type === "chat.direct").readAt).toBeNull();
});

/* ---------------------------------------------------------- browser, live */

const bell = (page: Page) => page.getByRole("button", { name: /^Open notifications/ });

test("assign → live bell, one toast across tabs, inbox row, deep link, mark read", async ({ browser }) => {
  const [manager, sales] = await Promise.all(["nm6", "ns10"].map(Client.login));
  const record = await lead(manager, "Gulf Lubricants Trading");

  const context = await browser.newContext();
  await sales.signInBrowser(context);
  const [tab, other] = [await context.newPage(), await context.newPage()];
  for (const p of [tab, other]) {
    // The realtime channel is up (the hub said "ready") before anything is sent.
    const socket = p.waitForEvent("websocket", (ws) => ws.url().endsWith("/api/collab/socket"));
    await p.goto("/");
    await (await socket).waitForEvent("framereceived", (f) => String(f.payload).includes('"ready"'));
    await expect(bell(p)).toHaveAccessibleName("Open notifications");
  }

  expect((await assignTo(manager, record.id, "ns10")).status).toBe(200);

  // Bell count and tab title update live in both tabs.
  for (const p of [tab, other]) {
    await expect(bell(p)).toHaveAccessibleName("Open notifications, 1 unread");
    await expect(p.locator(".notify-badge")).toHaveText("1");
    await expect.poll(() => p.title()).toMatch(/^\(1\) /);
  }
  // Exactly one toast between the two tabs.
  const toasts = () => Promise.all([tab, other].map((p) => p.locator(".notify-toast").count()));
  await expect.poll(async () => (await toasts()).reduce((a, b) => a + b, 0)).toBe(1);
  await tab.waitForTimeout(1200);
  expect((await toasts()).reduce((a, b) => a + b, 0)).toBe(1);
  const withToast = (await tab.locator(".notify-toast").count()) ? tab : other;
  const toast = withToast.locator(".notify-toast");
  await expect(toast).toContainText("New lead assigned to you");
  await expect(toast).toContainText("Gulf Lubricants Trading · Base Oil SN500");
  await expect(toast).toContainText("By Nadia Manager6");

  // The notification centre lists it under Needs action, with GST time.
  await bell(withToast).click();
  const row = withToast.locator(".notify-row", { hasText: "Gulf Lubricants Trading" });
  await expect(withToast.locator(".notify-section", { hasText: "Needs action" }).locator(".notify-row")).toHaveCount(1);
  await expect(row).toContainText("Nadia Manager6");
  await expect(row.locator("time")).toContainText("GST");

  // Clicking opens exactly that lead, and reading it clears the count everywhere.
  await row.locator(".notify-main").click();
  await expect(withToast.getByRole("dialog", { name: "Gulf Lubricants Trading" })).toBeVisible();
  await expect(withToast.getByRole("dialog")).toContainText("Nour Sales10");
  // Close the record (a modal hides the page behind it), then check both tabs.
  await withToast.keyboard.press("Escape");
  await expect(withToast.getByRole("dialog")).toHaveCount(0);
  for (const p of [tab, other]) {
    await expect(bell(p)).toHaveAccessibleName("Open notifications");
    await expect(p.locator(".notify-badge")).toHaveCount(0);
    await expect.poll(() => p.title()).not.toMatch(/^\(/);
  }
  await context.close();
});

test("the manager's Assign action in the record view", async ({ page, context }) => {
  const [manager] = await Promise.all(["nm2"].map(Client.login));
  const record = await lead(manager, "Desert Oils LLC");
  await manager.signInBrowser(context);
  await page.goto("/?module=leads");
  await page.getByText("Desert Oils LLC").first().click();
  const detail = page.getByRole("dialog", { name: "Desert Oils LLC" });
  await detail.getByRole("button", { name: "Assign" }).click();
  const dialog = page.getByRole("dialog", { name: "Assign Desert Oils LLC" });
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: /Nour Sales3/ }).click();
  await dialog.getByRole("button", { name: "Assign" }).click();
  // The confirmation toast sits outside the (modal) record view.
  await expect(page.locator(".toast")).toContainText("Assigned to Nour Sales3.");
  await expect(detail).toContainText("Nour Sales3");
  expect((await manager.request("GET", `/api/records?id=${record.id}`)).body.record.owner).toBe("Nour Sales3");

  // An executive never sees the action.
  const sales = await Client.login("ns3");
  const salesContext = await page.context().browser()!.newContext();
  await sales.signInBrowser(salesContext);
  const salesPage = await salesContext.newPage();
  await salesPage.goto("/?module=leads");
  await salesPage.getByText("Desert Oils LLC").first().click();
  await expect(salesPage.getByRole("dialog", { name: "Desert Oils LLC" })).toBeVisible();
  await expect(salesPage.getByRole("dialog", { name: "Desert Oils LLC" }).getByRole("button", { name: "Assign" })).toHaveCount(0);
  await salesContext.close();
});

test("a chat notification opens the conversation at the message", async ({ page, context }) => {
  const [sender, reader] = await Promise.all(["nm5", "ns6"].map(Client.login));
  const dm = (await sender.openDirect("ns6")).body.conversation;
  const sent = (await sender.send(dm.id, "Can you call the client?")).body.message;
  await waitFor(reader, (n) => n.target?.messageId === sent.id);
  await reader.signInBrowser(context);
  await page.goto("/?view=notifications");
  await page.locator(".notify-row", { hasText: "Can you call the client?" }).locator(".notify-main").click();
  await expect(page).toHaveURL(new RegExp(`c=${dm.id}`));
  await expect(page.locator(`[data-message-id="${sent.id}"], .collab-msg`, { hasText: "Can you call the client?" }).first()).toBeVisible();
});

test("the notification centre at phone width", async ({ browser }) => {
  const sales = await Client.login("ns4");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await sales.signInBrowser(context);
  const page = await context.newPage();
  await page.goto("/?view=notifications");
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notification settings" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(bell(page)).toBeVisible();
  await context.close();
});
