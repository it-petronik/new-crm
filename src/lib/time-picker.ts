/** Time-only values: no Date parsing, timezone conversion, or locale-dependent storage. */
export function timeMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

export function timeParts(value: string) {
  const minutes = timeMinutes(value) ?? 9 * 60;
  const hour = Math.floor(minutes / 60);
  return { hour: hour % 12 || 12, minute: minutes % 60, period: hour < 12 ? "AM" : "PM" };
}

export function timeValue(hour: number, minute: number, period: string) {
  return `${String(hour % 12 + (period === "PM" ? 12 : 0)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function timeLabel(value: string) {
  if (timeMinutes(value) === null) return "Choose a time";
  const { hour, minute, period } = timeParts(value);
  return `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

export function timeError(value: string, min?: string, max?: string, step?: string | number) {
  if (!value) return "";
  const minutes = timeMinutes(value);
  if (minutes === null) return "Choose a valid time.";
  const lower = timeMinutes(min || ""), upper = timeMinutes(max || "");
  const outside = lower !== null && upper !== null && lower > upper
    ? minutes < lower && minutes > upper
    : (lower !== null && minutes < lower) || (upper !== null && minutes > upper);
  if (outside) return `Choose a time ${min && max ? `between ${timeLabel(min)} and ${timeLabel(max)}` : min ? `after ${timeLabel(min)}` : `before ${timeLabel(max || "")}`}.`;
  const seconds = step === "any" ? 0 : Number(step ?? 60);
  if (seconds > 0 && ((minutes - (lower ?? 0)) * 60) % seconds !== 0) return `Choose a time in ${seconds / 60}-minute intervals.`;
  return "";
}
