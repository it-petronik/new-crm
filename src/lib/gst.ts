/**
 * Gulf Standard Time, the timezone Enercore does business in.
 *
 * Everything the business reads — the header clock, "today", a reminder time —
 * is presented in Asia/Dubai regardless of where the reader's laptop thinks it
 * is. Everything stored stays UTC, exactly as the rest of the system expects.
 *
 * The zone is applied through Intl, never by adding four hours to a local
 * clock: arithmetic on a device time inherits whatever that device is set to,
 * so a laptop left on the wrong timezone would quietly produce wrong business
 * dates.
 */

export const BUSINESS_TIME_ZONE = "Asia/Dubai";
export const BUSINESS_UTC_OFFSET = "UTC+4";

const formatter = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, ...options });

/** `10:42 am` in Dubai, whatever the reader's device says. */
export const businessTime = (at: Date = new Date(), withSeconds = false) =>
  formatter({
    hour: "numeric",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: true,
  })
    .format(at)
    .toLowerCase();

/** `Thu 25 Sep` in Dubai. */
export const businessDate = (at: Date = new Date()) =>
  formatter({ weekday: "short", day: "numeric", month: "short" }).format(at);

/** `Friday, 25 September 2026 at 10:42 am`, for a dialog's full-length field. */
export const businessDateTimeLong = (at: Date | string) => {
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return "";
  const day = formatter({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
  return `${day} at ${businessTime(date)}`;
};

/**
 * The business day as `YYYY-MM-DD`.
 *
 * This is what "today" means for a due date or a follow-up: the date in Dubai,
 * not on the reader's machine. Using `toISOString().slice(0,10)` would give the
 * UTC date, which is the previous day for the first four hours of every
 * Gulf morning.
 */
export function businessToday(at: Date = new Date()) {
  const parts = formatter({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A timestamp shown to the business, e.g. `25 Sep, 10:42 am GST`. */
export const businessStamp = (at: Date | string) => {
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return "";
  return `${formatter({ day: "numeric", month: "short" }).format(date)}, ${businessTime(date)} GST`;
};

/**
 * The compact form for a dense list — activity rows, table cells — where
 * `businessStamp`'s trailing "GST" repeated down a column would be noise.
 * Still Dubai time and still 12-hour with am/pm: a bare 24-hour time like
 * "04:14" reads as ambiguous next to a 12-hour clock elsewhere on the same
 * page, which is what this replaces.
 *
 * e.g. `25 Sep, 10:42 am`
 */
export const businessStampShort = (at: Date | string) => {
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return "";
  return `${formatter({ day: "numeric", month: "short" }).format(date)}, ${businessTime(date)}`;
};

/** Milliseconds until the next minute turns, so a clock ticks on the minute. */
export const msToNextMinute = (at: Date = new Date()) =>
  60_000 - (at.getSeconds() * 1000 + at.getMilliseconds());
