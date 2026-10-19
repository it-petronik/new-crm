import type { MailMessage } from "./model";
export type MailSort = "newest" | "oldest";
export function mergeMailPreviews(current:MailMessage[],incoming:MailMessage[]){
  // A changed signed reference for the same folder/UID means a different
  // connection or UIDVALIDITY. Do not retain older previews from that mailbox.
  const changed=new Set(incoming.filter(m=>m.uid&&current.some(old=>old.folder===m.folder&&old.uid===m.uid&&old.id!==m.id)).map(m=>m.folder));
  return [...new Map([...current.filter(m=>!changed.has(m.folder)),...incoming].map(m=>[m.id,m])).values()];
}
export function sortMail(messages: MailMessage[], sort: MailSort = "newest") {
  return [...messages].sort(
    (a, b) =>
      (sort === "newest"
        ? b.updatedAt - a.updatedAt
        : a.updatedAt - b.updatedAt) || a.id.localeCompare(b.id),
  );
}
