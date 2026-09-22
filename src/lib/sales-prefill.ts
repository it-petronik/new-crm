import { canRead, type Actor, type RecordItem } from "./domain";
export function quotationSources(
  records: RecordItem[],
  actor: Actor,
  company: string,
  branch: string,
  currency: string,
  unit: string,
) {
  const visible = records.filter(
    (r) => r.company === company && r.branch === branch && canRead(actor, r),
  );
  return {
    customers: visible.filter(
      (r) => r.kind === "customers" && r.status === "Active",
    ),
    products: visible.filter(
      (r) =>
        r.kind === "products" && r.currency === currency && r.unit === unit,
    ),
  };
}
