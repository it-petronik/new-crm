import { allowedModules, type Actor, type Module } from "./domain";
const homes = {
  sales: {
    title: "Sales desk",
    description:
      "Move conversations forward, follow up and prepare the next quotation.",
    modules: ["leads", "quotations", "orders", "customers"],
  },
  accounts: {
    title: "Accounts desk",
    description:
      "Prepare customer proformas, review receivables and keep payment records clear.",
    modules: ["accounts", "orders", "customers", "approvals"],
  },
  logistics: {
    title: "Delivery desk",
    description:
      "Plan shipments, resolve delays and keep confirmed orders moving.",
    modules: ["logistics", "orders", "products"],
  },
  hr: {
    title: "People desk",
    description:
      "Support your people, review leave and keep employee records up to date.",
    modules: ["hr", "approvals"],
  },
  marketing: {
    title: "Marketing desk",
    description:
      "Plan content, review active campaigns and follow up on new interest.",
    modules: ["marketing", "leads"],
  },
  it: {
    title: "Support desk",
    description:
      "Resolve requests, keep access safe and review workspace activity.",
    modules: ["it", "settings", "activity"],
  },
  assistant: {
    title: "Management briefing",
    description:
      "Review company activity and pending decisions. Your access is read-only.",
    modules: ["orders", "leads", "accounts", "approvals"],
  },
  employee: {
    title: "Your workday",
    description: "Keep track of your requests and find the support you need.",
    modules: ["it", "hr"],
  },
} satisfies Record<
  string,
  { title: string; description: string; modules: Module[] }
>;
export function roleHome(actor: Actor) {
  const role = actor.role;
  const key =
    role === "MD Assistant"
      ? "assistant"
      : role.startsWith("Sales")
        ? "sales"
        : role.startsWith("Accounts") || role === "Accountant"
          ? "accounts"
          : role.startsWith("Logistics")
            ? "logistics"
            : role.startsWith("HR")
              ? "hr"
              : role.startsWith("Marketing")
                ? "marketing"
                : role === "IT Administrator"
                  ? "it"
                  : "employee";
  const home = homes[key];
  return {
    ...home,
    key,
    modules: home.modules.filter((m) =>
      allowedModules(actor).includes(m),
    ) as Module[],
  };
}

/** Short, role-specific onboarding, not another mandatory workflow. */
export function dailyRoutine(actor: Actor): string[] {
  const key = roleHome(actor).key;
  const steps: Record<string, string[]> = {
    sales: ["Open Sales pipeline for leads assigned to you or created by you.", "After each conversation, save one outcome in Update / feedback.", "Choose the next follow-up date. Add product and quantity when known."],
    marketing: ["Capture new interest as a lead and select the correct brand.", "Choose a salesperson when saving, or assign the lead from its row.", "Review feedback and the weekly report to see what progressed."],
    accounts: ["Review due payments and open customer documents.", "Prepare a customer proforma from an order or create one directly.", "Check the document and bank details before issuing. Record received payments separately."],
    logistics: ["Review today's shipments and delayed deliveries.", "Open a shipment to update its progress and transport details.", "Record the next delivery date so the team knows what happens next."],
    hr: ["Review pending leave and people records.", "Open a request to check its details before making a decision.", "Keep employee information current. Login access is managed separately."],
    assistant: ["Review the management briefing for your permitted brands.", "Open a record to check the source details.", "Use reports to prepare the management review. Your account is read-only."],
    employee: ["Open My requests to check your own requests.", "Request leave or create a support ticket when you need help.", "Check notifications for replies and decisions."],
    it: ["Review support tickets and access requests.", "Keep user roles and company access up to date.", "Use the activity log to review changes."],
  };
  return steps[key];
}
