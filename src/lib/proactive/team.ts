import type { Actor } from "../domain";

/** Roles that see a team scope (everyone else: their own work). */
export const hasTeamScope = (actor: Actor) => ["MD", "IT Administrator", "MD Assistant", "Group Manager", "Branch Manager", "Sales Manager", "Logistics Manager", "Accounts Manager", "HR Manager"].includes(actor.role);
