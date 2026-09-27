import type { RecordItem } from "../../src/lib/domain";
import { byKey } from "./people";

/**
 * Fictional CRM records for the Action Center suites (Phase 5), seeded into
 * the throwaway local D1. Company Petronex, branch "Sharjah": the people who
 * test it are limited to that branch, and no other suite reads Petronex
 * records by count, so every figure here is exact. Record titles carry
 * "Sharjah" so AI prompts can be traced.
 */

export const PX_COMPANY = "Petronex";
export const PX_BRANCH = "Sharjah";
const DAY = 86_400_000;

export function proactiveRecords(now = Date.now()): RecordItem[] {
  const iso = (days: number) => new Date(now + days * DAY).toISOString();
  const date = (days: number) => new Date(now + 4 * 3600_000 + days * DAY).toISOString().slice(0, 10);
  const who = (key: string) => ({ ownerId: byKey(key).id, owner: byKey(key).name });
  const base = (id: string, kind: RecordItem["kind"], title: string, owner: string, extra: Partial<RecordItem>): RecordItem => ({
    id, kind, company: PX_COMPANY, branch: PX_BRANCH, title,
    contact: "Test Contact", product: "Base Oil SN150", quantity: 20, unit: "MT", destination: "Jebel Ali",
    amount: 0, currency: "USD", status: "New", due: date(10), detail: "", source: "Test",
    createdAt: iso(-20), updatedAt: iso(-1), ...who(owner), ...extra,
  });
  return [
    // pxse1 — overdue follow-up (complete for its stage).
    base("PX-L1", "leads", "Sharjah Proactive Oils", "pxse1", { status: "Qualified", amount: 30000, due: date(-3) }),
    // pxse1 — Negotiation missing quantity and destination (not dismissible).
    base("PX-L2", "leads", "Sharjah Coral Blend", "pxse1", { status: "Negotiation", amount: 20000, quantity: 0, destination: "" }),
    // pxse1 — a new enquiry with no way to contact (advisory).
    base("PX-L3", "leads", "Sharjah Dune Additives", "pxse1", { status: "New", contact: "", email: "", phone: "" }),
    // pxse2 — someone else's overdue follow-up.
    base("PX-L4", "leads", "Sharjah Other Seller Lead", "pxse2", { status: "Qualified", amount: 15000, due: date(-1) }),
    // Waiting for approval for 3 days (pxse1's quotation).
    base("PX-Q1", "quotations", "Sharjah Quote Pending", "pxse1", { status: "Pending Approval", amount: 42000, due: date(20), updatedAt: iso(-3) }),
    // Operations: an order whose shipment is delayed.
    base("PX-O1", "orders", "Sharjah Order Alpha", "pxsm", { status: "Confirmed", amount: 42000, due: date(20) }),
    base("PX-S1", "logistics", "Sharjah Shipment Alpha", "pxsm", { status: "Delayed", parentId: "PX-O1", due: date(5) }),
    // Finance: an invoice 10 days overdue, $1,000 of $5,000 paid.
    base("PX-I1", "accounts", "Sharjah Invoice 1", "pxacc", {
      status: "Sent", amount: 5000, due: date(-10),
      payments: [{ id: "px-pay-1", amountCents: 100000, reference: "TT-1", at: iso(-5), actor: byKey("pxacc").name }],
    }),
    // Two customers that are the same company (legal suffix only).
    base("PX-C1", "customers", "Sharjah Gulf Star Trading LLC", "pxse1", { status: "Active" }),
    base("PX-C2", "customers", "Sharjah Gulf Star Trading", "pxse1", { status: "Active" }),
    // UI suite (pxui): one overdue follow-up, one incomplete Negotiation lead.
    base("PX-U1", "leads", "Sharjah Screen Follow", "pxui", { status: "Qualified", amount: 9000, due: date(-2) }),
    base("PX-U2", "leads", "Sharjah Screen Complete", "pxui", { status: "Negotiation", amount: 8000, destination: "" }),
  ];
}
