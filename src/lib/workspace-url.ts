const pages: Record<string, string> = {
  prospecting: "prospecting",
  overview: "overview",
  leads: "lead-desk",
  quotations: "quotations",
  orders: "sales-orders",
  logistics: "logistics",
  accounts: "accounts",
  customers: "customers",
  suppliers: "suppliers",
  products: "products",
  hr: "people-hr",
  marketing: "marketing",
  it: "it-support",
  approvals: "approvals",
  activity: "activity",
  settings: "settings",
  access: "access-control",
  profile: "profile",
  appearance: "appearance",
  notifications: "notifications",
  shortcuts: "shortcuts",
  collaboration: "collaboration",
  ai: "enercore-ai",
  actions: "action-center",
  tasks: "tasks",
  "my-requests": "my-requests",
};
const companies: Record<string, string> = {
  "All companies": "all-companies",
  Petronik: "petronik",
  Afrilube: "afrilube",
  Petronex: "petronex",
  Istanegry: "istanergy",
};
pages.mail = "email";
pages.operations = "operations";
pages.catalogs = "option-catalogs";
companies.Enercore = "enercore";
export function workspaceUrl(page: string, company: string) {
  return `/workspace/${companies[company] || "all-companies"}/${pages[page] || "overview"}`;
}
export function workspaceParams(path: string, search: string) {
  const params = new URLSearchParams(search);
  const parts = path.split("/");
  if (parts[1] === "workspace") {
    params.set(
      "company",
      Object.keys(companies).find((k) => companies[k] === parts[2]) ||
        "All companies",
    );
    const page =
      parts[3] === "sales-pipeline"
        ? "leads"
        : Object.keys(pages).find((k) => pages[k] === parts[3]) || "overview";
    params.set(
      [
        "mail",
        "prospecting",
        "access",
        "profile",
        "appearance",
        "notifications",
        "shortcuts",
        "collaboration",
        "ai",
        "actions",
        "tasks",
        "operations",
        "catalogs",
      ].includes(page)
        ? "view"
        : "module",
      page,
    );
  }
  return params;
}
