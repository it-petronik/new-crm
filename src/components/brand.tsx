import Image from "next/image";
export const brands: Record<string, { file: string; label: string }> = {
  Petronik: { file: "petronik", label: "PETRONIK FZCO" },
  Afrilube: { file: "afrilube", label: "Afrilube" },
  Petronex: { file: "petronex", label: "Petronex" },
  Istanegry: { file: "istanergy", label: "Istanergy" },
  Enercore: { file: "enercore", label: "Enercore" },
};
export function BrandLogo({
  company = "Enercore",
  className = "",
  lockup = false,
  inverse = false,
}: {
  company?: string;
  className?: string;
  lockup?: boolean;
  inverse?: boolean;
}) {
  const brand = brands[company];
  if (!brand) return <span>{company}</span>;
  return (
    <span className={`brand-logo logo-${brand.file} ${className}`}>
      <Image
        src={brand.file === "enercore" ? `/brands/enercore${lockup ? `-lockup${inverse ? "-white" : ""}` : ""}.svg` : `/brands/${brand.file}.${brand.file === "istanergy" ? "svg" : "png"}`}
        alt={brand.label}
        width={180}
        height={72}
        unoptimized
      />
    </span>
  );
}
