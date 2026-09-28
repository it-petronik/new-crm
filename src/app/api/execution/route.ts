import { z } from "zod";
import { checkOrigin, currentActor } from "@/lib/auth";
import { getDb, isPreview } from "@/lib/db";
import { CommercialError } from "@/lib/commercial/model";
import { id } from "@/lib/execution/model";
import * as service from "@/lib/execution/store";
const version = z.number().int().positive();
const related = { dealId: id, supplierId: id, productId: id, requestId: id };
const command = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("candidate"),
      ...related,
      status: z.string().optional(),
      version: version.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("rfq"),
      ...related,
      id: id.optional(),
      version: version.optional(),
      status: z.string(),
      details: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.literal("offer"),
      ...related,
      rfqId: id.optional(),
      previousId: id.optional(),
      version: version.optional(),
      details: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.literal("offer-status"),
      id,
      version,
      status: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("scenario"),
      offerId: id,
      requestId: id,
      id: id.optional(),
      version: version.optional(),
      details: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.literal("scenario-status"),
      id,
      version,
      status: z.string(),
    })
    .strict(),
  z.object({ action: z.literal("quotation"), id, version }).strict(),
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
      return reply(
        { error: "Commercial execution requires the connected workspace." },
        409,
      );
    const actor = await currentActor();
    if (!actor) return reply({ error: "Sign in required." }, 401);
    const db = await getDb();
    if (!db) return reply({ error: "Database unavailable." }, 503);
    const p = new URL(request.url).searchParams;
    return reply(
      p.has("recordId")
        ? await service.executionHistory(db, actor, id.parse(p.get("recordId")))
        : await service.executionView(db, actor, id.parse(p.get("dealId"))),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    if (isPreview())
      return reply(
        { error: "Commercial execution requires the connected workspace." },
        409,
      );
    checkOrigin(request);
    const actor = await currentActor();
    if (!actor) return reply({ error: "Sign in required." }, 401);
    const db = await getDb();
    if (!db) return reply({ error: "Database unavailable." }, 503);
    const c = command.parse(await request.json());
    switch (c.action) {
      case "candidate":
        return reply({ id: await service.saveCandidate(db, actor, c) });
      case "rfq":
        return reply({ id: await service.saveRfq(db, actor, c) });
      case "offer":
        return reply({ id: await service.recordOffer(db, actor, c) });
      case "offer-status":
        await service.offerStatus(db, actor, c);
        break;
      case "scenario":
        return reply({ id: await service.saveScenario(db, actor, c) });
      case "scenario-status":
        await service.scenarioStatus(db, actor, c);
        break;
      case "quotation":
        return reply({ id: await service.prepareQuotation(db, actor, c) });
    }
    return reply({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
