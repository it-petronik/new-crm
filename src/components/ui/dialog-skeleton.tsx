"use client";
import { Dialog, DialogActions } from "./controls";
import { Skeleton } from "./skeleton";
import { createContext, useContext } from "react";
export const DialogLoadingContext = createContext<() => void>(() => {});
/** Same modal shell as the form that will replace it, with no loading prose. */
export function DialogSkeleton() {
  const cancel = useContext(DialogLoadingContext);
  return (
    <Dialog
      title="Preparing dialog"
      description={<Skeleton w={180} h={18} />}
      className="dialog-skeleton"
      dismissOnOutside={false}
      onClose={cancel}
    >
      <div role="status" aria-label="Preparing form" aria-busy="true">
        <div className="dialog-skeleton-fields">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <Skeleton w="45%" h={11} />
              <Skeleton h={32} />
            </div>
          ))}
        </div>
      </div>
      <DialogActions
        cancel="Cancel"
        onCancel={cancel}
        start={<Skeleton w={70} h={30} />}
        secondary={<Skeleton w={100} h={30} />}
      />
    </Dialog>
  );
}
