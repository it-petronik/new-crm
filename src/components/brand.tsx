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
}: {
  company?: string;
  className?: string;
}) {
  const brand = brands[company];
  if (!brand) return <span>{company}</span>;
  return (
    <span className={`brand-logo logo-${brand.file} ${className}`}>
      <Image
        src={`/brands/${brand.file}.png`}
        alt={brand.label}
        width={180}
        height={72}
        unoptimized
      />
    </span>
  );
}
