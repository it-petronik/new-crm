/** Small TLS-only SMTP submission client. No plaintext/port-25 fallback. */
export type SmtpAccount = {
  host: string;
  username: string;
  password: string;
  from: string;
  replyTo: string;
};
export type MailSocket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close: () => Promise<void>;
};
export type Connector = (host: string) => Promise<MailSocket>;
const encode = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};
export const tlsConnect: Connector = async (host) => {
  const { connect } = await import("node:tls");
  const { Duplex } = await import("node:stream");
  const socket = connect({
    host,
    port: 465,
    servername: host,
    rejectUnauthorized: true,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
      socket.setTimeout(12000, () =>
        socket.destroy(new Error("SMTP connect timeout")),
      );
    });
  } catch (e) {
    socket.destroy();
    throw e;
  }
  const streams = Duplex.toWeb(socket) as {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
  return {
    ...streams,
    close: async () => {
      socket.destroy();
    },
  };
};
export async function submitSmtp(
  account: SmtpAccount,
  message: { id: string; recipient: string; subject: string; body: string },
  connector: Connector = tlsConnect,
): Promise<{
  status: "accepted" | "uncertain" | "rejected";
  providerId: null;
}> {
  let socket: MailSocket | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    expired = false;
  const task = async () => {
    socket = await connector(account.host);
    if (expired) {
      void socket.close().catch(() => {});
      throw new Error("SMTP expired");
    }
    const reader = socket.readable.getReader(),
      writer = socket.writable.getWriter();
    const decoder = new TextDecoder();
    let buffer = "";
    async function line() {
      for (;;) {
        const i = buffer.indexOf("\r\n");
        if (i >= 0) {
          const out = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          return out;
        }
        if (buffer.length > 16000) throw new Error("SMTP reply exceeded limit");
        const chunk = await reader.read();
        if (chunk.done) throw new Error("SMTP disconnected");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    }
    async function reply(codes: number[]) {
      let expected = "";
      for (let i = 0; i < 100; i++) {
        const value = await line();
        if (!/^\d{3}[ -]/.test(value)) throw new Error("Invalid SMTP response");
        if (expected && value.slice(0, 3) !== expected)
          throw new Error("Inconsistent SMTP response");
        expected = value.slice(0, 3);
        if (value[3] === " ") {
          if (!codes.includes(Number(expected))) throw new Rejected();
          return;
        }
      }
      throw new Error("SMTP reply exceeded limit");
    }
    const write = (s: string) => writer.write(new TextEncoder().encode(s));
    async function cmd(s: string, codes: number[]) {
      await write(s + "\r\n");
      await reply(codes);
    }
    try {
      await reply([220]);
      await cmd("EHLO crm.enercore.ae", [250]);
      await cmd(
        `AUTH PLAIN ${encode(`\0${account.username}\0${account.password}`)}`,
        [235],
      );
      await cmd(`MAIL FROM:<${account.from}>`, [250]);
      await cmd(`RCPT TO:<${message.recipient}>`, [250, 251]);
      await cmd("DATA", [354]);
      const encodedBody =
        encode(message.body)
          .match(/.{1,76}/g)
          ?.join("\r\n") || "";
      // Base64 avoids SMTP line length, Unicode and dot-stuffing ambiguities.
      const words: string[] = [];
      let segment = "";
      for (const char of message.subject) {
        if (new TextEncoder().encode(segment + char).length > 42) {
          words.push(segment);
          segment = "";
        }
        segment += char;
      }
      if (segment) words.push(segment);
      const subject = words
        .map((s) => `=?UTF-8?B?${encode(s)}?=`)
        .join("\r\n ");
      await write(
        `From: ${account.from}\r\nReply-To: ${account.replyTo}\r\nTo: ${message.recipient}\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: <${message.id}@${account.from.split("@")[1]}>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}\r\n.\r\n`,
      );
      await reply([250]);
      return { status: "accepted" as const, providerId: null };
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  };
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SMTP timeout")), 15000);
      }),
    ]);
  } catch (e) {
    return {
      status: e instanceof Rejected ? "rejected" : "uncertain",
      providerId: null,
    };
  } finally {
    expired = true;
    clearTimeout(timer);
    if (socket) void socket.close().catch(() => {});
  }
}
class Rejected extends Error {}
