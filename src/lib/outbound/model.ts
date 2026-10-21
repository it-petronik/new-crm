import { z } from "zod";
import {
  allowedModules,
  canRead,
  canWrite,
  type Actor,
  type RecordItem,
} from "../domain";

export const channels = ["email", "whatsapp"] as const;
export type Channel = (typeof channels)[number];
export const tokens = [
  "contact",
  "record",
  "company",
  "product",
  "sender",
] as const;
export const labels: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled review",
  ready: "Ready for review",
  sending: "Submitting · do not retry",
  accepted: "Provider accepted",
  captured: "Test capture · not delivered",
  uncertain: "Check with provider",
  rejected: "Provider rejected",
  cancelled: "Cancelled",
};
export class OutboundError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function canCommunicate(actor: Actor, record: RecordItem) {
  return (
    [
      "leads",
      "customers",
      "suppliers",
      "quotations",
      "accounts",
      "logistics",
    ].includes(record.kind) &&
    !record.deletedAt &&
    canRead(actor, record) &&
    canWrite(actor, record)
  );
}
export function canManageTemplates(actor: Actor, company: string) {
  return (
    actor.companies.includes(company) &&
    !actor.branches.length &&
    ["MD", "MD Assistant", "IT Administrator", "Group Manager", "Sales Manager", "Marketing Manager"].includes(
      actor.role,
    ) &&
    ["leads", "customers", "marketing"].some(
      (m) =>
        allowedModules(actor).includes(
          m as "leads" | "customers" | "marketing",
        ) &&
        actor.moduleAccess?.[m as "leads" | "customers" | "marketing"] !==
          "read",
    )
  );
}
const text = z.string().trim().min(1).max(4000);
const subject = z
  .string()
  .trim()
  .max(200)
  .refine((s) => !/[\r\n]/.test(s), "Subject must be one line.");
const templateText = text.refine((s) => {
  const rest = s.replace(
    /\{\{\s*(contact|record|company|product|sender)\s*\}\}/g,
    "",
  );
  return !/[{}]/.test(rest);
}, "Use only the supported template fields.");
const templateSubject = subject.refine(
  (s) =>
    !/[{}]/.test(
      s.replace(/\{\{\s*(contact|record|company|product|sender)\s*\}\}/g, ""),
    ),
  "Use only the supported template fields.",
);
const id = z.string().min(1).max(100);
const revision = { id, version: z.number().int().positive() };
export const command = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("template"),
      id: z.string().uuid(),
      company: z.string().min(1).max(80),
      name: z.string().trim().min(2).max(80),
      channel: z.enum(channels),
      subject: templateSubject,
      body: templateText,
    })
    .strict(),
  z.object({ action: z.literal("archive-template"), ...revision }).strict(),
  z
    .object({
      action: z.literal("draft"),
      id: z.string().uuid(),
      recordId: id,
      channel: z.enum(channels),
      templateId: id.nullable(),
      subject,
      body: text,
    })
    .strict(),
  z
    .object({ action: z.literal("edit"), ...revision, subject, body: text })
    .strict(),
  z
    .object({
      action: z.literal("schedule"),
      ...revision,
      at: z.number().int().positive(),
    })
    .strict(),
  z.object({ action: z.literal("ready"), ...revision }).strict(),
  z.object({ action: z.literal("cancel"), ...revision }).strict(),
  z
    .object({
      action: z.literal("send"),
      ...revision,
      confirmed: z.literal(true),
      consent: z.string().trim().min(8).max(500),
    })
    .strict(),
]);
export function render(value: string, record: RecordItem, actor: Actor) {
  const facts: Record<(typeof tokens)[number], string> = {
    contact: record.contact || record.title,
    record: record.title,
    company: record.company,
    product: record.product || "",
    sender: actor.name,
  };
  return value.replace(
    /\{\{\s*(contact|record|company|product|sender)\s*\}\}/g,
    (_, key: keyof typeof facts) => facts[key],
  );
}
export function recipient(record: RecordItem, channel: Channel) {
  if (channel === "email") {
    const parsed = z.string().email().max(254).safeParse(record.email?.trim());
    if (!parsed.success || /[\r\n]/.test(parsed.data))
      throw new OutboundError(
        409,
        "Add a valid email address to the linked CRM record first.",
      );
    return parsed.data.toLowerCase();
  }
  const phone = record.phone?.replace(/[ ()-]/g, "") || "";
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new OutboundError(
      409,
      "Add a phone number with its +country code to the linked CRM record first.",
    );
  return phone;
}
export type Message = {
  id: string;
  ownerId: string;
  recordId: string;
  company: string;
  branch: string;
  channel: Channel;
  recipient: string;
  subject: string;
  body: string;
  templateId: string | null;
  status: string;
  version: number;
  scheduledAt: number | null;
  createdAt: number;
  updatedAt: number;
  providerId: string | null;
  consent: string;
  recordTitle?: string;
  canAct?: boolean;
};
export type Template = {
  id: string;
  company: string;
  name: string;
  channel: Channel;
  subject: string;
  body: string;
  version: number;
  archived: number;
};
export type History = {
  id: string;
  messageId: string;
  action: string;
  at: number;
};
