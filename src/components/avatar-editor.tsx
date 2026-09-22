"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Trash2, ZoomIn } from "lucide-react";
import { Button, Dialog, DialogActions, DialogPresence } from "./ui/controls";
import { Avatar } from "./avatar";
import { readAvatar, writeAvatar, useAvatar } from "@/lib/avatar-store";

const VIEW = 264;
const OUTPUT = 256;
const MAX_FILE = 8 * 1024 * 1024;

/** Square crop with drag to reposition and a zoom control. */
function Cropper({
  source,
  onSave,
}: {
  source: string;
  onSave: (image: string) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const element = new window.Image();
    element.onload = () => setImage(element);
    element.onerror = () => setError("That file could not be read as an image.");
    element.src = source;
  }, [source]);

  // At zoom 1 the image exactly covers the square, so no gap can appear.
  const base = image ? Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight) : 1;
  const scale = base * zoom;
  const limit = (value: number, span: number) => {
    const max = Math.max(0, (span * scale - VIEW) / 2);
    return Math.min(max, Math.max(-max, value));
  };
  const clamped = image
    ? { x: limit(offset.x, image.naturalWidth), y: limit(offset.y, image.naturalHeight) }
    : offset;

  function save() {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext("2d");
    if (!context) return setError("This browser cannot prepare the image.");
    // Map the visible square back onto the source image.
    const half = VIEW / 2 / scale;
    const centreX = image.naturalWidth / 2 - clamped.x / scale;
    const centreY = image.naturalHeight / 2 - clamped.y / scale;
    context.drawImage(
      image,
      centreX - half, centreY - half, half * 2, half * 2,
      0, 0, OUTPUT, OUTPUT,
    );
    onSave(canvas.toDataURL("image/jpeg", 0.85));
  }

  return (
    <>
      <p className="muted small">
        Drag the picture to reposition it and use the slider to zoom. Only the
        square area is saved. The picture stays in this browser: it is not
        uploaded and will not follow you to another device.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <div
        className="crop-viewport"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={(event) => {
          if (!image) return;
          drag.current = { x: event.clientX, y: event.clientY, ox: clamped.x, oy: clamped.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (!from) return;
          setOffset({ x: from.ox + (event.clientX - from.x), y: from.oy + (event.clientY - from.y) });
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source}
            alt=""
            draggable={false}
            style={{
              width: image.naturalWidth * scale,
              height: image.naturalHeight * scale,
              transform: `translate(calc(-50% + ${clamped.x}px), calc(-50% + ${clamped.y}px))`,
            }}
          />
        )}
      </div>
      <label className="crop-zoom">
        <span><ZoomIn size={15} aria-hidden="true" /> Zoom</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          aria-label="Zoom picture"
          onChange={(event) => setZoom(Number(event.target.value))}
        />
      </label>
      <DialogActions>
        {/* The shared dialog already supplies Close, so only Save is added. */}
        <Button className="primary" disabled={!image} onClick={save}>Save picture</Button>
      </DialogActions>
    </>
  );
}

export function AvatarEditor({
  id,
  name,
  size = 96,
}: {
  id: string;
  name: string;
  size?: number;
}) {
  const current = useAvatar(id);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="avatar-editor">
      <span className="avatar-editor-photo">
        <Avatar name={name} image={current} size={size} />
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="visually-hidden"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (!chosen) return;
            if (chosen.size > MAX_FILE) return setError("Choose an image under 8 MB.");
            setError("");
            const reader = new FileReader();
            reader.onload = () => setSource(String(reader.result || ""));
            reader.onerror = () => setError("That file could not be read.");
            reader.readAsDataURL(chosen);
          }}
        />
        <button
          type="button"
          className="avatar-editor-camera"
          aria-label={current ? "Change profile picture" : "Add profile picture"}
          onClick={() => file.current?.click()}
        >
          <Camera size={15} aria-hidden="true" />
        </button>
      </span>
      {current && (
        <Button className="text-button delete-action" onClick={() => writeAvatar(id, "")}>
          Remove
        </Button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <DialogPresence>
        {source && (
          <Dialog title="Crop your picture" onClose={() => setSource("")}>
            <Cropper
              source={source}
              onSave={(image) => {
                writeAvatar(id, image);
                setSource("");
              }}
            />
          </Dialog>
        )}
      </DialogPresence>
    </div>
  );
}

export { readAvatar };
