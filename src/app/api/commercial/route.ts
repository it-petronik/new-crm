import { z } from "zod";
import { checkOrigin, currentActor } from "@/lib/auth";
import { getDb, isPreview } from "@/lib/db";
import { CommercialError } from "@/lib/commercial/model";
import {
  changeLinks,
  commercialView,
  duplicates,
  listContacts,
  openDeal,
  quickCustomer,
  saveCapability,
  saveContact,
  searchCommercial,
} from "@/lib/commercial/store";
import { toCsv } from "@/lib/export";
const id = z.string().min(1).max(100);
const scope = {
  company: z.string().min(1).max(80),
  branch: z.string().min(1).max(80),
};
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deal"), leadId: id }).strict(),
  z
    .object({
      action: z.literal("contact"),
      parentId: id,
      id: id.optional(),
      version: z.number().int().positive().optional(),
      requestId: id.optional(),
      details: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.literal("capability"),
      supplierId: id,
      productId: id,
      id: id.optional(),
      version: z.number().int().positive().optional(),
      details: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.literal("links"),
      id,
      expectedUpdatedAt: z.string(),
      customerId: id.nullable().optional(),
      contactId: id.nullable().optional(),
      productId: id.nullable().optional(),
      primaryContactId: id.nullable().optional(),
      confirmReassignment: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("customer"),
      ...scope,
      title: z.string().trim().min(2).max(160),
      country: z.string().max(80).optional(),
      contactName: z.string().max(160).optional(),
      email: z.union([z.email(), z.literal("")]).optional(),
      phone: z.string().max(50).optional(),
      requestId: id,
      createAnyway: z.boolean().optional(),
    })
    .strict(),
]);
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failure = (e: unknown) =>
  reply(
    {
      error:
        e instanceof CommercialError
          ? e.message
          : e instanceof z.ZodError
            ? "Check the supplied fields."
            : "Could not complete this request.",
    },
    e instanceof CommercialError ? e.status : 400,
  );
export async function GET(request: Request) {
  try {
    if (isPreview())
      return reply({ error: "Preview uses local fictional data." }, 409);
    const actor = await currentActor();
    if (!actor) return reply({ error: "Sign in required." }, 401);
    const db = await getDb();
    if (!db) return reply({ error: "Database unavailable." }, 503);
    const p = new URL(request.url).searchParams;
    if (p.has("q")) {
      const kind = z
        .enum(["customers", "suppliers", "products", "leads"])
        .optional()
        .parse(p.get("kind") || undefined);
      return reply({
        results: await searchCommercial(
          db,
          actor,
          p.get("q")!,
          kind,
          p.get("company") || undefined,
          p.get("branch") || undefined,
        ),
      });
    }
    const recordId = id.parse(p.get("id"));
    if (p.get("view") === "contacts" || p.get("view") === "export-contacts") {
      const contacts = await listContacts(db, actor, recordId);
      if (p.get("view") === "export-contacts")
        return new Response(
          toCsv([
            [
              "Name",
              "Role",
              "Job title",
              "Email",
              "Phone",
              "Country",
              "Active",
            ],
            ...contacts.map((c) => [
              c.name,
              c.role,
              c.jobTitle,
              c.email,
              c.phone,
              c.country,
              c.active ? "Yes" : "No",
            ]),
          ]),
          {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": "attachment; filename=contacts.csv",
              "Cache-Control": "no-store",
            },
          },
        );
      return reply({ contacts });
    }
    return reply(
      await commercialView(db, actor, recordId, p.get("view") === "deal"),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    if (isPreview())
      return reply({ error: "Preview uses local fictional data." }, 409);
    checkOrigin(request);
    const actor = await currentActor();
    if (!actor) return reply({ error: "Sign in required." }, 401);
    const db = await getDb();
    if (!db) return reply({ error: "Database unavailable." }, 503);
    const c = command.parse(await request.json());
    switch (c.action) {
      case "deal":
        return reply({ deal: await openDeal(db, actor, c.leadId) });
      case "contact":
        return reply({ id: await saveContact(db, actor, c) });
      case "capability":
        return reply({ id: await saveCapability(db, actor, c) });
      case "links":
        return reply({ record: await changeLinks(db, actor, c) });
      case "customer":
        return reply(await quickCustomer(db, actor, c));
    }
  } catch (e) {
    return failure(e);
  }
}
