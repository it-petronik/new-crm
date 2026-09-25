import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRead,
  canWrite,
  canApprove,
  allowedModules,
  type Actor,
} from "../src/lib/domain";
import { inAdminScope, mayAssign } from "../src/lib/access-control";
import { authorised, type NotificationDraft, type Person } from "../src/lib/notification-rules";
import { makePreview, previewActor } from "../src/lib/fixtures";

const requested = {
  role: "Sales Executive" as const,
  companies: ["Petronik"],
  branches: ["Main"],
};
const target = { id: "other", ...requested };
test("administrators cannot edit themselves or assign beyond company and branch scope", () => {
  const admin = {
    ...previewActor,
    companies: ["Petronik"],
    branches: ["Main"],
  };
  assert.equal(mayAssign(admin, target, requested), true);
  assert.equal(mayAssign(admin, { ...target, id: admin.id }, requested), false);
  assert.equal(
    mayAssign(admin, null, { ...requested, companies: ["Afrilube"] }),
    false,
  );
  assert.equal(inAdminScope(admin, ["Petronik"], []), false);
  assert.equal(
    mayAssign(admin, { ...target, companies: ["Afrilube"] }, requested),
    false,
  );
});
test("IT administrators cannot create or modify leadership access", () => {
  const it: Actor = { ...previewActor, role: "IT Administrator" };
  assert.equal(mayAssign(it, target, requested), true);
  assert.equal(mayAssign(it, null, { ...requested, role: "MD" }), false);
  assert.equal(mayAssign(it, { ...target, role: "MD" }, requested), false);
  assert.equal(
    mayAssign({ ...it, moduleAccess: { settings: "read" } }, target, requested),
    false,
  );
});
test("module restrictions narrow permissions and cannot elevate a role", () => {
  const r = makePreview().records[0];
  assert.equal(
    canRead({ ...previewActor, moduleAccess: { [r.kind]: "none" } }, r),
    false,
  );
  assert.equal(
    canWrite({ ...previewActor, moduleAccess: { [r.kind]: "read" } }, r),
    false,
  );
  assert.equal(
    canRead({ ...previewActor, moduleAccess: { [r.kind]: "read" } }, r),
    true,
  );
  assert.equal(
    allowedModules({
      ...previewActor,
      role: "Sales Executive",
      moduleAccess: { accounts: "write" },
    }).includes("accounts"),
    false,
  );
  assert.equal(
    mayAssign(previewActor, null, {
      ...requested,
      moduleAccess: { accounts: "write" },
    }),
    false,
  );
  const quote = makePreview().records.find((r) => r.kind === "quotations")!;
  assert.equal(
    canApprove({ ...previewActor, moduleAccess: { approvals: "none" } }, quote),
    false,
  );
});
test("notifications reach only people who may read the record right now", () => {
  const data = makePreview();
  const insider: Person = {
    ...previewActor,
    id: "insider",
    companies: ["Petronik"],
    moduleAccess: { accounts: "none" },
    active: true,
  };
  const outsider: Person = { ...insider, id: "outsider", companies: ["Afrilube"], moduleAccess: {}, active: true };
  const inactive: Person = { ...insider, id: "inactive", active: false };
  const drafts: NotificationDraft[] = data.records.flatMap((r) =>
    [insider, outsider, inactive].map((p) => ({
      recipientId: p.id,
      actorId: "someone-else",
      type: "record.assigned",
      category: "assignment" as const,
      title: "t",
      body: "b",
      entityType: r.kind,
      entityId: r.id,
      priority: "normal" as const,
      dedupeKey: `k:${r.id}:${p.id}`,
    })),
  );
  const records = new Map(data.records.map((r) => [r.id, r]));
  const kept = authorised(drafts, [insider, outsider, inactive], records);
  assert.ok(kept.length > 0);
  assert.ok(kept.every((d) => d.recipientId !== "inactive"));
  for (const d of kept) {
    const person = d.recipientId === "insider" ? insider : outsider;
    assert.ok(canRead(person, records.get(d.entityId)!));
  }
  assert.ok(kept.every((d) => !(d.recipientId === "insider" && records.get(d.entityId)!.kind === "accounts")));
  assert.ok(kept.every((d) => d.recipientId !== "outsider" || records.get(d.entityId)!.company !== "Petronik"));
  // Never the person acting.
  assert.equal(authorised(drafts.map((d) => ({ ...d, actorId: d.recipientId })), [insider, outsider], records).length, 0);
});
