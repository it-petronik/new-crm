import { canWrite, type Actor, type Kind, type RecordItem } from "./domain";

export const quickKinds = ["leads", "customers", "suppliers", "products"] as const;

/** Presentation follows the same record-level check as the actual create flow.
 * A readable module is not permission to create something in that module. */
export function quickCreateKinds(actor: Actor, company = actor.companies[0], branch = actor.branches[0] || "Main"): Kind[] {
  return quickKinds.filter(kind => canWrite(actor, { kind, company, branch, ownerId: actor.id } as RecordItem));
}

export type WorkspaceView =
  "mail" | "prospecting" | "collaboration" | "ai" | "actions" | "tasks" | "operations" | "notifications" | "profile" | "appearance" | "access" | "shortcuts" | "catalogs";
export const viewLabels: Record<WorkspaceView, string> = {
  catalogs: "Option Catalogs", mail: "Email", prospecting: "Prospecting",
  collaboration: "Collaboration", ai: "Enercore AI", actions: "Action Center",
  tasks: "Tasks", operations: "Operations", notifications: "Notifications",
  profile: "My profile", appearance: "Appearance", access: "Access control", shortcuts: "Shortcuts",
};
