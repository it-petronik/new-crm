import { canRead, type Actor, type RecordItem } from "./domain";
export type Ranking = { name: string; value: number; count: number };
export function dashboardInsights(
  actor: Actor,
  input: RecordItem[],
  currency: string,
  days = 0,
  now = new Date(),
) {
  const records = input.filter(
    (r) =>
      canRead(actor, r) &&
      r.currency === currency &&
      (!days || Date.parse(r.createdAt) >= now.getTime() - days * 86400000),
  );
  const orders = records.filter(
    (r) =>
      r.kind === "orders" &&
      ["Confirmed", "In Progress", "Completed"].includes(r.status),
  );
  const leads = records.filter((r) => r.kind === "leads");
  const open = leads.filter(
    (r) => !["Won", "Lost", "On Hold"].includes(r.status),
  );
  const lost = leads.filter((r) => r.status === "Lost");
  const products = new Map<string, Ranking>();
  const people = new Map<string, Ranking>();
  const demand = new Map<string, Ranking>();
  const countries = new Map<
    string,
    {
      name: string;
      value: number;
      count: number;
      products: Map<string, Ranking>;
    }
  >();
  for (const order of orders) {
    const seen = new Set<string>();
    const countryName = order.attributes?.country?.trim().replace(/\s+/g, " ");
    const countryKey = countryName?.toLocaleLowerCase();
    const country = countryKey
      ? countries.get(countryKey) || {
          name: countryName!,
          value: 0,
          count: 0,
          products: new Map<string, Ranking>(),
        }
      : null;
    if (country && countryKey) {
      country.value += order.amount;
      country.count++;
      countries.set(countryKey, country);
    }
    const lines = order.lines?.length
      ? order.lines.map((l) => ({
          name: l.description.trim() || "Unspecified product",
          value: Math.round(l.quantity * l.unitPriceCents) / 100,
        }))
      : [
          {
            name: order.product.trim() || "Unspecified product",
            value: order.amount,
          },
        ];
    for (const line of lines) {
      const key = line.name.toLowerCase();
      const item = products.get(key) || { name: line.name, value: 0, count: 0 };
      item.value += line.value;
      if (!seen.has(key)) item.count++;
      seen.add(key);
      products.set(key, item);
      if (country && line.name !== "Unspecified product") {
        const p = country.products.get(key) || {
          name: line.name,
          value: 0,
          count: 0,
        };
        p.value += line.value;
        country.products.set(key, p);
      }
    }
    const person = people.get(order.ownerId) || {
      name: order.owner || "Unassigned",
      value: 0,
      count: 0,
    };
    person.value += order.amount;
    person.count++;
    people.set(order.ownerId, person);
  }
  for (const lead of open) {
    if (!lead.product.trim()) continue;
    const name = lead.product.trim() || "Unspecified product",
      key = name.toLowerCase();
    const item = demand.get(key) || { name, value: 0, count: 0 };
    item.count++;
    item.value += lead.amount;
    demand.set(key, item);
  }
  const byValue = (a: Ranking, b: Ranking) =>
    b.value - a.value || a.name.localeCompare(b.name);
  const sold = [...products.values()]
    .filter((p) => p.name !== "Unspecified product")
    .sort(byValue);
  const closed = leads.filter((r) => ["Won", "Lost"].includes(r.status));
  return {
    countries: [...countries.values()]
      .map((c) => ({ ...c, products: [...c.products.values()].sort(byValue) }))
      .sort(byValue),
    missingCountry: orders.filter((r) => !r.attributes?.country?.trim()).length,
    missingDemand: open.filter((r) => !r.product.trim()).length,
    unclassifiedSales: products.get("unspecified product")?.value || 0,
    orders: [...orders].sort((a, b) => b.amount - a.amount),
    sold,
    lowest: [...sold].sort(
      (a, b) => a.value - b.value || a.name.localeCompare(b.name),
    ),
    people: [...people.values()].sort(byValue),
    demand: [...demand.values()].sort(
      (a, b) => b.count - a.count || byValue(a, b),
    ),
    orderValue: orders.reduce((sum, r) => sum + r.amount, 0),
    lostCount: lost.length,
    lostValue: lost.reduce((sum, r) => sum + r.amount, 0),
    winRate: closed.length
      ? Math.round(
          (100 * closed.filter((r) => r.status === "Won").length) /
            closed.length,
        )
      : null,
    cancelled: records.filter(
      (r) => r.kind === "orders" && r.status === "Cancelled",
    ).length,
  };
}
