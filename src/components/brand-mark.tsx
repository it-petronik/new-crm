import type { CSSProperties } from "react";
import { brandMarkFor } from "@/lib/brand-marks";

/** Shared screen/print symbol; inline crop geometry also survives standalone PDF export. */
export function BrandMark({
  src,
  label,
  className = "",
  style,
  padding = 0,
}: {
  src: string;
  label: string;
  className?: string;
  style?: CSSProperties;
  padding?: number;
}) {
  const mark = brandMarkFor(src);
  if (!mark)
    return <img src={src} alt={label} className={className} style={style} />;
  const [x, y, width, height] = mark.crop;
  return (
    <span
      className={className}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={!label || undefined}
      style={{
        display: "inline-block",
        aspectRatio: "1",
        flexShrink: 0,
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          overflow: "hidden",
          width: `${Math.min(1, width / height) * (1 - padding * 2) * 100}%`,
          height: `${Math.min(1, height / width) * (1 - padding * 2) * 100}%`,
        }}
      >
        <img
          src={mark.src}
          alt=""
          loading="eager"
          draggable={false}
          width={mark.width}
          height={mark.height}
          style={{
            position: "absolute",
            display: "block",
            width: `${(mark.width / width) * 100}%`,
            height: `${(mark.height / height) * 100}%`,
            maxWidth: "none",
            left: `${(-x / width) * 100}%`,
            top: `${(-y / height) * 100}%`,
            objectFit: "fill",
          }}
        />
      </span>
    </span>
  );
}
