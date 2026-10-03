import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { d1, migratedDatabase } from "./support/sqlite-d1";
import * as schema from "../src/lib/schema";
import type { Database } from "../src/lib/d1";
import type { Actor, RecordItem } from "../src/lib/domain";
import { duplicates, listContacts, newRecordContact } from "../src/lib/commercial/store";
import { companyCore } from "../src/lib/commercial/model";
import { createRecordWithAudit } from "../src/lib/data";

/**
 * "Add customer" as one business action: the customer, its main contact and
 * the primary-contact link are written together, retry-safe, and duplicate
 * suggestions never reveal what the person may not read.
 */
const md: Actor = { id: "md", name: "Manager", role: "MD", companies: ["Petronik"], branches: [] };
const sales: Actor = { id: "sales", name: "Sales", role: "Sales Executive", companies: ["Petronik"], branches: ["Main"] };
const otherCompany: Actor = { id: "other", name: "Other", role: "Sales Executive", companies: ["Afrilube"], branches: ["Main"] };

function setup() {
  const sqlite = migratedDatabase();
  const db = drizzle(d1(sqlite) as never, { schema }) as Database;
  return { sqlite, db };
}
const count = (s: DatabaseSync, t: string) => Number((s.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n);
const customer = (id: string, values: Partial<RecordItem> = {}): RecordItem => ({
  id,
  kind: "customers",
  title: "Petrochem Trading LLC",
  company: "Petronik",
  branch: "Main",
  ownerId: "md",
  owner: "Manager",
  status: "Active",
  contact: "Samira Haddad",
  email: "samira@petrochem.example",
  phone: "+971 4 555 0142",
  product: "",
  quantity: 0,
  unit: "",
  amount: 0,
  currency: "USD",
  due: "2026-10-01",
  source: "Test",
  detail: "",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  attributes: { country: "UAE" },
  ...values,
});
// Exactly what POST /api/records does for a new customer with a main contact.
async function create(db: Database, actor: Actor, r: RecordItem, requestId: string) {
  const main = await newRecordContact(db, actor, r, requestId);
  const created = main ? main.record : r;
  await createRecordWithAudit(
    db,
    { id: r.id, kind: r.kind, company: r.company, branch: r.branch, ownerId: actor.id, status: r.status, payload: r },
    { id: crypto.randomUUID(), actor: actor.name, actorId: actor.id, company: r.company, action: "Created customers", recordId: r.id, after: created },
    main ? [...main.statements] : [],
  );
  return created;
}

test("customer and main contact are one write: linked as primary, audited once", async () => {
  const { db, sqlite } = setup();
  const r = await create(db, md, customer("REQ-1"), "request-1");
  assert.ok(r.primaryContactId);
  assert.equal(count(sqlite, "BusinessRecord"), 1);
  assert.equal(count(sqlite, "Contact"), 1);
  assert.equal(count(sqlite, "AuditEvent"), 1);
  const stored = JSON.parse((sqlite.prepare("SELECT payload FROM BusinessRecord").get() as { payload: string }).payload);
  assert.equal(stored.primaryContactId, r.primaryContactId);
  const [contact] = await listContacts(db, md, "REQ-1");
  assert.equal(contact.id, r.primaryContactId);
  assert.equal(contact.name, "Samira Haddad");
  assert.equal(contact.email, "samira@petrochem.example");
  assert.equal(contact.country, "UAE");
  sqlite.close();
});

test("a failed contact write leaves no customer and no audit behind", async () => {
  const { db, sqlite } = setup();
  sqlite.exec("CREATE TRIGGER fail_contact BEFORE INSERT ON Contact BEGIN SELECT RAISE(ABORT,'test_failure'); END;");
  await assert.rejects(create(db, md, customer("REQ-2"), "request-2"), /test_failure/);
  assert.equal(count(sqlite, "BusinessRecord"), 0);
  assert.equal(count(sqlite, "Contact"), 0);
  assert.equal(count(sqlite, "AuditEvent"), 0);
  sqlite.close();
});

test("a retried request derives the same contact and cannot add a second one", async () => {
  const { db, sqlite } = setup();
  const first = await newRecordContact(db, md, customer("REQ-3"), "request-3");
  const again = await newRecordContact(db, md, customer("REQ-3"), "request-3");
  assert.equal(first?.record.primaryContactId, again?.record.primaryContactId);
  await create(db, md, customer("REQ-3"), "request-3");
  // A concurrent duplicate submission fails as a whole (the route then
  // returns the existing record); nothing extra is written.
  await assert.rejects(create(db, md, customer("REQ-3"), "request-3"));
  assert.equal(count(sqlite, "BusinessRecord"), 1);
  assert.equal(count(sqlite, "Contact"), 1);
  sqlite.close();
});

test("no contact without a name; suppliers get theirs too; other kinds never", async () => {
  const { db } = setup();
  assert.equal(await newRecordContact(db, md, customer("A", { contact: "  " }), "r"), null);
  assert.ok(await newRecordContact(db, md, customer("B", { kind: "suppliers" }), "r"));
  assert.equal(await newRecordContact(db, md, customer("C", { kind: "leads" }), "r"), null);
  assert.equal(await newRecordContact(db, md, customer("D", { kind: "products" }), "r"), null);
});

test("company names match without their legal form, deterministically", () => {
  assert.equal(companyCore("Petrochem Trading LLC"), "petrochem trading");
  assert.equal(companyCore("PETROCHEM TRADING L.L.C."), "petrochem trading");
  assert.equal(companyCore("Gulf Refining Partners FZE"), "gulf refining partners");
  // Only trailing legal words go; the name itself is never reduced to nothing.
  assert.equal(companyCore("LLC"), "llc");
  assert.equal(companyCore("Trading Co Supplies"), "trading co supplies");
});

test("duplicate suggestions: legal-form match, and nothing outside the person's access", async () => {
  const { db } = setup();
  await create(db, md, customer("REQ-4"), "request-4");
  await create(db, md, customer("REQ-5", { title: "Private Branch Customer", branch: "North", contact: "" }), "request-5");
  const typed = { company: "Petronik", branch: "Main", title: "Petrochem Trading", email: "", phone: "" };
  const found = await duplicates(db, sales, typed);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].reasons, ["Same name apart from legal form"]);
  // A branch the person cannot read is not searched at all.
  assert.deepEqual(await duplicates(db, sales, { ...typed, branch: "North", title: "Private Branch Customer" }), []);
  // Another company's person learns nothing about Petronik's customers.
  assert.deepEqual(await duplicates(db, otherCompany, typed), []);
  assert.deepEqual(await duplicates(db, otherCompany, { ...typed, title: "", email: "samira@petrochem.example" }), []);
});

