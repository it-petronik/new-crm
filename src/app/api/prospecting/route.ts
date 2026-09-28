import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { checkOrigin, currentActor } from "@/lib/auth";
import { getDb, isPreview } from "@/lib/db";
import { CommercialError } from "@/lib/commercial/model";
import { apolloProvider, ApolloError } from "@/lib/prospecting/provider";
import { command } from "@/lib/prospecting/commands";
import * as service from "@/lib/prospecting/store";
import * as ops from "@/lib/prospecting/operations";
import { bulkImport, bulkImportReview } from "@/lib/prospecting/imports";
import { csv, xlsx, report } from "@/lib/prospecting/export";
import { apolloStages, apolloUsage } from "@/lib/schema";
import { generateStructured, checkLimits, AiError } from "@/lib/ai/gateway";
import {
  interpretationOutput,
  interpretationJsonSchema,
  interpretationInstructions,
  interpretOutput,
} from "@/lib/prospecting/interpretation";
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  try {
    if (isPreview())
      return reply(
        {
          error:
            "Apollo requires the connected workspace. Preview makes no Apollo calls.",
        },
        409,
      );
    checkOrigin(request);
    const actor = await currentActor();
    if (!actor) return reply({ error: "Sign in required." }, 401);
    const db = await getDb();
    if (!db) return reply({ error: "Database unavailable." }, 503);
    const raw = await request.text();
    if (raw.length > 150000) return reply({ error: "Request too large." }, 413);
    const c = command.parse(JSON.parse(raw));
    switch (c.action) {
      case "interpret": {
        service.prospectScope(actor, c.company, c.branch);
        try {
          await checkLimits(db, actor);
          const result = await generateStructured({
            db,
            actor,
            feature: "prospecting",
            instructions: interpretationInstructions,
            prompt: JSON.stringify({ query: c.query }),
            schema: interpretationOutput,
            jsonSchema: interpretationJsonSchema,
            singleAttempt: true,
          });
          return reply({
            criteria: interpretOutput(
              result.data,
              c.query,
              c.current,
              c.manualKeys,
            ),
          });
        } catch (e) {
          if (e instanceof CommercialError) throw e;
          throw new CommercialError(
            e instanceof AiError ? e.status : 503,
            "AI interpretation unavailable — using keyword search.",
          );
        }
      }
      case "search": {
        const prepared = await ops.prepare(db, actor, { ...c, type: "search" });
        return reply(
          await ops.advance(
            db,
            actor,
            prepared.id,
            true,
            await apolloProvider(),
          ),
        );
      }
      case "workspace":
        return reply(await ops.workspace(db, actor, c.company, c.branch));
      case "refresh-account":
        return reply(
          await ops.refreshAccount(
            db,
            actor,
            c.company,
            c.branch,
            await apolloProvider(),
          ),
        );
      case "save-search":
        return reply(await ops.saveSearch(db, actor, c));
      case "delete-search":
        return reply(await ops.deleteSearch(db, actor, c.id));
      case "prepare":
        return reply(await ops.prepare(db, actor, c));
      case "advance":
        return reply(
          await ops.advance(
            db,
            actor,
            c.id,
            c.confirmed,
            await apolloProvider(),
          ),
        );
      case "operation":
        return reply(await ops.readOperation(db, actor, c.id));
      case "retry-failed":
        return reply(await ops.retryFailed(db, actor, c.id, c.requestId));
      case "phone-results":
        return reply(
          await ops.pollPhones(db, actor, c.id, await apolloProvider()),
        );
      case "page":
        return reply(await ops.stagedPage(db, actor, c.stageId));
      case "dataset":
        return reply(await ops.dataset(db, actor, c.refs));
      case "bulk-review":
        return reply(await bulkImportReview(db, actor, c.refs));
      case "bulk-import":
        return reply(await bulkImport(db, actor, c.items));
      case "export":
      case "report": {
        const rows = await ops.dataset(db, actor, c.refs);
        const chunks = (ids: string[]) =>
          Array.from({ length: Math.ceil(ids.length / 40) }, (_, i) =>
            ids.slice(i * 40, i * 40 + 40),
          );
        const stageRows = (
          await Promise.all(
            chunks([...new Set(c.refs.map((r) => r.stageId))]).map((ids) =>
              db
                .select({
                  fingerprint: apolloStages.fingerprint,
                  data: apolloStages.data,
                })
                .from(apolloStages)
                .where(
                  and(
                    eq(apolloStages.actorId, actor.id),
                    inArray(apolloStages.id, ids),
                  ),
                ),
            ),
          )
        ).flat();
        const ids = [
          ...new Set(
            stageRows.flatMap(
              (r) =>
                r.data.operationIds ||
                (r.fingerprint.startsWith("operation:")
                  ? [r.fingerprint.slice(10)]
                  : []),
            ),
          ),
        ];
        const log = (
          await Promise.all(
            chunks(ids).map((part) =>
              db
                .select({
                  operation: apolloUsage.operation,
                  estimatedCredits: apolloUsage.estimatedCredits,
                  actualCredits: apolloUsage.actualCredits,
                  status: apolloUsage.status,
                })
                .from(apolloUsage)
                .where(
                  and(
                    eq(apolloUsage.actorId, actor.id),
                    inArray(apolloUsage.operationId, part),
                  ),
                ),
            ),
          )
        ).flat();
        const summary = report(rows, log);
        if (c.action === "report") return reply(summary);
        const body =
          c.format === "csv"
            ? csv(rows)
            : new Uint8Array(xlsx(rows, summary)).buffer;
        return new Response(body, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type":
              c.format === "csv"
                ? "text/csv; charset=utf-8"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="enercore-prospects.${c.format}"`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      case "review":
        return reply(
          await service.importReview(db, actor, c.stageId, c.providerId),
        );
      case "import":
        return reply(await service.importProspect(db, actor, c));
      case "enrichment-review":
        return reply(
          await service.enrichmentReview(
            db,
            actor,
            c.stageId,
            c.providerId,
            c.targetId,
            c.kind,
          ),
        );
      case "apply-enrichment":
        return reply(await service.applyEnrichment(db, actor, c));
    }
  } catch (e) {
    return reply(
      {
        error:
          e instanceof CommercialError
            ? e.message
            : e instanceof z.ZodError
              ? e.issues[0]?.message || "Check the supplied fields."
              : "Could not complete this request.",
        retryAfter: e instanceof ApolloError ? e.retryAfter : undefined,
      },
      e instanceof CommercialError ? e.status : 400,
    );
  }
}
