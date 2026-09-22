"use client";
import { useState } from "react";
import {
  Search,
  ArrowUpRight,
  X,
  Command,
  Plus,
  Layers,
  FileText,
} from "lucide-react";
import { Button, Input, Dialog, DialogActions } from "./ui/controls";
export type CommandItem = {
  id: string;
  label: string;
  detail: string;
  record?: boolean;
  run: () => void;
};
export default function CommandMenu({
  items,
  onClose,
}: {
  items: CommandItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("create");
  const categoryOf = (i: CommandItem) =>
    i.record
      ? "records"
      : i.detail.startsWith("Create")
        ? "create"
        : "navigate";
  const visible = items
    .filter(
      (i) =>
        (query.trim() || categoryOf(i) === category) &&
        `${i.label} ${i.detail}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 16);
  return (
    <Dialog title="Quick actions" onClose={onClose}>
      <div className="command-heading">
        <span className="command-emblem">
          <Command size={21} />
        </span>
        <div>
          <h2>Quick actions</h2>
          <p>Create something new or jump to your work.</p>
        </div>
        <Button
          className="icon-button"
          aria-label="Close command menu"
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      <div className="command-search">
        <Search size={18} />
        <Input
          autoFocus
          aria-label="Search commands and records"
          placeholder="Search a page, company, record or action…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              document
                .querySelector<HTMLButtonElement>(".command-item")
                ?.focus();
            }
            if (e.key === "Enter" && visible[0]) {
              e.preventDefault();
              onClose();
              visible[0].run();
            }
          }}
        />
      </div>
      {!query && (
        <div className="command-tabs" aria-label="Command categories">
          {[
            ["create", "Create new"],
            ["navigate", "Go to page"],
            ["records", "Find records"],
          ].map(([value, label]) => (
            <Button
              key={value}
              aria-pressed={category === value}
              className={category === value ? "selected" : ""}
              onClick={() => setCategory(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      <div
        className={`command-list ${!query && category === "create" ? "command-grid" : ""}`}
      >
        {visible.map((item, index) => (
          <Button
            key={item.id}
            className="command-item"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const nodes =
                  document.querySelectorAll<HTMLButtonElement>(".command-item");
                nodes[
                  (index + (e.key === "ArrowDown" ? 1 : -1) + nodes.length) %
                    nodes.length
                ]?.focus();
              }
            }}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span className="command-action-icon">
              {item.record ? (
                <FileText size={18} />
              ) : categoryOf(item) === "create" ? (
                <Plus size={18} />
              ) : (
                <Layers size={18} />
              )}
            </span>
            <span>
              {item.label}
              <small>{item.detail}</small>
            </span>
            <ArrowUpRight size={16} />
          </Button>
        ))}
        {!visible.length && (
          <div className="empty">
            <h3>No matches</h3>
            <p>Try a customer name, company or module.</p>
          </div>
        )}
      </div>
      <DialogActions>
        <div className="command-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>Enter</kbd> Open
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </DialogActions>
    </Dialog>
  );
}
