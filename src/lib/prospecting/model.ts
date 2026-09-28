import { z } from "zod";
import { filters, splitList } from "./filters";
export const searchInput = z
  .object({
    discovery: z
      .object({
        query: z.string().trim().min(1).max(800),
        roles: z.array(z.string().max(60)).max(5),
        warnings: z.array(z.string().max(160)).max(40),
      })
      .strict()
      .optional(),
    advanced: z.record(z.string(), z.string().trim().max(2000)).default({}),
    perPage: z
      .union([z.literal(25), z.literal(50), z.literal(100)])
      .default(25),
    similarTitles: z.boolean().default(true),
    kind: z.enum(["company", "person"]),
    keywords: z.string().trim().max(150).default(""),
    location: z.string().trim().max(100).default(""),
    companySize: z
      .enum([
        "",
        "1,10",
        "11,50",
        "51,200",
        "201,500",
        "501,1000",
        "1001,5000",
        "5001,1000000",
      ])
      .default(""),
    titles: z.string().trim().max(200).default(""),
    seniority: z
      .enum([
        "",
        "owner",
        "founder",
        "c_suite",
        "partner",
        "vp",
        "head",
        "director",
        "manager",
        "senior",
        "entry",
        "intern",
      ])
      .default(""),
    domain: z.string().trim().max(200).default(""),
    page: z.number().int().min(1).max(500).default(1),
  })
  .strict()
  .superRefine((s, ctx) => {
    const a = s.advanced;
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    for (const [key, value] of Object.entries(a)) {
      const f = filters.find((x) => x.key === key);
      if (
        !f ||
        (f.mode && f.mode !== s.kind) ||
        ["keywords", "location", "titles", "domain"].includes(key)
      ) {
        issue("Unsupported filter");
        continue;
      }
      if (!value) continue;
      if (
        f.type === "number" &&
        (!/^-?\d+$/.test(value) ||
          !Number.isSafeInteger(Number(value)) ||
          (Number(value) < 0 && !key.startsWith("growth")))
      )
        issue("Enter a valid integer");
      if (
        f.type === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        issue("Enter a valid date");
      if (
        f.type === "list" &&
        splitList(value).length > (key === "lookalikes" ? 5 : 100)
      )
        issue("Too many filter values");
    }
    if (
      (a.growthMonths && !["6", "12", "24"].includes(a.growthMonths)) ||
      !!a.growthMonths !== !!(a.growthMin || a.growthMax)
    )
      issue("Growth needs a period and at least one bound");
    for (const [lo, hi] of [
      ["revenueMin", "revenueMax"],
      ["fundingMin", "fundingMax"],
      ["totalFundingMin", "totalFundingMax"],
      ["growthMin", "growthMax"],
      ["jobsMin", "jobsMax"],
      ["fundingFrom", "fundingTo"],
      ["jobsFrom", "jobsTo"],
    ])
      if (
        a[lo] &&
        a[hi] &&
        (lo.endsWith("From") ? a[lo] > a[hi] : Number(a[lo]) > Number(a[hi]))
      )
        issue("Minimum must not exceed maximum");
    if (
      a.employeeRanges &&
      a.employeeRanges
        .split(";")
        .some(
          (v) =>
            !/^\d+,\d+$/.test(v.trim()) ||
            Number(v.split(",")[0]) > Number(v.split(",")[1]),
        )
    )
      issue("Check employee ranges");
    if (
      a.seniorities &&
      splitList(a.seniorities).some(
        (v) =>
          ![
            "owner",
            "founder",
            "c_suite",
            "partner",
            "vp",
            "head",
            "director",
            "manager",
            "senior",
            "entry",
            "intern",
          ].includes(v),
      )
    )
      issue("Unsupported seniority");
    if (
      a.emailStatuses &&
      splitList(a.emailStatuses).some(
        (v) =>
          ![
            "verified",
            "unverified",
            "likely to engage",
            "unavailable",
          ].includes(v),
      )
    )
      issue("Unsupported email status");
  });
export type SearchInput = z.infer<typeof searchInput>;
export type Prospect = {
  id: string;
  kind: "company" | "person";
  name: string;
  nameComplete: boolean;
  companyId: string;
  companyName: string;
  domain: string;
  country: string;
  industry: string;
  size: string;
  description: string;
  title: string;
  email: string;
  phone: string;
  seniority?: string;
  profileUrl?: string;
  emailStatus?: string;
  phoneType?: string;
  companyPhone?: string;
  enrichmentStatus?:
    | "Not enriched"
    | "Partially enriched"
    | "Enriched"
    | "No additional data"
    | "Failed";
  enrichedAt?: string;
  provenance?: Record<string, { source: "Apollo"; enrichedAt: string }>;
};
export type ProspectPage = {
  prospects: Prospect[];
  page: number;
  hasMore: boolean;
  criteria: SearchInput;
  source: "Apollo";
  enriched?: boolean;
  pending?: boolean;
  total?: number;
  actualCredits?: number;
  operationIds?: string[];
};
export function domainOf(s: string) {
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    return ["https:", "http:"].includes(u.protocol)
      ? u.hostname.toLowerCase().replace(/^www\./, "")
      : "";
  } catch {
    return "";
  }
}
