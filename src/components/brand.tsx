import { BrandMark } from "./brand-mark";
import { brandMarks } from "@/lib/brand-marks";
export const brands: Record<string, { file: string; label: string }> = {
  Petronik: { file: "petronik", label: "Petronik" },
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
  lockup?: boolean;
  inverse?: boolean;
}) {
  const brand = brands[company];
  if (!brand) return <span>{company}</span>;
  return (
    <BrandMark padding={0.08}
      className={`brand-logo logo-${brand.file} ${className}`}
      src={brandMarks[company as keyof typeof brandMarks].src}
      label={brand.label}
    />
  );
}
