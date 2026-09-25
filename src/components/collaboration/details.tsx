"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, LogOut, MoreHorizontal, Settings2, UserPlus, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import type { ConversationDetail, ConversationMemberView } from "@/lib/collab";
import type { Actor } from "@/lib/domain";
import { companyName } from "@/lib/company-name";
import { collabFetch } from "@/lib/collab-client";
import { Button, DialogPresence } from "../ui/controls";
import { Avatar } from "../avatar";
import { Skeleton } from "../ui/skeleton";
import { AddMembersDialog, ConfirmDialog, EditRoomDialog } from "./dialogs";

const roleLabel = { owner: "Owner", admin: "Admin", member: "" } as const;

/**
 * The right-hand panel: what a conversation is and who is in it, plus room
 * administration for owners and admins. Every action here is re-authorized by
 * the server; hiding a button is a courtesy, not the control.
 */
export default function Details({
  detail,
  actor,
  onClose,
  onChanged,
  onLeft,
  onMessage,
}: {
  detail: ConversationDetail | null;
  actor: Actor;
  onClose: () => void;
  onChanged: () => void;
  onLeft: () => void;
  onMessage: (userId: string) => void;
}) {
  const [dialog, setDialog] = useState<
    | { kind: "add" }
    | { kind: "edit" }
    | { kind: "leave" }
    | { kind: "archive"; archived: boolean }
    | { kind: "remove"; member: ConversationMemberView }
    | null
  >(null);
  const [error, setError] = useState("");

  const run = async (action: () => Promise<unknown>, after: () => void) => {
    setError("");
    try {
      await action();
      setDialog(null);
      after();
    } catch (e) {
      setError((e as Error).message);
      setDialog(null);
    }
  };

  if (!detail)
    return (
      <aside className="collab-details" aria-label="Conversation details" aria-busy="true">
        <div className="collab-details-head">
          <h3>Details</h3>
          <Button className="icon-button" aria-label="Close details" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="collab-details-body">
          <Skeleton w="60%" h={14} />
          <Skeleton w="90%" h={11} />
          <Skeleton w="40%" h={11} />
        </div>
      </aside>
    );

  const c = detail.conversation;
  const direct = c.kind === "direct";
  const me = detail.members.find((m) => m.id === actor.id);
  const isOwner = me?.memberRole === "owner";

  return (
    <aside className="collab-details" aria-label="Conversation details">
      <div className="collab-details-head">
        <h3>{direct ? "Profile" : "Room details"}</h3>
        <Button className="icon-button" aria-label="Close details" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>
      <div className="collab-details-body">
        {direct ? (
          <div className="collab-profile">
            <Avatar name={c.title} size={56} />
            <b>{c.title}</b>
            <small>{c.counterpart?.role}</small>
            {c.counterpart && !c.counterpart.active && <span className="e-badge tone-neutral">Inactive</span>}
          </div>
        ) : (
          <>
            <section className="collab-details-section">
              <h4>{c.title}</h4>
              {c.description && <p className="collab-details-desc">{c.description}</p>}
              <dl className="collab-facts">
                <div>
                  <dt>Visibility</dt>
                  <dd>{c.visibility === "private" ? "Private — members only" : "Workspace — open to join"}</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>{c.branch ? `${companyName(c.company)} · ${c.branch}` : `${companyName(c.company)} · All branches`}</dd>
                </div>
                {c.archived && (
                  <div>
                    <dt>Status</dt>
                    <dd>Archived</dd>
                  </div>
                )}
              </dl>
              {detail.canAdmin && (
                <div className="collab-details-actions">
                  <Button className="secondary compact" onClick={() => setDialog({ kind: "edit" })}>
                    <Settings2 size={14} /> Settings
                  </Button>
                  <Button
                    className="secondary compact"
                    onClick={() => setDialog({ kind: "archive", archived: !c.archived })}
                  >
                    {c.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    {c.archived ? "Restore" : "Archive"}
                  </Button>
                </div>
              )}
            </section>
            <section className="collab-details-section">
              <div className="collab-details-subhead">
                <h4>
                  Members <span>{detail.members.length}</span>
                </h4>
                {detail.canAdmin && !c.archived && (
                  <Button className="secondary compact" onClick={() => setDialog({ kind: "add" })}>
                    <UserPlus size={14} /> Add
                  </Button>
                )}
              </div>
              <ul className="collab-members">
                {detail.members.map((m) => {
                  const manageable =
                    detail.canAdmin &&
                    m.id !== actor.id &&
                    m.memberRole !== "owner" &&
                    (m.memberRole === "member" || isOwner);
                  return (
                    <li key={m.id}>
                      <Avatar name={m.name} size={28} />
                      <span className="collab-member-name">
                        {m.name}
                        {m.id === actor.id && <em> (you)</em>}
                        <small>{[m.role, m.active ? null : "Inactive"].filter(Boolean).join(" · ")}</small>
                      </span>
                      {roleLabel[m.memberRole] && <span className="e-badge tone-info">{roleLabel[m.memberRole]}</span>}
                      {(manageable || (m.id !== actor.id && m.active)) && (
                        <Popover.Root>
                          <Popover.Trigger asChild>
                            <Button className="icon-button" aria-label={`Actions for ${m.name}`}>
                              <MoreHorizontal size={15} />
                            </Button>
                          </Popover.Trigger>
                          <Popover.Portal>
                            <Popover.Content className="row-overflow-menu" align="end" sideOffset={4}>
                              {m.id !== actor.id && m.active && (
                                <Popover.Close asChild>
                                  <button type="button" className="row-overflow-item" onClick={() => onMessage(m.id)}>
                                    Message
                                  </button>
                                </Popover.Close>
                              )}
                              {manageable && (
                                <Popover.Close asChild>
                                  <button
                                    type="button"
                                    className="row-overflow-item"
                                    onClick={() =>
                                      void run(
                                        () =>
                                          collabFetch(`/conversations/${c.id}/members`, {
                                            method: "PATCH",
                                            body: {
                                              userId: m.id,
                                              role: m.memberRole === "admin" ? "member" : "admin",
                                            },
                                          }),
                                        onChanged,
                                      )
                                    }
                                  >
                                    {m.memberRole === "admin" ? "Remove admin" : "Make admin"}
                                  </button>
                                </Popover.Close>
                              )}
                              {manageable && (
                                <Popover.Close asChild>
                                  <button
                                    type="button"
                                    className="row-overflow-item is-destructive"
                                    onClick={() => setDialog({ kind: "remove", member: m })}
                                  >
                                    Remove from room
                                  </button>
                                </Popover.Close>
                              )}
                            </Popover.Content>
                          </Popover.Portal>
                        </Popover.Root>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="collab-details-section">
              <Button className="secondary compact collab-leave" onClick={() => setDialog({ kind: "leave" })}>
                <LogOut size={14} /> Leave room
              </Button>
            </section>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <DialogPresence>
        {dialog?.kind === "add" && (
          <AddMembersDialog
            conversationId={c.id}
            onClose={() => setDialog(null)}
            onAdded={() => {
              setDialog(null);
              onChanged();
            }}
          />
        )}
        {dialog?.kind === "edit" && (
          <EditRoomDialog
            conversation={c}
            onClose={() => setDialog(null)}
            onSaved={() => {
              setDialog(null);
              onChanged();
            }}
          />
        )}
        {dialog?.kind === "leave" && (
          <ConfirmDialog
            title="Leave room?"
            body={
              isOwner && detail.members.length > 1
                ? "You own this room. Ownership passes to the longest-serving admin, or member if there is none. You'll need to be added again to return."
                : c.visibility === "private"
                  ? "You'll need to be added again to return."
                  : "You can rejoin from Browse rooms."
            }
            action="Leave"
            destructive
            onClose={() => setDialog(null)}
            onConfirm={() =>
              run(() => collabFetch(`/conversations/${c.id}/members?userId=${encodeURIComponent(actor.id)}`, { method: "DELETE" }), onLeft)
            }
          />
        )}
        {dialog?.kind === "archive" && (
          <ConfirmDialog
            title={dialog.archived ? "Archive room?" : "Restore room?"}
            body={
              dialog.archived
                ? "Members keep the history, but no one can post until the room is restored."
                : "Members will be able to post again."
            }
            action={dialog.archived ? "Archive" : "Restore"}
            destructive={dialog.archived}
            onClose={() => setDialog(null)}
            onConfirm={() =>
              run(
                () => collabFetch(`/conversations/${c.id}`, { method: "PATCH", body: { archived: dialog.archived } }),
                onChanged,
              )
            }
          />
        )}
        {dialog?.kind === "remove" && (
          <ConfirmDialog
            title={`Remove ${dialog.member.name}?`}
            body="They lose access to this room and its history."
            action="Remove"
            destructive
            onClose={() => setDialog(null)}
            onConfirm={() =>
              run(
                () =>
                  collabFetch(
                    `/conversations/${c.id}/members?userId=${encodeURIComponent(dialog.member.id)}`,
                    { method: "DELETE" },
                  ),
                onChanged,
              )
            }
          />
        )}
      </DialogPresence>
    </aside>
  );
}
