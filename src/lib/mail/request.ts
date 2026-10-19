/** Time-bound, abortable mailbox reads. Mutating requests never retry implicitly. */
export class MailRequestError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
async function request<T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
  retries: number,
  timeout: number,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController(),
      abort = () => controller.abort();
    if (init.signal?.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    init.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new MailRequestError(
          data.error || "Mailbox temporarily unavailable.",
          response.status,
        );
      }
      return await read(response);
    } catch (error) {
      if (init.signal?.aborted)
        throw new DOMException("Request cancelled", "AbortError");
      const status = error instanceof MailRequestError ? error.status : 0;
      if (
        attempt >= retries ||
        (status && status < 500 && ![408, 425, 429].includes(status))
      )
        throw error instanceof MailRequestError
          ? error
          : new MailRequestError(
              "Connection interrupted. Please retry; your mailbox is unchanged.",
            );
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
}
export const mailJson = <T = any>(
  url: string,
  init: RequestInit = {},
  retries = 0,
  timeout = 35000,
) => request<T>(url, init, (r) => r.json(), retries, timeout);
export const mailBytes = (url: string, init: RequestInit = {}, retries = 1) =>
  request(url, init, (r) => r.arrayBuffer(), retries, 45000);
