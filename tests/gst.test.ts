import { test } from "node:test";
import assert from "node:assert/strict";
import {
  businessTime, businessDate, businessToday, businessStamp,
  msToNextMinute, BUSINESS_TIME_ZONE, BUSINESS_UTC_OFFSET,
} from "../src/lib/gst";
import { followUpPresets } from "../src/lib/attention";

test("business time is Dubai, regardless of the machine running this", () => {
  assert.equal(BUSINESS_TIME_ZONE, "Asia/Dubai");
  assert.equal(BUSINESS_UTC_OFFSET, "UTC+4");

  // 06:42 UTC is 10:42 in Dubai.
  const at = new Date("2026-09-25T06:42:00.000Z");
  assert.equal(businessTime(at), "10:42 am");
  assert.match(businessDate(at), /Fri 25 Sept?/);
  // en-GB abbreviates September as "Sept"; either spelling is correct.
  assert.match(businessStamp(at), /25 Sept?, 10:42 am GST/);
});

test("the business day is the Dubai day, not the UTC one", () => {
  // 22:30 UTC is already the next morning in Dubai. Taking the UTC date here
  // would make every follow-up a day late for the first hours of the Gulf day.
  const lateUtc = new Date("2026-09-25T22:30:00.000Z");
  assert.equal(lateUtc.toISOString().slice(0, 10), "2026-09-25", "UTC still says the 25th");
  assert.equal(businessToday(lateUtc), "2026-09-26", "Dubai is already the 26th");

  // And just after Gulf midnight.
  assert.equal(businessToday(new Date("2026-09-25T20:00:00.000Z")), "2026-09-26");
  assert.equal(businessToday(new Date("2026-09-25T19:59:00.000Z")), "2026-09-25");
});

test("the offset is applied through the zone, never by adding four hours", () => {
  // A date in a period where many zones shift; Dubai never observes DST, so
  // the offset must hold in both January and July.
  for (const iso of ["2026-01-15T06:00:00.000Z", "2026-07-15T06:00:00.000Z"])
    assert.equal(businessTime(new Date(iso)), "10:00 am", iso);
});

test("stored timestamps stay UTC; only presentation is converted", () => {
  const stored = "2026-09-25T06:42:00.000Z";
  assert.equal(new Date(stored).toISOString(), stored, "the stored value is untouched");
  assert.match(businessStamp(stored), /10:42 am GST/);
  assert.equal(businessStamp("not a date"), "", "a bad value renders as nothing, not NaN");
});

test("follow-up presets are counted from the business day", () => {
  // Late UTC on the 25th is already the 26th in Dubai, so "tomorrow" is the 27th.
  const presets = followUpPresets(new Date("2026-09-25T22:30:00.000Z"));
  assert.deepEqual(presets.map((p) => p.date), ["2026-09-27", "2026-09-29", "2026-10-03", "2026-10-10"]);
  assert.deepEqual(presets.map((p) => p.label), ["Tomorrow", "In 3 days", "Next week", "In 2 weeks"]);
});

test("the clock ticks on the minute rather than every second", () => {
  assert.equal(msToNextMinute(new Date("2026-09-25T06:42:00.000Z")), 60_000);
  assert.equal(msToNextMinute(new Date("2026-09-25T06:42:30.500Z")), 29_500);
});
