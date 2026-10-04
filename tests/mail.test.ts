import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalMailSandbox, mailAction } from "../src/lib/mail/model";
test("mail sandbox requires both server binding and exact local origin", () => {
  assert.equal(isLocalMailSandbox("sandbox", "http://localhost:8788"), true);
  for (const url of ["https://crm.enercore.ae", "http://localhost.evil.test", "invalid", undefined])
    assert.equal(isLocalMailSandbox("sandbox", url), false);
  assert.equal(isLocalMailSandbox(undefined, "http://localhost:8788"), false);
});
test("sending requires explicit confirmation and rejects header injection", () => {
  const draft = { id: crypto.randomUUID(), to: "buyer@example.invalid", subject: "Quote", body: "Test" };
  assert.equal(mailAction.safeParse({ ...draft, action: "send-test" }).success, false);
  assert.equal(mailAction.safeParse({ ...draft, action: "send-test", confirmed: true }).success, true);
  assert.equal(mailAction.safeParse({ ...draft, action: "save", subject: "Quote\r\nBcc: other@example.invalid" }).success, false);
  assert.equal(mailAction.safeParse({ ...draft, action: "save", ownerId: "another-user" }).success, false);
});
