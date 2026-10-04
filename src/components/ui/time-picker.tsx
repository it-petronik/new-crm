"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Clock3 } from "lucide-react";
import { timeError, timeLabel, timeParts, timeValue } from "@/lib/time-picker";
import styles from "./time-picker.module.css";

function TimeColumn({ label, values, value, onChange }: { label: string; values: string[]; value: string; onChange: (value: string) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const option = list.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (option && list.current) list.current.scrollTop = option.offsetTop - list.current.clientHeight / 2 + option.offsetHeight / 2;
  }, [value]);
  return <div className={styles.column}><span>{label}</span><div ref={list} className={styles.options} role="radiogroup" aria-label={label} onKeyDown={event => {
    const index = values.indexOf(value);
    const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? (index + 1) % values.length : event.key === "ArrowUp" || event.key === "ArrowLeft" ? (index - 1 + values.length) % values.length : event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); onChange(values[next]);
    list.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus({ preventScroll: true });
  }}>{values.map(option => <button key={option} type="button" role="radio" aria-checked={value === option} tabIndex={value === option ? 0 : -1} onClick={() => onChange(option)}>{option}</button>)}</div></div>;
}

/** Shared Input[type=time] adapter. HH:mm is preserved for existing forms and APIs. */
export const TimePicker = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TimePicker({ value, defaultValue, name, onChange, required, disabled, readOnly, id, className, min, max, step, ...props }, ref) {
  const initial = String(defaultValue ?? "");
  const [internal, setInternal] = useState(initial);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(timeParts(String(value ?? initial)));
  const [invalid, setInvalid] = useState(false);
  const proxy = useRef<HTMLInputElement>(null);
  const errorId = useId();
  useImperativeHandle(ref, () => proxy.current!);
  const current = String(value ?? internal);
  const next = timeValue(draft.hour, draft.minute, draft.period);
  const error = timeError(next, min?.toString(), max?.toString(), step);
  useEffect(() => { proxy.current?.setCustomValidity(timeError(current, min?.toString(), max?.toString(), step)); }, [current, min, max, step]);
  useEffect(() => {
    const form = proxy.current?.form;
    const reset = () => { setInternal(initial); setInvalid(false); setOpen(false); };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [initial]);
  function change(value: string) {
    setInternal(value); setInvalid(false); setOpen(false);
    onChange?.({ target: { value, name }, currentTarget: { value, name } } as ChangeEvent<HTMLInputElement>);
  }
  return <Popover.Root open={open} onOpenChange={nextOpen => { if (nextOpen) setDraft(timeParts(current)); setOpen(nextOpen); }}>
    <div className={styles.field}>
      <input ref={proxy} className="ui-validation-proxy" type="text" name={name} value={current} required={required} disabled={disabled} readOnly={readOnly} tabIndex={-1} aria-hidden="true" onChange={() => {}} onInvalid={event => { event.preventDefault(); setInvalid(true); setDraft(timeParts(current)); setOpen(true); }}/>
      <Popover.Trigger asChild><button type="button" id={id} disabled={disabled} aria-readonly={readOnly || undefined} onClick={event => { if (readOnly) event.preventDefault(); }} className={`ui-time-trigger ${styles.trigger} ${className || ""}`} aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-describedby={props["aria-describedby"]} aria-invalid={invalid || props["aria-invalid"]} aria-required={required || undefined}>
        <Clock3 size={17} aria-hidden="true"/><span data-placeholder={!current}>{current ? timeLabel(current) : props.placeholder || "Choose a time"}</span><ChevronDown size={15} aria-hidden="true"/>
      </button></Popover.Trigger>
    </div>
    <Popover.Portal><Popover.Content className={`ui-time-popover ${styles.popover}`} align="start" sideOffset={8} collisionPadding={12} aria-label="Choose a time" onOpenAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => document.getElementById(`${errorId}-hours`)?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true })); }}>
      <div className={styles.heading}><span><Clock3 size={16}/> Select time</span><strong>{timeLabel(next)}</strong></div>
      <div className={styles.columns}>
        <div id={`${errorId}-hours`}><TimeColumn label="Hour" values={Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))} value={String(draft.hour).padStart(2, "0")} onChange={hour => setDraft(d => ({ ...d, hour: Number(hour) }))}/></div>
        <TimeColumn label="Minute" values={Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"))} value={String(draft.minute).padStart(2, "0")} onChange={minute => setDraft(d => ({ ...d, minute: Number(minute) }))}/>
        <TimeColumn label="Period" values={["AM", "PM"]} value={draft.period} onChange={period => setDraft(d => ({ ...d, period }))}/>
      </div>
      {error && <p className={styles.error} id={errorId} role="status">{error}</p>}
      {invalid && !current && <p className={styles.error} role="status">Please choose a time.</p>}
      <div className={styles.footer}>{!required && <button type="button" className="ui-button secondary" onClick={() => change("")}>Clear</button>}<button type="button" className="ui-button primary" disabled={!!error} aria-describedby={error ? errorId : undefined} onClick={() => change(next)}><Check size={15}/> Set time</button></div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
});
