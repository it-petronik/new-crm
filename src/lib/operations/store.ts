import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../d1";
import { auditEvents, businessRecords } from "../schema";
import { canRead, type Actor, type Kind, type RecordItem } from "../domain";
import {
  purchases,
  movements,
  invoices,
  payments,
  type Purchase,
} from "./tables";
import {
  extendedCents,
  fixedNumber,
  inOperationsScope,
  operationCommand,
  operationsAccess,
  OperationsError,
} from "./model";

const missing = () =>
  new OperationsError(404, "This operations record isn't available to you.");
async function chunks<T, R>(
  ids: T[],
  read: (slice: T[]) => Promise<R[]>,
): Promise<R[]> {
  const result: R[] = [];
  for (let i = 0; i < ids.length; i += 80)
    result.push(...(await read(ids.slice(i, i + 80))));
  return result;
}
async function record(db: Database, a: Actor, id: string, kind?: Kind) {
  const row = await db
    .select({ payload: businessRecords.payload })
    .from(businessRecords)
    .where(eq(businessRecords.id, id))
    .get();
  const r = row?.payload as RecordItem | undefined;
  if (!r || r.deletedAt || (kind && r.kind !== kind) || !canRead(a, r))
    throw missing();
  return r;
}
async function purchase(db: Database, a: Actor, id: string) {
  if (!operationsAccess(a).view)
    throw new OperationsError(403, "Your role cannot use operations.");
  const p = await db.select().from(purchases).where(eq(purchases.id, id)).get();
  if (!p || !inOperationsScope(a, p)) throw missing();
  await record(db, a, p.orderId, "orders");
  return p;
}
const operationId = async (a: Actor, request: string, action: string) => {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${a.id}:${action}:${request}`),
  );
  return `${action.toUpperCase()}-${Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)}`;
};
const audit = (
  db: Database,
  a: Actor,
  p: Purchase,
  id: string,
  action: string,
  now: number,
) =>
  db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    company: p.company,
    branch: p.branch,
    actor: a.name,
    actorId: a.id,
    subject: "operations",
    recordId: id,
    action,
    before: null,
    after: { purchaseId: p.id },
    at: new Date(now),
  });
function permitted(value: boolean) {
  if (!value)
    throw new OperationsError(
      403,
      "Your role cannot perform this operations action.",
    );
}

export async function operationsView(db: Database, a: Actor, company?: string) {
  const access = operationsAccess(a);
  permitted(access.view);
  if (!a.companies.length)
    return {
      access,
      purchases: [],
      movements: [],
      invoices: [],
      payments: [],
      history: [],
      truncated: false,
    };
  const rows = await db
    .select()
    .from(purchases)
    .where(
      and(
        inArray(purchases.company, a.companies),
        company && company !== "All companies"
          ? eq(purchases.company, company)
          : undefined,
        a.branches.length ? inArray(purchases.branch, a.branches) : undefined,
      ),
    )
    .orderBy(desc(purchases.createdAt))
    .limit(81)
    .all();
  const related = await chunks(
    [
      ...new Set(
        rows
          .slice(0, 80)
          .flatMap((p) => [p.orderId, p.supplierId, p.productId]),
      ),
    ],
    (ids) =>
      db
        .select({ id: businessRecords.id, payload: businessRecords.payload })
        .from(businessRecords)
        .where(inArray(businessRecords.id, ids))
        .all(),
  );
  const readable = new Map<string, RecordItem>();
  for (const row of related) {
    const record = row.payload as RecordItem;
    if (!record.deletedAt && canRead(a, record)) readable.set(row.id, record);
  }
  const visible = rows
    .slice(0, 80)
    .filter((p) => readable.get(p.orderId)?.kind === "orders");
  const ids = visible.map((p) => p.id);
  if (!ids.length)
    return {
      access,
      purchases: [],
      movements: [],
      invoices: [],
      payments: [],
      history: [],
      truncated: rows.length > 80,
    };
  // Independent bounded queries; a visible PO never reveals an inaccessible
  // CRM child. Costs never leave the server for the logistics-only view.
  const moves = await db
    .select()
    .from(movements)
    .where(inArray(movements.purchaseId, ids))
    .orderBy(desc(movements.createdAt))
    .limit(501)
    .all();
  const bills = access.costs
    ? await db
        .select()
        .from(invoices)
        .where(inArray(invoices.purchaseId, ids))
        .orderBy(desc(invoices.createdAt))
        .limit(501)
        .all()
    : [];
  const paid = (
    await chunks(
      bills.slice(0, 500).map((i) => i.id),
      (ids) =>
        db
          .select()
          .from(payments)
          .where(inArray(payments.invoiceId, ids))
          .orderBy(desc(payments.createdAt))
          .limit(501)
          .all(),
    )
  ).sort((a, b) => b.createdAt - a.createdAt);
  const totals = await db
    .select({
      purchaseId: movements.purchaseId,
      balance: sql<number>`sum(${movements.quantity})`,
      received: sql<number>`sum(CASE WHEN ${movements.kind} IN ('Receipt','Receipt reversal') THEN ${movements.quantity} ELSE 0 END)`,
    })
    .from(movements)
    .where(inArray(movements.purchaseId, ids))
    .groupBy(movements.purchaseId)
    .all();
  const billTotals = access.costs
    ? await db
        .select({
          purchaseId: invoices.purchaseId,
          total: sql<number>`sum(${invoices.amountCents})`,
        })
        .from(invoices)
        .where(inArray(invoices.purchaseId, ids))
        .groupBy(invoices.purchaseId)
        .all()
    : [];
  const payTotals = await chunks(
    bills.slice(0, 500).map((i) => i.id),
    (ids) =>
      db
        .select({
          invoiceId: payments.invoiceId,
          total: sql<number>`sum(${payments.amountCents})`,
        })
        .from(payments)
        .where(inArray(payments.invoiceId, ids))
        .groupBy(payments.invoiceId)
        .all(),
  );
  const shown = visible.map((p) => {
    const names: Record<string, string> = {};
    for (const key of ["orderId", "supplierId", "productId"] as const) {
      names[key] = readable.get(p[key])?.title ?? "Restricted record";
    }
    const { priceCents, totalCents, ...safe } = p;
    const sum = totals.find((t) => t.purchaseId === p.id);
    return {
      ...safe,
      names,
      balance: Number(sum?.balance ?? 0),
      received: Number(sum?.received ?? 0),
      ...(access.costs
        ? {
            priceCents,
            totalCents,
            invoicedCents: Number(
              billTotals.find((t) => t.purchaseId === p.id)?.total ?? 0,
            ),
          }
        : {}),
    };
  });
  const shipmentRows = await chunks(
    [
      ...new Set(
        moves
          .slice(0, 500)
          .map((m) => m.shipmentId)
          .filter((id): id is string => !!id),
      ),
    ],
    (ids) =>
      db
        .select({ id: businessRecords.id, payload: businessRecords.payload })
        .from(businessRecords)
        .where(inArray(businessRecords.id, ids))
        .all(),
  );
  const shipmentById = new Map(
    shipmentRows.map((r) => [r.id, r.payload as RecordItem] as const),
  );
  const safeMoves = [];
  for (const m of moves.slice(0, 500)) {
    let shipment: { id: string; title: string } | null = null;
    if (m.shipmentId) {
      const s = shipmentById.get(m.shipmentId);
      if (s && !s.deletedAt && s.kind === "logistics" && canRead(a, s)) {
        shipment = { id: s.id, title: s.title };
      }
    }
    const { shipmentId, ...safe } = m;
    safeMoves.push({
      ...safe,
      shipment,
      restrictedShipment: !!shipmentId && !shipment,
    });
  }
  const history = await db
    .select({
      id: auditEvents.id,
      recordId: auditEvents.recordId,
      action: auditEvents.action,
      actor: auditEvents.actor,
      at: auditEvents.at,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.subject, "operations"),
        sql`json_extract(${auditEvents.after},'$.purchaseId') IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`,`,
        )})`,
      ),
    )
    .orderBy(desc(auditEvents.at))
    .limit(100)
    .all();
  return {
    access,
    purchases: shown,
    movements: safeMoves,
    invoices: bills.slice(0, 500).map((i) => ({
      ...i,
      paidCents: Number(
        payTotals.find((t) => t.invoiceId === i.id)?.total ?? 0,
      ),
    })),
    payments: paid.slice(0, 500),
    history,
    truncated:
      rows.length > 80 ||
      moves.length > 500 ||
      bills.length > 500 ||
      paid.length > 500,
  };
}
export type OperationsView = Awaited<ReturnType<typeof operationsView>>;

export async function operationsCommand(db: Database, a: Actor, raw: unknown) {
  const c = operationCommand.parse(raw),
    access = operationsAccess(a),
    now = Date.now();
  permitted(access.view);
  if (c.action === "purchase") {
    permitted(access.purchase);
    const v = c.values;
    const order = await record(db, a, v.orderId, "orders"),
      supplier = await record(db, a, v.supplierId, "suppliers"),
      product = await record(db, a, v.productId, "products");
    if (!["Confirmed", "In Progress", "Completed"].includes(order.status))
      throw new OperationsError(400, "Choose a confirmed sales order.");
    if (
      [supplier, product].some(
        (r) =>
          r.company !== order.company ||
          r.branch !== order.branch ||
          ["Inactive", "Archived"].includes(r.status),
      )
    )
      throw new OperationsError(
        400,
        "Supplier, product and order must be active and in the same company and branch.",
      );
    if (order.productId && order.productId !== product.id)
      throw new OperationsError(
        400,
        "Choose the product linked to the sales order.",
      );
    for (const r of [order, product])
      if (
        ["MT", "KG", "L", "DRUM", "IBC", "UNIT"].includes(
          r.unit.toUpperCase(),
        ) &&
        r.unit.toUpperCase() !== v.unit
      )
        throw new OperationsError(
          400,
          "The unit must match the order and product. No automatic unit conversion is applied.",
        );
    const id = await operationId(a, c.requestId, c.action);
    const existing = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, id))
      .get();
    if (existing) {
      await purchase(db, a, id);
      replay(existing, {
        orderId: v.orderId,
        supplierId: v.supplierId,
        productId: v.productId,
        warehouse: v.warehouse,
        quantity: fixedNumber(v.quantity, 6, 1000000000000),
        priceCents: fixedNumber(v.price, 2, 1000000000),
        currency: v.currency,
        unit: v.unit,
        expectedDate: v.expectedDate,
        notes: v.notes,
      });
      return { id, duplicate: true };
    }
    const quantity = fixedNumber(v.quantity, 6, 1000000000000),
      priceCents = fixedNumber(v.price, 2, 1000000000);
    const p: Purchase = {
      id,
      company: order.company,
      branch: order.branch,
      orderId: order.id,
      supplierId: supplier.id,
      productId: product.id,
      warehouse: v.warehouse,
      unit: v.unit,
      quantity,
      priceCents,
      totalCents: extendedCents(quantity, priceCents),
      currency: v.currency,
      status: "Draft",
      expectedDate: v.expectedDate,
      notes: v.notes,
      createdBy: a.id,
      approvedBy: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await db.batch([
      db.insert(purchases).values(p),
      audit(db, a, p, id, "Created purchase order", now),
    ]);
    return { id };
  }
  if (c.action === "status") {
    permitted(access.purchase);
    const p = await purchase(db, a, c.id);
    if (p.version !== c.version)
      throw new OperationsError(
        409,
        "Someone changed this purchase order. Refresh and review it.",
      );
    if (c.status === "Approved" && p.createdBy === a.id)
      throw new OperationsError(
        403,
        "A different authorized manager must approve this purchase order.",
      );
    // Trigger enforces the version increment and all legal transitions. The
    // mutation must fail, rather than silently update zero rows, under races.
    await db.batch([
      db
        .update(purchases)
        .set({
          status: c.status,
          approvedBy: c.status === "Approved" ? a.id : p.approvedBy,
          version: c.version + 1,
          updatedAt: now,
        })
        .where(eq(purchases.id, p.id)),
      audit(db, a, p, p.id, `${c.status} purchase order`, now),
    ]);
    return { id: p.id };
  }
  let p: Purchase;
  if (c.action === "reverse") {
    permitted(access.stock);
    const original = await db
      .select()
      .from(movements)
      .where(eq(movements.id, c.movementId))
      .get();
    if (!original) throw missing();
    p = await purchase(db, a, original.purchaseId);
    await record(db, a, p.productId, "products");
    if (original.shipmentId)
      await record(db, a, original.shipmentId, "logistics");
    const id = await operationId(a, c.requestId, c.action);
    const existing = await db
      .select()
      .from(movements)
      .where(eq(movements.id, id))
      .get();
    if (existing) {
      replay(existing, {
        reversalOf: original.id,
        reference: c.reference,
        date: c.date,
        notes: c.notes,
      });
      return { id, duplicate: true };
    }
    if (original.reversalOf)
      throw new OperationsError(
        400,
        "A reversal cannot itself be reversed. Record a new corrected receipt or dispatch.",
      );
    await db.batch([
      db.insert(movements).values({
        id,
        purchaseId: p.id,
        kind:
          original.kind === "Receipt"
            ? "Receipt reversal"
            : "Dispatch reversal",
        quantity: -original.quantity,
        shipmentId: original.shipmentId,
        reversalOf: original.id,
        reference: c.reference,
        date: c.date,
        notes: c.notes,
        createdBy: a.id,
        createdAt: now,
      }),
      audit(db, a, p, id, `Reversed ${original.kind.toLowerCase()}`, now),
    ]);
    return { id };
  }
  if (c.action === "payment") {
    permitted(access.finance);
    const bill = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, c.invoiceId))
      .get();
    if (!bill) throw missing();
    p = await purchase(db, a, bill.purchaseId);
    if (c.date < bill.date)
      throw new OperationsError(
        400,
        "Payment date cannot precede the invoice date.",
      );
    const id = await operationId(a, c.requestId, c.action);
    const existing = await db
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .get();
    if (existing) {
      replay(existing, {
        invoiceId: bill.id,
        amountCents: fixedNumber(c.amount, 2, 1000000000000000),
        reference: c.reference,
        date: c.date,
        notes: c.notes,
      });
      return { id, duplicate: true };
    }
    await db.batch([
      db.insert(payments).values({
        id,
        invoiceId: bill.id,
        amountCents: fixedNumber(c.amount, 2, 1000000000000000),
        reference: c.reference,
        date: c.date,
        notes: c.notes,
        createdBy: a.id,
        createdAt: now,
      }),
      audit(db, a, p, id, "Recorded supplier payment", now),
    ]);
    return { id };
  }
  p = await purchase(db, a, c.purchaseId);
  const id = await operationId(a, c.requestId, c.action);
  if (c.action === "movement") {
    permitted(access.stock);
    await record(db, a, p.productId, "products");
    if (c.kind === "Dispatch") {
      if (!c.shipmentId)
        throw new OperationsError(400, "Choose a shipment for this dispatch.");
      const shipment = await record(db, a, c.shipmentId, "logistics");
      if (
        shipment.parentId !== p.orderId ||
        ["Cancelled", "Delivered"].includes(shipment.status)
      )
        throw new OperationsError(
          400,
          "Choose an active shipment linked to this purchase order's sales order.",
        );
    }
    const existing = await db
      .select()
      .from(movements)
      .where(eq(movements.id, id))
      .get();
    if (existing) {
      replay(existing, {
        purchaseId: p.id,
        kind: c.kind,
        quantity:
          fixedNumber(c.quantity, 6, 1000000000000) *
          (c.kind === "Dispatch" ? -1 : 1),
        shipmentId: c.shipmentId,
        reference: c.reference,
        date: c.date,
        notes: c.notes,
      });
      return { id, duplicate: true };
    }
    await db.batch([
      db.insert(movements).values({
        id,
        purchaseId: p.id,
        kind: c.kind,
        quantity:
          fixedNumber(c.quantity, 6, 1000000000000) *
          (c.kind === "Dispatch" ? -1 : 1),
        shipmentId: c.shipmentId,
        reversalOf: null,
        reference: c.reference,
        date: c.date,
        notes: c.notes,
        createdBy: a.id,
        createdAt: now,
      }),
      audit(db, a, p, id, `Recorded ${c.kind.toLowerCase()}`, now),
    ]);
  } else {
    permitted(access.finance);
    if (c.dueDate < c.date)
      throw new OperationsError(
        400,
        "Invoice due date cannot precede its issue date.",
      );
    const existing = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .get();
    if (existing) {
      replay(existing, {
        purchaseId: p.id,
        amountCents: fixedNumber(c.amount, 2, 1000000000000000),
        reference: c.reference,
        date: c.date,
        dueDate: c.dueDate,
        notes: c.notes,
      });
      return { id, duplicate: true };
    }
    await db.batch([
      db.insert(invoices).values({
        id,
        purchaseId: p.id,
        company: p.company,
        supplierId: p.supplierId,
        reference: c.reference,
        normalized: c.reference
          .normalize("NFKC")
          .toLowerCase()
          .replace(/\s+/g, " "),
        amountCents: fixedNumber(c.amount, 2, 1000000000000000),
        date: c.date,
        dueDate: c.dueDate,
        notes: c.notes,
        createdBy: a.id,
        createdAt: now,
      }),
      audit(db, a, p, id, "Recorded supplier invoice", now),
    ]);
  }
  return { id };
}

function replay(existing: object, expected: Record<string, unknown>) {
  if (
    Object.entries(expected).some(
      ([key, value]) => (existing as Record<string, unknown>)[key] !== value,
    )
  )
    throw new OperationsError(
      409,
      "This request was already saved with different details. Review its existing entry before creating another.",
    );
}

export function operationsFailure(error: unknown): OperationsError {
  if (error instanceof OperationsError) return error;
  const messages: string[] = [];
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    messages.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  const message = messages.join(" ");
  for (const [key, text] of Object.entries({
    operations_stock: "Not enough stock. Refresh the balance and try again.",
    operations_receipt_limit:
      "Receipt exceeds the remaining purchase quantity, or a reversal would invalidate receipts.",
    operations_invoice_limit:
      "Invoice exceeds the remaining purchase value, or the purchase is not approved.",
    operations_payment_limit: "Payment exceeds the remaining invoice balance.",
    operations_scope:
      "Linked records must belong to the same company and branch.",
    operations_approval:
      "A different authorized manager must approve this purchase order.",
    operations_stale:
      "Someone changed this purchase order. Refresh and review it.",
    operations_transition: "This status change is not allowed.",
    operations_history:
      "This purchase has a ledger history and cannot be cancelled.",
    operations_reversal: "This movement cannot be reversed.",
    operations_not_approved:
      "Approve the purchase order before recording receipts or dispatches.",
  }))
    if (message.includes(key)) return new OperationsError(409, text);
  if (/UNIQUE/.test(message))
    return new OperationsError(
      409,
      "This reference or request already exists. Refresh before trying again.",
    );
  return new OperationsError(
    500,
    "The operation could not be saved. Refresh and try again.",
  );
}
