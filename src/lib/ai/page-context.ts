import { z } from "zod";
import {
  allowedModules,
  canRead,
  modules,
  labels,
  type Actor,
  type RecordItem,
} from "../domain";
import { moduleHelp, viewHelp } from "../workspace-help";

/** Page pointers, never screenshots, DOM, form values, contacts or uploads. */
export const aiPageSchema = z
  .object({
    module: z.enum(modules),
    company: z.string().max(40).nullable(),
    recordId: z.string().min(1).max(100).optional(),
    view: z
      .enum([
        "prospecting",
        "mail",
        "collaboration",
        "tasks",
        "actions",
        "operations",
        "catalogs",
        "profile",
        "appearance",
        "notifications",
        "shortcuts",
        "access",
      ])
      .optional(),
  })
  .strict();
export type AiPageContext = z.infer<typeof aiPageSchema>;
export function pageContextProblem(
  actor: Actor,
  page: AiPageContext,
  record?: RecordItem,
) {
  if (record && (record.deletedAt || !canRead(actor, record)))
    return "This record is not available in your current workspace.";
  if (
    !allowedModules(actor).includes(page.module) ||
    (page.company && !actor.companies.includes(page.company))
  )
    return "This page is outside your permitted workspace.";
  if (record && (record.kind === "hr" || record.kind === "leave"))
    return "Private HR records are not shared with the page assistant.";
  if (
    record &&
    (record.kind !== page.module ||
      (page.company && record.company !== page.company))
  )
    return "The selected record does not belong to this page.";
  return "";
}
export function pageGuide(page: AiPageContext) {
  if (page.view) {
    const titles: Record<string, string> = {
      mail: "Email",
      prospecting: "Prospecting",
      collaboration: "Collaboration",
      tasks: "Tasks",
      actions: "Action Center",
      operations: "Operations",
      catalogs: "Option catalogs",
      profile: "My profile",
      appearance: "Appearance",
      notifications: "Notifications",
      shortcuts: "Shortcuts",
      access: "Access control",
    };
    return {
      title: titles[page.view],
      purpose:
        viewHelp[page.view] ||
        "Use the controls available to your role on this page. Permissions are managed by your administrator.",
      steps: [
        "Review the information shown on this page.",
        "Open the item you need and check its details.",
        "Use the actions available to your role; review before saving.",
      ],
    };
  }
  return { title: labels[page.module], ...moduleHelp[page.module] };
}
