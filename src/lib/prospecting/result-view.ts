import type { DatasetItem } from "./operations-model";

/** Local view of already staged data; never expands a provider search or selection. */
export function viewStagedProspects(
  rows: readonly DatasetItem[],
  search: string,
  match: string,
  sort: string,
) {
  const term = search.trim().toLowerCase();
  const result = rows.filter(
    ({ prospect: p, match: status }) =>
      (!term ||
        [p.name, p.companyName, p.title, p.domain, p.country, p.industry]
          .join(" ")
          .toLowerCase()
          .includes(term)) &&
      (match === "all" ||
        (match === "existing" && status.startsWith("Existing")) ||
        (match === "new" && status === "No match in checked records") ||
        (match === "review" && status === "Possible Customer match")),
  );
  if (sort !== "default")
    result.sort((a, b) => {
      const company = sort === "company";
      return (
        (company ? a.prospect.companyName : a.prospect.name).localeCompare(
          company ? b.prospect.companyName : b.prospect.name,
          undefined,
          { numeric: true, sensitivity: "base" },
        ) * (sort === "name-desc" ? -1 : 1)
      );
    });
  return result;
}
