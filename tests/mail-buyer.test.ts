import test from "node:test";
import assert from "node:assert/strict";
import { classifyBuyer } from "../src/lib/mail/buyer";
import { mailReference, resolveMailReference } from "../src/lib/mail/reference";
test("Facebook conversions and generic marketing are not buyers", () => {
  for (const [sender, subject, body] of [
    [
      "notification@facebookmail.com",
      "See more of the conversions you're already driving",
      "Sales, purchase and pricing tips",
    ],
    [
      "newsletter@vendor.invalid",
      "Weekly digest",
      "Product availability and purchase pricing",
    ],
    [
      "scribe@scribe.invalid",
      "One invite turns Scribe into a team superpower",
      "Please quote our pricing page",
    ],
    ["noreply@service.invalid", "Your quote is ready", "View our pricing"],
  ])
    assert.equal(classifyBuyer(sender, subject, body).candidate, false);
});
test("real forwarded RFQs and website enquiries retain literal evidence", () => {
  for (const subject of [
    "FW: New Inquiry from David – Afrilube",
    "FW: [Petronik Quote] PTX-MV8A0R1K / ATLAS MARINE",
    "REQUEST FOR QUOTATION BRIMONT 26/ISO 32",
    "Quotation enquiry",
  ]) {
    const result = classifyBuyer("sales6@petronik.ae", subject);
    assert.equal(result.candidate, true, subject);
    assert.ok(result.evidence.length);
  }
  assert.equal(
    classifyBuyer(
      "buyer@example.invalid",
      "Supply question",
      "Please quote 25 MT of SN500",
    ).candidate,
    true,
  );
  assert.equal(
    classifyBuyer(
      "buyer@example.invalid",
      "Supply question",
      "We would like to talk",
    ).candidate,
    false,
  );
});
test("preview references are stable, bound to owner/connection, and reject tampering", async () => {
  const secret = Buffer.alloc(32, 7).toString("base64"),
    value = { uid: 4, uidValidity: "1", path: "INBOX" };
  const ref = await mailReference(secret, "one", "connection1", value);
  assert.equal(await mailReference(secret, "one", "connection1", value), ref);
  assert.deepEqual(
    await resolveMailReference(secret, "one", "connection1", ref),
    value,
  );
  await assert.rejects(resolveMailReference(secret, "two", "connection1", ref));
  await assert.rejects(resolveMailReference(secret, "one", "connection2", ref));
  await assert.rejects(
    resolveMailReference(secret, "one", "connection1", ref.slice(0, -2) + "xx"),
  );
  assert.ok(!ref.includes("subject"));
});
