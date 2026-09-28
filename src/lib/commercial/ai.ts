import { addExecutionContext } from "../execution/context";
import { eq } from "drizzle-orm";
import type { Database } from "../d1";
import type { Actor, RecordItem } from "../domain";
import { contacts, deals, businessRecords } from "../schema";
import type { AiContext } from "../ai/context";
import { readRecords, commercialView } from "./store";
import { leadContext, describe } from "../ai/tools/crm";

/** Resolve each linked child independently before it can enter model context. */
export async function addIdentityContext(
  db: Database,
  actor: Actor,
  lead: RecordItem,
  ctx: AiContext,
) {
  ctx.fact(
    "Customer relationship",
    lead.customerId
      ? "Stable recorded customer link"
      : "LEGACY — customer name is a snapshot, not confirmed identity",
  );
  if (lead.customerId) {
    const customer = (
      await readRecords(db, actor, eq(businessRecords.id, lead.customerId), 1)
    )[0];
    if (customer) {
      const ref = describe(ctx, customer, "authoritative customerId");
      if (lead.contactId) {
        const contact = await db
          .select()
          .from(contacts)
          .where(eq(contacts.id, lead.contactId))
          .get();
        if (contact?.parentId === customer.id) {
          ctx.fact("Linked contact", contact.details.name, ref);
          ctx.fact("Contact version", contact.version, ref);
        }
      }
    }
  }
  const room = await db
    .select()
    .from(deals)
    .where(eq(deals.leadId, lead.id))
    .get();
  if (room) {ctx.fact("Deal Room", room.id); await addExecutionContext(db,actor,room.id,ctx);}
}
export async function dealContext(db: Database, actor: Actor, id: string) {
  const view = await commercialView(db, actor, id, true);
  const bundle = await leadContext(db, actor, view.root.id);
  bundle.context.fact("Deal", view.deal!.id);
  bundle.context.fact(
    "Requirement source",
    "Reviewed Lead fields; meeting/AI statements remain proposals until employee review.",
  );
  for (const cap of view.capabilities) {
    const ref = bundle.context.ref(`Supplier capability: ${cap.supplier}`, {
      type: "record",
      kind: "suppliers",
      id: cap.supplierId,
    });
    bundle.context.record(ref, {
      supplier: cap.supplier,
      product: cap.product,
      grade: cap.grade,
      origin: cap.originCountry,
      version: cap.version,
      meaning:
        "Potential supplier from manually recorded capability only. Availability, stock, current price and terms unknown.",
    });
    if (cap.notes) bundle.context.text("capability_note", cap.notes, ref);
  }
  return {
    context: bundle.context,
    instructions:
      "Brief this deal using sections: Current situation, Requirement, Recent developments, Commercial gaps, Risks, Next best action. Use only supplied authorized Enercore activity. Capability does not establish availability, price, stock, terms or selection. No linking, supplier selection or record creation suggestions. Never interpret a requested/preferred term as accepted. Do not compute financial values. Cite sources.",
  };
}
