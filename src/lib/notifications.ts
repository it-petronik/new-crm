import {
  canApprove,
  scopedWorkspace,
  type Actor,
  type RecordItem,
  type Workspace,
} from "./domain";
export type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  company: string;
  at: string;
  recordId: string;
  category: "action" | "activity";
};
export function workspaceNotifications(
  actor: Actor,
  data: Workspace,
): NotificationItem[] {
  data = scopedWorkspace(actor, data);
  const today = new Date().toISOString().slice(0, 10);
  const pending = data.records.flatMap((r) => {
    let title = "";
    if (r.status === "Pending Approval" && canApprove(actor, r))
      title = "Approval requested";
    else if (["Overdue", "Delayed"].includes(r.status))
      title = r.status === "Overdue" ? "Payment overdue" : "Shipment delayed";
    else if (
      r.kind === "leads" &&
      r.due <= today &&
      !["Won", "Lost", "On Hold"].includes(r.status)
    )
      title = "Follow-up due";
    else if (
      r.kind === "it" &&
      ["Open", "In Progress"].includes(r.status) &&
      r.due <= today
    )
      title = "Support ticket needs attention";
    if (!title) return [];
    return [
      {
        id: `record:${r.id}:${r.status}:${r.updatedAt}`,
        title,
        detail: r.title,
        company: r.company,
        at: r.updatedAt,
        recordId: r.id,
        category: "action" as const,
      },
    ];
  });
  return [
    ...pending,
    ...data.audit.map((a) => ({
      id: `audit:${a.id}`,
      title: a.action,
      detail: a.actor,
      company: a.company,
      at: a.at,
      recordId: a.recordId,
      category: "activity" as const,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}
