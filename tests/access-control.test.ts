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
import { workspaceNotifications } from "../src/lib/notifications";
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
test("notifications exclude records and audit outside the actor's scope", () => {
  const actor: Actor = {
    ...previewActor,
    companies: ["Petronik"],
    moduleAccess: { accounts: "none" },
  };
  const data = makePreview();
  const items = workspaceNotifications(actor, data);
  assert.ok(items.length > 0);
  assert.ok(items.every((n) => n.company === "Petronik"));
  assert.ok(
    items.every((n) => {
      const r = data.records.find((r) => r.id === n.recordId);
      return r && canRead(actor, r);
    }),
  );
});
