/** Fictional design-review dataset. Prints SQL only; never connects to a DB.
 * Applied exclusively by local-review.sh with --local and a dedicated state.
 * Idempotent inserts preserve any edits a reviewer has made. */
import { makePreview } from "../src/lib/fixtures";
import { hashPassword } from "../src/lib/password";
import { companies, type RecordItem } from "../src/lib/domain";
import { PASSWORD } from "../e2e/collab/people";

if (process.env.LOCAL_DESIGN_FIXTURE !== "1") throw new Error("Local fixtures only. Use npm run dev:review.");
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
async function main() {
  const now = Date.now();
  const date = (days: number) => new Date(now + days * 86400000).toISOString().slice(0, 10);
  const ownerId = "collab-user-studio", owner = "Alex Morgan · Demo";
  const sql = [`-- FICTIONAL LOCAL DATA. NEVER APPLY TO PRODUCTION.`,
    `INSERT OR IGNORE INTO User (id,email,name,passwordHash,role,companies,branches,moduleAccess,active,createdAt) VALUES (${q(ownerId)},'studio@collab.test',${q(owner)},${q(await hashPassword(PASSWORD))},'MD',${q(JSON.stringify(companies))},'[]','{}',1,${now});`];
  const records: RecordItem[] = makePreview().records.map((r, i) => ({ ...r, id: `design-v2-${r.id}`, ownerId, owner, createdAt: `${date(-i % 20)}T09:00:00.000Z`, detail: `${r.detail ? r.detail + "\n\n" : ""}Fictional design-review record. No real transaction.`, email: `contact${i}@example.invalid`, phone: "+971 00 000 0000", attributes: { ...r.attributes, country: ["United Arab Emirates", "Kenya", "Vietnam", "Türkiye"][i % 4] } }));
  const template = records[0];
  const add = (id: string, values: Partial<RecordItem>) => { const r = { ...template, id: `design-v2-${id}`, customerId: null, contactId: null, productId: null, dealId: null, primaryContactId: null, parentId: undefined, amount: 0, quantity: 0, contact: "", product: "", ...values }; records.push(r); return r; };
  // Explicit relationships, never fuzzy production linking. Each fictional
  // customer/product is inserted before its dependent records.
  const commercial = records.filter(r => ["leads", "quotations", "orders", "accounts", "logistics"].includes(r.kind));
  for (const r of commercial) {
    let customer = records.find(c => c.kind === "customers" && c.title === r.title && c.company === r.company);
    if (!customer) customer = add(`customer-${r.id}`, { kind: "customers", company: r.company, title: r.title, contact: r.contact || "Jordan Taylor", status: "Active", product: r.product, attributes: { country: r.attributes!.country, segment: "Distributor", address: "Sample business address" } });
    r.customerId = customer.id;
    const product = records.find(p => p.kind === "products" && p.company === r.company);
    if (product) r.productId = product.id;
    if (["quotations", "orders"].includes(r.kind)) { r.lines = [{ description: r.product || "Base Oil SN 500", quantity: r.quantity || 100, unitPriceCents: Math.round(r.amount * 100 / (r.quantity || 100)) }]; r.attributes = { ...r.attributes, issueDate: date(-4), senderName: r.company, customerAddress: "Fictional business address", incoterm: "CFR", paymentTerms: "30% advance, balance before shipment" }; }
  }
  add("long-customer", { kind: "customers", title: "Northern Coast Industrial Supply & International Distribution Partners", company: "Petronik", contact: "Samira Hassan", status: "Active", attributes: { country: "United Arab Emirates", segment: "Distributor" } });
  for (let i = 0; i < 8; i++) add(`post-${i}`, { kind: "marketing", title: ["SN 500 product spotlight", "Meet our logistics team", "Quality testing, explained", "Distributor stories", "Grease application guide", "Behind the supply chain", "October product roundup", "Questions from our customers"][i], company: companies[i % 4], status: "Active", product: ["LinkedIn", "Instagram", "Facebook"][i % 3], due: `${date(0).slice(0, 7)}-${String(3 + i * 3).padStart(2, "0")}`, unit: "posts", source: "Content calendar", attributes: { contentType: "social-post", contentStage: ["Idea", "Draft", "Ready"][i % 3], contentFormat: ["Image", "Carousel", "Video"][i % 3], contentTime: "10:00", contentTimezone: "Asia/Dubai" } });
  add("office-expense", { kind: "accounts", title: "October office supplies", amount: 420, status: "Recorded", due: date(-2), attributes: { entryType: "Expense", category: "Office", paymentMethod: "Card", department: "Company" } });
  add("service-income", { kind: "accounts", title: "Sample handling service", amount: 1800, status: "Recorded", due: date(-1), attributes: { entryType: "Income", category: "Other income", paymentMethod: "Bank transfer", department: "Sales" } });
  add("own-leave", { kind: "leave", title: "Annual leave", status: "Pending Approval", due: date(14), quantity: 3, unit: "days", contact: owner, source: "Employee self-service" });
  for (const r of records.sort((a, b) => Number(!!a.customerId || !!a.productId) - Number(!!b.customerId || !!b.productId))) {
    sql.push(`INSERT OR IGNORE INTO BusinessRecord (id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES (${[q(r.id), q(r.kind), q(r.company), q(r.branch), q(ownerId), q(r.status), q(JSON.stringify(r)), 1, Date.parse(r.createdAt), now].join(",")});`);
    if (["customers", "suppliers"].includes(r.kind)) {
      const contactId = `${r.id}-contact`;
      const details = { name: r.contact || "Jordan Taylor", jobTitle: "Procurement Manager", role: "Purchasing", email: r.email || "buyer@example.invalid", phone: r.phone || "", whatsapp: "", country: r.attributes?.country || "", active: true, notes: "Fictional contact for layout review" };
      sql.push(`INSERT OR IGNORE INTO Contact (id,parentId,company,branch,details,active,version,createdAt,updatedAt) VALUES (${[q(contactId), q(r.id), q(r.company), q(r.branch), q(JSON.stringify(details)), 1, 1, now, now].join(",")});`);
      sql.push(`UPDATE BusinessRecord SET payload=json_set(payload,'$.primaryContactId',${q(contactId)}) WHERE id=${q(r.id)} AND json_extract(payload,'$.primaryContactId') IS NULL;`);
    }
    sql.push(`INSERT OR IGNORE INTO AuditEvent (id,company,actor,actorId,action,recordId,at) VALUES (${[q(`design-event-${r.id}`), q(r.company), q(owner), q(ownerId), q(`Created ${r.kind} · fictional review`), q(r.id), now].join(",")});`);
  }
  // Populated communications without real recipients, invitations or media.
  const peerId = "collab-user-cmsales";
  for (const [chatIndex, [suffix, title, kind]] of ([["sales-room", "Sales planning · Demo", "room"], ["delivery-room", "Delivery desk · Demo", "room"], ["direct", null, "direct"]] as const).entries()) {
    const id = `design-v2-${suffix}`;
    const directKey = kind === "direct" ? q([ownerId, peerId].sort().join("::")) : "NULL";
    sql.push(`INSERT OR IGNORE INTO Conversation (id,kind,name,description,visibility,company,branch,directKey,createdBy,createdAt,updatedAt,lastMessageAt) VALUES (${q(id)},${q(kind)},${title ? q(title) : "NULL"},'Fictional local design review','private','Petronik',NULL,${directKey},${q(ownerId)},${now},${now},${now});`);
    for (const user of [ownerId, peerId]) sql.push(`INSERT OR IGNORE INTO ConversationMember (conversationId,userId,role,joinedAt) VALUES (${q(id)},${q(user)},${q(user === ownerId ? "owner" : "member")},${now});`);
    for (const [index, body] of ["Fictional review conversation — nothing here is sent outside this local workspace.", "The sample quotation is ready. Please check quantities and delivery terms before we proceed.", "Thanks. Let us review it at the planning meeting tomorrow."].entries()) {
      const messageId = (1791014400000 + index).toString(36).padStart(10, "0") + `${chatIndex}${index}`.padStart(12, "0");
      sql.push(`INSERT OR IGNORE INTO Message (id,conversationId,authorId,body,createdAt) VALUES (${q(messageId)},${q(id)},${q(index === 1 ? peerId : ownerId)},${q(body)},${now - (3 - index) * 60000});`);
    }
  }
  sql.push(`INSERT OR IGNORE INTO Meeting (id,conversationId,createdBy,title,kind,media,status,scheduledAt,durationMin,providerRoom,createdAt,guestAccess) VALUES ('design-v2-planning-meeting','design-v2-sales-room',${q(ownerId)},'Weekly sales planning · Demo','scheduled','video','scheduled',${now + 86400000},30,'design-v2-local-planning',${now},'off');`);
  process.stdout.write(sql.join("\n") + "\n");
}
void main();
