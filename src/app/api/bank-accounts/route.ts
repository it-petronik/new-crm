import { and, asc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { checkOrigin, currentActor } from "@/lib/auth";
import { getDb, isPreview } from "@/lib/db";
import { bankMutationSchema, canUseBankAccounts } from "@/lib/bank-accounts";
import { auditEvents, savedBankAccounts } from "@/lib/schema";

const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const publicRow = (row: typeof savedBankAccounts.$inferSelect) => ({
  id: row.id,
  company: row.company,
  label: row.label,
  currency: row.currency,
  details: row.details,
  version: row.version,
});
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return reply({ error: "Please sign in again." }, 401);
  const company = new URL(request.url).searchParams.get("company") || "";
  if (!canUseBankAccounts(actor, company))
    return reply(
      { error: "You don’t have access to bank accounts for this company." },
      403,
    );
  try {
    const db = await getDb();
    if (!db)
      return reply(
        {
          error:
            "Saved bank accounts are unavailable. You can still enter details in the draft.",
        },
        503,
      );
    const rows = await db
      .select()
      .from(savedBankAccounts)
      .where(eq(savedBankAccounts.company, company))
      .orderBy(asc(savedBankAccounts.label));
    return reply({
      accounts: rows.map(publicRow),
      canManage: canUseBankAccounts(actor, company, true),
    });
  } catch {
    return reply(
      {
        error:
          "We couldn’t load saved bank accounts. Try again, or enter details in the draft.",
      },
      503,
    );
  }
}
async function change(request: Request) {
  try {
    checkOrigin(request);
  } catch {
    return reply({ error: "Please reopen this page and try again." }, 403);
  }
  const actor = await currentActor();
  if (!actor) return reply({ error: "Please sign in again." }, 401);
  if (isPreview())
    return reply(
      { error: "Preview accounts are saved only in this browser." },
      403,
    );
  const body = await request.json().catch(() => null);
  const parsed = bankMutationSchema.safeParse(body);
  if (!parsed.success)
    return reply(
      {
        error:
          "Enter an account label, bank name, account holder and account number. Check that each field is a single line.",
      },
      400,
    );
  const input = parsed.data;
  if (!canUseBankAccounts(actor, input.company, true))
    return reply(
      { error: "You cannot manage bank accounts for this company." },
      403,
    );
  if (request.method === "PATCH" && !input.version)
    return reply({ error: "Reload the saved account before editing it." }, 400);
  try {
    const db = await getDb();
    if (!db)
      return reply(
        {
          error:
            "We couldn’t save this bank account. Your draft details are still here.",
        },
        503,
      );
    const scope = and(
      eq(savedBankAccounts.id, input.id),
      eq(savedBankAccounts.company, input.company),
    );
    const [existing] = await db
      .select()
      .from(savedBankAccounts)
      .where(scope)
      .limit(1);
    if (request.method === "POST" && existing) {
      if (
        existing.label === input.label &&
        existing.currency === input.currency &&
        JSON.stringify(existing.details) === JSON.stringify(input.details)
      )
        return reply({ account: publicRow(existing) });
      return reply(
        {
          error:
            "This save was already used. Reload the account before making another change.",
        },
        409,
      );
    }
    if (
      request.method === "PATCH" &&
      (!existing || existing.version !== input.version)
    )
      return reply(
        {
          error:
            "Someone changed this saved account. Reload the list before editing it.",
        },
        409,
      );
    const now = Date.now();
    const row = {
      id: input.id,
      company: input.company,
      label: input.label,
      currency: input.currency,
      details: input.details,
      createdBy: existing?.createdBy || actor.id,
      updatedAt: now,
      version: (existing?.version || 0) + 1,
    };
    await db.batch([
      existing
        ? db
            .update(savedBankAccounts)
            .set({
              label: row.label,
              currency: row.currency,
              details: row.details,
              updatedAt: now,
              // NOT NULL deliberately aborts the entire batch if a concurrent edit won.
              version: sql`CASE WHEN ${savedBankAccounts.version} = ${input.version!} THEN ${savedBankAccounts.version} + 1 ELSE NULL END`,
            })
            .where(scope)
        : db.insert(savedBankAccounts).values(row),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        company: input.company,
        actor: actor.name,
        actorId: actor.id,
        action: existing
          ? "Updated saved bank account"
          : "Added saved bank account",
        recordId: input.id,
        subject: "bank-account",
        branch: null,
        at: new Date(now),
        // Never copy financial identifiers into broadly surfaced audit payloads.
        before: existing ? { version: existing.version } : null,
        after: { version: row.version },
      }),
    ]);
    return reply({ account: publicRow(row) }, existing ? 200 : 201);
  } catch {
    return reply(
      {
        error:
          "We couldn’t confirm this save. Reload the list to check it before trying again. Your draft details are unchanged.",
      },
      409,
    );
  }
}
export const POST = change;
export const PATCH = change;
