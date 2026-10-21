import {
  type Actor,
  type Role,
  type Module,
  roleModules,
  canManageUsers,
  isFullAdmin,
} from "./domain";
export const leadership = [
  "MD",
  "MD Assistant",
  "Group Manager",
  "Branch Manager",
  "IT Administrator",
];
export function inAdminScope(
  actor: Actor,
  companies: string[],
  branches: string[],
) {
  return (
    companies.length > 0 &&
    companies.every((c) => actor.companies.includes(c)) &&
    (!actor.branches.length ||
      (branches.length > 0 &&
        branches.every((b) => actor.branches.includes(b))))
  );
}
/**
 * The branch scope a newly assigned role should carry.
 *
 * An MD is a group-level account, not a branch account. Scope checks compare a
 * target's branches against the actor's, and a group-wide account (`branches:
 * []`) sits inside no branch list at all — so giving a new MD a single branch
 * silently makes it a subordinate that cannot administer, or issue a reset
 * link for, the MD that created it. Mirroring the actor's own scope keeps two
 * MDs peers.
 *
 * IT now has the same administrative capabilities by explicit product policy;
 * new IT accounts inherit the administrator's branch scope like new MDs.
 * Company scopes and explicit read-only/disabled modules remain authoritative.
 */
export function branchesForRole(actor: Actor, role: string) {
  if (["MD", "MD Assistant", "IT Administrator"].includes(role)) return actor.branches;
  return actor.branches.length ? actor.branches : ["Main"];
}

export function mayAssign(
  actor: Actor,
  target: {
    id: string;
    role: string;
    companies: string[];
    branches: string[];
  } | null,
  requested: {
    role: Role;
    companies: string[];
    branches: string[];
    moduleAccess?: Actor["moduleAccess"];
  },
) {
  if (!canManageUsers(actor) || target?.id === actor.id) return false;
  if (
    target &&
    (!inAdminScope(actor, target.companies, target.branches) ||
      (!isFullAdmin(actor) && leadership.includes(target.role)))
  )
    return false;
  if (
    !inAdminScope(actor, requested.companies, requested.branches) ||
    (!isFullAdmin(actor) && leadership.includes(requested.role))
  )
    return false;
  return Object.entries(requested.moduleAccess || {}).every(
    ([m, level]) =>
      level === "none" || roleModules(requested.role).includes(m as Module),
  );
}
