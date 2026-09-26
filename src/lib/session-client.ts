"use client";

/**
 * Keeping a signed-in person signed in, in the browser.
 *
 * When the 8-hour session lapses, a device that chose "keep me signed in"
 * renews it from its HttpOnly refresh cookie — which page JavaScript never
 * sees. `renewSession` does that exactly once at a time: one request per tab
 * (a shared promise) and one tab at a time (a Web Lock). Inside the lock it
 * first asks whether another tab has already renewed (the cookies are
 * shared), so a renewal is never repeated with a used token.
 *
 * `installSessionRecovery` makes that invisible: a same-origin API call that
 * comes back 401 waits for the renewal and is sent again, once. If there is
 * nothing to renew with, the person goes to the login page and comes back
 * to where they were.
 */

let inFlight: Promise<boolean> | null = null;
const nativeFetch = typeof window !== "undefined" ? window.fetch.bind(window) : fetch;

async function signedIn() {
  try {
    const r = await nativeFetch("/api/auth", { cache: "no-store", credentials: "same-origin" });
    return r.ok && ((await r.json()) as { signedIn?: boolean }).signedIn === true;
  } catch {
    return false;
  }
}

async function renewOnce(): Promise<boolean> {
  if (await signedIn()) return true;
  for (let attempt = 0; attempt < 3; attempt++) {
    let status = 0;
    try {
      status = (await nativeFetch("/api/auth/refresh", { method: "POST", cache: "no-store", credentials: "same-origin" })).status;
    } catch {
      return false;
    }
    if (status === 200) return true;
    if (status !== 409) return false;
    // Another tab renewed with the same credential a moment ago: its new
    // cookies are arriving. Use them rather than renewing again.
    await new Promise((r) => setTimeout(r, 400));
    if (await signedIn()) return true;
  }
  return false;
}

/** Renews this browser's session if it can. True when signed in afterwards. */
export function renewSession(): Promise<boolean> {
  if (inFlight) return inFlight;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const run: Promise<boolean> = locks ? locks.request("enercore-session-renewal", renewOnce).then((held) => held) : renewOnce();
  const shared = run.finally(() => {
    inFlight = null;
  });
  inFlight = shared;
  return shared;
}

let redirecting = false;
function toLogin() {
  if (redirecting || location.pathname.startsWith("/login")) return;
  redirecting = true;
  location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
}

const recoverable = (url: URL) =>
  url.origin === location.origin &&
  url.pathname.startsWith("/api/") &&
  !url.pathname.startsWith("/api/auth") &&
  // The guest pages have no CRM session to recover.
  !url.pathname.startsWith("/api/meet/");

let installed = false;
/** Wraps window.fetch once, for the signed-in workspace only. */
export function installSessionRecovery() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (!recoverable(url)) return nativeFetch(input, init);
    // A Request body can be read once; keep a copy for the retry.
    const spare = input instanceof Request ? input.clone() : null;
    const response = await nativeFetch(input, init);
    if (response.status !== 401) return response;
    if (await renewSession()) return nativeFetch(spare ?? input, init);
    toLogin();
    return response;
  };
}
