"use client";

import { useRef, useState } from "react";
import { Hash, ImagePlus, Lock, Trash2 } from "lucide-react";
import { roomAvatarUrl, type ConversationSummary } from "@/lib/collab";
import { ROOM_AVATAR_MAX, formatBytes } from "@/lib/collab-files";
import { collabFetch, uploadRoomAvatar } from "@/lib/collab-client";
import { initials } from "../avatar";
import { Button } from "../ui/controls";

type RoomLike = Pick<ConversationSummary, "id" | "title" | "visibility" | "avatarVersion">;

/**
 * A room's image: the uploaded picture, or a generated squircle with the
 * room's initials (private rooms carry a small lock). One shape everywhere —
 * list, header, details.
 */
export function RoomAvatar({ room, size = 34 }: { room: RoomLike; size?: number }) {
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.3) };
  if (room.avatarVersion)
    return (
      <span className="collab-room-avatar has-image" style={style} aria-hidden="true">
        <img src={roomAvatarUrl(room.id, room.avatarVersion)} alt="" loading="lazy" decoding="async" />
      </span>
    );
  const letters = initials(room.title);
  return (
    <span className="collab-room-avatar" style={{ ...style, fontSize: Math.max(10, Math.round(size * 0.36)) }} aria-hidden="true">
      {letters && letters !== "?" ? letters : <Hash size={Math.round(size * 0.45)} />}
      {room.visibility === "private" && size >= 30 && (
        <span className="collab-room-avatar-lock">
          <Lock size={9} />
        </span>
      )}
    </span>
  );
}

/** Centre-crops and scales an image to a 256px square JPEG, in the browser. */
async function squareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not read that image."))), "image/jpeg", 0.88),
  );
}

/** Room image controls for Room settings (owners and admins). */
export function RoomAvatarEditor({ room, onChanged }: { room: RoomLike; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) return setError("Choose an image file.");
    setBusy(true);
    try {
      const square = await squareImage(file);
      if (square.size > ROOM_AVATAR_MAX) throw new Error(`Room images can be at most ${formatBytes(ROOM_AVATAR_MAX)}.`);
      await uploadRoomAvatar(room.id, square);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await collabFetch(`/conversations/${room.id}/avatar`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="collab-avatar-editor">
      <RoomAvatar room={room} size={56} />
      <div className="collab-avatar-editor-actions">
        <Button className="secondary compact" disabled={busy} onClick={() => input.current?.click()}>
          <ImagePlus size={14} aria-hidden="true" /> {room.avatarVersion ? "Change image" : "Add image"}
        </Button>
        {room.avatarVersion && (
          <Button className="secondary compact delete-action" disabled={busy} onClick={() => void remove()}>
            <Trash2 size={14} aria-hidden="true" /> Remove
          </Button>
        )}
        <small>Square images work best. JPEG, PNG, WebP or GIF.</small>
        {error && <small className="is-error" role="alert">{error}</small>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        hidden
        onChange={(e) => void choose(e.target.files?.[0])}
      />
    </div>
  );
}
