/** Shared browser request boundary. Never show HTML, stack traces or parser errors. */
export class WorkspaceRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
const technical =
  /unexpected token|valid json|syntaxerror|typeerror|failed to fetch|load failed|networkerror|aborterror|<!doctype|<html|\b(?:SQLITE|D1_ERROR|ECONN\w*|ETIMEDOUT)\b|\b[A-Z]{2,}_[A-Z_]{2,}\b|\bat \S+\.(?:ts|js):\d/i;
export function friendlyError(
  error: unknown,
  fallback = "Something interrupted this request. Please try again.",
) {
  const value =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return !value || technical.test(value) || value.length > 300
    ? fallback
    : value;
}
export async function readJsonResponse<T = any>(
  response: Response,
  fallback = "We couldn’t load this information. Please try again.",
): Promise<T> {
  const expired =
    response.status === 401 ||
    (response.redirected &&
      new URL(response.url).pathname.startsWith("/login"));
  if (expired)
    throw new WorkspaceRequestError(
      401,
      "Your session has ended. Please sign in again to continue.",
    );
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new WorkspaceRequestError(
      response.status || 502,
      response.status === 403
        ? "You don’t have access to this information. Ask your administrator if you need access."
        : fallback,
    );
  }
  if (!data || typeof data !== "object")
    throw new WorkspaceRequestError(response.status || 502, fallback);
  if (data && typeof data.error === "string")
    data.error = friendlyError(data.error, fallback);
  return data as T;
}
export async function requestJson<T = any>(
  url: string,
  init: RequestInit = {},
  fallback = "We couldn’t load this information. Please try again.",
): Promise<T> {
  const read = !init.method || init.method === "GET",
    attempts = read ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController(),
      abort = () => controller.abort();
    init.signal?.addEventListener("abort", abort, { once: true });
    if (init.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, read ? 15000 : 25000);
    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await readJsonResponse<any>(response, fallback);
      if (!response.ok)
        throw new WorkspaceRequestError(
          response.status,
          data?.error || fallback,
          data?.fields,
        );
      return data as T;
    } catch (error) {
      if (init.signal?.aborted)
        throw new DOMException("Cancelled", "AbortError");
      const status = error instanceof WorkspaceRequestError ? error.status : 0;
      if (
        attempt + 1 < attempts &&
        (!status || status >= 500 || status === 200)
      )
        continue;
      throw error instanceof WorkspaceRequestError
        ? error
        : new WorkspaceRequestError(
            0,
            read
              ? "We couldn’t connect. Check your connection and try again."
              : "We couldn’t confirm this change. Refresh to check its status before trying again.",
          );
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  }
  throw new WorkspaceRequestError(0, fallback);
}
