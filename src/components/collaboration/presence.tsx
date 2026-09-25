"use client";

import type { ReactElement } from "react";
import * as Popover from "@radix-ui/react-popover";
import { MessageSquare, ShieldCheck } from "lucide-react";
import type { PresenceView } from "@/lib/collab";
import { presenceLabel } from "@/lib/collab-client";
import { companyName } from "@/lib/company-name";
import { Avatar } from "../avatar";
import { Button } from "../ui/controls";

/**
 * Presence, shown quietly: a small dot on an avatar (with a text label for
 * assistive technology — colour is never the only signal), and a line of text
 * where there is room for one.
 */
export function PresenceDot({ view, className = "" }: { view?: PresenceView; className?: string }) {
  if (!view) return null;
  return (
    <span
      className={`collab-presence is-${view.status} ${className}`}
      role="img"
      aria-label={presenceLabel(view)}
      title={presenceLabel(view)}
    />
  );
}

/** A person's avatar with their presence dot. */
export function PersonAvatar({ name, size, presence }: { name: string; size: number; presence?: PresenceView }) {
  return (
    <span className="collab-person-avatar" style={{ width: size, height: size }}>
      <Avatar name={name} size={size} />
      <PresenceDot view={presence} />
    </span>
  );
}

export type ProfilePerson = {
  id: string;
  name: string;
  role: string;
  /** Only companies the viewer shares with this person. */
  companies?: string[];
  active?: boolean;
};

/**
 * A small profile card on an avatar or name: who they are, where they are,
 * whether they are around. Deliberately nothing private — no email, phone or
 * access details — and a "Manage access" link only for administrators, who
 * already see all of that in Access control.
 */
export function ProfilePopover({
  person,
  presence,
  meId,
  onMessage,
  onManageAccess,
  children,
}: {
  person: ProfilePerson;
  presence?: PresenceView;
  meId: string;
  onMessage?: (userId: string) => void;
  onManageAccess?: () => void;
  children: ReactElement;
}) {
  const me = person.id === meId;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="collab-profile-card" side="right" align="start" sideOffset={8} collisionPadding={12}>
          <div className="collab-profile-card-head">
            <PersonAvatar name={person.name} size={48} presence={presence} />
            <div>
              <b>
                {person.name}
                {me && <em> (you)</em>}
              </b>
              <small>{person.role}</small>
              {presence && <span className={`collab-profile-status is-${presence.status}`}>{presenceLabel(presence)}</span>}
            </div>
          </div>
          {!!person.companies?.length && (
            <p className="collab-profile-card-meta">{person.companies.map((c) => companyName(c)).join(" · ")}</p>
          )}
          {person.active === false && <p className="collab-profile-card-meta">This account is inactive.</p>}
          {!me && (onMessage || onManageAccess) && (
            <div className="collab-profile-card-actions">
              {onMessage && person.active !== false && (
                <Popover.Close asChild>
                  <Button className="primary compact" onClick={() => onMessage(person.id)}>
                    <MessageSquare size={14} aria-hidden="true" /> Message
                  </Button>
                </Popover.Close>
              )}
              {onManageAccess && (
                <Popover.Close asChild>
                  <Button className="secondary compact" onClick={onManageAccess}>
                    <ShieldCheck size={14} aria-hidden="true" /> Manage access
                  </Button>
                </Popover.Close>
              )}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
