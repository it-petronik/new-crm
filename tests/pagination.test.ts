import { test } from "node:test";
import assert from "node:assert/strict";
import { pageWindow } from "../src/lib/pagination";
test("pagination handles first, middle and partial final pages", () => {
  assert.deepEqual(pageWindow(23, 2, 10), {
    page: 2,
    pages: 3,
    start: 10,
    end: 20,
    total: 23,
    pageSize: 10,
  });
  assert.equal(pageWindow(23, 3, 10).end, 23);
});
test("empty and reduced result sets never produce invalid pages", () => {
  assert.equal(pageWindow(0, 5, 10).page, 1);
  assert.equal(pageWindow(0, 5, 10).end, 0);
  assert.equal(pageWindow(4, 5, 10).page, 1);
  assert.equal(pageWindow(100, -2, 20).start, 0);
});
