"use client";

import { Skeleton } from "../ui/skeleton";

/**
 * Loading placeholders shaped exactly like the Collaboration content they
 * stand in for — same classes, paddings and line heights as the real rows —
 * so nothing moves when the data arrives. Kept in their own small module so
 * the workspace can show the hub's shape while the hub's code is loading.
 */

/** One conversation row: avatar, name + time, one preview line. */
export function ConversationRowSkeleton({ width = 60 }: { width?: number }) {
  return (
    <div className="collab-row is-skeleton" aria-hidden="true">
      <Skeleton w={34} h={34} r={10} />
      <span className="collab-row-main">
        <span className="collab-row-top">
          <Skeleton w={`${width}%`} h={12} />
          <Skeleton w={34} h={10} />
        </span>
        <Skeleton w={`${Math.min(92, width + 22)}%`} h={10} />
      </span>
    </div>
  );
}

export function ConversationListSkeleton({ rows = 7, label = "Loading conversations" }: { rows?: number; label?: string }) {
  const widths = [58, 44, 66, 50, 38, 62, 47, 55];
  return (
    <div aria-busy="true" aria-label={label} className="collab-list-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <ConversationRowSkeleton key={i} width={widths[i % widths.length]} />
      ))}
    </div>
  );
}

/** A person in a picker: avatar, name, role. No status pill. */
export function PersonRowSkeleton() {
  return (
    <div className="collab-person-skeleton" aria-hidden="true">
      <Skeleton w={30} h={30} r={999} />
      <span>
        <Skeleton w="48%" h={12} />
        <Skeleton w="30%" h={10} />
      </span>
    </div>
  );
}

/** The whole hub while its code loads: list, and an empty thread frame. */
export function HubSkeleton() {
  return (
    <div className="collab collab-loading" aria-busy="true" aria-label="Loading collaboration">
      <aside className="collab-sidebar">
        <div className="collab-sidebar-head">
          <Skeleton w={120} h={16} />
        </div>
        <div className="collab-search">
          <Skeleton h={34} r={8} />
        </div>
        <div className="collab-filters">
          {[64, 108, 52, 58, 70].map((w, i) => (
            <Skeleton key={i} w={w} h={28} r={999} />
          ))}
        </div>
        <div className="collab-list">
          {Array.from({ length: 7 }, (_, i) => (
            <ConversationRowSkeleton key={i} width={[58, 44, 66, 50, 38, 62, 47][i]} />
          ))}
        </div>
      </aside>
      <div className="collab-main" />
    </div>
  );
}
