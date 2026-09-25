"use client";

import React, {
  Children,
  Fragment,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { createPortal } from "react-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { DayPicker } from "react-day-picker";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  LoaderCircle,
  X,
  AlertCircle,
} from "lucide-react";

const cx = (...values: (string | undefined | false)[]) =>
  values.filter(Boolean).join(" ");
export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }
>(({ className, children, loading, disabled, ...props }, ref) => (
  <button
    {...props}
    ref={ref}
    disabled={disabled || loading}
    className={cx("ui-button", className)}
    aria-busy={loading || undefined}
  >
    {loading && <LoaderCircle className="ui-spinner" size={16} />} {children}
  </button>
));
Button.displayName = "Button";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  const [revealed, setRevealed] = useState(false);
  if (type === "date") return <DatePicker {...props} className={className} />;
  if (type === "password")
    return (
      <div className="ui-password">
        <input
          {...props}
          ref={ref}
          type={revealed ? "text" : "password"}
          className={cx("ui-input", className)}
        />
        <Button
          type="button"
          className="ui-password-toggle"
          aria-label={revealed ? "Hide password" : "Show password"}
          onClick={() => setRevealed(!revealed)}
        >
          {revealed ? <EyeOff size={17} /> : <Eye size={17} />}
        </Button>
      </div>
    );
  return (
    <input
      {...props}
      type={type}
      ref={ref}
      className={cx("ui-input", className)}
    />
  );
});
Input.displayName = "Input";
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea {...props} ref={ref} className={cx("ui-textarea", className)} />
));
Textarea.displayName = "Textarea";

