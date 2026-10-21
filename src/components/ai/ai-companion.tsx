"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Sparkles, ArrowUpRight } from "lucide-react";
import { Button, Dialog, DialogActions, DialogPresence } from "../ui/controls";
import { SkeletonPage } from "../ui/skeleton";
import {
  allowedModules,
  type Actor,
  type Module,
  type RecordItem,
} from "@/lib/domain";
import type { AiPageContext } from "@/lib/ai/page-context";
const Chat = dynamic(() => import("./ai-chat"), {
  ssr: false,
  loading: () => <SkeletonPage variant="chat" />,
});
export function AiCompanion({
  actor,
  module,
  company,
  records,
  record,
  preview,
  onOpen,
  view,
}: {
  actor: Actor;
  module: Module;
  company: string;
  records: RecordItem[];
  record?: RecordItem;
  preview: boolean;
  onOpen: () => void;
  view?: AiPageContext["view"];
}) {
  const [open, setOpen] = useState(false);
  useEffect(
    () => setOpen(false),
    [module, company, record?.id, view, actor.id, actor.role],
  );
  if (!allowedModules(actor).includes(module)) return null;
  return (
    <>
      <Button
        className="ai-companion-trigger"
        aria-label="Open Enercore assistant"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Sparkles size={16} />
        Ask AI
      </Button>
      <DialogPresence>
        {open && (
          <Dialog
            title="Enercore assistant"
            className="ai-page-assistant"
            variant="drawer"
            modal={false}
            dismissOnOutside={false}
            onClose={() => setOpen(false)}
          >
            <Chat
              actor={actor}
              preview={preview}
              records={records}
              company={company}
              module={module}
              record={record}
              view={view}
              compact
            />
            <DialogActions
              cancel={false}
              start={
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => {
                    setOpen(false);
                    onOpen();
                  }}
                >
                  Open full chat
                  <ArrowUpRight size={14} />
                </Button>
              }
              secondary={
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setOpen(false)}
                >
                  Close
                </Button>
              }
            />
          </Dialog>
        )}
      </DialogPresence>
    </>
  );
}
