"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Maximize2, ZoomIn } from "lucide-react";
import type { RecordItem } from "@/lib/domain";
import { Button } from "./ui/controls";
import { QuotationDocument } from "./quotation-document";

export function DocumentPreview({
  record,
  connected = false,
}: {
  record: RecordItem;
  connected?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(794);
  const [height, setHeight] = useState(1123);
  const [actualSize, setActualSize] = useState(false);
  useEffect(() => {
    if (!frame.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(1, entry.contentRect.width - 2)),
    );
    observer.observe(frame.current);
    const sheetObserver = new ResizeObserver(([entry]) =>
      setHeight(Math.max(1123, entry.contentRect.height)),
    );
    if (paper.current) sheetObserver.observe(paper.current);
    return () => {
      observer.disconnect();
      sheetObserver.disconnect();
    };
  }, []);
  useEffect(() => setActualSize(false), [record.id]);
  const scale = actualSize ? 1 : width / 794;
  return (
    <div className="quotation-dialog-preview">
      <div className="document-preview-toolbar">
        <div>
          <strong>A4 Document Preview</strong>
          <span>Sender details, terms and signing area</span>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={() => setActualSize(!actualSize)}
        >
          {actualSize ? <Maximize2 size={14} /> : <ZoomIn size={14} />}{" "}
          {actualSize ? "Fit To Width" : "Actual Size"}
        </Button>
      </div>
      <div
        className="document-preview-stage"
        ref={frame}
        data-preview-mode={actualSize ? "actual" : "fit"}
      >
        <div
          className="document-preview-space"
          style={{ width: 794 * scale, height: height * scale }}
        >
          <div
            className="document-preview-sheet"
            ref={paper}
            style={
              {
                "--preview-scale": scale,
                transform: `scale(${scale})`,
              } as CSSProperties
            }
          >
            <QuotationDocument record={record} connected={connected} />
          </div>
        </div>
      </div>
      <p className="document-print-guidance">
        Printing uses the clean document layout. If your browser still adds a
        date or page title, turn off “Headers and footers” in its print
        settings.
      </p>
    </div>
  );
}
