import type { BrowserContext } from "@playwright/test";
import { request as httpRequest } from "node:http";
import { byKey, PASSWORD, WORKER, type TestPerson } from "./people";

/**
 * A signed-in person talking to the local Worker over plain HTTP, with the
 * session cookie handled explicitly so every request's credentials and
 * origin are exactly what the test says they are.
 */

export type Result<T = any> = { status: number; body: T };

export class Client {
  constructor(
    public person: TestPerson,
    public cookie: string,
  ) {}

  get id() {
    return this.person.id;
  }

  static async login(key: string): Promise<Client> {
    const person = byKey(key);
    const response = await fetch(`${WORKER}/api/auth`, {
      method: "POST",
      headers: { Origin: WORKER, "Content-Type": "application/json" },
      body: JSON.stringify({ email: person.email, password: PASSWORD }),
    });
    const setCookie = response.headers.get("set-cookie");
    if (response.status !== 200 || !setCookie)
      throw new Error(`login ${key} failed: ${response.status} ${await response.text()}`);
    return new Client(person, setCookie.split(";")[0]);
  }

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    options: { origin?: string | null; cookie?: string | null; raw?: string } = {},
  ): Promise<Result<T>> {
    const headers: Record<string, string> = {};
    const origin = options.origin === undefined ? WORKER : options.origin;
    if (origin) headers.Origin = origin;
    const cookie = options.cookie === undefined ? this.cookie : options.cookie;
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined || options.raw !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${WORKER}${path}`, {
      method,
      headers,
      body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return { status: response.status, body: parsed as T };
  }

  get = <T = any>(path: string) => this.request<T>("GET", `/api/collab${path}`);
  post = <T = any>(path: string, body: unknown) => this.request<T>("POST", `/api/collab${path}`, body);
  patch = <T = any>(path: string, body: unknown) => this.request<T>("PATCH", `/api/collab${path}`, body);
  del = <T = any>(path: string) => this.request<T>("DELETE", `/api/collab${path}`);

  /* ------------------------------------------------------------ shortcuts */

  async createRoom(options: {
    name?: string;
    visibility?: "private" | "workspace";
    company?: string;
    branch?: string | null;
    members?: string[];
    description?: string;
  } = {}) {
    const result = await this.post("/conversations", {
      kind: "room",
      name: options.name ?? `Room ${Math.random().toString(36).slice(2, 8)}`,
      description: options.description ?? "",
      visibility: options.visibility ?? "private",
      company: options.company ?? this.person.companies[0],
      branch: options.branch ?? null,
      memberIds: (options.members ?? []).map((k) => byKey(k).id),
    });
    if (result.status !== 201) throw new Error(`createRoom: ${result.status} ${JSON.stringify(result.body)}`);
    return result.body.conversation as { id: string; title: string; [k: string]: any };
  }

  async openDirect(key: string) {
    return this.post("/conversations", { kind: "direct", userId: byKey(key).id });
  }

  async send(conversationId: string, body: string, extra: Record<string, unknown> = {}) {
    return this.post(`/conversations/${conversationId}/messages`, { body, ...extra });
  }

  async page(conversationId: string, query = "") {
    return this.get(`/conversations/${conversationId}/messages${query}`);
  }

  async listEntry(conversationId: string) {
    const result = await this.get("/conversations");
    return (result.body.conversations as any[]).find((c) => c.id === conversationId);
  }

  async summary() {
    return (await this.get("/summary")).body as { unread: number; mentions: number };
  }

  /** Multipart upload exactly as a browser sends it (with Content-Length). */
  async upload(
    conversationId: string,
    file: { name: string; bytes: Uint8Array; type?: string },
    fields: Record<string, string> = {},
    thumbnail?: { name: string; bytes: Uint8Array },
    options: { origin?: string | null; path?: string; field?: string } = {},
  ) {
    const form = new FormData();
    form.append(options.field ?? "file", new Blob([file.bytes as BlobPart], { type: file.type ?? "application/octet-stream" }), file.name);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (thumbnail) form.append("thumbnail", new Blob([thumbnail.bytes as BlobPart]), thumbnail.name);
    const encoded = new Response(form);
    const headers: Record<string, string> = {
      Cookie: this.cookie,
      "Content-Type": encoded.headers.get("content-type")!,
    };
    const origin = options.origin === undefined ? WORKER : options.origin;
    if (origin) headers.Origin = origin;
    const response = await fetch(`${WORKER}${options.path ?? `/api/collab/conversations/${conversationId}/attachments`}`, {
      method: "POST",
      headers,
      body: new Uint8Array(await encoded.arrayBuffer()),
    });
    const text = await response.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: response.status, body };
  }

  /** Fetches a file route as this person; returns status, headers, bytes. */
  async file(url: string, headers: Record<string, string> = {}) {
    const response = await fetch(`${WORKER}${url}`, { headers: { Cookie: this.cookie, ...headers } });
    return { status: response.status, headers: response.headers, bytes: new Uint8Array(await response.arrayBuffer()) };
  }

  /** Admin action through the real user-administration API. */
  async updateUser(key: string, change: Record<string, unknown>) {
    const target = byKey(key);
    const result = await this.request("PATCH", "/api/users", { id: target.id, ...change });
    if (result.status !== 200) throw new Error(`updateUser ${key}: ${result.status} ${JSON.stringify(result.body)}`);
  }

  async moveUser(key: string, companies: string[], branches: string[]) {
    await this.updateUser(key, { role: byKey(key).role, companies, branches, moduleAccess: {} });
  }

  /** Puts this person's session cookie into a browser context. */
  async signInBrowser(context: BrowserContext) {
    const [name, value] = this.cookie.split("=");
    await context.addCookies([
      { name, value, domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
  }
}

export const ids = (...keys: string[]) => keys.map((k) => byKey(k).id);

/* ---------------------------------------------------------------- socket */

export type Socket = {
  ws: WebSocket;
  events: any[];
  closed: Promise<number>;
  waitFor: (predicate: (e: any) => boolean, ms?: number) => Promise<any>;
  none: (predicate: (e: any) => boolean, ms?: number) => Promise<void>;
};

const SOCKET_URL = `${WORKER.replace("http", "ws")}/api/collab/socket`;

/**
 * Opens the realtime socket as this person (Node's built-in WebSocket, which
 * accepts request headers); resolves once the hub says "ready".
 */
export function openSocket(cookie: string, origin: string = WORKER): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SOCKET_URL, { headers: { Cookie: cookie, Origin: origin } } as any);
    const events: any[] = [];
    const waiters: { predicate: (e: any) => boolean; resolve: (e: any) => void }[] = [];
    let closeCode: (code: number) => void = () => {};
    const closed = new Promise<number>((r) => (closeCode = r));
    ws.onclose = (e) => closeCode(e.code);
    ws.onerror = () => reject(new Error("socket failed"));
    ws.onmessage = (message) => {
      const text = String(message.data);
      const event = text === "pong" ? { type: "pong" } : JSON.parse(text);
      events.push(event);
      if (event.type === "ready")
        resolve({
          ws,
          events,
          closed,
          waitFor: (predicate, ms = 8000) =>
            new Promise((ok, fail) => {
              const found = events.find(predicate);
              if (found) return ok(found);
              const timer = setTimeout(() => fail(new Error("event not received")), ms);
              waiters.push({ predicate, resolve: (e) => (clearTimeout(timer), ok(e)) });
            }),
          none: async (predicate, ms = 2500) => {
            await new Promise((r) => setTimeout(r, ms));
            const found = events.find(predicate);
            if (found) throw new Error(`unexpected event: ${JSON.stringify(found)}`);
          },
        });
      for (const w of [...waiters])
        if (w.predicate(event)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(event);
        }
    };
  });
}

/**
 * The HTTP status the gateway answers a WebSocket upgrade with (101 when it
 * is accepted), sent as a raw upgrade request so a refusal's exact status is
 * visible — browsers and WebSocket clients hide it.
 */
export function upgradeStatus(headers: Record<string, string>, path = "/api/collab/socket"): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${WORKER}${path}`, {
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64"),
        ...headers,
      },
    });
    request.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode ?? 101);
    });
    request.on("response", (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", reject);
    request.end();
  });
}

