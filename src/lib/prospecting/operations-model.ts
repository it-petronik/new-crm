import { z } from "zod";
import type { Prospect, SearchInput } from "./model";
export const refInput = z
  .object({
    stageId: z.string().min(1).max(100),
    providerId: z.string().min(1).max(100),
  })
  .strict();
export const refsInput = z.array(refInput).min(1).max(100);
export type ProspectRef = z.infer<typeof refInput>;
export type CreditPolicy = {
  reviewedAt: string;
  source: string;
  companySearch: number;
  companyEnrich: number;
  personEnrich: number;
  phoneAdditional: number;
  note: string;
};
/** Public prices are estimates, not account billing promises. Central server policy is versioned with confirmations. */
export const creditPolicy: CreditPolicy = {
  reviewedAt: "2026-09-28",
  source: "https://docs.apollo.io/docs/api-pricing",
  companySearch: 1,
  companyEnrich: 1,
  personEnrich: 1,
  phoneAdditional: 8,
  note: "Published standard API prices. Legacy plans, re-access and returned data can affect billing. Actual cost is shown only when Apollo reports it.",
};
export type AccountUsage = {
  checkedAt: string;
  available: number | null;
  used: number | null;
  allowance: number | null;
  cycleStart: string | null;
  cycleEnd: string | null;
  creditError?: string;
  limitsError?: string;
  limits: {
    endpoint: string;
    window: string;
    limit: number;
    remaining: number | null;
  }[];
  source: string;
};
export type BulkResult = {
  items: {
    id: string;
    prospect: Prospect | null;
    status: "succeeded" | "no_data" | "failed";
    message?: string;
  }[];
  actualCredits?: number;
  phoneRequestId?: string;
};
export type PhoneResult = {
  pending: boolean;
  retryAfter: number;
  phones: { id: string; phone: string; type: string }[];
  actualCredits?: number;
};
export type ItemStatus =
  "pending" | "running" | "succeeded" | "no_data" | "failed" | "unknown";
export type OperationItem = {
  ref: ProspectRef;
  prospect: Prospect;
  status: ItemStatus;
  message?: string;
  resultRef?: ProspectRef;
};
export type OperationData = {
  type: "search" | "enrich";
  kind: "company" | "person";
  criteria: SearchInput;
  items: OperationItem[];
  phones: boolean;
  estimate: number;
  policy: CreditPolicy;
  available: number | null;
  resultStageId?: string;
  message?: string;
  retryAt?: number;
  phoneJobs?: {
    requestId: string;
    ids: string[];
    done: boolean;
    retryAt: number;
    actualCredits?: number;
  }[];
  actualCredits?: number;
  actualComplete?: boolean;
  confirmed?: boolean;
  sourceOperationIds?: string[];
};
export type OperationView = {
  id: string;
  status: string;
  expiresAt: Date | string;
  createdAt: Date | string;
  data: OperationData;
};
export type MatchStatus =
  | "Existing Customer"
  | "Existing Contact"
  | "Possible Customer match"
  | "No match in checked records";
export type DatasetItem = {
  imported?: boolean;
  ref: ProspectRef;
  prospect: Prospect;
  match: MatchStatus;
  customerId?: string;
  contactId?: string;
  criteria: SearchInput;
};
