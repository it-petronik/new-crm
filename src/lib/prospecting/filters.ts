/** Apollo OpenAPI contract reviewed 2026-09-28; only documented endpoint filters. */
export type FilterDefinition = {
  key: string;
  label: string;
  api: string;
  type?: "number" | "date" | "list";
  group: string;
  mode?: "company" | "person";
  hint?: string;
};
export const filters: FilterDefinition[] = [
  {
    key: "keywords",
    label: "Keywords",
    api: "q_keywords",
    group: "Company",
    hint: "Company mode: comma-separated business keywords. People mode: keyword phrase.",
  },
  {
    key: "companyName",
    label: "Company name",
    api: "q_organization_name",
    group: "Company",
    mode: "company",
  },
  {
    key: "domain",
    label: "Company domains",
    api: "q_organization_domains_list",
    type: "list",
    group: "Company",
  },
  {
    key: "location",
    label: "Company locations",
    api: "organization_locations",
    type: "list",
    group: "Company",
  },
  {
    key: "excludedLocations",
    label: "Exclude company locations",
    api: "organization_not_locations",
    type: "list",
    group: "Company",
    mode: "company",
  },
  {
    key: "employeeRanges",
    label: "Employee ranges",
    api: "organization_num_employees_ranges",
    group: "Company",
    hint: "Ranges separated by semicolons: 1,10;11,50",
  },
  {
    key: "organizationIds",
    label: "Apollo company IDs",
    api: "organization_ids",
    type: "list",
    group: "Company",
  },
  {
    key: "excludedDomains",
    label: "Exclude company websites",
    api: "not_organization_websites_list",
    type: "list",
    group: "Company",
  },
  {
    key: "personName",
    label: "Person name",
    api: "q_person_name",
    group: "People",
    mode: "person",
  },
  {
    key: "titles",
    label: "Job titles",
    api: "person_titles",
    type: "list",
    group: "People",
    mode: "person",
  },
  {
    key: "personLocations",
    label: "Person locations",
    api: "person_locations",
    type: "list",
    group: "People",
    mode: "person",
  },
  {
    key: "seniorities",
    label: "Seniority levels",
    api: "person_seniorities",
    type: "list",
    group: "People",
    mode: "person",
    hint: "owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern",
  },
  {
    key: "emailStatuses",
    label: "Email availability/status",
    api: "contact_email_status",
    type: "list",
    group: "People",
    mode: "person",
    hint: "verified, unverified, likely to engage, unavailable. Search does not reveal emails.",
  },
  {
    key: "revenueMin",
    label: "Annual revenue minimum (USD)",
    api: "revenue_range[min]",
    type: "number",
    group: "Revenue & funding",
  },
  {
    key: "revenueMax",
    label: "Annual revenue maximum (USD)",
    api: "revenue_range[max]",
    type: "number",
    group: "Revenue & funding",
  },
  {
    key: "fundingMin",
    label: "Latest funding minimum (USD)",
    api: "latest_funding_amount_range[min]",
    type: "number",
    group: "Revenue & funding",
    mode: "company",
  },
  {
    key: "fundingMax",
    label: "Latest funding maximum (USD)",
    api: "latest_funding_amount_range[max]",
    type: "number",
    group: "Revenue & funding",
    mode: "company",
  },
  {
    key: "totalFundingMin",
    label: "Total funding minimum (USD)",
    api: "total_funding_range[min]",
    type: "number",
    group: "Revenue & funding",
    mode: "company",
  },
  {
    key: "totalFundingMax",
    label: "Total funding maximum (USD)",
    api: "total_funding_range[max]",
    type: "number",
    group: "Revenue & funding",
    mode: "company",
  },
  {
    key: "fundingFrom",
    label: "Latest funding from",
    api: "latest_funding_date_range[min]",
    type: "date",
    group: "Revenue & funding",
    mode: "company",
  },
  {
    key: "fundingTo",
    label: "Latest funding to",
    api: "latest_funding_date_range[max]",
    type: "date",
    group: "Revenue & funding",
    mode: "company",
  },
  {
    key: "technologiesAny",
    label: "Uses any technology IDs",
    api: "currently_using_any_of_technology_uids",
    type: "list",
    group: "Technology & growth",
    hint: "Apollo technology UIDs, not free-text product names.",
  },
  {
    key: "technologiesAll",
    label: "Uses all technology IDs",
    api: "currently_using_all_of_technology_uids",
    type: "list",
    group: "Technology & growth",
    mode: "person",
  },
  {
    key: "technologiesNot",
    label: "Does not use technology IDs",
    api: "currently_not_using_any_of_technology_uids",
    type: "list",
    group: "Technology & growth",
    mode: "person",
  },
  {
    key: "growthMonths",
    label: "Headcount growth period (months)",
    api: "organization_headcount_growth_past_n_months",
    type: "number",
    group: "Technology & growth",
    hint: "6, 12 or 24; also enter a growth bound.",
  },
  {
    key: "growthMin",
    label: "Headcount growth minimum (%)",
    api: "organization_headcount_growth_range[min]",
    type: "number",
    group: "Technology & growth",
  },
  {
    key: "growthMax",
    label: "Headcount growth maximum (%)",
    api: "organization_headcount_growth_range[max]",
    type: "number",
    group: "Technology & growth",
  },
  {
    key: "lookalikes",
    label: "Lookalike company IDs",
    api: "lookalike_organization_ids",
    type: "list",
    group: "Technology & growth",
    hint: "Up to 5 Apollo company IDs.",
  },
  {
    key: "hiringTitles",
    label: "Hiring job titles",
    api: "q_organization_job_titles",
    type: "list",
    group: "Hiring",
  },
  {
    key: "hiringLocations",
    label: "Hiring locations",
    api: "organization_job_locations",
    type: "list",
    group: "Hiring",
  },
  {
    key: "jobsMin",
    label: "Job openings minimum",
    api: "organization_num_jobs_range[min]",
    type: "number",
    group: "Hiring",
  },
  {
    key: "jobsMax",
    label: "Job openings maximum",
    api: "organization_num_jobs_range[max]",
    type: "number",
    group: "Hiring",
  },
  {
    key: "jobsFrom",
    label: "Job posted from",
    api: "organization_job_posted_at_range[min]",
    type: "date",
    group: "Hiring",
  },
  {
    key: "jobsTo",
    label: "Job posted to",
    api: "organization_job_posted_at_range[max]",
    type: "date",
    group: "Hiring",
  },
];
export const splitList = (v: string) => [
  ...new Set(
    v
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
];

export function describeCriteria(c: {
  discovery?: { query: string; roles: string[] };
  kind: string;
  page: number;
  perPage: number;
  keywords: string;
  location: string;
  domain: string;
  titles: string;
  companySize: string;
  seniority: string;
  similarTitles: boolean;
  advanced: Record<string, string>;
}) {
  return [
    ...(c.discovery
      ? [
          `Search: "${c.discovery.query}"`,
          `Suggested roles: ${c.discovery.roles.join(", ")}`,
        ]
      : []),
    c.kind === "company" ? "Companies" : "People",
    `Page ${c.page}`,
    `${c.perPage} per page`,
    ...filters
      .filter((f) => !f.mode || f.mode === c.kind)
      .map((f) => {
        const value = ["keywords", "location", "domain", "titles"].includes(
          f.key,
        )
          ? c[f.key as "keywords" | "location" | "domain" | "titles"]
          : c.advanced[f.key];
        return value ? `${f.label}: ${value}` : "";
      })
      .filter(Boolean),
    ...(c.companySize ? [`Employee range: ${c.companySize}`] : []),
    ...(c.seniority ? [`Seniority: ${c.seniority}`] : []),
    ...(c.kind === "person"
      ? [`Similar titles: ${c.similarTitles ? "included" : "excluded"}`]
      : []),
  ].join(" · ");
}
