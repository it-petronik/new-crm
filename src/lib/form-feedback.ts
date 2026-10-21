/** Plain-language feedback shared by forms; the server remains authoritative. */
export function controlFeedback(
  label: string,
  value: string,
  validity: Pick<
    ValidityState,
    | "valueMissing"
    | "typeMismatch"
    | "patternMismatch"
    | "rangeUnderflow"
    | "rangeOverflow"
    | "stepMismatch"
    | "badInput"
    | "tooLong"
    | "customError"
  >,
  options: { min?: string; max?: string; validationMessage?: string } = {},
) {
  const name = label.replace(/\s*\*\s*$/, "").trim() || "This field";
  if (validity.valueMissing) return `${name} is required.`;
  if (validity.typeMismatch)
    return /email/i.test(name)
      ? "Enter a valid email address, like name@company.com."
      : `Enter a valid ${name.toLowerCase()}.`;
  if (validity.badInput || validity.stepMismatch)
    return `Check ${name.toLowerCase()} and enter a valid number.`;
  if (validity.rangeUnderflow)
    return `${name} must be at least ${options.min}.`;
  if (validity.rangeOverflow)
    return `${name} cannot be more than ${options.max}.`;
  if (validity.tooLong) return `Please shorten ${name.toLowerCase()}.`;
  if (validity.patternMismatch)
    return `Check the format of ${name.toLowerCase()}.`;
  if (validity.customError)
    return options.validationMessage || `Check ${name.toLowerCase()}.`;
  return "";
}
