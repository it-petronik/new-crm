"use client";
import {
  Button,
  Input,
  Select,
  Textarea,
  Field,
} from "@/components/ui/controls";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <h1>We couldn’t open this workspace.</h1>
      <p>
        Your data has not been changed. Please retry or contact IT if this
        continues.
      </p>
      <Button className="primary" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
