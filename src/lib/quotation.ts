const small = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const tens = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
function words(n: number): string {
  if (n < 20) return small[n];
  if (n < 100)
    return tens[Math.floor(n / 10)] + (n % 10 ? "-" + small[n % 10] : "");
  if (n < 1000)
    return (
      small[Math.floor(n / 100)] +
      " hundred" +
      (n % 100 ? " " + words(n % 100) : "")
    );
  for (const [size, label] of [
    [1e9, "billion"],
    [1e6, "million"],
    [1000, "thousand"],
  ] as const)
    if (n >= size)
      return (
        words(Math.floor(n / size)) +
        " " +
        label +
        (n % size ? " " + words(n % size) : "")
      );
  return "";
}
export function amountInWords(cents: number, currency: string): string {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100000000000)
    return "";
  const units: Record<string, [string, string]> = {
    USD: ["US dollars", "cents"],
    AED: ["UAE dirhams", "fils"],
    EUR: ["euros", "cents"],
    SGD: ["Singapore dollars", "cents"],
  };
  const unit = units[currency];
  if (!unit) return "";
  const result =
    words(Math.floor(cents / 100)) +
    " " +
    unit[0] +
    (cents % 100 ? " and " + words(cents % 100) + " " + unit[1] : "") +
    " only";
  return result[0].toUpperCase() + result.slice(1);
}
export function quotationError(
  lines: { quantity: number; unitPriceCents: number }[],
  issued: string,
  due: string,
) {
  if (!lines.length) return "Add at least one quotation item.";
  const validDate = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!validDate(issued) || !validDate(due) || issued > due)
    return "Validity must be on or after the issue date.";
  if (
    lines.some(
      (l) =>
        !Number.isFinite(l.quantity) ||
        l.quantity <= 0 ||
        !Number.isSafeInteger(l.unitPriceCents) ||
        l.unitPriceCents < 0,
    )
  )
    return "Check item quantities and unit prices.";
  const total = lines.reduce(
    (sum, l) => sum + Math.round(l.quantity * l.unitPriceCents),
    0,
  );
  if (!Number.isSafeInteger(total) || total > 100000000000)
    return "Quotation total exceeds the supported limit of 1 billion.";
  return "";
}
