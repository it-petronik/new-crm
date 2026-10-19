import { z } from "zod";
import { MailboxError } from "./credentials";
const schema = z
  .object({
    uid: z.number().int().positive(),
    uidValidity: z.string().min(1).max(100),
    path: z.string().min(1).max(300),
  })
  .strict();
const enc = new TextEncoder();
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
const decode = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
async function key(secret?: string) {
  try {
    const bytes = decode(secret || "");
    if (bytes.length !== 32) throw Error();
    return await crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  } catch {
    throw new MailboxError(503, "Mailbox encryption is not configured.");
  }
}
export async function mailReference(
  secret: string | undefined,
  owner: string,
  connection: string,
  value: z.infer<typeof schema>,
) {
  const payload = encode(enc.encode(JSON.stringify(schema.parse(value))));
  const mac = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    enc.encode(`mail-preview-v1:${owner}:${connection}:${payload}`),
  );
  return `m1.${payload}.${encode(new Uint8Array(mac))}`;
}
export async function resolveMailReference(
  secret: string | undefined,
  owner: string,
  connection: string,
  reference: string,
) {
  try {
    const [version, payload, mac, ...extra] = reference.split(".");
    if (
      version !== "m1" ||
      !payload ||
      !mac ||
      extra.length ||
      reference.length > 2048
    )
      throw Error();
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        decode(mac),
        enc.encode(`mail-preview-v1:${owner}:${connection}:${payload}`),
      ))
    )
      throw Error();
    return schema.parse(JSON.parse(new TextDecoder().decode(decode(payload))));
  } catch {
    throw new MailboxError(
      404,
      "Email reference expired or unavailable. Sync your mailbox again.",
    );
  }
}
