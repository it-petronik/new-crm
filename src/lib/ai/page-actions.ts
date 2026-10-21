import {
  allowedModules,
  canRead,
  type Actor,
  type Module,
  type RecordItem,
} from "../domain";
export type PageAiAction = { label: string; question: string };
/** Suggestions only; no data collection, model calls or writes happen here. */
export function pageAiActions(
  actor: Actor,
  module: Module,
  record?: RecordItem,
): PageAiAction[] {
  const allowed = allowedModules(actor);
  if (!allowed.includes(module)) return [];
  const actions: PageAiAction[] = [];
  const add = (kind: Module, label: string, question: string) => {
    if (allowed.includes(kind)) actions.push({ label, question });
  };
  if (["overview", "settings", "activity", "approvals"].includes(module)) {
    add("leads", "Prioritise follow-ups", "Which leads need attention now?");
    add(
      "accounts",
      "Review unpaid invoices",
      "How much is overdue from customers?",
    );
    add(
      "quotations",
      "Review quotations",
      "Which quotations are waiting for a response?",
    );
  } else if (module === "leads") {
    add("leads", "Prioritise follow-ups", "Which follow-ups are overdue?");
    add("leads", "Review pipeline", "How is our pipeline looking?");
  } else {
    const names: Partial<Record<Module, string>> = {
      quotations: "quotations",
      orders: "orders",
      logistics: "shipments",
      accounts: "accounts records",
      customers: "customers",
      suppliers: "suppliers",
      products: "products",
      hr: "employee records",
      marketing: "marketing records",
      it: "support tickets",
    };
    if (names[module])
      add(
        module,
        "Review status",
        `How many ${names[module]} are in each status?`,
      );
    if (module === "accounts")
      add(
        "accounts",
        "Review overdue payments",
        "How much is overdue from customers?",
      );
    if (module === "quotations")
      add(
        "quotations",
        "Check waiting quotations",
        "Which quotations are waiting for a response?",
      );
    if (
      (module === "products" || module === "suppliers") &&
      record &&
      canRead(actor, record)
    )
      add(
        "leads",
        "Find related opportunities",
        `Find leads for ${record.product || record.title}`,
      );
  }
  return actions.slice(0, 3);
}
