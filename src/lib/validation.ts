/**
 * Client-side validation messages and timing.
 *
 * This exists only to tell someone what to fix, quickly and in plain language.
 * It is never the authority: every rule here is also enforced by the API, and
 * removing this file would change the user experience, not what the database
 * will accept.
 *
 * Messages name the field and say what to do. "Please fill out this field"
 * tells a person nothing they did not already know.
 */

export type Rule = (value: string) => string;

const blank = (value: string) => value.trim() === "";

/** `Company name is required.` */
export const required = (label: string): Rule => (value) =>
  blank(value) ? `${label} is required.` : "";

export const minLength = (label: string, min: number): Rule => (value) =>
  !blank(value) && value.trim().length < min
    ? `${label} needs at least ${min} characters.`
    : "";

export const maxLength = (label: string, max: number): Rule => (value) =>
  value.length > max ? `${label} cannot be longer than ${max} characters.` : "";

/**
 * Deliberately permissive: the API is authoritative, and a client-side pattern
 * that rejects a valid address is worse than one that accepts a typo.
 */
export const email: Rule = (value) =>
  blank(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? ""
    : "Enter a valid email address, like name@company.com.";

export const number = (label: string, opts: { min?: number; max?: number } = {}): Rule => (value) => {
  if (blank(value)) return "";
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return `${label} must be a number.`;
  const n = Number(value);
  if (opts.min != null && n < opts.min)
    return opts.min === 0 ? `${label} cannot be negative.` : `${label} must be at least ${opts.min}.`;
  if (opts.max != null && n > opts.max) return `${label} cannot be more than ${opts.max}.`;
  return "";
};

export const date = (label: string): Rule => (value) =>
  blank(value) || /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? ""
    : `${label} must be a date.`;

export const matches = (other: string, message: string): Rule => (value) =>
  value === other ? "" : message;

/** First failing rule wins, so a field never shows two complaints at once. */
export const check = (value: string, rules: Rule[]) => {
  for (const rule of rules) {
    const message = rule(value);
    if (message) return message;
  }
  return "";
};

export type FieldRules = Record<string, Rule[]>;

/**
 * Validates a set of values, returning a message per invalid field.
 */
export function validate(values: Record<string, string>, rules: FieldRules) {
  const errors: Record<string, string> = {};
  for (const [name, list] of Object.entries(rules)) {
    const message = check(values[name] ?? "", list);
    if (message) errors[name] = message;
  }
  return errors;
}

/** Field order, so submitting can focus the first problem rather than any. */
export const firstInvalid = (errors: Record<string, string>, order: string[]) =>
  order.find((name) => errors[name]) ?? Object.keys(errors)[0];

/** Shape shared with the record profiles, so form and import agree. */
export type SpecLike = {
  name: string;
  label: string;
  type?: "number" | "date" | "email";
  options?: string[];
  required?: boolean;
  min?: number;
};

/**
 * Validates one value against a record-profile field.
 *
 * The forms and the CSV importer describe fields with the same metadata, so
 * they validate identically and a person gets the same wording either way.
 */
export function specError(spec: SpecLike, value: string): string {
  const rules: Rule[] = [];
  if (spec.required) rules.push(required(spec.label));
  if (spec.type === "email") rules.push(email);
  if (spec.type === "number") rules.push(number(spec.label, { min: spec.min }));
  if (spec.type === "date") rules.push(date(spec.label));
  if (spec.options?.length)
    rules.push((v) =>
      !blankValue(v) && !spec.options!.includes(v)
        ? `Choose one of: ${spec.options!.join(", ")}.`
        : "",
    );
  return check(value, rules);
}

const blankValue = (value: string) => value.trim() === "";
