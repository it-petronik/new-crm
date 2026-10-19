"use client";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "./controls";
import {
  SkeletonRegion,
  SkeletonKpiRow,
  SkeletonTable,
  SkeletonPanel,
} from "./skeleton";
import { friendlyError } from "@/lib/client-request";
export function LoadingState({
  label = "Loading your workspace",
  variant = "table",
}: {
  label?: string;
  variant?: "table" | "cards" | "detail";
}) {
  return (
    <div className="async-loading" data-ui="loading-state">
      <SkeletonRegion label={label}>
        {variant === "cards" && <SkeletonKpiRow count={3} />}{" "}
        {variant === "detail" ? (
          <SkeletonPanel lines={5} />
        ) : (
          <SkeletonTable rows={5} />
        )}
      </SkeletonRegion>
    </div>
  );
}
export function ErrorState({
  message,
  onRetry,
  title = "We couldn’t load this information",
}: {
  message: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const detail = friendlyError(
    message,
    "Please try again. If this keeps happening, contact your administrator.",
  );
  return (
    <div className="async-error" role="alert">
      <span className="async-error-icon">
        <AlertCircle size={20} />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
      <div className="async-error-actions">
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            <RefreshCw size={16} />
            Try again
          </Button>
        )}
        {/sign in again/i.test(detail) && (
          <a className="ui-button secondary" href="/login">
            Sign in
          </a>
        )}
      </div>
    </div>
  );
}
