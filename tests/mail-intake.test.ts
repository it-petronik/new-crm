import test from "node:test";
import assert from "node:assert/strict";
import { simulateIntake } from "../src/lib/mail/intake";
test("local intake extracts literal fields and quantity without inventing identity", () => {
  const s = simulateIntake("Quotation request", "Company: Example Trading\nContact: Sam\nProduct: SN 500\nPlease quote 200 MT.");
  assert.equal(s.category, "sales"); assert.equal(s.company, "Example Trading"); assert.equal(s.quantity, 200);
  assert.equal(simulateIntake("Price enquiry", "Hello").company, "");
});
test("ambiguous messages stay unclassified; credentials are redacted", () => {
  assert.equal(simulateIntake("Quotation and laptop issue", "Help").category, "other");
  const s = simulateIntake("Laptop login problem", "password: secret123");
  assert.equal(s.category,"it"); assert.ok(!JSON.stringify(s).includes("secret123"));
});
