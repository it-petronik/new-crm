export function salaryAttributes(attributes: Record<string,string> = {}) {
  if (attributes.basicSalary === undefined && attributes.allowance === undefined) return attributes;
  const read = (value:string = "") => {
    if(value && !/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Salary and allowance must be non-negative amounts with up to two decimal places.");
    const number = Number(value || 0);
    if(!Number.isFinite(number) || number > 100000000) throw new Error("Salary amount is too large.");
    return Math.round(number * 100);
  };
  return {...attributes, monthlySalary:String((read(attributes.basicSalary) + read(attributes.allowance)) / 100)};
}

/**
 * Total for display, derived from the components so a stale stored value is
 * never shown. Legacy records that predate the split keep their own total.
 */
export function salaryTotal(attributes: Record<string,string> = {}) {
  if (attributes.basicSalary === undefined && attributes.allowance === undefined) return attributes.monthlySalary || "";
  try { return salaryAttributes(attributes).monthlySalary; } catch { return attributes.monthlySalary || ""; }
}
