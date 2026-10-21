/** Prints fictional test SQL; no database connection. */
import { hashPassword } from "../src/lib/password";
import { roles } from "../src/lib/domain";
import { makePreview } from "../src/lib/fixtures";
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
async function main() {
  const hash = await hashPassword("Hr-Local-Test-Only-2026"),
    now = Date.now();
  const lines: string[] = [];
  for (const [i, role] of roles.entries())
    lines.push(
      `INSERT INTO User(id,email,name,passwordHash,role,companies,branches,moduleAccess,active,createdAt) VALUES('hr-local-${i}','hr${i}@example.test',${q(`Fictional ${role}`)},${q(hash)},${q(role)},'["Petronik"]','[]','{}',1,${now});`,
    );
  for (const [i, company, branch] of [
    [1, "Petronik", "Main"],
    [2, "Afrilube", "Main"],
    [3, "Petronik", "Other"],
  ] as const) {
    const r = {
      ...makePreview().records[0],
      id: `hr-employee-${i}`,
      kind: "hr",
      company,
      branch,
      title: `Fictional Employee ${i}`,
      status: "Active",
      due: "2026-01-01",
      ownerId: "hr-local-10",
      owner: "Fictional HR",
      attributes: { department: "Sales", basicSalary: "99999" },
    };
    lines.push(
      `INSERT INTO BusinessRecord(id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES(${q(r.id)},'hr',${q(company)},${q(branch)},'hr-local-10','Active',${q(JSON.stringify(r))},1,${now},${now});`,
    );
  }
  process.stdout.write(lines.join("\n") + "\n");
}
void main();
