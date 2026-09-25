import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { purgeAttachments } from "../src/realtime/files";

/**
 * The retention purge, against a real SQLite database built from the real
 * migrations (0000–0004), through the real Drizzle D1 driver — only the D1
 * binding itself is replaced by this small adapter over node:sqlite, and R2
 * by a fake that can be told to fail for one object.
 */

type Value = string | number | null | bigint | Uint8Array;
const norm = (v: unknown): Value => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : (v as Value));

function d1(db: DatabaseSync) {
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

function freshDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync("drizzle").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort())
    for (const statement of readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint"))
      if (statement.trim()) db.exec(statement);
  const now = Date.now();
  db.exec(`INSERT INTO "User" VALUES ('u-owner-0001','o@x.test','Owner','h','Sales Manager','["Petronik"]','[]','{}',1,${now})`);
  db.exec(`INSERT INTO "Conversation" ("id","kind","name","visibility","company","createdBy","createdAt","updatedAt")
           VALUES ('c-room-0001','room','Room','private','Petronik','u-owner-0001',${now},${now})`);
  db.exec(`INSERT INTO "Message" ("id","conversationId","authorId","body","createdAt") VALUES ('m-live-00001','c-room-0001','u-owner-0001','hi',${now})`);
  db.exec(`INSERT INTO "Message" ("id","conversationId","authorId","body","createdAt","deletedAt") VALUES ('m-gone-00001','c-room-0001','u-owner-0001','',${now},${now})`);
  return db;
}

const DAY = 86_400_000;
function attach(db: DatabaseSync, id: string, opts: { messageId?: string | null; createdAgo: number; deletedAgo?: number; thumb?: boolean }) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO "Attachment" ("id","conversationId","messageId","uploaderId","storageKey","thumbKey","originalName","mimeType","kind","size","createdAt","deletedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    "c-room-0001",
    opts.messageId ?? null,
    "u-owner-0001",
    `att/${id}`,
    opts.thumb ? `att/${id}.thumb` : null,
    `${id}.png`,
    "image/png",
    "image",
    10,
    now - opts.createdAgo,
    opts.deletedAgo === undefined ? null : now - opts.deletedAgo,
  );
}

function fakeBucket(failKey?: string) {
  const deleted: string[] = [];
  return {
    deleted,
    put: async () => ({}),
    get: async () => null,
    delete: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      if (failKey && list.includes(failKey)) throw new Error("R2 unavailable");
      deleted.push(...list);
    },
  };
}

const ids = (db: DatabaseSync) =>
  (db.prepare(`SELECT "id" FROM "Attachment" ORDER BY "id"`).all() as { id: string }[]).map((r) => r.id);

test("purge selects only stale pending uploads and long-deleted files", async () => {
  const db = freshDatabase();
  attach(db, "a-pending-old", { messageId: null, createdAgo: DAY + 60_000, thumb: true }); // purge
  attach(db, "a-pending-new", { messageId: null, createdAgo: DAY - 60_000 }); //            keep: still within a day
  attach(db, "a-live-sent", { messageId: "m-live-00001", createdAgo: 400 * DAY }); //      keep: active, however old
  attach(db, "a-deleted-old", { messageId: "m-gone-00001", createdAgo: 40 * DAY, deletedAgo: 31 * DAY }); // purge
  attach(db, "a-deleted-new", { messageId: "m-gone-00001", createdAgo: 40 * DAY, deletedAgo: 29 * DAY }); // keep: recovery window
  attach(db, "a-discarded-new", { messageId: null, createdAgo: 60_000, deletedAgo: 30_000 }); //  keep until a day old

  const bucket = fakeBucket();
  const purged = await purgeAttachments({ DB: d1(db) as never, COLLAB_FILES: bucket as never, APP_MODE: "production" });
  assert.equal(purged, 2);
  assert.deepEqual(ids(db), ["a-deleted-new", "a-discarded-new", "a-live-sent", "a-pending-new"]);
  assert.deepEqual(bucket.deleted.sort(), ["att/a-deleted-old", "att/a-pending-old", "att/a-pending-old.thumb"].sort());

  // Idempotent: a second run finds nothing more to do.
  assert.equal(await purgeAttachments({ DB: d1(db) as never, COLLAB_FILES: bucket as never, APP_MODE: "production" }), 0);
  assert.equal(bucket.deleted.length, 3);
});

test("one failing R2 delete leaves that row for the next run and no other harm", async () => {
  const db = freshDatabase();
  attach(db, "a-one", { messageId: null, createdAgo: 2 * DAY });
  attach(db, "a-two", { messageId: null, createdAgo: 2 * DAY });
  attach(db, "a-three", { messageId: null, createdAgo: 2 * DAY });
  const flaky = fakeBucket("att/a-two");
  const purged = await purgeAttachments({ DB: d1(db) as never, COLLAB_FILES: flaky as never, APP_MODE: "production" });
  assert.equal(purged, 2);
  assert.deepEqual(ids(db), ["a-two"], "only the object that failed keeps its row");
  // Next run, storage healthy again: it is cleaned up.
  assert.equal(await purgeAttachments({ DB: d1(db) as never, COLLAB_FILES: fakeBucket() as never, APP_MODE: "production" }), 1);
  assert.deepEqual(ids(db), []);
});

test("purge never runs in preview or without storage", async () => {
  const db = freshDatabase();
  attach(db, "a-old", { messageId: null, createdAgo: 2 * DAY });
  assert.equal(await purgeAttachments({ DB: d1(db) as never, COLLAB_FILES: fakeBucket() as never, APP_MODE: "preview" }), 0);
  assert.equal(await purgeAttachments({ DB: d1(db) as never, APP_MODE: "production" }), 0);
  assert.deepEqual(ids(db), ["a-old"]);
});
