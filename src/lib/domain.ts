export const companies = [
  "Petronik",
  "Afrilube",
  "Petronex",
  "Istanegry",
] as const;
export const modules = [
  "overview",
  "leads",
  "quotations",
  "orders",
  "logistics",
  "accounts",
  "customers",
  "suppliers",
  "products",
  "hr",
  "marketing",
  "it",
  "approvals",
  "activity",
  "settings",
] as const;
export type Module = (typeof modules)[number];
export type Kind =
  Exclude<Module, "overview" | "approvals" | "activity" | "settings"> | "leave";
export const roles = [
  "MD",
  "MD Assistant",
  "Group Manager",
  "Branch Manager",
  "Sales Manager",
  "Sales Executive",
  "Logistics Manager",
  "Logistics Executive",
  "Accounts Manager",
  "Accountant",
  "HR Manager",
  "HR Executive",
  "Marketing Manager",
  "Marketing Executive",
  "IT Administrator",
  "Employee",
] as const;
export type Role = (typeof roles)[number];
export type Actor = {
  id: string;
  name: string;
  role: Role;
  companies: string[];
  branches: string[];
  email?: string;
  moduleAccess?: Partial<Record<Module, "none" | "read" | "write">>;
};
export type LineItem = {
  description: string;
  packaging?: string;
  quantity: number;
  unitPriceCents: number;
};
export type Payment = {
  id: string;
  amountCents: number;
  reference: string;
  at: string;
  actor: string;
};
export type Note = { id: string; text: string; at: string; actor: string };
export type RecordItem = {
  deletedAt?: string;
  id: string;
  kind: Kind;
  company: string;
  branch: string;
  title: string;
  contact: string;
  product: string;
  quantity: number;
  unit: string;
  amount: number;
  currency: string;
  status: string;
  ownerId: string;
  owner: string;
  due: string;
  detail: string;
  source: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  lines?: LineItem[];
  payments?: Payment[];
  notes?: Note[];
  email?: string;
  phone?: string;
  destination?: string;
  attributes?: Record<string, string>;
};
export type Audit = {
  id: string;
  actor: string;
  action: string;
  recordId: string;
  company: string;
  at: string;
  /** "account" for user administration; absent for business records. */
  subject?: "account" | null;
  /** Branch of the account concerned; null or absent means group-wide. */
  branch?: string | null;
};
export type Workspace = { records: RecordItem[]; audit: Audit[] };
export const stages: Record<Kind, string[]> = {
  leads: [
    "New",
    "Contacted",
    "Qualified",
    "Quote Sent",
    "Negotiation",
    "Won",
    "Lost",
    "On Hold",
  ],
  quotations: [
    "Draft",
    "Pending Approval",
    "Approved",
    "Sent",
    "Accepted",
    "Rejected",
    "Expired",
  ],
  orders: ["Confirmed", "In Progress", "Completed", "Cancelled"],
  logistics: [
    "Pending Planning",
    "Documents Pending",
    "Ready to Dispatch",
    "In Transit",
    "Delivered",
    "Delayed",
    "Cancelled",
  ],
  accounts: ["Draft", "Sent", "Partially Paid", "Paid", "Overdue", "Cancelled"],
  customers: ["Active", "Credit Hold", "Inactive"],
  suppliers: ["Active", "On Hold", "Inactive"],
  products: ["Available", "Low Stock", "On Request"],
  hr: ["Active", "On Leave", "Offboarding", "Inactive"],
  marketing: ["Planned", "Active", "Completed"],
  it: ["Open", "In Progress", "Resolved"],
  leave: ["Pending Approval", "Approved", "Rejected"],
};
export const labels: Record<Module, string> = {
  overview: "Overview",
  leads: "Sales pipeline",
  quotations: "Quotations",
  orders: "Sales orders",
  logistics: "Logistics",
  accounts: "Accounts",
  customers: "Customers",
  suppliers: "Suppliers",
  products: "Products",
  hr: "People & HR",
  marketing: "Marketing",
  it: "IT & support",
  approvals: "Approvals",
  activity: "Activity log",
  settings: "Workspace settings",
};
const grants: Partial<Record<Role, Module[]>> = {
  "Sales Manager": [
    "overview",
    "leads",
    "quotations",
    "orders",
    "customers",
    "products",
    "logistics",
    "approvals",
  ],
  "Sales Executive": [
    "overview",
    "leads",
    "quotations",
    "orders",
    "customers",
    "products",
    "logistics",
  ],
  "Logistics Manager": ["overview", "logistics", "orders", "products"],
  "Logistics Executive": ["overview", "logistics", "orders", "products"],
  "Accounts Manager": [
    "overview",
    "accounts",
    "orders",
    "customers",
    "approvals",
  ],
  Accountant: ["overview", "accounts", "orders", "customers"],
  "HR Manager": ["overview", "hr", "approvals"],
  "HR Executive": ["overview", "hr"],
  "Marketing Manager": ["overview", "marketing", "leads"],
  "Marketing Executive": ["overview", "marketing", "leads"],
  "IT Administrator": ["overview", "it", "settings", "activity"],
  Employee: ["overview", "hr", "it"],
};
export function allowedModules(actor: Actor): Module[] {
  return roleModules(actor.role).filter(
    (m) => actor.moduleAccess?.[m] !== "none",
  );
}
export function roleModules(role: Role): Module[] {
  return grants[role] || [...modules];
}
export function canManageUsers(actor: Actor) {
  return (
    ["MD", "IT Administrator"].includes(actor.role) &&
    allowedModules(actor).includes("settings") &&
    actor.moduleAccess?.settings !== "read"
  );
}
export function canRead(actor: Actor, r: RecordItem): boolean {
  if (!actor.companies.includes(r.company)) return false;
  if (actor.branches.length && !actor.branches.includes(r.branch)) return false;
  const module = r.kind === "leave" ? "hr" : r.kind;
  if (!allowedModules(actor).includes(module)) return false;
  if (r.kind === "leave" || r.kind === "hr")
    return (
      ["MD", "HR Manager", "HR Executive"].includes(actor.role) ||
      r.ownerId === actor.id
    );
  if (
    ["Sales Executive", "Logistics Executive", "Employee"].includes(
      actor.role,
    ) &&
    !["products", "customers"].includes(r.kind)
  )
    return r.ownerId === actor.id;
  return true;
}
export function canWrite(actor: Actor, r: RecordItem): boolean {
  if (r.deletedAt) return false;
  if (actor.moduleAccess?.[r.kind === "leave" ? "hr" : r.kind] === "read")
    return false;
  if (!canRead(actor, r) || actor.role === "MD Assistant") return false;
  if (["MD", "Group Manager", "Branch Manager"].includes(actor.role))
    return (
      !["hr", "leave"].includes(r.kind) ||
      r.ownerId === actor.id ||
      actor.role === "MD"
    );
  if (r.kind === "leave")
    return (
      r.ownerId === actor.id ||
      ["HR Manager", "HR Executive"].includes(actor.role)
    );
  if (actor.role.startsWith("Sales"))
    return ["leads", "quotations", "customers"].includes(r.kind);
  if (actor.role.startsWith("Logistics")) return r.kind === "logistics";
  if (["Accounts Manager", "Accountant"].includes(actor.role))
    return r.kind === "accounts";
  if (actor.role.startsWith("HR")) return r.kind === "hr";
  if (actor.role.startsWith("Marketing"))
    return ["marketing", "leads"].includes(r.kind);
  if (actor.role === "IT Administrator") return r.kind === "it";
  return actor.role === "Employee" && r.kind === "it" && r.ownerId === actor.id;
}
export function canApprove(actor: Actor, r: RecordItem) {
  return (
    allowedModules(actor).includes("approvals") &&
    actor.moduleAccess?.approvals !== "read" &&
    actor.moduleAccess?.[r.kind === "leave" ? "hr" : r.kind] !== "read" &&
    canRead(actor, r) &&
    r.ownerId !== actor.id &&
    (actor.role === "MD" ||
      (r.kind === "leave"
        ? actor.role === "HR Manager"
        : ["Group Manager", "Branch Manager", "Sales Manager"].includes(
            actor.role,
          )))
  );
}
/**
 * Local calendar date. toISOString() reports the UTC day, which shifted every
 * dashboard range by one day for anyone east or west of UTC.
 */
