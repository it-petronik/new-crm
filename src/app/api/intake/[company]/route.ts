import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, isPreview } from "@/lib/db";
import { findUserById, findRecord, createRecordWithAudit, recordLoginAttempt } from "@/lib/data";
import { type RecordItem, companies } from "@/lib/domain";

const payload = z.object({
  eventId: z.string().min(8).max(100),
  title: z.string().min(2).max(160),
  contact: z.string().max(160),
  email: z.email(),
  phone: z.string().max(50).optional(),
  product: z.string().max(160),
  quantity: z.number().min(0).max(100000000),
  destination: z.string().max(160),
  message: z.string().max(5000).optional(),
  website: z.string().max(100),
});

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** WebCrypto HMAC, so this runs on the Workers runtime. */
async function sign(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/** Constant-time comparison; a timing difference would leak the signature. */
function sameSignature(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

const sha256Hex = async (value: string) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

// Server-to-server integration. Secrets must never be exposed in browser code.
export async function POST(request: Request, { params }: { params: Promise<{ company: string }> }) {
  try {
    const slug = (await params).company.toLowerCase();
    const company = companies.find((c) => c.toLowerCase() === slug);
    const db = await getDb();
    if (!company || isPreview() || !db)
      return NextResponse.json({ error: "Intake is not configured." }, { status: 503 });
    const prefix = `INTAKE_${slug.toUpperCase()}`;
    const secret = process.env[`${prefix}_SECRET`];
    const ownerId = process.env[`${prefix}_OWNER_ID`];
    if (!secret || secret.length < 32 || !ownerId)
      return NextResponse.json({ error: "Intake is not configured." }, { status: 503 });
    const timestamp = request.headers.get("x-enercore-timestamp") || "";
    const signature = request.headers.get("x-enercore-signature") || "";
    if (
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > 300000 ||
      !/^[a-f0-9]{64}$/i.test(signature)
    )
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    // Rate limit per company before the body is read. Signature verification
    // is cheap, but a valid-signature flood would still create records, and an
    // invalid one should not be free to repeat indefinitely.
    if ((await recordLoginAttempt(db, `intake:${slug}`, 60_000)) > 120)
      return NextResponse.json({ error: "Too many enquiries. Try again shortly." }, { status: 429 });
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > 20000)
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    const raw = new TextDecoder().decode(buffer);
    const expected = await sign(secret, `${timestamp}.${raw}`);
    if (!sameSignature(expected, signature.toLowerCase()))
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    const input = payload.parse(JSON.parse(raw));
    const owner = await findUserById(db, ownerId);
    if (
      !owner?.active ||
      !owner.companies.includes(company) ||
      !["MD", "Group Manager", "Branch Manager", "Sales Manager", "Sales Executive"].includes(owner.role)
    )
      return NextResponse.json({ error: "Lead routing needs configuration." }, { status: 503 });
    const id = "WEB-" + (await sha256Hex(`${company}:${input.eventId}`)).slice(0, 40);
    // Deterministic id makes a repeated delivery a duplicate, not a new lead.
    if (await findRecord(db, id)) return NextResponse.json({ id, duplicate: true }, { status: 200 });
    const now = new Date().toISOString();
    const record: RecordItem = {
      id, kind: "leads", company, branch: owner.branches[0] || "Main",
      title: input.title, contact: input.contact, email: input.email, phone: input.phone || "",
      product: input.product, quantity: input.quantity, unit: "MT", amount: 0, currency: "USD",
      status: "New", ownerId: owner.id, owner: owner.name,
      due: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      destination: input.destination, detail: input.message || "",
      source: `Website: ${input.website}`, createdAt: now, updatedAt: now,
    };
    try {
      await createRecordWithAudit(
        db,
        { id, kind: "leads", company, branch: record.branch, ownerId: owner.id, status: "New", payload: record },
        { id: crypto.randomUUID(), company, actor: "Website intake", actorId: owner.id, recordId: id, action: "Created website enquiry" },
      );
    } catch (error) {
      // The primary key is the last line of defence against a concurrent retry.
      if (String(error).includes("UNIQUE") || String(error).includes("constraint"))
        return NextResponse.json({ id, duplicate: true }, { status: 200 });
      throw error;
    }
    return NextResponse.json({ id, duplicate: false }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to accept enquiry. Validate the payload." }, { status: 400 });
  }
}
