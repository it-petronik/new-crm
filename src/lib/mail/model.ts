import { z } from "zod";

export const mailDraft = z
  .object({
    id: z.string().uuid(),
    to: z
      .string()
      .trim()
      .email()
      .max(254)
      .refine((v) => !/[\r\n]/.test(v)),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\r\n]/.test(v)),
    body: z.string().trim().min(1).max(20000),
    version: z.number().int().positive().optional(),
  })
  .strict();
export type MailDraft = z.infer<typeof mailDraft>;
export type MailMessage = MailDraft & {
  uid?: number;
  folder: "inbox" | "drafts" | "outbox" | "history";
  remote?: number;
  sender: string;
  updatedAt: number;
  isRead?: number;
  candidate?: number;
  truncated?: number;
  status?: string;
};
export const mailAction = z.discriminatedUnion("action", [
  mailDraft.extend({ action: z.literal("save") }),
  mailDraft.extend({
    action: z.literal("send-test"),
    confirmed: z.literal(true),
  }),
  mailDraft.extend({ action: z.literal("send"), confirmed: z.literal(true) }),
]);

// Configuration is trusted only from the server binding, never Host headers
// or a client-provided mode flag. Production has neither of these bindings.
export function isLocalMailSandbox(mode: unknown, appUrl: unknown) {
  if (mode !== "sandbox" || typeof appUrl !== "string") return false;
  try {
    const url = new URL(appUrl);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
