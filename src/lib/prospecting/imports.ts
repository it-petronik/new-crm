import { bulkImportItemInput } from "./commands";
import type { Database } from "../d1";
import type { Actor } from "../domain";
import { CommercialError, duplicateReasons } from "../commercial/model";
import {
  importReview,
  reviewContext,
  importProspect,
  staged,
  type ImportInput,
} from "./store";
import { dataset } from "./operations";
import { type ProspectRef } from "./operations-model";
export async function bulkImportReview(
  db: Database,
  actor: Actor,
  refs: ProspectRef[],
) {
  const rows = await dataset(db, actor, refs);
  const items = [];
  const contexts = new Map<string, Awaited<ReturnType<typeof reviewContext>>>();
  for (const row of rows) {
    const { stage } = await staged(
      db,
      actor,
      row.ref.stageId,
      row.ref.providerId,
    );
    const key = JSON.stringify([stage.company, stage.branch]);
    if (!contexts.has(key))
      contexts.set(
        key,
        await reviewContext(db, actor, stage.company, stage.branch),
      );
    const review = await importReview(
      db,
      actor,
      row.ref.stageId,
      row.ref.providerId,
      contexts.get(key),
    );
    const exact = review.customers.find((c) => c.id === row.customerId);
    const contactMatches =
      exact?.contacts.filter(
        (c) =>
          c.active &&
          duplicateReasons(
            {
              title: row.prospect.name,
              email: row.prospect.email,
              phone: row.prospect.phone,
            },
            { title: c.name, email: c.email, phone: c.phone },
          ).length,
      ) || [];
    items.push({
      ...row,
      customers: review.customers,
      contactMatches,
      needsReview:
        row.match === "Possible Customer match" ||
        contactMatches.length > 1 ||
        (row.prospect.kind === "person" && !row.prospect.nameComplete),
      companyName:
        row.prospect.companyName ||
        (row.prospect.kind === "company" ? row.prospect.name : ""),
      contactName: row.prospect.nameComplete ? row.prospect.name : "",
    });
  }
  const uniqueNew = new Set(
    items
      .filter((i) => !i.customerId && !i.needsReview)
      .map((i) => i.prospect.companyId || i.prospect.id),
  );
  return {
    items,
    counts: {
      existingCustomers: new Set(
        items.filter((i) => i.customerId).map((i) => i.customerId),
      ).size,
      newCustomers: uniqueNew.size,
      existingContacts: items.filter(
        (i) => i.contactId || i.contactMatches.length === 1,
      ).length,
      newContacts: items.filter(
        (i) =>
          i.prospect.kind === "person" &&
          !i.needsReview &&
          !i.contactId &&
          !i.contactMatches.length,
      ).length,
      needsReview: items.filter((i) => i.needsReview).length,
    },
    note: "Counts are a review estimate. Each import rechecks current permissions and duplicates; unresolved items are skipped. Prospects sharing the same Apollo company identity can share one new Customer after confirmation.",
  };
}
export type BulkImportItem = ImportInput & {
  skip?: boolean;
  groupCompany?: boolean;
};
export async function bulkImport(db: Database, actor: Actor, items: unknown[]) {
  if (!items.length || items.length > 100)
    throw new CommercialError(400, "Review up to 100 prospects at a time.");
  const results: {
    providerId: string;
    status: string;
    message: string;
    createdCustomer?: boolean;
    createdContact?: boolean;
    createdLead?: boolean;
    customerId?: string;
    contactId?: string | null;
    leadId?: string | null;
    replayed?: boolean;
  }[] = [];
  const groups = new Map<string, string>();
  for (const raw of items) {
    const parsed = bulkImportItemInput.safeParse(raw);
    if (!parsed.success) {
      const providerId =
        raw && typeof raw === "object" && "providerId" in raw
          ? String(raw.providerId).slice(0, 100)
          : "invalid-item";
      results.push({
        providerId,
        status: "Failed",
        message:
          "Check this item's reviewed fields. Nothing was imported for this item.",
      });
      continue;
    }
    const { skip, groupCompany, ...c } = parsed.data;
    if (skip) {
      results.push({
        providerId: c.providerId,
        status: "Skipped",
        message: "Skipped in review",
      });
      continue;
    }
    try {
      const { stage, prospect } = await staged(
        db,
        actor,
        c.stageId,
        c.providerId,
      );
      const key = `${stage.company}:${stage.branch}:${prospect.companyId || prospect.id}`;
      if (groupCompany && groups.has(key) && !c.customerId)
        c.customerId = groups.get(key);
      const review = await importReview(db, actor, c.stageId, c.providerId);
      if (!c.customerId && review.customers.length && !c.createAnyway) {
        results.push({
          providerId: c.providerId,
          status: "Needs review",
          message: "Possible existing Customer; open individual review.",
        });
        continue;
      }
      const ids = await importProspect(db, actor, c);
      if (groupCompany) groups.set(key, ids.customerId);
      results.push({
        providerId: c.providerId,
        status: ids.replayed
          ? "Matched existing"
          : c.customerId
            ? "Matched existing"
            : "Created",
        ...ids,
        createdCustomer: !ids.replayed && !c.customerId,
        createdContact: !ids.replayed && !!ids.contactId && !c.contactId,
        createdLead: !ids.replayed && !!ids.leadId,
        message: ids.replayed
          ? "Previous import reused"
          : c.customerId
            ? "Linked to reviewed Customer"
            : "Reviewed Customer created",
      });
    } catch (e) {
      results.push({
        providerId: c.providerId,
        status:
          e instanceof CommercialError && e.status === 409
            ? "Needs review"
            : "Failed",
        message:
          e instanceof CommercialError
            ? e.message
            : "This item could not be imported. Review its fields and try again.",
      });
    }
  }
  return {
    results,
    counts: {
      created: results.filter((r) => r.status === "Created").length,
      matched: results.filter((r) => r.status === "Matched existing").length,
      skipped: results.filter((r) => r.status === "Skipped").length,
      needsReview: results.filter((r) => r.status === "Needs review").length,
      failed: results.filter((r) => r.status === "Failed").length,
      customers: results.filter((r) => r.createdCustomer).length,
      contacts: results.filter((r) => r.createdContact).length,
      leads: results.filter((r) => r.createdLead).length,
    },
  };
}
