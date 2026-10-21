import { test } from "node:test";
import assert from "node:assert/strict";
import { documentContactLink } from "../src/lib/pdf/contact-link";

test("document contact links preserve readable values with safe destinations", () => {
  assert.equal(documentContactLink("website", "www.example.com"), "https://www.example.com/");
  assert.equal(documentContactLink("website", "https://example.com/contact"), "https://example.com/contact");
  assert.equal(documentContactLink("email", "accounts@example.com"), "mailto:accounts@example.com");
  assert.equal(documentContactLink("phone", "+971 (4) 123-4567"), "tel:+97141234567");
});
test("document contacts never turn unsafe or malformed values into links", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "//example.com", "https://name:secret@example.com", "example.com\nother", "not a website", ""]) assert.equal(documentContactLink("website", value), undefined);
  for (const value of ["bad", "a@example.com?subject=hello world", "a@example.com\r\nBcc:x@example.com"]) assert.equal(documentContactLink("email", value), undefined);
  for (const value of ["123", "javascript:alert(1)", "call me"]) assert.equal(documentContactLink("phone", value), undefined);
});
