"use client";
import type { ReactNode } from "react";
import { Clock, Filter } from "lucide-react";
import { Select } from "../ui/controls";
import { Avatar } from "../avatar";
import { BrandLogo } from "../brand";
import { companyName } from "@/lib/company-name";
import { businessToday } from "@/lib/gst";
import { money, stages, type RecordItem } from "@/lib/domain";
import styles from "./pipeline-board.module.css";

/** A compact alternate view of the same permission-scoped leads, with no writes. */
export function PipelineBoard({
  records,
  filter,
  onFilter,
  onOpen,
  actions,
}: {
  records: RecordItem[];
  filter: string;
  onFilter: (stage: string) => void;
  onOpen: (record: RecordItem) => void;
  actions: (record: RecordItem) => ReactNode;
}) {
  const today = businessToday();
  const columns = stages.leads.filter(
    (s) => filter === "All statuses" || s === filter,
  );
  return (
    <section className={styles.board} aria-label="Lead pipeline board">
      <header className={styles.toolbar}>
        <div className={styles.caption}>
          <h2>Pipeline</h2>
          <span>
            {records.length} {records.length === 1 ? "lead" : "leads"}
          </span>
        </div>
        <div className={styles.filter}>
          <Filter size={14} aria-hidden="true" />
          <Select
            aria-label="Pipeline stage"
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
          >
            <option>All statuses</option>
            {stages.leads.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </div>
      </header>
      <div
        className={styles.columns}
        role="region"
        aria-label="Pipeline stages"
        tabIndex={0}
      >
        {columns.map((stage) => {
          const leads = records.filter((r) => r.status === stage);
          return (
            <section
              className={styles.column}
              data-stage={stage}
              key={stage}
              aria-label={`${stage} leads`}
            >
              <header className={styles.stage}>
                <h3>
                  <i aria-hidden="true" />
                  {stage}
                </h3>
                <span>{leads.length}</span>
              </header>
              <div className={styles.cards}>
                {leads.map((record) => {
                  const overdue =
                    record.due &&
                    record.due < today &&
                    !["Won", "Lost"].includes(record.status);
                  const date = record.due
                    ? new Date(`${record.due}T12:00:00Z`)
                    : null;
                  const due =
                    date && !Number.isNaN(date.getTime())
                      ? new Intl.DateTimeFormat("en-GB", {
                          day: "numeric",
                          month: "short",
                          timeZone: "Asia/Dubai",
                        }).format(date)
                      : "No follow-up";
                  return (
                    <article className={styles.card} key={record.id}>
                      <button
                        type="button"
                        className={styles.open}
                        aria-label={`Open lead ${record.title}`}
                        onClick={() => onOpen(record)}
                      >
                        <span className={styles.brand}>
                          <BrandLogo
                            company={record.company}
                            className={styles.mark}
                          />
                          {companyName(record.company)}
                        </span>
                        <strong className={styles.name} title={record.title}>
                          {record.title}
                        </strong>
                        <span className={styles.product} title={record.product}>
                          {record.product || "Product not added"}
                        </span>
                        <strong className={styles.amount}>
                          {money(record.amount, record.currency)}
                        </strong>
                      </button>
                      <footer className={styles.footer}>
                        <span
                          className={styles.due}
                          data-overdue={!!overdue}
                          title={
                            record.due
                              ? `${overdue ? "Overdue follow-up" : "Follow-up"}: ${record.due}`
                              : "Set a next follow-up"
                          }
                        >
                          <Clock size={12} aria-hidden="true" />
                          {date ? (
                            <time dateTime={record.due}>{due}</time>
                          ) : (
                            due
                          )}
                        </span>
                        <span
                          className={styles.owner}
                          title={record.owner || "Unassigned"}
                        >
                          <Avatar
                            name={record.owner || "Unassigned"}
                            size={22}
                          />
                        </span>
                        {actions(record)}
                      </footer>
                    </article>
                  );
                })}
                {!leads.length && <p className={styles.empty}>No leads</p>}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