/* ------------------------------------------------ leads started in context */
import { resolveLinks, saveContact } from "../src/lib/commercial/store";
import { activeLeadMatches } from "../src/components/form-guidance";
import { alreadyAdded, bulkState, prospectState } from "../src/lib/prospecting/review-state";

function insert(sqlite: DatabaseSync, r: RecordItem) {
  sqlite
    .prepare("INSERT INTO BusinessRecord(id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,1,1,1)")
    .run(r.id, r.kind, r.company, r.branch, r.ownerId, r.status, JSON.stringify(r));
  return r;
}
const lead = (values: Partial<RecordItem>): RecordItem => ({ ...customer("L", { kind: "leads", status: "New", contact: "", email: "", phone: "" }), ...values });

test("a lead from a contact takes the contact's own details, never the browser's", async () => {
  const { db, sqlite } = setup();
  insert(sqlite, customer("C1", { contact: "" }));
  const contactId = await saveContact(db, md, { parentId: "C1", details: { name: "Samira Haddad", email: "samira@petrochem.example", phone: "+971 4 555 0142" } });
  const r = await resolveLinks(db, sales, lead({ customerId: "C1", contactId, contact: "Someone Else", email: "spoofed@example.test" }));
  assert.equal(r.title, "Petrochem Trading LLC");
  assert.equal(r.contact, "Samira Haddad");
  assert.equal(r.email, "samira@petrochem.example");
});

