/**
 * Fictional people for the Collaboration Hub suite. Seeded into a throwaway
 * local D1 (see scripts/collab-test-server.sh); never used anywhere else.
 *
 * Many interchangeable people rather than a few reused ones, so each test
 * owns its actors: no test's rate-limit counter, membership or deactivation
 * can leak into another.
 */

export const PASSWORD = "Collab-Test-Password-1";
export const WORKER = "http://localhost:8788";

export type TestPerson = {
  key: string;
  id: string;
  email: string;
  name: string;
  role: string;
  companies: string[];
  branches: string[];
};

const person = (key: string, name: string, companies: string[], branches: string[], role = "Sales Manager"): TestPerson => ({
  key,
  id: `collab-user-${key}`,
  email: `${key}@collab.test`,
  name,
  role,
  companies,
  branches,
});

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

export const people: TestPerson[] = [
  person("admin", "Collab Admin", ["Petronik", "Afrilube"], [], "MD"),
  // Petronik, group-wide.
  ...range(40).map((i) => person(`pg${i}`, `Petra Group${i}`, ["Petronik"], [])),
  // Petronik, Dubai branch.
  ...range(8).map((i) => person(`pd${i}`, `Dana Dubai${i}`, ["Petronik"], ["Dubai"])),
  // Petronik, Abu Dhabi branch.
  ...range(6).map((i) => person(`pa${i}`, `Amir Abudhabi${i}`, ["Petronik"], ["Abu Dhabi"])),
  // Afrilube, group-wide: another company entirely.
  ...range(8).map((i) => person(`af${i}`, `Femi Afrilube${i}`, ["Afrilube"], [])),
  // DM targets for the rate-limit test only, so exhausting the limit never
  // gives anyone else's test an unexpected conversation.
  ...range(32).map((i) => person(`rl${i}`, `Rana Limit${i}`, ["Petronik"], [])),
  // Collaboration V2 suites.
  ...range(30).map((i) => person(`v${i}`, `Vera Two${i}`, ["Petronik"], [])),
  ...range(4).map((i) => person(`vd${i}`, `Vic Dubai${i}`, ["Petronik"], ["Dubai"])),
  ...range(4).map((i) => person(`vf${i}`, `Val Afrilube${i}`, ["Afrilube"], [])),
  // V2 browser suites.
  ...range(16).map((i) => person(`w${i}`, `Wes Browser${i}`, ["Petronik"], [])),
  // Notifications: their own company (Petronex), so approvals, logistics
  // and accounts hand-offs raised by other suites never reach them.
  ...range(6).map((i) => person(`nm${i}`, `Nadia Manager${i}`, ["Petronex"], [], "Sales Manager")),
  ...range(10).map((i) => person(`ns${i}`, `Nour Sales${i}`, ["Petronex"], [], "Sales Executive")),
  person("nsd", "Nabil Dubai", ["Petronex"], ["Dubai"], "Sales Executive"),
  person("nsf", "Nia Afrilube", ["Afrilube"], [], "Sales Executive"),
  person("nlog", "Nils Logistics", ["Petronex"], [], "Logistics Manager"),
  person("nacc", "Nora Accounts", ["Petronex"], [], "Accounts Manager"),
  person("nacc2", "Nadim Accountant", ["Petronex"], [], "Accountant"),
  person("nhr", "Noah People", ["Petronex"], [], "HR Manager"),
  person("nemp", "Nina Employee", ["Petronex"], [], "Employee"),
  person("nit", "Ned Support", ["Petronex"], [], "IT Administrator"),
];

export const byKey = (key: string) => {
  const found = people.find((p) => p.key === key);
  if (!found) throw new Error(`No test person ${key}`);
  return found;
};

/** A seeded room with enough history to page through. */
export const PAGING_ROOM = {
  id: "collab-room-paging-000001",
  name: "Paging history",
  members: ["pg39", "pg40"],
  count: 95,
};
