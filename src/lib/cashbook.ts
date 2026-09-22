import type { RecordItem } from "./domain";
export function isCashEntry(r: Pick<RecordItem, "kind" | "attributes">) {
  return r.kind === "accounts" && ["Income", "Expense"].includes(r.attributes?.entryType || "");
}
export function cashTotals(records: RecordItem[], currency: string) {
  const entries = records.filter(r => isCashEntry(r) && !r.deletedAt && r.status !== "Cancelled" && r.currency === currency);
  const sum = (type: string) => entries.filter(r => r.attributes?.entryType === type).reduce((total, r) => total + Math.round(r.amount * 100), 0) / 100;
  const income = sum("Income"), expense = sum("Expense");
  return { income, expense, net: income - expense };
}
export function cashEntryError(r: Pick<RecordItem, "kind" | "attributes" | "amount" | "parentId" | "lines" | "payments">) {
  if (!isCashEntry(r)) return "Select Income or Expense.";
  if (!Number.isFinite(r.amount) || r.amount <= 0 || Math.abs(r.amount * 100 - Math.round(r.amount * 100)) > 0.00001) return "Enter a positive amount with no more than two decimal places.";
  if (r.parentId || r.lines?.length || r.payments?.length) return "Manual entries cannot contain invoice links, items or payments.";
  if (!r.attributes?.category || !r.attributes?.paymentMethod) return "Select a category and payment method.";
  return "";
}
