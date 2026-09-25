import type { Database } from "./d1";
import type { Actor } from "./domain";
import { sharedCompany } from "./collab";
import { CollabError } from "./collab-access";
import { peopleByIds } from "./meeting-data";
import { INVITEE_MAX } from "./meetings";

/**
 * Who may be invited to a standalone meeting: active colleagues who share
 * at least one company with the organiser (the same rule as starting a
 * direct message). Anything else refuses the whole request rather than
 * quietly inviting fewer people.
 */
export async function eligibleInvitees(db: Database, actor: Actor, ids: string[]) {
  const unique = [...new Set(ids)].filter((id) => id !== actor.id);
  if (unique.length > INVITEE_MAX) throw new CollabError(400, `Invite at most ${INVITEE_MAX} people.`);
  const found = await peopleByIds(db, unique);
  const ok = found.filter((p) => p.active && !!sharedCompany(actor, p));
  if (ok.length !== unique.length) throw new CollabError(400, "Some people can't be invited to this meeting.");
  return unique;
}
