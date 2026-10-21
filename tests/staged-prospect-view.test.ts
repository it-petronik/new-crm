import test from "node:test";
import assert from "node:assert/strict";
import { viewStagedProspects } from "../src/lib/prospecting/result-view";
import type { DatasetItem } from "../src/lib/prospecting/operations-model";
import { searchInput } from "../src/lib/prospecting/model";

const rows: DatasetItem[] = [
  {
    name: "Zulu 2",
    companyName: "Beta",
    country: "Kenya",
    match: "Existing Customer",
  },
  {
    name: "Alpha",
    companyName: "Gamma",
    country: "Vietnam",
    match: "No match in checked records",
  },
  {
    name: "Zulu 10",
    companyName: "Alpha",
    country: "Kenya",
    match: "Possible Customer match",
  },
].map((r, i) => ({
  ref: { stageId: "staged", providerId: String(i) },
  criteria: searchInput.parse({ kind: "company" }),
  match: r.match as DatasetItem["match"],
  prospect: {
    id: String(i),
    kind: "company",
    name: r.name,
    nameComplete: true,
    companyId: "",
    companyName: r.companyName,
    country: r.country,
    domain: "",
    industry: "",
    size: "",
    description: "",
    title: "",
    email: "",
    phone: "",
  },
}));

test("staged prospect search and sorting affect a copy, not provider order, references or selection", () => {
  const original = structuredClone(rows);
  assert.deepEqual(
    viewStagedProspects(rows, "", "all", "name").map((r) => r.prospect.name),
    ["Alpha", "Zulu 2", "Zulu 10"],
  );
  assert.deepEqual(
    viewStagedProspects(rows, "kenya", "review", "default").map(
      (r) => r.prospect.name,
    ),
    ["Zulu 10"],
  );
  assert.deepEqual(
    viewStagedProspects(rows, "", "existing", "default").map(
      (r) => r.ref.providerId,
    ),
    ["0"],
  );
  assert.equal(viewStagedProspects(rows, "", "new", "default").length, 1);
  assert.deepEqual(
    viewStagedProspects(rows, "", "all", "company").map(
      (r) => r.prospect.companyName,
    ),
    ["Alpha", "Beta", "Gamma"],
  );
  assert.deepEqual(rows, original);
});
