import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * A D1 binding over node:sqlite, for unit tests that exercise the real
 * Drizzle D1 driver against a database built from the real migrations.
 * (The same adapter as tests/collab-purge.test.ts.)
 */

type Value = string | number | null | bigint | Uint8Array;
const norm = (v: unknown): Value => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : (v as Value));

export function d1(db: DatabaseSync) {
  class Statement {
    constructor(
      private sql: string,
      private params: Value[] = [],
    ) {}
    bind(...params: unknown[]) {
      return new Statement(this.sql, params.map(norm));
    }
    async all() {
      return { results: db.prepare(this.sql).all(...this.params), success: true, meta: {} };
    }
    async first() {
      return (db.prepare(this.sql).all(...this.params)[0] as unknown) ?? null;
    }
    async run() {
      const r = db.prepare(this.sql).run(...this.params);
      return { success: true, meta: { changes: Number(r.changes) }, results: [] };
    }
    async raw() {
      const s = db.prepare(this.sql);
      s.setReturnArrays(true);
      return s.all(...this.params);
    }
  }
  return {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.all());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}


/** An in-memory database with every migration in drizzle/ applied, in order. */
export function migratedDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync("drizzle").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort())
    for (const statement of readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint"))
      if (statement.trim()) db.exec(statement);
  return db;
}