export const localISO = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** First day of a window of `days` ending today, counted on the local calendar. */
export function windowStart(days: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return localISO(start);
}
export const money = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
export function totalCents(
  lines: { quantity: number; unitPriceCents: number }[],
) {
  return lines.reduce(
    (sum, line) => sum + Math.round(line.quantity * line.unitPriceCents),
    0,
  );
}
export function outstanding(r: RecordItem) {
  if (r.status === "Paid") return 0;
  return (
    Math.max(
      0,
      Math.round(r.amount * 100) -
        (r.payments || []).reduce((s, p) => s + p.amountCents, 0),
    ) / 100
  );
}
/**
 * Whether an actor may see one user-administration event.
 *
 * Account events name people and what was done to their accounts, so they are
 * shown only to the roles that administer users — never to a Group Manager or
 * Branch Manager, who see record history but have no business seeing account
 * changes.
 *
 * Scope mirrors `inAdminScope` rather than the looser company-only rule used
 * for record events. The event carries the account's company and branch, so a
 * branch-scoped administrator sees only accounts inside their branch, and a
 * group-wide account (branch null) is visible only to a group-wide
 * administrator — exactly as it is for issuing a reset link.
 *
 * Known limitation, deliberate: an event records the target's *primary*
 * company, so an event about someone in companies A and B is visible to an
 * administrator of A only. Widening that needs the account's current
 * membership at read time, which is a larger change.
 */
export function canSeeAccountEvent(actor: Actor, event: Audit) {
  // Self-contained rather than relying on the caller to have checked: a row
  // without this marker is a business-record event and must go through the
  // record rules, which are stricter for anyone who is not an administrator.
  if (event.subject !== "account") return false;
  if (!canManageUsers(actor)) return false;
  if (!actor.companies.includes(event.company)) return false;
  if (!actor.branches.length) return true;
  return !!event.branch && actor.branches.includes(event.branch);
}

export function scopedWorkspace(actor: Actor, workspace: Workspace): Workspace {
  const maySeeRecordHistory = [
    "MD",
    "Group Manager",
    "Branch Manager",
    "IT Administrator",
  ].includes(actor.role);
  return {
    records: workspace.records.filter((r) => !r.deletedAt && canRead(actor, r)),
    audit: workspace.audit.filter((a) =>
      // Rows written before `subject` existed are business-record events and
      // keep exactly their previous visibility.
      a.subject === "account"
        ? canSeeAccountEvent(actor, a)
        : maySeeRecordHistory &&
          actor.companies.includes(a.company) &&
          workspace.records.some((r) => r.id === a.recordId && canRead(actor, r)),
    ),
  };
}
