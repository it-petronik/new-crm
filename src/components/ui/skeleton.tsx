"use client";

/**
 * Loading placeholders.
 *
 * The purpose is to keep the page's structure on screen while its data
 * arrives, so nothing jumps when it does. Every placeholder is hidden from
 * assistive technology — a screen reader should hear "loading", once, from the
 * region that is loading, not a description of grey rectangles. The region
 * itself carries aria-busy and a single polite message.
 */

export function Skeleton({ w, h = 14, r, className }: { w?: number | string; h?: number | string; r?: number; className?: string }) {
  return (
    <span
      className={`skeleton${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{ width: w ?? "100%", height: h, borderRadius: r ?? 6 }}
    />
  );
}

export function SkeletonText({ lines = 3, width = ["92%", "78%", "56%"] }: { lines?: number; width?: (string | number)[] }) {
  return (
    <span className="skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} w={width[i % width.length]} h={11} />
      ))}
    </span>
  );
}

/** Wraps a loading region: one announcement, no placeholder noise. */
export function SkeletonRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="skeleton-region" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div className="skeleton-kpis" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-kpi skeleton-card">
          <Skeleton w="45%" h={11} />
          <Skeleton w="62%" h={26} />
          <Skeleton w="72%" h={10} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonListRow() {
  return (
    <div className="skeleton-row" aria-hidden="true">
      <Skeleton w={30} h={30} r={999} />
      <div className="skeleton-row-main">
        <Skeleton w="42%" h={12} />
        <Skeleton w="26%" h={10} />
      </div>
      <Skeleton w={86} h={22} r={999} />
    </div>
  );
}

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="panel skeleton-table" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <SkeletonListRow key={i} />)}
    </div>
  );
}

export function SkeletonPanel({ lines = 3, title = true }: { lines?: number; title?: boolean }) {
  return (
    <section className="panel skeleton-card" aria-hidden="true">
      {title && <Skeleton w="34%" h={14} />}
      <SkeletonText lines={lines} />
    </section>
  );
}

/** The executive dashboard's own shape: attention, KPIs, then analysis. */
export function SkeletonDashboard() {
  return (
    <SkeletonRegion label="Loading your dashboard">
      {/* The loaded executive layout, piece for piece: the KPI strip, then the
          same e-exec-grid (attention | pipeline health), then Operations —
          so nothing moves or reflows when the data lands. */}
      <SkeletonKpiRow />
      <div className="e-exec-grid">
        <section className="panel skeleton-attention" aria-hidden="true">
          <Skeleton w="30%" h={13} />
          <div className="skeleton-stack">
            {[0, 1, 2].map((i) => <SkeletonAttnRow key={i} />)}
          </div>
        </section>
        <SkeletonPanel lines={4} />
      </div>
      <SkeletonPanel lines={2} />
    </SkeletonRegion>
  );
}

/** Matches a loaded attention row: identity, detail, and its action button. */
export function SkeletonAttnRow() {
  return (
    <div className="skeleton-attn-row" aria-hidden="true">
      <div className="skeleton-row-main">
        <Skeleton w="38%" h={12} />
        <Skeleton w="58%" h={10} />
      </div>
      <Skeleton w={96} h={26} r={7} />
    </div>
  );
}

/** My Day's own shape: greeting, actions, then the day's items. */
export function SkeletonMyDay() {
  return (
    <SkeletonRegion label="Loading your day">
      <div className="skeleton-my-day" aria-hidden="true">
        <header className="skeleton-day-head">
          <div style={{ flex: "1 1 240px" }}>
            <Skeleton w={70} h={10} />
            <Skeleton w="54%" h={24} />
            <Skeleton w="40%" h={11} />
          </div>
          <div className="skeleton-day-actions">
            {[0, 1].map((i) => <Skeleton key={i} w={120} h={34} r={8} />)}
          </div>
        </header>
        <section className="panel skeleton-attention tone-warning">
          <Skeleton w="30%" h={13} />
          <div className="skeleton-stack">
            {[0, 1, 2].map((i) => <SkeletonAttnRow key={i} />)}
          </div>
        </section>
        <div className="skeleton-two-col">
          <SkeletonPanel lines={3} />
          <SkeletonPanel lines={3} />
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** A list keeps its toolbar; only the rows are replaced. */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <SkeletonRegion label="Loading records">
      <SkeletonTable rows={rows} />
    </SkeletonRegion>
  );
}
