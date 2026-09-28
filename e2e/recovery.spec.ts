import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";

let rehearsal: ChildProcess | undefined;
test.afterEach(() => {
  // A timed-out test must stop its own Python/Wrangler process tree too.
  if (!rehearsal?.pid) return;
  try {
    if (process.platform === "win32") rehearsal.kill("SIGTERM");
    else process.kill(-rehearsal.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
});

test("Phase 6 recovers exactly in isolated D1; interruption fails closed and a fresh target works", async () => {
  // Four isolated bindings under one unique local directory; never production.
  const work = await mkdtemp(resolve("work/recovery-e2e-"));
  await new Promise<void>((ok, fail) => {
    const child = spawn("python3", ["tests/recovery_rehearsal.py", "--work", work], {
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe"],
    });
    rehearsal = child;
    let error = "";
    child.stderr.on("data", (data) => { error = (error + String(data)).slice(-4096); });
    child.on("error", fail);
    child.on("close", (code) => {
      rehearsal = undefined;
      if (code === 0) ok();
      else fail(new Error(`Local recovery rehearsal failed (${code}): ${error}`));
    });
  });
  const result = JSON.parse(await readFile(resolve(work, "rehearsal-result.json"), "utf8"));
  expect(result).toMatchObject({ status: "passed", exactAllTableRows: true, exactSchema: true, foreignKeyViolations: 0, integrityCheck: "ok", nonemptyTargetRefused: true, freshReplacementValidated: true, remoteOperations: 0 });
  expect(result.interruptedRestoreExitCode).not.toBe(0);
  for (const table of ["BusinessRecord", "Contact", "Deal", "SupplierProductCapability", "AuditEvent", "Meeting", "MeetingNote", "MeetingReport", "AiUsage", "d1_migrations"]) expect(result.tables[table].rows).toBeGreaterThan(0);
});
