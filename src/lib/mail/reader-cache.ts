import type { MailDetail } from "./imap";
import { mailJson } from "./request";

/** One mounted mailbox only: never shared across users or persisted in storage. */
export function createReaderCache() {
  const values = new Map<string, { at: number; value: MailDetail }>();
  const pending = new Map<string, Promise<MailDetail>>();
  let generation = 0;
  return {
    get(id: string) {
      const item = values.get(id);
      if (item && Date.now() - item.at < 300000) return item.value;
      values.delete(id);
      return null;
    },
    clear() { generation++; values.clear(); pending.clear(); },
    async load(id: string, refresh = false): Promise<MailDetail> {
      const cached = this.get(id);
      if (cached && !refresh) return cached;
      const active = pending.get(id);
      if (active) return active;
      const epoch = generation;
      const task = mailJson<MailDetail>(`/api/mail/message?id=${encodeURIComponent(id)}`,{},2)
        .then(data => {
          if (generation === epoch) {
            if (values.size >= 20) values.delete(values.keys().next().value!);
            values.set(id, { at: Date.now(), value: data });
          }
          return data as MailDetail;
        }).finally(() => { if (pending.get(id) === task) pending.delete(id); });
      pending.set(id, task);
      return task;
    },
  };
}
export type ReaderCache = ReturnType<typeof createReaderCache>;
