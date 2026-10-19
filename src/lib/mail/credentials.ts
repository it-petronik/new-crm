import { z } from "zod";
export class MailboxError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const enc = new TextEncoder();
function bytes(value: string) {
  try {
    return Uint8Array.from(atob(value), (s) => s.charCodeAt(0));
  } catch {
    throw new MailboxError(
      503,
      "Mailbox encryption is not configured. Contact your administrator.",
    );
  }
}
const b64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
async function key(secret?: string) {
  const raw = bytes(secret || "");
  if (raw.length !== 32)
    throw new MailboxError(
      503,
      "Mailbox encryption is not configured. Contact your administrator.",
    );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
/** Binding the ciphertext to the owner + connection prevents copying credentials to another account. */
export async function sealPassword(
  password: string,
  secret: string | undefined,
  ownerId: string,
  connectionId: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: enc.encode(`${ownerId}:${connectionId}`),
    },
    await key(secret),
    enc.encode(password),
  );
  return `1.${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}
export async function openPassword(
  sealed: string,
  secret: string | undefined,
  ownerId: string,
  connectionId: string,
) {
  const parts = sealed.split(".");
  if (parts.length !== 3 || parts[0] !== "1")
    throw new MailboxError(503, "Reconnect your mailbox to restore access.");
  try {
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bytes(parts[1]),
          additionalData: enc.encode(`${ownerId}:${connectionId}`),
        },
        await key(secret),
        bytes(parts[2]),
      ),
    );
  } catch {
    throw new MailboxError(
      503,
      "Mailbox credentials could not be unlocked. Reconnect or contact your administrator.",
    );
  }
}
export const connectMailboxInput = z
  .object({
    action: z.literal("connect"),
    address: z.string().trim().email().max(254),
    password: z
      .string()
      .min(1)
      .max(500)
      .refine((s) => !/[\r\n\0]/.test(s)),
    host: z.string().trim().toLowerCase().default("mail.petronik.ae"),
  })
  .strict();
export function permittedHost(host: string, allowlist?: string) {
  const hosts = (allowlist || "mail.petronik.ae")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!hosts.includes(host) || !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host))
    throw new MailboxError(
      400,
      "This email server has not been approved by your administrator.",
    );
  return host;
}