type Option = { value: string; label: ReactNode; disabled?: boolean };
export function Select({
  children,
  value,
  defaultValue,
  name,
  onChange,
  disabled,
  required,
  className,
  id,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  // Options may arrive wrapped in fragments or nested arrays when a caller
  // builds them conditionally, so the tree is flattened before it is read.
  const collect = (nodes: ReactNode, into: Option[]) => {
    Children.toArray(nodes).forEach((child) => {
      if (!isValidElement(child)) return;
      const p = (
        child as React.ReactElement<{
          value?: string;
          children?: ReactNode;
          disabled?: boolean;
        }>
      ).props;
      if (child.type === Fragment) {
        collect(p.children, into);
        return;
      }
      const value = String(p.value ?? p.children ?? "");
      // Radix rejects an empty item value; such an option cannot be selected.
      if (!value) return;
      into.push({ value, label: p.children, disabled: p.disabled });
    });
  };
  const options: Option[] = [];
  collect(children, options);
  const initial = String(defaultValue ?? options[0]?.value ?? "");
  const [internal, setInternal] = useState(initial);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const form = trigger.current?.closest("form");
    const reset = () => setInternal(initial);
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [initial]);
  const current = String(value ?? internal);
  return (
    <SelectPrimitive.Root
      value={current}
      name={name}
      disabled={disabled}
      required={required}
      onValueChange={(next) => {
        setInternal(next);
        onChange?.({
          target: { value: next, name },
          currentTarget: { value: next, name },
        } as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectPrimitive.Trigger
        ref={trigger}
        id={id}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        className={cx("ui-select-trigger", className)}
      >
        <SelectPrimitive.Value placeholder="Select an option" />
        <SelectPrimitive.Icon className="ui-select-chevron">
          <ChevronDown size={16} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className="ui-select-menu"
        >
          <SelectPrimitive.ScrollUpButton className="ui-select-scroll">
            <ChevronDown size={14} style={{ transform: "rotate(180deg)" }} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="ui-select-viewport">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="ui-select-option"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={15} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="ui-select-scroll">
            <ChevronDown size={14} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/**
 * A labelled control, optionally carrying a validation message.
 *
 * Errors live here rather than in each form so that every field in the CRM
 * announces itself the same way: the message sits under the control, the
 * control is marked invalid for assistive technology, and the message is
 * associated with it rather than merely adjacent. `hint` is for standing
 * guidance and is replaced by the error while one is present, so the two never
 * compete for the same space.
 */
export function Field({
  children,
  className,
  error,
  hint,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { error?: string; hint?: string }) {
  const autoId = useId();
  const items = Children.toArray(children);
  const controls = items.filter(
    (child) =>
      isValidElement(child) &&
      [Input, Select, Textarea].includes(child.type as typeof Input),
  );
  const control = controls[0] as
    | React.ReactElement<{
        id?: string;
        "aria-label"?: string;
        "aria-labelledby"?: string;
        required?: boolean;
      }>
    | undefined;
  const content = items.filter((child) => !controls.includes(child));
  const labelText = content.filter(
    (child) => typeof child === "string" || typeof child === "number",
  );
  if (!control)
    return (
      <label {...props} className={cx("ui-field", className)}>
        {children}
      </label>
    );
  const id = control.props.id || autoId;
  const labelId = id + "-label";
  const messageId = id + "-message";
  const message = error || hint;
  return (
    <div className={cx("ui-field", error && "has-error", className)} style={props.style}>
      {labelText.length > 0 && (
        <label className="ui-field-label" htmlFor={id} id={labelId}>
          {labelText}
          {control.props.required && (
            <span className="ui-required" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {labelText.length === 0 && content.filter(isValidElement).slice(0, 1)}
      {cloneElement(control, {
        id,
        "aria-labelledby": control.props["aria-label"]
          ? undefined
          : labelText.length
            ? labelId
            : control.props["aria-labelledby"],
        "aria-invalid": error ? true : undefined,
        "aria-describedby": message ? messageId : undefined,
      } as Record<string, unknown>)}
      {message && (
        <p
          id={messageId}
          className={cx("ui-field-message", error && "is-error")}
          // A correction should be read out; standing guidance should not
          // interrupt what the person is doing.
          role={error ? "alert" : undefined}
        >
          {error && <AlertCircle size={13} aria-hidden="true" />}
          {message}
        </p>
      )}
    </div>
  );
}

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function fromISO(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
}
export function DatePicker({
  value,
  defaultValue,
  name,
  onChange,
  disabled,
  required,
  id,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const initial = String(defaultValue || "");
  const [internal, setInternal] = useState(initial);
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const proxy = useRef<HTMLInputElement>(null);
  const current = String(value ?? internal);
  const selected = fromISO(current);
  useEffect(() => {
    const form = proxy.current?.form;
    const reset = () => {
      setInternal(initial);
      setInvalid(false);
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [initial]);
  function change(date: Date | undefined) {
    const next = date ? iso(date) : "";
    setInternal(next);
    setInvalid(false);
    onChange?.({
      target: { value: next, name },
      currentTarget: { value: next, name },
    } as React.ChangeEvent<HTMLInputElement>);
    setOpen(false);
  }
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className="ui-date-field">
        <input
          ref={proxy}
          className="ui-validation-proxy"
          name={name}
          value={current}
          required={required}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          onChange={() => {}}
          onInvalid={(e) => {
            e.preventDefault();
            setInvalid(true);
            setOpen(true);
          }}
        />
        <PopoverPrimitive.Trigger asChild>
          <Button
            type="button"
            id={id}
            disabled={disabled}
            className={cx(
              "ui-date-trigger",
              !selected && "is-placeholder",
              className,
            )}
            aria-label={props["aria-label"]}
            aria-labelledby={props["aria-labelledby"]}
            aria-invalid={invalid || undefined}
          >
            <CalendarDays size={17} />
            <span>
              {selected
                ? selected.toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : "Choose a date"}
            </span>
            <ChevronDown size={15} />
          </Button>
        </PopoverPrimitive.Trigger>
      </div>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="ui-calendar-popover"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Choose a date"
        >
          <DayPicker
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={change}
            showOutsideDays
            fixedWeeks
            weekStartsOn={1}
            disabled={
              props.min || props.max
                ? [
                    {
                      before:
                        fromISO(String(props.min || "")) ||
                        new Date(1900, 0, 1),
                    },
                    {
                      after:
                        fromISO(String(props.max || "")) ||
                        new Date(2200, 11, 31),
                    },
                  ]
                : undefined
            }
          />
          <div className="ui-calendar-footer">
            <Button
              type="button"
              disabled={Boolean(
                (props.min && iso(new Date()) < String(props.min)) ||
                (props.max && iso(new Date()) > String(props.max)),
              )}
              onClick={() => change(new Date())}
            >
              Today
            </Button>
            {!required && (
              <Button type="button" onClick={() => change(undefined)}>
                Clear
              </Button>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

const PresenceContext = createContext(true);
export function DialogPresence({ children }: { children: ReactNode }) {
  const [retained, setRetained] = useState(children);
  useEffect(() => {
    if (children) {
      setRetained(children);
      return;
    }
    const timer = setTimeout(() => setRetained(null), 240);
    return () => clearTimeout(timer);
  }, [children]);
  return (
    <PresenceContext.Provider value={Boolean(children)}>
      {children || retained}
    </PresenceContext.Provider>
  );
}

/* ---------------------------------------------------------------------------
   Dialog footer

   Every dialog's actions go through <DialogActions>, so footers are laid out
   by one component rather than by each page's CSS. The rule:

     [start: contextual / destructive]            [Cancel] [secondary] [Primary]

   - The primary action (Save, Create, Update, Import, Confirm) is always the
     rightmost and visually strongest button.
   - Cancel sits immediately left of the right-hand group. With no primary
     action it reads "Close" and is the only right-hand button.
   - A destructive action that is NOT what the dialog is for — Delete on a
     record editor, Archive in room settings — goes in `start`, on the far
     left, away from the confirm button so it cannot be hit by habit.
   - A confirmation dialog whose whole purpose is the destructive act ("Delete
     message?") passes that act as the PRIMARY with tone "danger": it is the
     confirmation, so it takes the primary position, right of Cancel.

   Wrapping on narrow screens keeps this order; the right-hand group is never
   reordered, so Save and Delete cannot swap sides between breakpoints.
   ------------------------------------------------------------------------ */

type DialogFooterState = {
  target: HTMLElement | null;
  onClose: () => void;
  register: () => () => void;
};
const DialogFooterContext = createContext<DialogFooterState | null>(null);

export type DialogPrimaryAction = {
  label: ReactNode;
  /** Shown while `pending`, e.g. "Saving…". Width is reserved for both. */
  pendingLabel?: ReactNode;
  onClick?: () => unknown;
  type?: "button" | "submit";
  /** Submits this form (by id) when the footer is portalled outside it. */
  form?: string;
  pending?: boolean;
  disabled?: boolean;
  tone?: "primary" | "danger";
  icon?: ReactNode;
};

/**
 * The dialog's primary button: the strongest, with a width that does not
 * change between "Save" and "Saving…", and a guard against double submission
 * — a second click while the first is still running does nothing, whether or
 * not the caller tracks a pending flag.
 */
export function PrimaryAction({ action }: { action: DialogPrimaryAction }) {
  const [running, setRunning] = useState(false);
  const busy = !!action.pending || running;
  return (
    <Button
      type={action.type ?? "button"}
      form={action.form}
      className={cx(action.tone === "danger" ? "danger-button" : "primary", "ui-primary-action")}
      disabled={action.disabled || busy}
      aria-busy={busy || undefined}
      onClick={
        action.onClick
          ? async () => {
              if (busy) return;
              const result = action.onClick!();
              if (result && typeof (result as Promise<unknown>).then === "function") {
                setRunning(true);
                try {
                  await result;
                } finally {
                  setRunning(false);
                }
              }
            }
          : undefined
      }
    >
      {action.icon}
      <span className="ui-action-label" data-pending={busy || undefined}>
        <span aria-hidden={busy || undefined}>{action.label}</span>
        {action.pendingLabel && <span aria-hidden={!busy || undefined}>{action.pendingLabel}</span>}
      </span>
    </Button>
  );
}

export function DialogActions({
  start,
  secondary,
  primary,
  cancel,
  onCancel,
  pending,
}: {
  /** Left: contextual or destructive actions (Delete, Archive, Print…). */
  start?: ReactNode;
  /** Right, before the primary: e.g. Back, "Save and add details". */
  secondary?: ReactNode;
  /** Rightmost. Omit for an informational dialog (Cancel becomes Close). */
  primary?: DialogPrimaryAction;
  /** Label for the cancel button, or false for none. */
  cancel?: string | false;
  /** Defaults to closing the dialog. */
  onCancel?: () => void;
  /** Freezes Cancel and secondary actions while the primary is running. */
  pending?: boolean;
}) {
  const footer = useContext(DialogFooterContext);
  const register = footer?.register;
  useEffect(() => register?.(), [register]);
  if (!footer?.target) return null;
  const cancelLabel = cancel === false ? null : (cancel ?? (primary ? "Cancel" : "Close"));
  return createPortal(
    <>
      <div className="ui-dialog-actions-start">{start}</div>
      <div className="ui-dialog-actions-end">
        {cancelLabel && (
          <Button
            type="button"
            className="secondary"
            disabled={pending || primary?.pending}
            onClick={onCancel ?? footer.onClose}
          >
            {cancelLabel}
          </Button>
        )}
        {secondary}
        {primary && <PrimaryAction action={primary} />}
      </div>
    </>,
    footer.target,
  );
}

export function Dialog({
  title,
  children,
  onClose,
  className,
  dismissOnOutside = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  /**
   * Whether a click outside closes the dialog. Pass false while a submission
   * is pending or unsaved input would be lost; Escape, the X and Cancel
   * still close it, as deliberate choices.
   */
  dismissOnOutside?: boolean;
}) {
  const present = useContext(PresenceContext);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  // How many <DialogActions> are mounted. With none, the dialog supplies its
  // own Close so every dialog can be dismissed from the footer.
  const [actions, setActions] = useState(0);
  const register = useRef(() => {
    setActions((n) => n + 1);
    return () => setActions((n) => n - 1);
  }).current;
  const opener = useRef<HTMLElement | null>(
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement),
  );
  return (
    <DialogPrimitive.Root
      open={present}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog-overlay" />
        <DialogPrimitive.Content
          className={cx("modal ui-dialog", className)}
          aria-describedby={undefined}
          onInteractOutside={(event) => {
            if (!dismissOnOutside) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus({ preventScroll: true });
            }
          }}
        >
          <div className="dialog-heading">
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <Button
              type="button"
              className="icon-button"
              aria-label="Close dialog"
              onClick={onClose}
            >
              <X size={18} />
            </Button>
          </div>
          <DialogFooterContext.Provider value={{ target: footer, onClose, register }}>
            <div className="dialog-body">{children}</div>
          </DialogFooterContext.Provider>
          <div className="ui-dialog-footer" ref={setFooter}>
            {actions === 0 && (
              <>
                <div className="ui-dialog-actions-start" />
                <div className="ui-dialog-actions-end">
                  <Button type="button" className="secondary" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function Tooltip({
  label,
  children,
  enabled = true,
}: {
  label: string;
  children: React.ReactElement;
  enabled?: boolean;
}) {
  if (!enabled) return children;
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="right"
            sideOffset={12}
            className="ui-tooltip"
          >
            {label}
            <TooltipPrimitive.Arrow />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
