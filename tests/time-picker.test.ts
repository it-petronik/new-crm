import test from "node:test";
import assert from "node:assert/strict";
import { timeError, timeLabel, timeMinutes, timeParts, timeValue } from "../src/lib/time-picker";

test("time picker preserves all minute values through 12-hour display", () => {
  for (let minutes = 0; minutes < 1440; minutes++) {
    const value = `${String(Math.floor(minutes / 60)).padStart(2,"0")}:${String(minutes % 60).padStart(2,"0")}`;
    const parts = timeParts(value);
    assert.equal(timeValue(parts.hour, parts.minute, parts.period), value);
    assert.equal(timeMinutes(value), minutes);
  }
});
test("midnight, noon and the optional empty value have clear labels", () => {
  assert.equal(timeLabel("00:00"), "12:00 AM");
  assert.equal(timeLabel("12:00"), "12:00 PM");
  assert.equal(timeLabel("23:59"), "11:59 PM");
  assert.equal(timeLabel(""), "Choose a time");
});
test("invalid native time values are never interpreted as dates", () => {
  for (const value of ["24:00", "12:60", "-1:00", "1:00", "foo", "2026-10-04", "13:10:00"]) assert.equal(timeMinutes(value), null);
});
test("time ranges support both regular and overnight windows", () => {
  assert.equal(timeError("09:00", "09:00", "17:00"), "");
  assert.equal(timeError("17:00", "09:00", "17:00"), "");
  assert.ok(timeError("08:59", "09:00", "17:00"));
  assert.equal(timeError("23:30", "22:00", "06:00"), "");
  assert.equal(timeError("05:30", "22:00", "06:00"), "");
  assert.ok(timeError("12:00", "22:00", "06:00"));
});
test("step validates five-minute meetings while optional calendar times keep minute precision", () => {
  assert.equal(timeError("10:05", undefined, undefined, 300), "");
  assert.ok(timeError("10:06", undefined, undefined, 300));
  assert.equal(timeError("10:06", "10:01", undefined, 300), "");
  assert.equal(timeError("10:06", undefined, undefined, "any"), "");
  assert.equal(timeError("10:06"), "");
  assert.equal(timeError("", undefined, undefined, 300), "");
});
