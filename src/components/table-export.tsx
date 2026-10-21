"use client";
import { createContext, useContext } from "react";
import type { Actor } from "@/lib/domain";
import { downloadTable, listExportData } from "@/lib/table-export";
import { Button } from "./ui/controls";
import { Download } from "lucide-react";
const ExportActor = createContext<Actor | null>(null);
export function TableExportProvider({
  actor,
  children,
}: {
  actor: Actor;
  children: React.ReactNode;
}) {
  return <ExportActor.Provider value={actor}>{children}</ExportActor.Provider>;
}
export function useTableExport() {
  const actor = useContext(ExportActor);
  return {
    available: !!actor,
    run: (rows: object[], title: string) => {
      if (actor)
        downloadTable({
          ...listExportData(rows, title),
          exportedBy: actor.name,
        });
    },
  };
}
export function TableExportButton({
  rows,
  title,
  disabled = false,
}: {
  rows: object[];
  title: string;
  disabled?: boolean;
}) {
  const exporter = useTableExport();
  return exporter.available ? (
    <Button
      variant="secondary"
      size="small"
      aria-label={`Export ${title} to Excel`}
      disabled={disabled || !rows.length}
      onClick={() => exporter.run(rows, title)}
    >
      <Download size={15} />
      Export Excel
    </Button>
  ) : null;
}
