import {
  allowedModules,
  canRead,
  isProforma,
  type Actor,
  type Kind,
  type Module,
  type RecordItem,
} from "./domain";
import { inAdminScope } from "./access-control";
import { isCashEntry } from "./cashbook";
import { businessToday, leadSummary, needsFeedback } from "./lead-desk";
import { toCsv } from "./export";

export type TeamPerson = Pick<
  Actor,
  "id" | "name" | "role" | "companies" | "branches"
> & { active: boolean };
export const managementScope = (actor: Actor) =>
  JSON.stringify([
    actor.id,
    actor.role,
    actor.companies,
    actor.branches,
    actor.moduleAccess,
  ]);
export const canViewManagement = (actor: Actor) =>
  ["MD", "MD Assistant", "IT Administrator"].includes(actor.role) &&
  allowedModules(actor).includes("overview");
export const departments = [
  {
    id: "sales",
    name: "Sales",
    module: "leads",
    kinds: ["leads", "quotations", "orders"],
    label: "Open sales work",
  },
  {
    id: "logistics",
    name: "Logistics",
    module: "logistics",
    kinds: ["logistics"],
    label: "Active shipments",
  },
  {
    id: "accounts",
    name: "Accounts",
    module: "accounts",
    kinds: ["accounts"],
    label: "Open finance work",
  },
  {
    id: "marketing",
    name: "Marketing",
    module: "marketing",
    kinds: ["marketing"],
    label: "Active campaigns",
  },
  {
    id: "hr",
    name: "People & HR",
    module: "hr",
    kinds: ["leave"],
    label: "Pending leave requests",
  },
  {
    id: "it",
    name: "IT & support",
    module: "it",
    kinds: ["it"],
    label: "Open support tickets",
  },
] as const;
export type DepartmentId = (typeof departments)[number]["id"];
export function employeeDepartment(
  role: string,
): DepartmentId | "management" | "other" {
  if (role.startsWith("Sales")) return "sales";
  if (role.startsWith("Logistics")) return "logistics";
  if (["Accounts Manager", "Accountant"].includes(role)) return "accounts";
  if (role.startsWith("Marketing")) return "marketing";
  if (role.startsWith("HR")) return "hr";
  if (role === "IT Administrator") return "it";
  return ["MD", "MD Assistant", "Group Manager", "Branch Manager"].includes(
    role,
  )
    ? "management"
    : "other";
}
const workKinds: Kind[] = [
  "leads",
  "quotations",
  "orders",
  "logistics",
  "accounts",
  "marketing",
  "leave",
  "it",
];
const closed = new Set([
  "Won",
  "Lost",
  "Accepted",
  "Rejected",
  "Expired",
  "Cancelled",
  "Completed",
  "Delivered",
  "Paid",
  "Resolved",
]);
export const completedWork = (r: RecordItem) =>
  ["Won", "Accepted", "Completed", "Delivered", "Paid", "Resolved"].includes(
    r.status,
  ) ||
  (r.kind === "leave" && ["Approved", "Rejected"].includes(r.status)) ||
  (isProforma(r) && r.status === "Issued");
export const openWork = (r: RecordItem) =>
  workKinds.includes(r.kind) &&
  !isCashEntry(r) &&
  !closed.has(r.status) &&
  !completedWork(r);
export const overdueWork = (r: RecordItem, today = businessToday()) =>
  openWork(r) &&
  (["Delayed", "Overdue"].includes(r.status) ||
    (/^\d{4}-\d{2}-\d{2}$/.test(r.due) && r.due < today));

/** A creation-cohort report, never an attendance, productivity rating or
 * completion-time report. Existing permissions are rechecked at this boundary.
 * Customer/prospect directory rows and HR profiles are not assigned tasks.
 * Owner IDs keep people with identical names separate. */
