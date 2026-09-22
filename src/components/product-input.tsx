"use client";
import { useId, useState } from "react";
import { Input } from "./ui/controls";
import { money, type RecordItem } from "@/lib/domain";

export function ProductInput({
  value,
  products,
  label,
  currency,
  unit,
  onChange,
  onSelect,
}: {
  value: string;
  products: RecordItem[];
  label: string;
  currency: string;
  unit: string;
  onChange: (value: string) => void;
  onSelect: (product: RecordItem) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = products
    .filter((p) =>
      `${p.title} ${p.product} ${p.attributes?.sku || ""}`
        .toLowerCase()
        .includes(value.toLowerCase().trim()),
    )
    .slice(0, 8);
  function select(p: RecordItem) {
    onSelect(p);
    setOpen(false);
    setActive(-1);
  }
  return (
    <div className="product-combobox">
      <Input
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={
          open && active >= 0 && matches[active] ? `${id}-${active}` : undefined
        }
        autoComplete="off"
        value={value}
        required
        maxLength={200}
        placeholder="Search products or type a custom item"
        onFocus={() => {
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActive((a) =>
              matches.length
                ? (a + (e.key === "ArrowDown" ? 1 : -1) + matches.length) %
                  matches.length
                : -1,
            );
          }
          if (e.key === "Enter" && open) {
            e.preventDefault();
            if (active >= 0 && matches[active]) select(matches[active]);
            else setOpen(false);
          }
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="product-suggestions">
          <div id={id} role="listbox" aria-label="Matching saved products">
            {matches.map((p, i) => (
              <div
                key={p.id}
                id={`${id}-${i}`}
                role="option"
                aria-selected={active === i}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(p)}
              >
                <span>
                  <b>{p.title}</b>
                  <small>{p.attributes?.sku || p.product}</small>
                </span>
                <strong>
                  {money(p.amount, currency)} / {unit}
                </strong>
              </div>
            ))}
          </div>
          <p>
            {matches.length
              ? "Choose a product to fill its price and packaging, or keep your custom text."
              : "No matching saved product. You can use this as a custom item."}
          </p>
        </div>
      )}
    </div>
  );
}
