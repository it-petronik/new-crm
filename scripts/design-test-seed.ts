/** Fictional design-review dataset. Prints SQL only; never connects to a DB.
 * Applied exclusively by local-review.sh with --local and a dedicated state.
 * Idempotent inserts preserve any edits a reviewer has made. */
import { makePreview } from "../src/lib/fixtures";
import { hashPassword } from "../src/lib/password";
import { companies, type RecordItem } from "../src/lib/domain";
import { PASSWORD } from "../e2e/collab/people";
import { businessToday } from "../src/lib/gst";
import { addDays } from "../src/lib/tasks/model";

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
  const opsProduct=add("ops-product",{kind:"products",title:"Fictional SN500 Operations",company:"Petronik",branch:"Main",status:"Available",unit:"MT"});
  add("ops-supplier",{kind:"suppliers",title:"Fictional Gulf Supply",company:"Petronik",branch:"Main",status:"Active",unit:"MT"});
  const opsOrder=add("ops-order",{kind:"orders",title:"Fictional Coastal Operations Order",company:"Petronik",branch:"Main",status:"Confirmed",unit:"MT",quantity:100,productId:opsProduct.id});
  add("ops-shipment",{kind:"logistics",title:"Fictional Coastal Shipment",company:"Petronik",branch:"Main",status:"Pending Planning",unit:"MT",quantity:100,productId:opsProduct.id,parentId:opsOrder.id});
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
  // Phase 8: fictional tasks in every state, task automation rules (one per
  // preset) and run history with success, skipped and failed outcomes.
  const today = businessToday();
  const due = (days: number) => addDays(today, days);
  const seller = "collab-user-cmsales", it = "collab-user-cmit";
  const rules: [string, string, string, number, string | null, number, string | null, string, string][] = [
    ["design-rule-lead", "Lead follow-up due", "lead_follow_up", 1, null, 0, "10:00", "normal", '{"statuses":[],"lookbackDays":1,"branches":[]}'],
    ["design-rule-it", "IT ticket triage", "it_ticket_triage", 0, it, 0, null, "high", '{"priorities":["High","Urgent"],"branches":[]}'],
    ["design-rule-handoff", "Operations handoff", "quotation_handoff", 1, ownerId, 1, "09:00", "high", '{"branches":[]}'],
  ];
  for (const [id, name, preset, enabled, assignee, days, time, priority, conditions] of rules)
    sql.push(`INSERT OR IGNORE INTO AutomationRule (id,company,name,preset,enabled,conditions,assigneeId,dueDays,dueTime,priority,version,createdBy,updatedBy,createdAt,updatedAt) VALUES (${[q(id), q("Petronik"), q(name), q(preset), enabled, q(conditions), assignee ? q(assignee) : "NULL", days, time ? q(time) : "NULL", q(priority), 1, q(ownerId), q(ownerId), now, now].join(",")});`);
  type SeedTask = { id: string; title: string; assignee?: string; status?: string; priority?: string; days: number; time?: string; link?: string; rule?: string; detail?: string; company?: string };
  const seedTasks: SeedTask[] = [
    { id: "overdue-1", title: "Send revised delivery schedule to Gulf Industrial Trading", priority: "high", days: -2, link: "design-v2-EC-1001", detail: "Fictional: customer asked for split shipments." },
    { id: "overdue-2", title: "Chase signed proforma", days: -1, priority: "urgent", link: "design-v2-EC-1007" },
    { id: "today-1", title: "Follow up: Atlas Marine Services", days: 0, time: "10:00", link: "design-v2-EC-1004", rule: "design-rule-lead" },
    { id: "today-2", title: "Confirm vessel nomination with logistics", days: 0, time: "16:30", status: "in_progress", link: "design-v2-EC-1010" },
    { id: "today-3", title: "Review quarterly distributor pricing notes", days: 0, priority: "low" },
    { id: "today-4", title: "Prepare a very long internal checklist title so that the row wraps gracefully on narrow phone screens without overlapping", days: 0, company: "Afrilube" },
    { id: "upcoming-1", title: "Operations handoff: Coastal Energy Partners", days: 1, time: "09:00", link: "design-v2-EC-1010", rule: "design-rule-handoff", priority: "high" },
    { id: "upcoming-2", title: "Plan sample shipment for Mekong Infrastructure", days: 3, company: "Petronex", link: "design-v2-EC-1003" },
    { id: "upcoming-3", title: "Book quarterly account review", days: 9 },
    { id: "done-1", title: "Share product data sheet", days: -3, status: "completed", link: "design-v2-EC-1018" },
    { id: "done-2", title: "Update customer delivery address", days: -5, status: "completed" },
    { id: "cancelled-1", title: "Arrange plant visit (customer postponed)", days: -1, status: "cancelled" },
    { id: "team-1", title: "Call buyer about sample results", assignee: seller, days: 0, link: "design-v2-EC-1018" },
    { id: "team-2", title: "Collect missing contact details", assignee: seller, days: -1, priority: "high" },
    { id: "team-3", title: "Triage ticket: Email access on new laptop", assignee: it, days: 0, link: "design-v2-EC-1029", priority: "high" },
  ];
  for (const t of seedTasks) {
    const linked = t.link ? records.find((r) => r.id === t.link) : undefined;
    const company = linked?.company ?? t.company ?? "Petronik";
    const status = t.status ?? "open";
    const values = [
      q(`design-task-${t.id}`), q(company), q(linked?.branch ?? "Main"), q(t.title), q(t.detail ?? "Fictional task for local review."), q(t.assignee ?? ownerId), q(ownerId),
      q(t.priority ?? "normal"), q(status), q(due(t.days)), t.time ? q(t.time) : "NULL", linked ? q(linked.id) : "NULL", t.rule ? q(t.rule) : "NULL",
      t.rule ? q(`${t.rule}:design-${t.id}`) : "NULL", 1, now - 86400000, now, status === "completed" ? now - 3600000 : "NULL",
    ];
    sql.push(`INSERT OR IGNORE INTO Task (id,company,branch,title,description,assigneeId,createdBy,priority,status,dueDate,dueTime,linkedRecordId,ruleId,dedupeKey,version,createdAt,updatedAt,completedAt) VALUES (${values.join(",")});`);
    sql.push(`INSERT OR IGNORE INTO AuditEvent (id,company,actor,actorId,action,recordId,before,after,at,subject) VALUES (${[q(`design-task-event-${t.id}`), q(company), q(t.rule ? "Automation · fictional" : owner), q(ownerId), q(t.rule ? "Created task by automation" : "Created task"), q(`design-task-${t.id}`), "NULL", q(JSON.stringify({ title: t.title, status: "open", dueDate: due(t.days) })), now - 86400000, q("task")].join(",")});`);
  }
  const runs: [string, string, string, string | null, string | null, string, string][] = [
    ["lead-ok", "design-rule-lead", "FOLLOW_UP_DUE:design-today-1", "design-v2-EC-1004", "design-task-today-1", "success", `Created a task for ${owner}, due ${due(0)} at 10:00.`],
    ["lead-skip", "design-rule-lead", "FOLLOW_UP_DUE:design-skip", "design-v2-EC-1001", null, "skipped", "An earlier follow-up task for this lead is still open."],
    ["handoff-ok", "design-rule-handoff", "STATUS_CHANGED:design-upcoming-1", "design-v2-EC-1010", "design-task-upcoming-1", "success", `Created a task for ${owner}, due ${due(1)} at 09:00.`],
    ["handoff-fail", "design-rule-handoff", "STATUS_CHANGED:design-fail", null, null, "failed", "The task could not be created after 3 attempts. Create it by hand, or contact IT if this continues."],
  ];
  for (const [id, rule, key, recordId, taskId, status, message] of runs)
    sql.push(`INSERT OR IGNORE INTO AutomationRun (id,ruleId,company,dedupeKey,trigger,recordId,taskId,status,message,attempts,createdAt,updatedAt) VALUES (${[q(`design-run-${id}`), q(rule), q("Petronik"), q(key), q(key.split(":")[0]), recordId ? q(recordId) : "NULL", taskId ? q(taskId) : "NULL", q(status), q(message), status === "failed" ? 3 : 1, now - 7200000, now - 7200000].join(",")});`);
  // Phase 9 fictional lots. INSERT ... SELECT protects repeated review seeds
  // from running ledger guards again for already-existing entries.
  const seed=(table:string,row:Record<string,string|number|null>)=>{
    const value=(v:string|number|null)=>v===null?"NULL":typeof v==="number"?String(v):q(v);
    sql.push(`INSERT INTO ${table} (${Object.keys(row).join(",")}) SELECT ${Object.values(row).map(value).join(",")} WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE id=${value(row.id)});`);
  };
  for(const [index,state] of ["Draft","Approved","Closed","Cancelled"].entries()){
    const id=`design-ops-po-${index}`;
    seed("PurchaseOrder",{id,company:"Petronik",branch:"Main",orderId:opsOrder.id,supplierId:"design-v2-ops-supplier",productId:opsProduct.id,warehouse:"Dubai warehouse",unit:"MT",quantity:10000000,priceCents:80000,totalCents:800000,currency:"USD",status:"Draft",expectedDate:date(index-2),notes:"Fictional local procurement lot",createdBy:"collab-user-cmmd",approvedBy:null,version:1,createdAt:now-index,updatedAt:now});
    if(state!=="Draft")sql.push(`UPDATE PurchaseOrder SET status=${q(state==="Cancelled"?"Cancelled":"Approved")},approvedBy=${state==="Cancelled"?"NULL":q(ownerId)},version=2 WHERE id=${q(id)} AND status='Draft' AND version=1;`);
    if(state==="Closed")sql.push(`UPDATE PurchaseOrder SET status='Closed',version=3 WHERE id=${q(id)} AND status='Approved' AND version=2;`);
    if(state==="Approved"){
      seed("StockMovement",{id:"design-ops-receipt",purchaseId:id,kind:"Receipt",quantity:6000000,shipmentId:null,reversalOf:null,reference:"GRN-DEMO-1",date:date(-1),notes:"Fictional partial receipt",createdBy:ownerId,createdAt:now});
      seed("StockMovement",{id:"design-ops-dispatch",purchaseId:id,kind:"Dispatch",quantity:-2000000,shipmentId:"design-v2-ops-shipment",reversalOf:null,reference:"DN-DEMO-1",date:date(0),notes:"Fictional dispatch",createdBy:ownerId,createdAt:now});
      seed("SupplierInvoice",{id:"design-ops-invoice",purchaseId:id,company:"Petronik",supplierId:"design-v2-ops-supplier",reference:"SUP-DEMO-1",normalized:"sup-demo-1",amountCents:400000,date:date(-4),dueDate:date(-1),notes:"Fictional partial supplier invoice",createdBy:ownerId,createdAt:now});
      seed("SupplierPayment",{id:"design-ops-payment",invoiceId:"design-ops-invoice",amountCents:100000,reference:"BANK-DEMO-1",date:date(-2),notes:"Fictional payment",createdBy:ownerId,createdAt:now});
    }
  }
  process.stdout.write(sql.join("\n") + "\n");
}
void main();
