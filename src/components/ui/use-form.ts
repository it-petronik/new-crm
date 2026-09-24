"use client";
import { useCallback, useRef, useState } from "react";
import { validate, firstInvalid, type FieldRules } from "@/lib/validation";

/**
 * Validation timing.
 *
 * A form opens neutral: nobody wants a wall of red before they have typed
 * anything. A field is judged once the person has left it, and from then on it
 * corrects itself as they type, so a fixed field clears immediately rather
 * than waiting for another submit. Submitting judges everything and moves
 * focus to the first problem.
 */
export function useForm(rules: FieldRules, order: string[] = Object.keys(rules)) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  /** Revalidates one field, but only once it is allowed to show an error. */
  const revalidate = useCallback(
    (name: string, value: string, values: Record<string, string>) => {
      if (!submitted && !touched[name]) return;
      const next = validate({ ...values, [name]: value }, { [name]: rules[name] ?? [] });
      setErrors((prev) => {
        const updated = { ...prev };
        if (next[name]) updated[name] = next[name];
        else delete updated[name];
        return updated;
      });
    },
    [rules, submitted, touched],
  );

  const blur = useCallback(
    (name: string, values: Record<string, string>) => {
      setTouched((prev) => ({ ...prev, [name]: true }));
      const next = validate(values, { [name]: rules[name] ?? [] });
      setErrors((prev) => {
        const updated = { ...prev };
        if (next[name]) updated[name] = next[name];
        else delete updated[name];
        return updated;
      });
    },
    [rules],
  );

  /** Returns true when the form may be submitted. */
  const submit = useCallback(
    (values: Record<string, string>) => {
      setSubmitted(true);
      const found = validate(values, rules);
      setErrors(found);
      const first = firstInvalid(found, order);
      if (first) {
        const el = form.current?.querySelector<HTMLElement>(`[name="${first}"]`);
        el?.focus();
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        return false;
      }
      return true;
    },
    [rules, order],
  );

  const reset = useCallback(() => {
    setErrors({});
    setTouched({});
    setSubmitted(false);
  }, []);

  /** Only show a message once the field has earned one. */
  const errorFor = (name: string) => (submitted || touched[name] ? errors[name] : "") || "";

  return { form, errors, errorFor, blur, revalidate, submit, reset, submitted };
}
