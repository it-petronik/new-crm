import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { checkOrigin, currentActor } from "@/lib/auth";
import { getDb, isPreview } from "@/lib/db";
import { notifyTask } from "@/lib/notify";
import { TASK_PRIORITIES, TASK_STATUSES, VIEWS, type TaskPriority, type TaskStatus, type TaskViewName } from "@/lib/tasks/model";
import { TaskError, assignableFor, createTask, listTasks, taskDetail, tasksForRecord, updateTask } from "@/lib/tasks/store";

/**
 * Tasks API. Every request is authorised here, on the server, from the
 * signed-in person's own access: a task id, a linked record id or an
 * assignee id in the request never widens what they may see or change.
 */

const noStore = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  if (error instanceof TaskError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) fields[issue.path.join(".")] ||= issue.message;
    return NextResponse.json({ error: Object.values(fields)[0] || "Check the highlighted fields.", fields }, { status: 400 });
  }
  console.error(JSON.stringify({ event: "task_request_failed", detail: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
  return NextResponse.json({ error: "Couldn't save the task. Try again, or contact IT if this continues." }, { status: 500 });
}
const list = <T extends string>(value: string | null, allowed: readonly T[]) =>
  (value ? value.split(",") : []).filter((v): v is T => (allowed as readonly string[]).includes(v));

export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Tasks need the live workspace." }, { status: 503 });
  const url = new URL(request.url);
  const p = url.searchParams;
  try {
    if (p.get("id")) return NextResponse.json(await taskDetail(db, actor, p.get("id")!), { headers: noStore });
    if (p.get("recordId")) return NextResponse.json({ items: await tasksForRecord(db, actor, p.get("recordId")!) }, { headers: noStore });
    if (p.get("assignees"))
      return NextResponse.json({ people: await assignableFor(db, actor, { company: p.get("company") || "", linkedRecordId: p.get("linkedRecordId") || null }) }, { headers: noStore });
    const view = (VIEWS as readonly string[]).includes(p.get("view") || "") ? (p.get("view") as TaskViewName) : "today";
    const sort = p.get("sort");
    const result = await listTasks(db, actor, {
      view,
      scope: p.get("scope") === "team" ? "team" : "mine",
      q: p.get("q") || undefined,
      priority: list<TaskPriority>(p.get("priority"), TASK_PRIORITIES),
      status: list<TaskStatus>(p.get("status"), TASK_STATUSES),
      assigneeId: p.get("assignee") || undefined,
      source: p.get("source") === "automation" ? "automation" : p.get("source") === "manual" ? "manual" : undefined,
      company: p.get("company") || undefined,
      sort: sort === "priority" || sort === "updated" || sort === "title" ? sort : "due",
      page: Number(p.get("page")) || 1,
      pageSize: [10, 20, 50].includes(Number(p.get("pageSize"))) ? Number(p.get("pageSize")) : 20,
    });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (isPreview()) return NextResponse.json({ error: "Preview uses local fictional data." }, { status: 409 });
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
    const { task, duplicate, draft } = await createTask(db, actor, await request.json());
    if (draft) await notifyTask(db, [draft]);
    return NextResponse.json({ task, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    if (isPreview()) return NextResponse.json({ error: "Preview uses local fictional data." }, { status: 409 });
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
    const { task, draft } = await updateTask(db, actor, await request.json());
    if (draft) await notifyTask(db, [draft]);
    return NextResponse.json({ task });
  } catch (error) {
    return failure(error);
  }
}