/* ------------------------------------------------------------ test files */

const bytes = (...parts: (number[] | string)[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === "string" ? [...new TextEncoder().encode(p)] : p));
  return new Uint8Array(out);
};
/** A file of exactly `size` bytes starting with `head`. */
export const sized = (head: Uint8Array, size: number) => {
  const out = new Uint8Array(size);
  out.set(head.subarray(0, Math.min(head.length, size)));
  return out;
};
// A real 1×1 PNG.
export const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);
export const FILES = {
  png: { name: "photo.png", bytes: PNG },
  jpg: { name: "photo.jpg", bytes: bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF-body") },
  pdf: { name: "report.pdf", bytes: bytes("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") },
  docx: { name: "memo.docx", bytes: bytes([0x50, 0x4b, 0x03, 0x04], "word/document.xml") },
  xlsx: { name: "sheet.xlsx", bytes: bytes([0x50, 0x4b, 0x03, 0x04], "xl/workbook.xml") },
  doc: { name: "old.doc", bytes: bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], "legacy") },
  txt: { name: "notes.txt", bytes: bytes("Plain notes, line one.\nLine two.") },
  csv: { name: "data.csv", bytes: bytes("a,b\n1,2\n") },
  webm: { name: "Voice message.webm", bytes: bytes([0x1a, 0x45, 0xdf, 0xa3], "webm-audio-payload-".repeat(64)) },
  // Hostile or unsupported.
  htmlAsJpg: { name: "cat.jpg", bytes: bytes("<html><script>alert(1)</script></html>") },
  textAsPdf: { name: "invoice.pdf", bytes: bytes("just some text pretending") },
  docxAsJpg: { name: "picture.jpg", bytes: bytes([0x50, 0x4b, 0x03, 0x04], "word/document.xml") },
  html: { name: "page.html", bytes: bytes("<!doctype html><script>alert(1)</script>") },
  htm: { name: "page.htm", bytes: bytes("<html></html>") },
  svg: { name: "logo.svg", bytes: bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') },
  svgAsPng: { name: "logo.png", bytes: bytes('<svg xmlns="http://www.w3.org/2000/svg"/>') },
  js: { name: "tool.js", bytes: bytes("alert(document.cookie)") },
  exe: { name: "setup.exe", bytes: bytes([0x4d, 0x5a, 0x90, 0x00], "This program cannot be run in DOS mode") },
  exeAsPdf: { name: "setup.pdf", bytes: bytes([0x4d, 0x5a, 0x90, 0x00]) },
  zip: { name: "bundle.zip", bytes: bytes([0x50, 0x4b, 0x03, 0x04], "payload") },
  htmlAsTxt: { name: "page.txt", bytes: bytes("<!doctype html><script>alert(document.cookie)</script>") },
};
