/**
 * Per-person workspace preferences: what they looked at recently, and what
 * they pinned.
 *
 * These are conveniences, not business data. They live in this browser under a
 * key scoped to the signed-in user, so no schema changes, no writes to
 * BusinessRecord, and nothing to keep in step across a team.
 *
 * Only what is needed to render a row and navigate to it is stored. Access is
 * never granted from here: a stored id is resolved against the records the
 * caller can already see, so an entry for something the person has since lost
 * access to simply stops appearing.
 */

export type RecentRecord = {
  id: string;
  title: string;
  kind: string;
  company: string;
  at: number;
};

const RECENT_LIMIT = 10;
const PIN_LIMIT = 20;

const key = (userId: string, name: string) => `enercore:${name}:${userId}`;

function read<T>(storageKey: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    // Private windows, cleared storage and quota errors all land here. A
    // convenience must never break the page it decorates.
    return fallback;
  }
}

function write(storageKey: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    /* ignore: see read() */
  }
}

// ------------------------------------------------------------- recently seen

export const recentRecords = (userId: string): RecentRecord[] =>
  read<RecentRecord[]>(key(userId, "recent"), []);

/** Records the visit, newest first, without duplicating an existing entry. */
export function rememberRecord(
  userId: string,
  record: { id: string; title: string; kind: string; company: string },
) {
  const entry: RecentRecord = {
    id: record.id,
    title: record.title,
    kind: record.kind,
    company: record.company,
    at: Date.now(),
  };
  const next = [entry, ...recentRecords(userId).filter((r) => r.id !== entry.id)].slice(
    0,
    RECENT_LIMIT,
  );
  write(key(userId, "recent"), next);
  return next;
}

// -------------------------------------------------------------------- pinned

export const pinnedIds = (userId: string): string[] =>
  read<string[]>(key(userId, "pinned"), []);

export const isPinned = (userId: string, id: string) => pinnedIds(userId).includes(id);

/** Adds or removes a pin, returning the new list. */
export function togglePin(userId: string, id: string) {
  const current = pinnedIds(userId);
  const next = current.includes(id)
    ? current.filter((p) => p !== id)
    : [id, ...current].slice(0, PIN_LIMIT);
  write(key(userId, "pinned"), next);
  return next;
}

/**
 * Resolves stored ids against the records the caller can see.
 *
 * This is what keeps a local convenience from becoming an access hole: an id
 * that no longer resolves is dropped rather than rendered.
 */
export function resolveVisible<T extends { id: string }>(ids: string[], visible: T[]): T[] {
  const byId = new Map(visible.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is T => Boolean(r));
}
