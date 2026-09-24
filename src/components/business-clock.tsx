"use client";
import { useEffect, useState } from "react";
import { businessTime, businessDate, msToNextMinute, BUSINESS_UTC_OFFSET } from "@/lib/gst";

/**
 * The header clock, always Gulf Standard Time.
 *
 * It ticks on the minute rather than every second: seconds add nothing to a
 * business clock and would re-render the header sixty times more often. The
 * first tick is aligned to the turn of the minute so the displayed time is
 * never up to a minute stale.
 *
 * Rendered only after mount because the server and the reader's device can sit
 * on different minutes, and a mismatch there is a hydration error.
 */
export default function BusinessClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    let interval: ReturnType<typeof setInterval>;
    const align = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, msToNextMinute());
    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, []);

  // Reserve the space before the first tick so the header does not shift.
  if (!now) return <div className="business-clock" aria-hidden="true" />;

  return (
    <div className="business-clock" title={`Business time · Dubai · ${BUSINESS_UTC_OFFSET}`}>
      <span className="business-clock-time">
        {businessTime(now)} <abbr title="Gulf Standard Time">GST</abbr>
      </span>
      <small>Dubai · {BUSINESS_UTC_OFFSET} · {businessDate(now)}</small>
    </div>
  );
}