test("a lead's context is checked: inactive contact, other customer's contact, product out of scope", async () => {
  const { db, sqlite } = setup();
  insert(sqlite, customer("C1", { contact: "" }));
  insert(sqlite, customer("C2", { title: "Other Co", contact: "" }));
  const other = await saveContact(db, md, { parentId: "C2", details: { name: "Not theirs" } });
  const inactive = await saveContact(db, md, { parentId: "C1", details: { name: "Left the company", active: false } });
  await assert.rejects(resolveLinks(db, sales, lead({ customerId: "C1", contactId: other })), /belonging/);
  await assert.rejects(resolveLinks(db, sales, lead({ customerId: "C1", contactId: inactive })), /belonging/);
  insert(sqlite, customer("P-north", { kind: "products", title: "SN500", branch: "North", status: "Available", contact: "" }));
  // A branch-limited salesperson cannot attach a product they cannot read.
  await assert.rejects(resolveLinks(db, sales, lead({ productId: "P-north" })));
  insert(sqlite, customer("P-main", { kind: "products", title: "Base Oil SN500", status: "Available", contact: "" }));
  const fromProduct = await resolveLinks(db, sales, lead({ productId: "P-main", product: "typed by hand" }));
  assert.equal(fromProduct.product, "Base Oil SN500");
});

test("active-lead notice: same customer and product; another contact is only related; closed leads never", () => {
  const records = [
    lead({ id: "L1", customerId: "C1", contactId: "K1", productId: "P1", product: "SN500", status: "Qualified" }),
    lead({ id: "L2", customerId: "C1", contactId: "K2", productId: "P1", product: "SN500", status: "New" }),
    lead({ id: "L3", customerId: "C1", productId: "P2", product: "Bitumen", status: "New" }),
    lead({ id: "L4", customerId: "C1", productId: "P1", product: "SN500", status: "Lost" }),
    lead({ id: "L5", customerId: "C9", productId: "P1", product: "SN500", status: "New" }),
  ];
  const found = activeLeadMatches(records, { customerId: "C1", contactId: "K1", productId: "P1", title: "", product: "SN500" });
  assert.deepEqual(found.map((m) => [m.record.id, m.sameContact]), [["L1", true], ["L2", false]]);
  // Before a product is known, every active lead for the customer is context.
  assert.equal(activeLeadMatches(records, { customerId: "C1", title: "", product: "" }).length, 3);
  // Without a linked customer, the company name (without its legal form)
  // decides, including C9's lead; the notice lists at most three.
  const byName = activeLeadMatches(records, { title: "Petrochem Trading", product: "SN500" });
  assert.deepEqual(byName.map((m) => m.record.id).sort(), ["L1", "L2", "L5"]);
  assert.equal(activeLeadMatches(records, { title: "Petrochem Trading", product: "" }).length, 3);
});

test("Apollo review states: ready, already in Enercore, needs review", () => {
  const exact = { id: "C1", reasons: ["Same Apollo company reference"] };
  const possible = { id: "C2", reasons: ["Same normalized name"] };
  assert.equal(alreadyAdded([possible, exact]), "C1");
  assert.equal(alreadyAdded([possible]), "");
  assert.equal(prospectState([], "", false), "ready");
  assert.equal(prospectState([possible], "", false), "review");
  assert.equal(prospectState([possible], "", true), "ready");
  assert.equal(prospectState([possible], "C2", false), "existing");
  assert.equal(bulkState({ needsReview: true }, false), "review");
  assert.equal(bulkState({ needsReview: true }, true, "C1"), "existing");
  assert.equal(bulkState({ needsReview: true }, true), "ready");
  assert.equal(bulkState({ needsReview: false }, false, "C1"), "existing");
  assert.equal(bulkState({ needsReview: false }, false), "ready");
});
