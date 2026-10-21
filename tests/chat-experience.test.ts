import test from "node:test";
import assert from "node:assert/strict";
import { previewActor, makePreview } from "../src/lib/fixtures";
import {
  chatHistoryKey,
  readChatHistory,
  writeChatHistory,
  CHAT_LIMITS,
  type LocalChat,
} from "../src/lib/ai/chat-history";
import {
  aiPageSchema,
  pageContextProblem,
  pageGuide,
} from "../src/lib/ai/page-context";
import { demoAnswer } from "../src/lib/ai/demo-answer";
import { workspaceParams, workspaceUrl } from "../src/lib/workspace-url";

const now = Date.now();
const result = demoAnswer(
  "Which leads need attention?",
  previewActor,
  makePreview().records,
);
const chat: LocalChat = {
  id: "chat-1",
  title: "Follow-up help",
  updatedAt: now,
  turns: [{ id: "turn-1", question: "Which leads need attention?", result }],
};

test("chat history separates identities, role, exact grants, company and demo/live scopes", () => {
  const key = chatHistoryKey(previewActor, "All companies", true);
  for (const actor of [
    { ...previewActor, id: "someone-else" },
    { ...previewActor, role: "Sales Executive" as const },
    { ...previewActor, companies: ["Petronik"] },
    { ...previewActor, branches: ["New branch"] },
    { ...previewActor, moduleAccess: { accounts: "none" as const } },
  ])
    assert.notEqual(chatHistoryKey(actor, "All companies", true), key);
  assert.notEqual(chatHistoryKey(previewActor, "Petronik", true), key);
  assert.notEqual(chatHistoryKey(previewActor, "All companies", false), key);
  assert.equal(
    chatHistoryKey(
      { ...previewActor, companies: [...previewActor.companies].reverse() },
      "All companies",
      true,
    ),
    key,
  );
});
test("chat history bounds storage, rejects invalid data and expires after seven days", () => {
  assert.equal(readChatHistory(writeChatHistory([chat]), now).length, 1);
  assert.deepEqual(readChatHistory("invalid"), []);
  assert.deepEqual(readChatHistory("x".repeat(CHAT_LIMITS.bytes + 1)), []);
  assert.deepEqual(
    readChatHistory(
      writeChatHistory([{ ...chat, updatedAt: now - 8 * 86400000 }]),
      now,
    ),
    [],
  );
  assert.deepEqual(
    readChatHistory(
      writeChatHistory([{ ...chat, updatedAt: now + 120000 }]),
      now,
    ),
    [],
  );
  assert.equal(
    readChatHistory(
      writeChatHistory(
        Array.from({ length: 25 }, (_, i) => ({ ...chat, id: String(i) })),
      ),
      now,
    ).length,
    20,
  );
  const interrupted = {
    ...chat,
    turns: [{ id: "incomplete", question: "Hello there" }],
  };
  assert.match(
    readChatHistory(writeChatHistory([interrupted]), now)[0].turns[0].error!,
    /interrupted/,
  );
});
test("saved history redacts secrets, never restores mutation approvals and omits live CRM answers", () => {
  const question = "Please check api_key: example-secret";
  const raw = writeChatHistory([
    {
      ...chat,
      title: question,
      turns: [
        {
          ...chat.turns[0],
          question,
          result: { ...result, suggestions: [{ id: "test" } as never] },
        },
      ],
    },
  ]);
  assert.ok(!raw.includes("example-secret"));
  assert.deepEqual(
    readChatHistory(raw, now)[0].turns[0].result!.suggestions,
    [],
  );
  const live = readChatHistory(writeChatHistory([chat], false), now)[0]
    .turns[0];
  assert.equal(live.result, undefined);
  assert.match(live.error!, /refresh your permitted CRM data/);
});
test("page help accepts bounded pointers, never screenshots, DOM or unsaved fields", () => {
  const page = { module: "leads" as const, company: null };
  assert.ok(aiPageSchema.safeParse(page).success);
  for (const extra of [
    { screenshot: "image" },
    { html: "<main/>" },
    { fields: { phone: "123" } },
    { view: "unknown" },
  ])
    assert.equal(aiPageSchema.safeParse({ ...page, ...extra }).success, false);
  assert.match(pageGuide(page).title, /Lead Desk/);
  assert.equal(
    pageContextProblem(
      { ...previewActor, role: "Sales Executive" },
      { module: "hr", company: null },
    ),
    "This page is outside your permitted workspace.",
  );
  assert.ok(
    pageContextProblem(previewActor, {
      module: "leads",
      company: "Foreign brand",
    }),
  );
  const lead = makePreview().records.find((r) => r.kind === "leads")!;
  assert.equal(pageContextProblem(previewActor, page, lead), "");
  assert.ok(
    pageContextProblem(previewActor, page, {
      ...lead,
      deletedAt: new Date().toISOString(),
    }),
  );
  assert.ok(
    pageContextProblem(previewActor, { module: "orders", company: null }, lead),
  );
  assert.ok(
    pageContextProblem(
      previewActor,
      { module: "hr", company: null },
      { ...lead, kind: "hr" },
    ),
  );
  assert.throws(() =>
    demoAnswer("Explain this page", previewActor, [], {
      ...page,
      recordId: "not-permitted",
    }),
  );
  const answer = demoAnswer("Explain this page", previewActor, [], page);
  assert.equal(answer.model, null);
  assert.equal(answer.tool, "local_demo");
  assert.match(answer.answer.summary, /Lead Desk/);
});
test("Lead Desk is canonical and older sales-pipeline bookmarks remain supported", () => {
  assert.equal(
    workspaceUrl("leads", "Petronik"),
    "/workspace/petronik/lead-desk",
  );
  for (const path of ["lead-desk", "sales-pipeline"])
    assert.equal(
      workspaceParams(`/workspace/petronik/${path}`, "").get("module"),
      "leads",
    );
});