export function managementSnapshot(
  actor: Actor,
  input: RecordItem[],
  roster: TeamPerson[],
  options: {
    company?: string;
    from?: string;
    to?: string;
    today?: string;
  } = {},
) {
  if (!canViewManagement(actor))
    throw new Error("Management overview is not available for this role.");
  const {
    company = "All companies",
    from = "",
    to = "",
    today = businessToday(),
  } = options;
  const visible = input.filter(
    (r) =>
      !r.deletedAt &&
      canRead(actor, r) &&
      (company === "All companies" || r.company === company),
  );
  const records = visible.filter(
    (r) =>
      (!from || r.createdAt.slice(0, 10) >= from) &&
      (!to || r.createdAt.slice(0, 10) <= to),
  );
  const work = records.filter(
    (r) => workKinds.includes(r.kind) && !isCashEntry(r),
  );
  const people = roster.filter(
    (p) =>
      inAdminScope(actor, p.companies, p.branches) &&
      (company === "All companies" || p.companies.includes(company)),
  );
  const known = new Set(people.map((p) => p.id));
  const unmatched = new Map<string, RecordItem>();
  for (const r of work)
    if (r.ownerId && !known.has(r.ownerId)) unmatched.set(r.ownerId, r);
  const employees = [
    ...people.map((person) => ({ ...person, linked: true })),
    ...[...unmatched.values()].map((r) => ({
      id: r.ownerId,
      name: r.owner || "Unlinked owner",
      role: "Unlinked owner",
      companies: [r.company],
      branches: [r.branch],
      active: false,
      linked: false,
    })),
  ]
    .map((person) => {
      const assigned = work.filter((r) => r.ownerId === person.id);
      const leads = leadSummary(actor, assigned);
      return {
        ...person,
        department: employeeDepartment(person.role),
        records: assigned,
        open: assigned.filter(openWork).length,
        completed: assigned.filter(completedWork).length,
        overdue: assigned.filter((r) => overdueWork(r, today)).length,
        feedback: assigned.filter((r) => r.kind === "leads" && needsFeedback(r))
          .length,
        responseMinutes: leads.responseMinutes,
        responseSamples: leads.responseSamples,
        latestUpdate:
          assigned
            .map((r) => r.updatedAt)
            .sort()
            .at(-1) || "",
      };
    })
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        b.feedback - a.feedback ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  const allowed = allowedModules(actor);
  return {
    records,
    work,
    employees,
    departments: departments
      .filter((d) => allowed.includes(d.module as Module))
      .map((d) => {
        const rows = work.filter((r) =>
          (d.kinds as readonly string[]).includes(r.kind),
        );
        return {
          ...d,
          open: rows.filter(openWork).length,
          completed: rows.filter(completedWork).length,
          overdue: rows.filter((r) => overdueWork(r, today)).length,
          members: people.filter((p) => employeeDepartment(p.role) === d.id)
            .length,
          records: rows,
        };
      }),
    activeAccounts: people.filter((p) => p.active).length,
    headcount: visible.filter((r) => r.kind === "hr" && r.status === "Active")
      .length,
    overdue: work.filter((r) => overdueWork(r, today)).length,
    feedback: work.filter((r) => r.kind === "leads" && needsFeedback(r)).length,
    unassigned: work.filter((r) => !r.ownerId).length,
    completed: work.filter(completedWork).length,
  };
}

export function managementCsv(
  snapshot: ReturnType<typeof managementSnapshot>,
  options: {
    scope: string;
    from: string;
    to: string;
    asOf: string;
    filters?: [string, string][];
  },
) {
  return toCsv([
    [
      "Report",
      "Department and employee CRM work",
      "Brand",
      options.scope,
      "Created from",
      options.from || "All dates",
      "Created to",
      options.to || "All dates",
      "Checked",
      options.asOf,
    ],
    [
      "Basis",
      "Assigned CRM records created in this period; current statuses. Not attendance, productivity scores or work completed during this period. Latest record update may be made by another permitted user. Tasks and offline work are not included.",
    ],
    ...(options.filters || []),
    [],
    [
      "Department",
      "Open work",
      "Completed outcomes",
      "Overdue",
      "CRM accounts",
    ],
    ...snapshot.departments.map((d) => [
      d.name,
      d.open,
      d.completed,
      d.overdue,
      d.members,
    ]),
    [],
    [
      "Employee",
      "Account ID",
      "Role",
      "Account status",
      "Open work",
      "Completed outcomes",
      "Overdue",
      "Lead feedback pending",
      "Median first response (min)",
      "Response samples",
      "Latest record update",
    ],
    ...snapshot.employees.map((p) => [
      p.name,
      p.id,
      p.role,
      !p.linked
        ? "Unlinked owner"
        : p.active
          ? "Active account"
          : "Inactive account",
      p.open,
      p.completed,
      p.overdue,
      p.feedback,
      p.responseMinutes === null ? "Unknown" : Math.round(p.responseMinutes),
      p.responseSamples,
      p.latestUpdate || "No records",
    ]),
  ]);
}
