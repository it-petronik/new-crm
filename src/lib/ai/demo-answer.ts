import {
  canRead,
  labels,
  type Actor,
  type RecordItem,
  type Module,
} from "../domain";
import { businessToday } from "../gst";
import type { AiResult } from "./client";
import {
  pageGuide,
  pageContextProblem,
  type AiPageContext,
} from "./page-context";

/** A labelled, local UI demonstration, never an AI/model response. */
export function demoAnswer(
  question: string,
  actor: Actor,
  records: RecordItem[],
  page?: AiPageContext,
): AiResult {
  const q = question.toLowerCase(),
    permitted = records.filter(
      (r) =>
        !r.deletedAt &&
        canRead(actor, r) &&
        (!page?.company || r.company === page.company),
    );
  if (page && pageContextProblem(actor, page))
    throw new Error("This page is outside your permitted workspace.");
  if (page?.recordId) {
    const current = permitted.find((r) => r.id === page.recordId);
    if (!current || pageContextProblem(actor, page, current))
      throw new Error("This record is not available to the page assistant.");
  }
  if (page && /explain|how|help|this page|what.*do next/i.test(question)) {
    const guide = pageGuide(page);
    return {
      feature: "ask",
      answer: {
        summary: `This is your ${guide.title}. ${guide.purpose}`,
        points: [],
        risks: [],
        nextActions: guide.steps.map((text) => ({ text, refs: [] })),
        draft: null,
        confidence: "high",
        missing: [],
      },
      suggestions: [],
      references: [],
      scope:
        "Local preview using the CRM’s built-in page guide. No screen image or model was used.",
      figures: [],
      flaggedText: 0,
      model: null,
      generatedAt: new Date().toISOString(),
      tool: "local_demo",
    };
  }
  const kind = /invoice|payment|receivable/.test(q)
    ? "accounts"
    : /quotation|quote/.test(q)
      ? "quotations"
      : /shipment|logistic/.test(q)
        ? "logistics"
        : /employee|hr/.test(q)
          ? "hr"
          : /supplier/.test(q)
            ? "suppliers"
            : /product/.test(q)
              ? "products"
              : /order/.test(q)
                ? "orders"
                : "leads";
  const matching = permitted.filter((r) => r.kind === kind),
    overdue = /overdue|follow.up|attention/.test(q);
  const rows = overdue
    ? matching.filter(
        (r) =>
          r.due &&
          r.due < businessToday() &&
          ![
            "Won",
            "Lost",
            "Paid",
            "Completed",
            "Cancelled",
            "Rejected",
          ].includes(r.status),
      )
    : matching;
  const byStatus = [...new Set(rows.map((r) => r.status))].map((status) => ({
    text: `${status}: ${rows.filter((r) => r.status === status).length}`,
    refs: [],
  }));
  return {
    feature: "ask",
    answer: {
      summary: overdue
        ? `${rows.length ? `You have ${rows.length} overdue ${kind === "leads" ? (rows.length === 1 ? "lead" : "leads") : "items"}. Start with the earliest follow-up and record the outcome after contacting each customer.` : "There are no overdue items in these demo records."}`
        : `There are ${rows.length} ${labels[kind as Module].toLowerCase()} records in this demo workspace. Here is their current status.`,
      points: byStatus.slice(0, 8),
      risks: [],
      nextActions: [],
      draft: null,
      confidence: "high",
      missing: [],
    },
    suggestions: [],
    references: rows.slice(0, 6).map((r, i) => ({
      id: `R${i + 1}`,
      label: `${labels[r.kind as Module]}: ${r.title}`,
      target: { type: "record", kind: r.kind, id: r.id },
    })),
    scope:
      "Local fictional preview only. This is a calculated UI example, not a live AI answer or a complete management report.",
    figures: [{ label: "Matching demo records", value: String(rows.length) }],
    flaggedText: 0,
    model: null,
    generatedAt: new Date().toISOString(),
    tool: "local_demo",
  };
}
