import { z } from "zod";
import { id } from "../execution/model";
import { searchInput } from "./model";
import { refInput, refsInput } from "./operations-model";
const scope = { company: id, branch: id };
export const importFields = {
  ...refInput.shape,
  requestId: id,
  customerId: id.optional(),
  contactId: id.optional(),
  companyName: z.string().min(1).max(160),
  contactName: z.string().max(160).optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  phone: z.string().max(50).optional(),
  createAnyway: z.boolean().optional(),
  createLead: z.boolean().optional(),
  createDeal: z.boolean().optional(),
  createContact: z.boolean().optional(),
  productId: id.optional(),
};
export const bulkImportItemInput = z
  .object({
    ...importFields,
    skip: z.boolean().optional(),
    groupCompany: z.boolean().optional(),
  })
  .strict();
const target = {
  ...refInput.shape,
  targetId: id,
  kind: z.enum(["customer", "contact"]),
};
export const command = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("interpret"),
      ...scope,
      query: z.string().trim().min(3).max(800),
      current: searchInput.optional(),
      manualKeys: z.array(z.string().max(80)).max(40).default([]),
    })
    .strict(),
  z.object({ action: z.literal("workspace"), ...scope }).strict(),
  z.object({ action: z.literal("refresh-account"), ...scope }).strict(),
  z
    .object({
      action: z.literal("save-search"),
      ...scope,
      name: z.string().trim().min(1).max(100),
      market: z.string().trim().max(200),
      criteria: searchInput,
      productId: id.optional(),
    })
    .strict(),
  z.object({ action: z.literal("delete-search"), id }).strict(),
  z
    .object({
      action: z.literal("prepare"),
      ...scope,
      requestId: id,
      type: z.enum(["search", "enrich"]),
      criteria: searchInput.optional(),
      refs: refsInput.optional(),
      phones: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("advance"), id, confirmed: z.literal(true) })
    .strict(),
  z.object({ action: z.literal("operation"), id }).strict(),
  z.object({ action: z.literal("retry-failed"), id, requestId: id }).strict(),
  z.object({ action: z.literal("phone-results"), id }).strict(),
  z.object({ action: z.literal("page"), stageId: id }).strict(),
  z.object({ action: z.literal("dataset"), refs: refsInput }).strict(),
  z.object({ action: z.literal("bulk-review"), refs: refsInput }).strict(),
  z
    .object({
      action: z.literal("bulk-import"),
      confirmed: z.literal(true),
      items: z.array(z.unknown()).min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("export"),
      format: z.enum(["csv", "xlsx"]),
      refs: refsInput,
    })
    .strict(),
  z.object({ action: z.literal("report"), refs: refsInput }).strict(),
  z.object({ action: z.literal("review"), ...refInput.shape }).strict(),
  z.object({ action: z.literal("import"), ...importFields }).strict(),
  z.object({ action: z.literal("enrichment-review"), ...target }).strict(),
  z
    .object({
      action: z.literal("apply-enrichment"),
      ...target,
      version: z.number().int().positive(),
      fields: z.array(z.string()).min(1).max(6),
    })
    .strict(),
]);
