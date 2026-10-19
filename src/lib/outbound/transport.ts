import { z } from "zod";
import { isLocalMailSandbox } from "../mail/model";
import { OutboundError, render, type Message } from "./model";
import type { Actor, RecordItem } from "../domain";
import { submitSmtp, type Connector } from "./smtp";

const email = z.object({
  host: z
    .string()
    .regex(/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/),
  username: z.string().email(),
  password: z
    .string()
    .min(1)
    .max(500)
    .refine((s) => !s.includes("\0")),
  from: z.string().email(),
  replyTo: z.string().email(),
});
const approved = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/),
  language: z.string().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/),
  body: z.string().min(1).max(4000),
});
const configuration = z.record(
  z.string(),
  z.object({
    email: email.optional(),
    whatsapp: z
      .object({
        token: z.string().min(8),
        phoneId: z.string().regex(/^\d+$/),
        version: z.string().regex(/^v\d+\.\d+$/),
        templates: z.record(z.string(), approved),
      })
      .optional(),
  }),
);
export type OutboundEnv = {
  OUTBOUND_CONFIG?: string;
  OUTBOUND_ENABLED?: string;
  MAIL_MODE?: string;
  APP_URL?: string;
};
export function connections(env: OutboundEnv, companies: string[]) {
  const parsed = configuration.safeParse(parse(env.OUTBOUND_CONFIG));
  const sandbox = isLocalMailSandbox(env.MAIL_MODE, env.APP_URL);
  return companies.map((company) => ({
    company,
    email: sandbox
      ? "sandbox"
      : env.OUTBOUND_ENABLED === "true" &&
          parsed.success &&
          parsed.data[company]?.email
        ? "configured"
        : "disconnected",
    whatsapp: sandbox
      ? "sandbox"
      : env.OUTBOUND_ENABLED === "true" &&
          parsed.success &&
          parsed.data[company]?.whatsapp
        ? "configured"
        : "disconnected",
  }));
}
function parse(value?: string) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return null;
  }
}
export type Submission = {
  status: "accepted" | "captured" | "uncertain" | "rejected";
  providerId: string | null;
};
/** Prepare before claiming a send: invalid configuration leaves the draft untouched. */
export function prepareSubmission(
  env: OutboundEnv,
  m: Message,
  record: RecordItem,
  actor: Actor,
  fetcher: typeof fetch = fetch,
  connector?: Connector,
): () => Promise<Submission> {
  if (isLocalMailSandbox(env.MAIL_MODE, env.APP_URL))
    return async () => ({ status: "captured", providerId: null });
  const parsed = configuration.safeParse(parse(env.OUTBOUND_CONFIG));
  if (env.OUTBOUND_ENABLED !== "true" || !parsed.success)
    throw new OutboundError(
      409,
      "Sending is disabled. Your draft has not been sent.",
    );
  const config = parsed.data[m.company];
  let url: string, headers: Record<string, string>, payload: unknown;
  if (m.channel === "email") {
    if (!config?.email)
      throw new OutboundError(
        409,
        "Email is not connected for this company. Nothing was sent.",
      );
    const account = config.email;
    return () => submitSmtp(account, m, connector);
  } else {
    const wa = config?.whatsapp,
      template = m.templateId && wa?.templates[m.templateId];
    if (!wa || !template || render(template.body, record, actor) !== m.body)
      throw new OutboundError(
        409,
        "WhatsApp needs a server-configured, Meta-approved template. This draft does not match one. Nothing was sent.",
      );
    const parameters = [
      ...template.body.matchAll(
        /\{\{\s*(contact|record|company|product|sender)\s*\}\}/g,
      ),
    ].map((match) => ({ type: "text", text: render(match[0], record, actor) }));
    url = `https://graph.facebook.com/${wa.version}/${wa.phoneId}/messages`;
    headers = { Authorization: `Bearer ${wa.token}` };
    payload = {
      messaging_product: "whatsapp",
      to: m.recipient.slice(1),
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        ...(parameters.length
          ? { components: [{ type: "body", parameters }] }
          : {}),
      },
    };
  }
  return async () => {
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      // No response body/error details are exposed or logged: providers can echo personal data.
      if (!response.ok)
        return {
          status:
            response.status >= 500 || response.status === 408
              ? "uncertain"
              : "rejected",
          providerId: null,
        };
      const data = (await response.json()) as {
        id?: string;
        messages?: { id?: string }[];
      };
      const providerId =
        m.channel === "email" ? data.id : data.messages?.[0]?.id;
      return typeof providerId === "string" && providerId.length <= 300
        ? { status: "accepted", providerId }
        : { status: "uncertain", providerId: null };
    } catch {
      return { status: "uncertain", providerId: null };
    }
  };
}
