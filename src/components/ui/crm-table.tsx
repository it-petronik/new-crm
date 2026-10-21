import type { TableHTMLAttributes } from "react";
/** One screen table vocabulary; paper/PDF tables do not use this component. */
export function CrmTable({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      {...props}
      data-crm-table
      className={`crm-table${className ? ` ${className}` : ""}`}
    />
  );
}
