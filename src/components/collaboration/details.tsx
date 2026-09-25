"use client";

import { useState } from "react";
import { LogOut, MoreHorizontal, Settings2, UserPlus, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import type { ConversationDetail, ConversationMemberView } from "@/lib/collab";
import type { Actor } from "@/lib/domain";
import { companyName } from "@/lib/company-name";
import { collabFetch, presenceLabel, usePresence } from "@/lib/collab-client";
import { Button, DialogPresence } from "../ui/controls";
import { Avatar } from "../avatar";
import { Skeleton } from "../ui/skeleton";
import { AddMembersDialog, ConfirmDialog, EditRoomDialog } from "./dialogs";
import { PersonAvatar, ProfilePopover } from "./presence";
import { RoomAvatar } from "./room-avatar";
import { DetailsMedia } from "./media-panel";

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
  onManageAccess,
}: {
  detail: ConversationDetail | null;
  actor: Actor;
  onClose: () => void;
  onChanged: () => void;
  onLeft: () => void;
  onMessage: (userId: string) => void;
  onManageAccess?: () => void;
}) {
  const presenceOf = usePresence(detail?.members.map((m) => m.id) ?? [], !!detail);
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
        {/* Mirrors the real panel: title, description, two facts, then
            the member list, so nothing moves when the details arrive. */}
        <div className="collab-details-body collab-details-skeleton">
          <section className="collab-details-section">
            <Skeleton w="55%" h={14} />
            <Skeleton w="90%" h={11} />
            <div className="collab-facts">
              <Skeleton w="70%" h={11} />
              <Skeleton w="60%" h={11} />
            </div>
          </section>
          <section className="collab-details-section">
            <Skeleton w="35%" h={13} />
            {[0, 1, 2].map((i) => (
              <div className="collab-member-row" key={i}>
                <Skeleton w={28} h={28} r={999} />
                <span className="collab-member-name">
                  <Skeleton w="65%" h={11} />
                  <Skeleton w="40%" h={10} />
                </span>
              </div>
            ))}
          </section>
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
          <>
            <div className="collab-profile">
              <PersonAvatar name={c.title} size={64} presence={c.counterpart ? presenceOf(c.counterpart.id) : undefined} />
              <b>{c.title}</b>
              <small>{c.counterpart?.role}</small>
              {c.counterpart && !c.counterpart.active ? (
                <span className="e-badge tone-neutral">Inactive</span>
              ) : (
                c.counterpart && <span className="collab-profile-status">{presenceLabel(presenceOf(c.counterpart.id))}</span>
              )}
            </div>
            <DetailsMedia conversationId={c.id} />
          </>
        ) : (
          <>
            <div className="collab-room-card">
              <RoomAvatar room={c} size={64} />
              <b>{c.title}</b>
              <small>
                {detail.members.length} {detail.members.length === 1 ? "member" : "members"}
                {(() => {
                  const online = detail.members.filter((m) => presenceOf(m.id)?.status === "online").length;
                  return online ? ` · ${online} online` : "";
                })()}
              </small>
            </div>
            <section className="collab-details-section">
              <div className="collab-details-subhead">
                <h4>About</h4>
                {detail.canAdmin && (
                  <Button className="secondary compact" onClick={() => setDialog({ kind: "edit" })}>
                    <Settings2 size={14} aria-hidden="true" /> Settings
                  </Button>
                )}
              </div>
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
            </section>
            <section className="collab-details-section">
              <div className="collab-details-subhead">
                <h4>
                  Members <span>{detail.members.length}</span>
                </h4>
                {detail.canAdmin && !c.archived && (
                  <Button className="secondary compact" onClick={() => setDialog({ kind: "add" })}>
                    <UserPlus size={14} aria-hidden="true" /> Add
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
                    <li key={m.id} className="collab-member-row">
                      <ProfilePopover
                        person={m}
                        presence={presenceOf(m.id)}
                        meId={actor.id}
                        onMessage={onMessage}
                        onManageAccess={onManageAccess}
                      >
                        <button type="button" className="collab-avatar-button" aria-label={`Profile of ${m.name}`}>
                          <PersonAvatar name={m.name} size={28} presence={m.active ? presenceOf(m.id) : undefined} />
                        </button>
                      </ProfilePopover>
                      <span className="collab-member-name">
                        {m.name}
                        {m.id === actor.id && <em> (you)</em>}
                        <small>
                          {[m.role, m.active ? presenceLabel(presenceOf(m.id)) || null : "Inactive"].filter(Boolean).join(" · ")}
                        </small>
                      </span>
                      {/* Fixed columns: the badge and the actions keep their
                          place whether or not a row has them. */}
                      <span className="collab-member-badge">
                        {roleLabel[m.memberRole] && <span className="e-badge tone-info is-sm">{roleLabel[m.memberRole]}</span>}
                      </span>
                      {!(manageable || (m.id !== actor.id && m.active)) && <span aria-hidden="true" />}
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
            <DetailsMedia conversationId={c.id} />
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {/* Leaving is the panel's one exit action: always in the same place,
          pinned below the scrolling content, styled as destructive. */}
      {!direct && (
        <div className="collab-details-foot">
          <Button className="secondary delete-action collab-leave" onClick={() => setDialog({ kind: "leave" })}>
            <LogOut size={15} aria-hidden="true" /> Leave room
          </Button>
        </div>
      )}

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
            onImageChanged={onChanged}
            onArchive={() => setDialog({ kind: "archive", archived: !c.archived })}
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
