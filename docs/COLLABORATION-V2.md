# Collaboration Hub V2 — design notes

Status: implemented, **not yet deployed**. Migration `0004_collaboration_v2` is
additive and not applied remotely. The R2 bucket does not exist yet.

## Presence

- **Authority:** Durable Objects. Each person's `CollabHub` derives their status
  from their open sockets across every tab and device:
  - **online**: at least one socket reports *active*;
  - **away**: sockets are open but all report *idle*;
  - **offline**: no socket.
- **Idle:** a tab is idle while it's hidden, or after 5 minutes without
  pointer, keyboard, wheel or touch input. It sends only changes, as
  `{"type":"activity","state":"active"|"idle"}`. That is the only message a
  client ever sends over the socket, and it can only change its owner's
  presence.
- **Directory:** a `CollabHub` instance under the reserved name
  `presence-directory` holds everyone's current status, in DO storage, for
  lookups. The gateway refuses to route any session to that name.
- **Fan-out:** only on a change, to people who share both a conversation *and* a
  company with the person, capped at 500.
- **Lookup:** `GET /api/collab/presence?ids=` answers only for active people who
  share a company with the caller.
- **Last seen:** stored in D1 `CollabPresence`, written once, when a person's
  final connection closes. It isn't written per heartbeat, and there is no
  permanent "online" flag. Shown as "Last seen 4 min ago", "Last seen 2:35 pm"
  (GST), "Last seen yesterday" or "Last seen 25 Sep".

## Typing

`POST /conversations/:id/typing {state}` requires the right to post in the
conversation. It is published to the conversation's current audience, never
back to the typist. Nothing is stored.

- Clients send "start" at most every 3 seconds, and "stop" on send, on clearing
  the text, and on leaving.
- Receivers expire a typing state after 6 seconds without a fresh "start".
- Every recipient hub drops repeats within 1.5 seconds, so a misbehaving client
  can't flood anyone.

## Attachments (R2)

- **Storage:** bytes live in R2 (`COLLAB_FILES`, private bucket). D1 `Attachment`
  holds metadata only. Storage keys are random (`att/<40 hex>`, `room/<40 hex>`)
  and never derived from filenames.
- **Accepted types:** a file is accepted only when its **extension and leading
  bytes agree**:
  - images: JPEG, PNG, GIF, WebP;
  - PDF;
  - documents: DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, ZIP;
  - audio: WebM, Ogg, M4A, MP3, WAV.

  The browser's MIME claim is ignored, and the served type is the one detected.
  HTML, SVG, XML, scripts and executables match nothing and are rejected.
- **Limits:**
  - per file: images 15 MB, PDF and documents 25 MB, audio 10 MB;
  - 10 files per message; voice notes up to 5 minutes;
  - uploads rate-limited to 60 per 10 minutes per person.
- **Previews:** images carry a client-made JPEG preview of at most 480px (itself
  validated as an image, at most 400 KB). Messages show previews; the lightbox
  loads the full file.
- **Upload flow:** `POST /conversations/:id/attachments` creates a *pending* row
  that only the uploader can see. Sending with `attachmentIds` links them, in
  the same D1 batch as the message, guarded to the sender's own pending uploads
  in that conversation.
- **Delivery:** served only by the Worker route `/api/collab/files/:id`
  (`?thumb`, `?download`), ahead of Next.js. Each request re-checks:
  1. session, active account and role;
  2. current conversation access (membership plus company/branch scope);
  3. that the file isn't deleted;
  4. for a pending file, that the caller is the uploader.

  Any refusal is the same 404, so neither an attachment id nor an R2 key grants
  anything. A removed member loses access on their next request; images can
  stay in that browser's cache for up to 5 minutes (documents are `no-store`).
- **Response headers:**
  - `nosniff`, and `Content-Disposition` with an ASCII fallback plus an RFC 5987
    UTF-8 name, so the original filename is kept without header injection;
  - `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`;
  - inline display only for images, PDFs and audio; everything else downloads;
  - non-PDF responses are sandboxed with `default-src 'none'` and are
    unframeable;
  - PDFs are frameable only by this site, for the in-app preview in the
    browser's own viewer. Nothing is parsed server-side.
- **Office files:** Word, Excel and PowerPoint show as file cards with Download.
  There's no preview, because no safe browser-native viewer exists and no
  third-party preview service is used.

## Retention

- **Deleting a message:** its text, mentions and reactions go, and its
  attachments are marked deleted. They're unreachable from that moment.
- **Scheduled purge:** a daily cron (`23 2 * * *`) deletes, from both R2 and D1:
  - uploads never sent within 1 day;
  - files whose message was deleted more than 30 days ago.

  The 30 days is a recovery window only, not visibility.
- **Room images:** replaced or removed images are deleted from R2 at once.

## Reactions

- One `MessageReaction` row per (message, person, emoji). The primary key makes
  duplicates impossible, and adding an existing reaction is a no-op.
- Only emoji from the known set are accepted.
- Reactions are rate-limited to 120 per minute, broadcast to the conversation's
  current audience, and cleared when the message is deleted.

## Room avatars

- Owners and admins only. The client centre-crops and scales to a 256px JPEG;
  the server accepts a real JPEG/PNG/WebP/GIF of at most 2 MB.
- Stored in R2 under a random key. `Conversation.avatarKey` and
  `avatarUpdatedAt` hold the metadata, and the timestamp is the cache version in
  the URL.
- Served by `/api/collab/rooms/:id/avatar` to members, or to people who could
  join a workspace room. Changes are audited and announced live.

## Before deploying V2

1. Back up D1, then `npm run db:migrate:remote`. Migration 0004 only adds
   tables, and two nullable columns on `Conversation`.
2. `wrangler r2 bucket create enercore-collab-files`. Keep it private: no
   public access and no custom domain.
3. `npm run cf:deploy:live`. This adds the `COLLAB_FILES` binding and the cron
   trigger to `enercore-crm-live` only; preview gets neither.
