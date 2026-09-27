/**
 * Controlled automation — the FOUNDATION (not yet wired to live triggers).
 *
 * Rules are code-defined and typed: a trigger, conditions from a closed set,
 * and actions from a closed set. There is no user scripting, no eval, no
 * expressions, no SQL. Actions only notify, raise a signal or request a
 * human review — they never change business data by themselves, and no AI
 * decides anything here.
 */

export const TRIGGERS = ["RECORD_CREATED", "STATUS_CHANGED", "MEETING_ENDED", "FOLLOW_UP_DUE", "QUOTATION_EXPIRING", "PAYMENT_OVERDUE"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export type AutomationEvent = {
  trigger: Trigger;
  kind?: string;
  from?: string;
  to?: string;
  amount?: number;
  currency?: string;
  recordId?: string;
  ownerId?: string;
};

/** Conditions: a closed, typed set. */
export type Condition =
  | { type: "kind_is"; kind: string }
  | { type: "status_to"; status: string }
  | { type: "status_from"; status: string }
  | { type: "amount_at_least"; amount: number; currency: string };

/** Actions: a closed, typed set — none writes business data. */
export type AutomationAction =
  | { type: "CREATE_NOTIFICATION"; audience: "owner" | "approvers"; message: string }
  | { type: "CREATE_SIGNAL"; signal: string }
  | { type: "REQUEST_REVIEW"; reviewer: "owner" | "manager"; reason: string };

export type Rule = { id: string; trigger: Trigger; conditions: Condition[]; actions: AutomationAction[]; enabled: boolean };

const holds = (c: Condition, e: AutomationEvent) => {
  switch (c.type) {
    case "kind_is":
      return e.kind === c.kind;
    case "status_to":
      return e.to === c.status;
    case "status_from":
      return e.from === c.status;
    case "amount_at_least":
      // Same currency only — never converted.
      return e.currency === c.currency && (e.amount ?? 0) >= c.amount;
  }
};

/** The actions an event would plan under the given rules (pure; nothing is executed here). */
export function plan(rules: Rule[], event: AutomationEvent) {
  return rules.filter((r) => r.enabled && r.trigger === event.trigger && r.conditions.every((c) => holds(c, event))).flatMap((r) => r.actions.map((a) => ({ rule: r.id, action: a })));
}

/** Validates a rule's shape at load time — unknown triggers, conditions or actions are rejected. */
export function validRule(rule: unknown): rule is Rule {
  if (!rule || typeof rule !== "object") return false;
  const r = rule as Rule;
  const conditionTypes = ["kind_is", "status_to", "status_from", "amount_at_least"];
  const actionTypes = ["CREATE_NOTIFICATION", "CREATE_SIGNAL", "REQUEST_REVIEW"];
  return (
    typeof r.id === "string" &&
    (TRIGGERS as readonly string[]).includes(r.trigger) &&
    Array.isArray(r.conditions) &&
    r.conditions.every((c) => c && conditionTypes.includes((c as Condition).type)) &&
    Array.isArray(r.actions) &&
    r.actions.every((a) => a && actionTypes.includes((a as AutomationAction).type)) &&
    typeof r.enabled === "boolean"
  );
}

/** Built-in rules (examples of the model; disabled until wired deliberately). */
export const DEFAULT_RULES: Rule[] = [
  { id: "quotation-accepted-review", trigger: "STATUS_CHANGED", conditions: [{ type: "kind_is", kind: "quotations" }, { type: "status_to", status: "Accepted" }], actions: [{ type: "REQUEST_REVIEW", reviewer: "owner", reason: "Confirm the order and shipment details." }], enabled: false },
  { id: "payment-overdue-signal", trigger: "PAYMENT_OVERDUE", conditions: [], actions: [{ type: "CREATE_SIGNAL", signal: "PAYMENT_OVERDUE" }], enabled: false },
  { id: "meeting-ended-outcome", trigger: "MEETING_ENDED", conditions: [], actions: [{ type: "CREATE_SIGNAL", signal: "MEETING_ENDED_NO_OUTCOME" }], enabled: false },
];
