import { test } from "node:test";
import assert from "node:assert/strict";
import {
  required, minLength, maxLength, email, number, date, matches,
  check, validate, firstInvalid, specError,
} from "../src/lib/validation";

test("messages name the field and say what to do", () => {
  assert.equal(required("Company name")(""), "Company name is required.");
  assert.equal(required("Company name")("   "), "Company name is required.");
  assert.equal(required("Company name")("Acme"), "");
  assert.equal(email("nope"), "Enter a valid email address, like name@company.com.");
  assert.equal(number("Estimated value", { min: 0 })("-1"), "Estimated value cannot be negative.");
  assert.equal(number("Quantity", { min: 5 })("2"), "Quantity must be at least 5.");
  assert.equal(number("Quantity")("abc"), "Quantity must be a number.");
  assert.equal(minLength("Your password", 14)("short"), "Your password needs at least 14 characters.");
  assert.equal(maxLength("Notes", 5)("abcdef"), "Notes cannot be longer than 5 characters.");
  assert.equal(date("Due date")("01/02/2026"), "Due date must be a date.");

  // No message may read like a browser's.
  const messages = [
    required("X")(""), email("nope"), number("X")("abc"),
    minLength("X", 3)("a"), date("X")("bad"),
  ];
  for (const message of messages) {
    assert.ok(!/please fill out|please include|constraint|invalid input/i.test(message), message);
    assert.ok(message.endsWith("."), `"${message}" should read as a sentence`);
  }
});

test("optional fields stay silent until they hold something", () => {
  // Only `required` complains about emptiness; everything else ignores it.
  assert.equal(email(""), "");
  assert.equal(number("Value")(""), "");
  assert.equal(date("Due")(""), "");
  assert.equal(minLength("Name", 5)(""), "");
});

test("a field shows one complaint at a time, the first that applies", () => {
  const rules = [required("Email"), email];
  assert.equal(check("", rules), "Email is required.");
  assert.equal(check("nope", rules), "Enter a valid email address, like name@company.com.");
  assert.equal(check("a@b.co", rules), "");
});

test("submitting reports every problem and focuses the first in field order", () => {
  const errors = validate(
    { title: "", email: "bad", amount: "-3" },
    { title: [required("Name")], email: [email], amount: [number("Value", { min: 0 })] },
  );
  assert.deepEqual(Object.keys(errors).sort(), ["amount", "email", "title"]);
  assert.equal(firstInvalid(errors, ["amount", "title", "email"]), "amount");
  assert.equal(firstInvalid({}, ["a"]), undefined, "a valid form has no first problem");
});

test("confirmation compares against the other value", () => {
  assert.equal(matches("abc", "Those passwords do not match.")("abc"), "");
  assert.equal(matches("abc", "Those passwords do not match.")("abd"), "Those passwords do not match.");
});

test("form and CSV import validate a profile field identically", () => {
  const spec = { name: "currency", label: "Currency", options: ["USD", "AED"] };
  assert.match(specError(spec, "GBP"), /Choose one of: USD, AED\./);
  assert.equal(specError(spec, "USD"), "");
  assert.equal(specError(spec, ""), "", "an optional choice may be left blank");

  assert.equal(specError({ name: "title", label: "Company name", required: true }, ""), "Company name is required.");
  assert.match(specError({ name: "email", label: "Email", type: "email" }, "x"), /valid email address/);
  assert.match(specError({ name: "quantity", label: "Quantity", type: "number", min: 0 }, "-2"), /cannot be negative/);
  assert.match(specError({ name: "due", label: "Due date", type: "date" }, "yesterday"), /must be a date/);
});
