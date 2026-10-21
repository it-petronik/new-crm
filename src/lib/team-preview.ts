import { demoAccounts } from "./fixtures";
import type { Actor } from "./domain";

export const previewTeamKey = "enercore-team-preview-v1";
/** Fictional browser-only roster. Never used by authenticated APIs. */
export function previewPeople(actor: Actor): (Actor & { active: boolean })[] {
  let saved: (Actor & { active: boolean })[] = [];
  try {
    saved = JSON.parse(localStorage.getItem(previewTeamKey) || "[]");
  } catch {}
  const people = [
    ...demoAccounts.map((a) => ({ ...a.actor, active: true })),
    { ...actor, active: true },
    ...(Array.isArray(saved) ? saved : []),
  ];
  return [...new Map(people.map((p) => [p.id, p])).values()];
}
