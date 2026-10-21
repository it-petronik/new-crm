import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

test("every interactive table declares sorting and filtering; document tables are intentionally static", () => {
  const root = join(process.cwd(), "src/components");
  const printOnly = new Set([
    "pdf/DocumentTemplate.tsx",
    "pdf/ItemsTable.tsx",
    "ai/meeting-intelligence-print.tsx",
  ]);
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name.endsWith(".tsx")
          ? [join(dir, e.name)]
          : [],
    );
  let checked = 0;
  for (const path of walk(root)) {
    const name = relative(root, path),
      source = readFileSync(path, "utf8");
    if (printOnly.has(name)) continue;
    assert.ok(
      name === "ui/crm-table.tsx" || !/<table\b/.test(source),
      `${name} bypasses the shared CRM table`,
    );
    for (const table of source.matchAll(/<CrmTable\b[\s\S]*?<\/CrmTable>/g)) {
      assert.match(
        table[0],
        /SortHeader/,
        `${name} table has no sortable columns`,
      );
      assert.match(
        source,
        /ListFilters|\.filter\(/,
        `${name} has no list filter`,
      );
      checked++;
    }
  }
  assert.ok(
    checked >= 13,
    "Inventory must include business, HR, import and review tables",
  );
});
