import { z } from "zod";
import type { Actor } from "../domain";
import type { AiResult } from "./client";
import { answerSchema } from "./schema";
import { redactSensitive } from "./sanitize";

export type ChatTurn = {
  id: string;
  question: string;
  result?: AiResult;
  error?: string;
  pageLabel?: string;
};
export type LocalChat = {
  id: string;
  title: string;
  updatedAt: number;
  turns: ChatTurn[];
};
export const CHAT_LIMITS = { chats: 20, turns: 20, bytes: 350_000, days: 7 };
/** A narrower role/company/module grant opens a different local history. */
export function chatHistoryKey(
  actor: Actor,
  company: string,
  preview: boolean,
) {
  const scope = JSON.stringify([
    actor.id,
    actor.role,
    [...actor.companies].sort(),
    [...actor.branches].sort(),
    Object.entries(actor.moduleAccess || {}).sort(),
    company,
    preview,
  ]);
  return `enercore-chat-v1:${encodeURIComponent(scope)}`;
}
const ref = z.object({
  id: z.string().max(20),
  label: z.string().max(200),
  target: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("record"),
      kind: z.string().max(30),
      id: z.string().max(100),
    }),
    z.object({
      type: z.literal("meeting"),
      id: z.string().max(100),
      view: z.enum(["details", "report"]).optional(),
    }),
    z.object({
      type: z.literal("conversation"),
      id: z.string().max(100),
      messageId: z.string().max(100).optional(),
    }),
  ]),
});
const savedResult = z.object({
  feature: z.string().max(30),
  answer: answerSchema.omit({ suggestions: true }),
  references: z.array(ref).max(100),
  scope: z.string().max(2500).nullable(),
  figures: z
    .array(
      z.object({
        label: z.string().max(200),
        value: z.string().max(500),
        ref: z.string().optional(),
      }),
    )
    .max(100),
  flaggedText: z.number(),
  model: z.string().nullable(),
  generatedAt: z.string().max(50),
  tool: z.string().optional(),
});
const storedChat = z.object({
  id: z.string().max(100),
  title: z.string().max(70),
  updatedAt: z.number(),
  turns: z
    .array(
      z.object({
        id: z.string().max(100),
        question: z.string().max(600),
        result: savedResult.optional(),
        error: z.string().max(500).optional(),
        pageLabel: z.string().max(160).optional(),
      }),
    )
    .max(CHAT_LIMITS.turns),
});

export function readChatHistory(
  raw: string | null,
  now = Date.now(),
): LocalChat[] {
  if (!raw || raw.length > CHAT_LIMITS.bytes) return [];
  try {
    return z
      .array(storedChat)
      .max(CHAT_LIMITS.chats)
      .parse(JSON.parse(raw))
      .filter(
        (c) =>
          c.updatedAt <= now + 60_000 &&
          now - c.updatedAt < CHAT_LIMITS.days * 86400000,
      )
      .map((c) => ({
        ...c,
        turns: c.turns.map((t) => ({
          ...t,
          question: redactSensitive(t.question),
          ...(!t.result && !t.error
            ? {
                error:
                  "This reply was interrupted. Send the message again when ready.",
              }
            : {}),
          result: t.result
            ? ({ ...t.result, suggestions: [] } as AiResult)
            : undefined,
        })),
      }));
  } catch {
    return [];
  }
}
/** Saved answers are reference material, never reusable mutation approvals. */
export function writeChatHistory(chats: LocalChat[], saveAnswers = true) {
  const safe = chats
    .filter((c) => c.turns.length)
    .slice(0, CHAT_LIMITS.chats)
    .map((c) => ({
      ...c,
      title: redactSensitive(c.title).slice(0, 70),
      turns: c.turns.slice(-CHAT_LIMITS.turns).map((t) => ({
        ...t,
        question: redactSensitive(t.question),
        result:
          saveAnswers && t.result
            ? { ...t.result, suggestions: [] }
            : undefined,
        error:
          !saveAnswers && t.result
            ? "Send this question again to refresh your permitted CRM data."
            : t.error?.slice(0, 500),
      })),
    }));
  while (safe.length && JSON.stringify(safe).length > CHAT_LIMITS.bytes)
    safe.pop();
  return JSON.stringify(safe);
}
