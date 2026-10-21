import { test } from "node:test";
import assert from "node:assert/strict";
import { makePreview, previewActor } from "../src/lib/fixtures";
import { roles, type Actor, type RecordItem } from "../src/lib/domain";
import {
  acknowledged,
  awaitingAllocation,
  applyLeadFeedback,
  initializeLead,
  leadSummary,
  leadType,
  needsFeedback,
  qualificationMissing,
  type LeadFeedback,
} from "../src/lib/lead-desk";
import { addNote, assign, transition } from "../src/lib/workflow";
import { mutateRecord } from "../src/lib/record-mutations";
import { mayOwn } from "../src/lib/notification-rules";

const at = "2026-10-20T08:00:00.000Z";
const sales: Actor = {
  ...previewActor,
  id: "test-sales",
  name: "Fictional Sales",
  role: "Sales Executive",
  companies: ["Petronik"],
};
const marketing: Actor = {
  ...sales,
  id: "test-marketing",
  name: "Fictional Marketing",
  role: "Marketing Manager",
};
function lead(patch: Partial<RecordItem> = {}) {
  return initializeLead(
    {
      ...makePreview().records.find((r) => r.kind === "leads")!,
      id: "TEST-LEAD",
      company: "Petronik",
      status: "New",
      owner: sales.name,
      ownerId: sales.id,
      createdAt: at,
      updatedAt: at,
      due: "2026-10-21",
      attributes: { leadType: "Buyer inquiry", grade: "SN500" },
      ...patch,
    },
    sales,
  );
}
function feedback(
  r: RecordItem,
  outcome: LeadFeedback["outcome"],
  actor = sales,
  rest: Partial<LeadFeedback> = {},
) {
  return applyLeadFeedback(
    { records: [r], audit: [] },
    actor,
    {
      action: "lead-feedback",
      id: r.id,
      expectedUpdatedAt: r.updatedAt,
      outcome,
      note: "",
      ...(outcome !== "Acknowledged" && outcome !== "Not Relevant"
        ? { due: "2026-10-21" }
        : {}),
      ...rest,
    },
    "2026-10-20T09:00:00.000Z",
  );
}
test("allocation queue includes known non-sales owners without guessing legacy roles", () => {
  const r = lead();
  assert.equal(awaitingAllocation(r), false);
  for (const role of ["Marketing Manager", "Marketing Executive", "MD", "IT Administrator", "Logistics Manager"])
    assert.equal(awaitingAllocation({ ...r, attributes: { ...r.attributes, leadOwnerRole: role } }), true, role);
  for (const role of ["Sales Manager", "Sales Executive", "Sales", ""])
    assert.equal(awaitingAllocation({ ...r, attributes: { ...r.attributes, leadOwnerRole: role } }), false, role);
  assert.equal(awaitingAllocation({ ...r, ownerId: "" }), true);
  assert.equal(awaitingAllocation({ ...r, ownerId: "", status: "Lost" }), false);
  assert.equal(awaitingAllocation({ ...r, ownerId: "", deletedAt: at }), false);
  assert.equal(awaitingAllocation({ ...r, ownerId: "", kind: "customers" }), false);
});
test("capture records server provenance but does not invent an inquiry receipt or response", () => {
  const r = lead();
  assert.equal(r.attributes?.leadCapturedById, sales.id);
  assert.equal(r.attributes?.leadTracking, "1");
  assert.equal(r.attributes?.leadReceivedAt, undefined);
  assert.equal(r.attributes?.leadFirstResponseAt, undefined);
  const imported = initializeLead({ ...r, attributes: {} }, marketing, {
    imported: true,
  });
  assert.equal(leadType(imported), "Buyer prospect");
  const web = initializeLead(
    { ...r, attributes: { leadFirstResponseAt: "FORGED" } },
    sales,
    { receivedAt: at },
  );
  assert.equal(web.attributes?.leadReceivedAt, at);
  assert.equal(web.attributes?.leadFirstResponseAt, undefined);
  assert.equal(leadType({ ...r, attributes: {} }), "Unclassified");
});
test("acknowledgement is owner-only, idempotent and never counts as customer response", () => {
  const r = lead(),
    result = feedback(r, "Acknowledged"),
    saved = result.records[0];
  assert.ok(acknowledged(saved));
  assert.equal(saved.attributes?.leadFirstResponseAt, undefined);
  assert.ok(needsFeedback(saved));
  assert.equal(saved.status, "New");
  assert.equal(result.audit.length, 1);
  const again = feedback(saved, "Acknowledged");
  assert.equal(again.audit.length, 0);
  assert.throws(
    () => feedback(r, "Acknowledged", previewActor),
    /assigned person/,
  );
});
test("typed notes and unanswered calls do not fabricate a first response", () => {
  const r = lead();
  const note = addNote(
    { records: [r], audit: [] },
    sales,
    r.id,
    "Follow-up scheduled",
    "2026-10-21",
  ).records[0];
  assert.equal(note.attributes?.leadFirstResponseAt, undefined);
  const no = feedback(r, "No Answer").records[0];
  assert.equal(no.status, "New");
  assert.ok(!needsFeedback(no));
  assert.equal(no.attributes?.leadFirstResponseAt, undefined);
});
test("real contact records one immutable response, actor, note, audit and next action", () => {
  const r = lead(),
    next = feedback(r, "Contacted", sales, { note: "Spoke to purchasing" })
      .records[0];
  assert.equal(next.status, "Contacted");
  assert.equal(next.due, "2026-10-21");
  assert.equal(
    next.attributes?.leadFirstResponseAt,
    "2026-10-20T09:00:00.000Z",
  );
  assert.equal(next.attributes?.leadFeedbackBy, sales.name);
  assert.match(next.notes!.at(-1)!.text, /Spoke to purchasing/);
  const again = applyLeadFeedback(
    { records: [next], audit: [] },
    sales,
    {
      action: "lead-feedback",
      id: r.id,
      expectedUpdatedAt: next.updatedAt,
      outcome: "Interested",
      note: "",
      due: "2026-10-22",
    },
    "2026-10-21T10:00:00.000Z",
  ).records[0];
  assert.equal(
    again.attributes?.leadFirstResponseAt,
    next.attributes?.leadFirstResponseAt,
  );
});
test("outcomes require valid future next actions or a reason to reject", () => {
  const r = lead();
  assert.throws(
    () => feedback(r, "Interested", sales, { due: undefined }),
    /follow-up/,
  );
  assert.throws(
    () => feedback(r, "Interested", sales, { due: "2026-10-19" }),
    /future/,
  );
  assert.throws(
    () => feedback(r, "Interested", sales, { due: "2026-02-30" }),
    /Invalid/,
  );
  assert.throws(() => feedback(r, "Not Relevant"), /reason/);
  const next = feedback(r, "Not Relevant", sales, {
    note: "Wrong product; no buying requirement",
  }).records[0];
  assert.equal(next.status, "Lost");
  assert.ok(!needsFeedback(next));
  assert.equal(next.attributes?.leadFirstResponseAt, undefined);
});
test("feedback cannot cross company, owner, branch, module, read-only or role boundaries", () => {
  const r = lead();
  for (const actor of [
    { ...sales, id: "other-sales" },
    { ...sales, companies: ["Afrilube"] },
    { ...sales, branches: ["Other"] },
    { ...sales, moduleAccess: { leads: "read" as const } },
    { ...sales, moduleAccess: { leads: "none" as const } },
    marketing,
    { ...sales, role: "MD Assistant" as const },
  ])
    assert.throws(() => feedback(r, "Contacted", actor));
  for (const role of roles.filter(
    (role) =>
      ![
        "MD",
        "IT Administrator",
        "Group Manager",
        "Branch Manager",
        "Sales Manager",
        "Sales Executive",
      ].includes(role),
  ))
    assert.throws(() => feedback(r, "Contacted", { ...sales, role }), role);
  assert.throws(() => feedback({ ...r, kind: "customers" }, "Contacted"));
  assert.throws(() => feedback({ ...r, deletedAt: at }, "Contacted"));
  assert.throws(() => feedback({ ...r, status: "Lost" }, "Contacted"));
});
test("stale updates are rejected without overwriting another person's work", () => {
  assert.throws(
    () =>
      feedback(lead(), "Contacted", sales, { expectedUpdatedAt: "2020-01-01" }),
    /changed/,
  );
});
test("reassignment resets acknowledgement and shows previous-owner feedback as history", () => {
  const r = feedback(lead(), "Contacted").records[0];
  const next = assign({ records: [r], audit: [] }, previewActor, r.id, {
    id: "new-sales",
    name: "New Owner",
    role: "Sales Executive",
  }).records[0];
  assert.ok(!acknowledged(next));
  assert.ok(needsFeedback(next));
  assert.equal(
    next.attributes?.leadFirstResponseAt,
    r.attributes?.leadFirstResponseAt,
  );
  assert.equal(next.attributes?.leadAssignedBy, previewActor.name);
  assert.equal(feedback(next, "Contacted", sales).records[0].attributes?.leadFeedbackBy,sales.name,"Creator retains access after assignment");
});
test("lead assignment permits active writable sales owners, not marketing or read-only accounts", () => {
  const r = lead();
  assert.ok(mayOwn({ ...sales, active: true }, r));
  assert.ok(!mayOwn({ ...marketing, active: true }, r));
  assert.ok(
    !mayOwn({ ...sales, active: true, moduleAccess: { leads: "read" } }, r),
  );
  assert.ok(!mayOwn({ ...sales, active: false }, r));
});
test("new inquiries require commercial qualification details, without rewriting legacy pipeline records", () => {
  const r = lead({
    product: "",
    quantity: 0,
    contact: "",
    email: "",
    phone: "",
    destination: "",
    attributes: { leadType: "Buyer inquiry" },
  });
  assert.ok(qualificationMissing(r).includes("grade"));
  for (const status of ["Qualified", "Quote Sent", "Negotiation", "Won"])
    assert.throws(
      () => transition({ records: [r], audit: [] }, sales, r.id, status),
      /qualification/,
    );
  const valid = {
    ...r,
    product: "Base Oil",
    quantity: 80,
    contact: "Test Buyer",
    email: "buyer@example.invalid",
    destination: "Test port",
    attributes: { ...r.attributes, grade: "SN500" },
  };
  assert.equal(
    transition({ records: [valid], audit: [] }, sales, r.id, "Qualified")
      .records[0].status,
    "Qualified",
  );
  const legacy = { ...r, attributes: {} };
  assert.equal(
    transition({ records: [legacy], audit: [] }, sales, r.id, "Qualified")
      .records[0].status,
    "Qualified",
  );
});
test("supplier opportunities and unverified prospects cannot become qualified buyer demand", () => {
  for (const leadType of [
    "Buyer prospect",
    "Supplier prospect",
    "Supplier offer",
  ]) {
    const r = lead({ attributes: { leadType } });
    assert.throws(
      () => transition({ records: [r], audit: [] }, sales, r.id, "Qualified"),
      /buyer inquiry/,
    );
    if (leadType.startsWith("Supplier"))
      assert.throws(() => feedback(r, "Quotation Needed"), /supplier/);
  }
});
test("ordinary edits cannot forge tracking timestamps, authorship or contact outcomes", () => {
  const r = lead();
  for (const key of [
    "leadFirstResponseAt",
    "leadReceivedAt",
    "leadCapturedBy",
    "leadOutcome",
    "leadAcknowledgedAt",
  ])
    assert.throws(
      () =>
        mutateRecord({ records: [r], audit: [] }, sales, r.id, r.updatedAt, {
          attributes: { [key]: at },
        }),
      /system/,
    );
  const updated = mutateRecord(
    { records: [r], audit: [] },
    sales,
    r.id,
    r.updatedAt,
    { attributes: { grade: "SN150" } },
  ).records[0];
  assert.equal(updated.attributes?.leadCapturedAt, at);
  assert.equal(updated.attributes?.grade, "SN150");
});
test("management counts actual buyer inquiries and linked confirmed orders, never supplier leads or Won alone", () => {
  const a = lead(),
    prospect = lead({
      id: "PROSPECT",
      attributes: { leadType: "Buyer prospect" },
    }),
    supplier = lead({
      id: "SUPPLIER",
      attributes: { leadType: "Supplier offer" },
    }),
    legacy = lead({ id: "LEGACY", attributes: { leadType: "Unclassified" } });
  const quote = {
    ...a,
    id: "QUOTE",
    kind: "quotations" as const,
    parentId: a.id,
    status: "Sent",
  };
  const order = {
    ...a,
    id: "ORDER",
    kind: "orders" as const,
    parentId: quote.id,
    status: "Confirmed",
  };
  const duplicateOrder = { ...order, id: "ORDER2" };
  const summary = leadSummary(previewActor, [
    a,
    prospect,
    supplier,
    legacy,
    quote,
    order,
    duplicateOrder,
  ]);
  assert.equal(summary.inquiries, 1);
  assert.equal(summary.prospects, 1);
  assert.equal(summary.suppliers, 1);
  assert.equal(summary.unclassified, 1);
  assert.equal(summary.quotations, 1);
  assert.equal(summary.converted, 1);
  assert.equal(summary.conversion, 100);
  assert.equal(
    leadSummary(previewActor, [{ ...a, status: "Won" }]).converted,
    0,
  );
  assert.equal(
    leadSummary(previewActor, [a, quote, { ...order, status: "Cancelled" }])
      .converted,
    0,
  );
  assert.equal(
    leadSummary({ ...sales, moduleAccess: { orders: "none" } }, [
      a,
      quote,
      order,
    ]).converted,
    0,
  );
});
test("response reports exclude unknown receipt times, internal acknowledgement and inaccessible records", () => {
  const a = feedback(lead(), "Contacted").records[0];
  assert.equal(leadSummary(previewActor, [a]).responseMinutes, null);
  const timed = { ...a, attributes: { ...a.attributes, leadReceivedAt: at } };
  const other = { ...timed, id: "OTHER", company: "Afrilube" };
  const result = leadSummary(sales, [timed, other]);
  assert.equal(result.inquiries, 1);
  assert.equal(result.responseMinutes, 60);
  assert.equal(result.responseSamples, 1);
  assert.equal(leadSummary(sales, [timed], "2026-10-21").inquiries, 0);
  assert.equal(leadSummary(sales, [{ ...timed, deletedAt: at }]).inquiries, 0);
});
