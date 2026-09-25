"use client";

import { useCallback, useEffect, useState } from "react";
import type { AttachmentPage, AttachmentView } from "@/lib/collab";
import { collabFetch } from "@/lib/collab-client";
import { listStamp } from "./message-text";
import { Button, Dialog } from "../ui/controls";
import { Skeleton } from "../ui/skeleton";
import { FileCard, Lightbox, PdfPreview, VoicePlayer, type LightboxItem } from "./attachments";
import { DialogPresence } from "../ui/controls";

type Kind = "media" | "files" | "audio";
type Item = AttachmentPage["items"][number];

/** One page of a room's attachments; never the whole room at once. */
function useAttachments(conversationId: string, kind: Kind, limit: number) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(
    async (before?: string | null) => {
      setLoading(true);
      try {
        const page = await collabFetch<AttachmentPage>(
          `/conversations/${conversationId}/attachments?kind=${kind}&limit=${limit}${before ? `&before=${before}` : ""}`,
        );
        setItems((current) => (before && current ? [...current, ...page.items] : page.items));
        setNext(page.nextBefore);
      } catch {
        setItems((current) => current ?? []);
      } finally {
        setLoading(false);
      }
    },
    [conversationId, kind, limit],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { items, next, loading, more: () => void load(next), reload: () => void load() };
}

const toLightbox = (items: Item[]): LightboxItem[] =>
  items.map((i) => ({ attachment: i, authorName: i.authorName, createdAt: i.createdAt }));

function MediaGrid({ items, onOpen }: { items: Item[]; onOpen: (index: number) => void }) {
  return (
    <div className="collab-media-grid">
      {items.map((item, i) => (
        <button key={item.id} type="button" className="collab-media-tile" aria-label={`Open ${item.name}`} onClick={() => onOpen(i)}>
          <img src={item.thumbUrl ?? item.url} alt="" loading="lazy" decoding="async" />
        </button>
      ))}
    </div>
  );
}

function FileList({ items, onPdf }: { items: Item[]; onPdf: (a: AttachmentView) => void }) {
  return (
    <ul className="collab-file-list">
      {items.map((item) => (
        <li key={item.id}>
          <FileCard attachment={item} onPreview={item.kind === "pdf" ? () => onPdf(item) : undefined} />
          <small>
            {item.authorName} · {listStamp(item.createdAt)}
          </small>
        </li>
      ))}
    </ul>
  );
}

/**
 * The details panel's Media and Files sections: the most recent few, loaded
 * only when the panel is open, with "View all" for the full, paged browser.
 */
export function DetailsMedia({ conversationId }: { conversationId: string }) {
  const media = useAttachments(conversationId, "media", 6);
  const files = useAttachments(conversationId, "files", 5);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [pdf, setPdf] = useState<AttachmentView | null>(null);
  const [browser, setBrowser] = useState<Kind | null>(null);
  return (
    <>
      <section className="collab-details-section">
        <div className="collab-details-subhead">
          <h4>Media</h4>
          {!!media.items?.length && (
            <Button className="secondary compact" onClick={() => setBrowser("media")}>
              View all
            </Button>
          )}
        </div>
        {media.items === null ? (
          <div className="collab-media-grid" aria-busy="true" aria-label="Loading media">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} h="auto" r={8} className="collab-media-tile" />
            ))}
          </div>
        ) : media.items.length ? (
          <MediaGrid items={media.items} onOpen={setLightbox} />
        ) : (
          <p className="collab-details-empty">No photos yet.</p>
        )}
      </section>
      <section className="collab-details-section">
        <div className="collab-details-subhead">
          <h4>Files</h4>
          {!!files.items?.length && (
            <Button className="secondary compact" onClick={() => setBrowser("files")}>
              View all
            </Button>
          )}
        </div>
        {files.items === null ? (
          <div aria-busy="true" aria-label="Loading files">
            <Skeleton h={48} r={8} />
          </div>
        ) : files.items.length ? (
          <FileList items={files.items} onPdf={setPdf} />
        ) : (
          <p className="collab-details-empty">No files yet.</p>
        )}
      </section>
      {lightbox !== null && media.items && (
        <Lightbox items={toLightbox(media.items)} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />
      )}
      <DialogPresence>{pdf && <PdfPreview attachment={pdf} onClose={() => setPdf(null)} />}</DialogPresence>
      <DialogPresence>
        {browser && <AttachmentBrowser conversationId={conversationId} initial={browser} onClose={() => setBrowser(null)} />}
      </DialogPresence>
    </>
  );
}

/** Every attachment in a room, by kind, paged 30 at a time. */
function AttachmentBrowser({ conversationId, initial, onClose }: { conversationId: string; initial: Kind; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>(initial);
  const page = useAttachments(conversationId, kind, 30);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [pdf, setPdf] = useState<AttachmentView | null>(null);
  const tabs: [Kind, string][] = [
    ["media", "Media"],
    ["files", "Files"],
    ["audio", "Voice"],
  ];
  return (
    <Dialog title="Shared in this conversation" onClose={onClose} className="collab-browser-dialog">
      <div className="collab-filters collab-browser-tabs" role="tablist" aria-label="Show">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "is-active" : ""} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      {page.items === null ? (
        <div className="collab-media-grid is-large" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} h="auto" r={8} className="collab-media-tile" />
          ))}
        </div>
      ) : !page.items.length ? (
        <p className="collab-details-empty">Nothing shared yet.</p>
      ) : kind === "media" ? (
        <div className="collab-media-grid is-large">
          {page.items.map((item, i) => (
            <button key={item.id} type="button" className="collab-media-tile" aria-label={`Open ${item.name}`} onClick={() => setLightbox(i)}>
              <img src={item.thumbUrl ?? item.url} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      ) : kind === "audio" ? (
        <ul className="collab-file-list">
          {page.items.map((item) => (
            <li key={item.id}>
              <VoicePlayer attachment={item} />
              <small>
                {item.authorName} · {listStamp(item.createdAt)}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <FileList items={page.items} onPdf={setPdf} />
      )}
      {page.next && (
        <div className="collab-older">
          <Button className="secondary compact" loading={page.loading} onClick={page.more}>
            Load more
          </Button>
        </div>
      )}
      {lightbox !== null && page.items && kind === "media" && (
        <Lightbox items={toLightbox(page.items)} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />
      )}
      <DialogPresence>{pdf && <PdfPreview attachment={pdf} onClose={() => setPdf(null)} />}</DialogPresence>
    </Dialog>
  );
}
