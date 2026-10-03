"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Dialog, DialogActions } from "./ui/controls";

/**
 * Protects real, unsaved edits — and nothing else.
 *
 * A form becomes "dirty" only from the person's own input or change events
 * (typing, choosing an option, ticking a box). Opening a form, moving focus,
 * validation messages and pre-filled defaults never count, so an untouched
 * form closes without a question. Saving unmounts the form, which clears it.
 */
export function useUnsavedChanges(busy = false) {
  const [dirty, setDirty] = useState(false);
  const [pendingClose, setPendingClose] = useState<null | (() => void)>(null);

  // Leaving the page (reload, closing the tab) only asks while edits exist.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** For a form's onInput/onChange: only events the person caused. */
  const markDirty = useCallback((e: { isTrusted?: boolean; nativeEvent?: Event }) => {
    const trusted = e.nativeEvent ? e.nativeEvent.isTrusted : e.isTrusted;
    if (trusted !== false) setDirty(true);
  }, []);

  /** Wraps a close action: closes at once, or asks first when edits exist. */
  const guard = useCallback(
    (close: () => void) => () => {
      if (dirty && !busy) setPendingClose(() => close);
      else close();
    },
    [dirty, busy],
  );

  const confirm: ReactNode = pendingClose ? (
    <Dialog title="Discard changes?" className="dialog-compact discard-dialog" onClose={() => setPendingClose(null)}>
      <p>You have unsaved changes.</p>
      <DialogActions
        cancel="Keep editing"
        onCancel={() => setPendingClose(null)}
        primary={{
          label: "Discard",
          tone: "danger",
          onClick: () => {
            const close = pendingClose;
            setPendingClose(null);
            setDirty(false);
            close();
          },
        }}
      />
    </Dialog>
  ) : null;

  return { dirty, markDirty, guard, confirm, reset: () => setDirty(false) };
}
