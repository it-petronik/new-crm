"use client";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  type InputHTMLAttributes,
  type ChangeEvent,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { businessToday } from "@/lib/gst";
const months = Array.from({ length: 12 }, (_, i) => ({
  short: new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, i, 1))),
  long: new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, i, 1))),
  number: String(i + 1).padStart(2, "0"),
}));
export const MonthPicker = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function MonthPicker(
  {
    value,
    defaultValue,
    name,
    id,
    required,
    disabled,
    readOnly,
    onChange,
    className,
    min,
    max,
    ...props
  },
  ref,
) {
  const initial = String(defaultValue || ""),
    [internal, setInternal] = useState(initial),
    [open, setOpen] = useState(false),
    current = String(value ?? internal),
    [year, setYear] = useState(
      Number((current || businessToday()).slice(0, 4)),
    ),
    proxy = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => proxy.current!);
  useEffect(() => {
    const form = proxy.current?.form;
    const reset = () => {
      setInternal(initial);
      setOpen(false);
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [initial]);
  const choose = (next: string) => {
    if (disabled || readOnly || next && (min && next < String(min) || max && next > String(max))) return;
    setInternal(next);
    onChange?.({
      target: { value: next, name },
      currentTarget: { value: next, name },
    } as ChangeEvent<HTMLInputElement>);
    setOpen(false);
  };
  const label = /^\d{4}-\d{2}$/.test(current)
    ? `${months[Number(current.slice(5)) - 1]?.long || ""} ${current.slice(0, 4)}`
    : "Choose month";
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (disabled || readOnly) return;
        if (next) setYear(Number((current || businessToday()).slice(0, 4)));
        setOpen(next);
      }}
    >
      <div className="ui-month-field">
        <input
          ref={proxy}
          type="text"
          className="ui-validation-proxy"
          aria-hidden="true"
          tabIndex={-1}
          name={name}
          value={current}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          onChange={() => {}}
        />
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            className={`ui-date-trigger ui-month-trigger ${className || ""}`}
            disabled={disabled}
            aria-label={props["aria-label"]}
            aria-labelledby={props["aria-labelledby"]}
            aria-describedby={props["aria-describedby"]}
            aria-invalid={props["aria-invalid"]}
            aria-required={required || undefined}
            onClick={(e) => {
              if (readOnly) e.preventDefault();
            }}
          >
            <CalendarDays size={15} aria-hidden="true" />
            <span>{label}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Content
          className="ui-month-popover"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label="Choose month"
        >
          <div className="ui-month-heading">
            <button
              type="button"
              aria-label="Previous year"
              disabled={year <= 1900}
              onClick={() => setYear((y) => y - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <strong>{year}</strong>
            <button
              type="button"
              aria-label="Next year"
              disabled={year >= 2200}
              onClick={() => setYear((y) => y + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div
            className="ui-month-grid"
            role="group"
            aria-label={`Months in ${year}`}
          >
            {months.map((m) => {
              const next = `${year}-${m.number}`;
              return (
                <button
                  type="button"
                  key={m.number}
                  aria-pressed={current === next}
                  aria-label={`${m.long} ${year}`}
                  disabled={Boolean(
                    (min && next < String(min)) || (max && next > String(max)),
                  )}
                  onClick={() => choose(next)}
                >
                  {m.short}
                </button>
              );
            })}
          </div>
          <div className="ui-month-footer">
            {!required && (
              <button type="button" onClick={() => choose("")}>
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => choose(businessToday().slice(0, 7))}
            >
              This month
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
});
