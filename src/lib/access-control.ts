import {
  type Actor,
  type Role,
  type Module,
  roleModules,
  canManageUsers,
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
      (actor.role !== "MD" && leadership.includes(target.role)))
  )
    return false;
  if (
    !inAdminScope(actor, requested.companies, requested.branches) ||
    (actor.role !== "MD" && leadership.includes(requested.role))
  )
    return false;
  return Object.entries(requested.moduleAccess || {}).every(
    ([m, level]) =>
      level === "none" || roleModules(requested.role).includes(m as Module),
  );
}
