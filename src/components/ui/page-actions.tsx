"use client";
import { Button } from "./controls";
import { MoreActions, type RowAction } from "./row-actions";
/** Only crowded page-level action rows get an overflow menu. */
export function PageActions({
  actions,
  label,
}: {
  actions: RowAction[];
  label: string;
}) {
  const crowded = actions.length > 5,
    shown = crowded ? actions.slice(0, 3) : actions,
    more = crowded ? actions.slice(3) : [];
  return (
    <div className="page-action-group" data-action-count={actions.length}>
      {shown.map((a) => (
        <Button
          key={a.id}
          variant={a.destructive ? "danger" : "secondary"}
          size="small"
          disabled={a.disabled}
          onClick={a.run}
        >
          {a.icon}
          {a.label}
        </Button>
      ))}
      {!!more.length && (
        <MoreActions label={label} triggerLabel="More" actions={more} />
      )}
    </div>
  );
}
