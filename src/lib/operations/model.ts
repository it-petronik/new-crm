import { z } from "zod";
import { allowedModules, type Actor, type Module } from "../domain";

export class OperationsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const management = (a: Actor) =>
  ["MD", "Group Manager", "Branch Manager"].includes(a.role);
const moduleAccess = (a: Actor, m: Module, write = false) =>
  allowedModules(a).includes(m) &&
  (!write || a.moduleAccess?.[m] !== "read") &&
  (!write || a.role !== "MD Assistant");
export function operationsAccess(a: Actor) {
  const buying =
    management(a) &&
    ["orders", "suppliers", "products"].every((m) =>
      moduleAccess(a, m as Module),
    );
  const finance =
    (management(a) || ["Accounts Manager", "Accountant"].includes(a.role)) &&
    moduleAccess(a, "accounts");
  const stock =
    (management(a) || a.role === "Logistics Manager") &&
    ["orders", "products", "logistics"].every((m) =>
      moduleAccess(a, m as Module),
    );
  return {
    view: buying || finance || stock,
    costs: buying || finance,
    purchase:
      buying &&
      ["orders", "suppliers", "products"].every((m) =>
        moduleAccess(a, m as Module, true),
      ),
    stock: stock && moduleAccess(a, "logistics", true),
    finance: finance && moduleAccess(a, "accounts", true),
  };
}
export const inOperationsScope = (
  a: Actor,
  s: { company: string; branch: string },
) =>
  a.companies.includes(s.company) &&
  (!a.branches.length || a.branches.includes(s.branch));
const id = z.string().trim().min(1).max(100);
const qty = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,6})(\.\d{1,6})?$/,
    "Use a positive quantity with up to 6 decimals.",
  );
const amount = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,10})(\.\d{1,2})?$/,
    "Use a positive amount with at most 2 decimals.",
  );
const notes = z.string().trim().max(2000).default("");
const reference = z.string().trim().min(1).max(100);
const date = z.iso.date();
export const purchaseInput = z
  .object({
    orderId: id,
    supplierId: id,
    productId: id,
    warehouse: z.string().trim().min(1).max(100),
    quantity: qty,
    price: amount,
    currency: z.enum(["USD", "AED", "EUR", "GBP", "INR", "SAR", "CNY", "SGD"]),
    unit: z.enum(["MT", "KG", "L", "DRUM", "IBC", "UNIT"]),
    expectedDate: date,
    notes,
  })
  .strict();
export const operationCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("purchase"),
      requestId: id,
      values: purchaseInput,
    })
    .strict(),
  z
    .object({
      action: z.literal("status"),
      id,
      version: z.number().int().positive(),
      status: z.enum(["Approved", "Closed", "Cancelled"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("movement"),
      requestId: id,
      purchaseId: id,
      kind: z.enum(["Receipt", "Dispatch"]),
      quantity: qty,
      shipmentId: id.nullable().default(null),
      reference,
      date,
      notes,
    })
    .strict(),
  z
    .object({
      action: z.literal("reverse"),
      requestId: id,
      movementId: id,
      reference,
      date,
      notes,
    })
    .strict(),
  z
    .object({
      action: z.literal("invoice"),
      requestId: id,
      purchaseId: id,
      reference,
      amount,
      date,
      dueDate: date,
      notes,
    })
    .strict(),
  z
    .object({
      action: z.literal("payment"),
      requestId: id,
      invoiceId: id,
      amount,
      reference,
      date,
      notes,
    })
    .strict(),
]);
export function fixedNumber(value: string, decimals: number, maximum: number) {
  const [whole, fraction = ""] = value.split(".");
  if (
    !/^\d+$/.test(whole) ||
    !/^\d*$/.test(fraction) ||
    fraction.length > decimals
  )
    throw new OperationsError(400, "Check the number of decimal places.");
  const scaled =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  if (scaled <= 0n || scaled > BigInt(maximum))
    throw new OperationsError(
      400,
      "Enter a positive value within the supported range.",
    );
  return Number(scaled);
}
export function extendedCents(quantity: number, price: number) {
  const total = (BigInt(quantity) * BigInt(price) + 500000n) / 1000000n;
  if (total <= 0n || total > 1000000000000000n)
    throw new OperationsError(
      400,
      "Purchase total is outside the supported range.",
    );
  return Number(total);
}
export const quantityText = (value: number) =>
  (value / 1000000).toLocaleString("en-US", { maximumFractionDigits: 6 });
export const amountText = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
