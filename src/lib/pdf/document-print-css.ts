/** Self-contained styles for Playwright `setContent` PDFs (no Tailwind runtime). */
export const DOCUMENT_PRINT_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #fff;
  color: #1a1a1a;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
img { max-width: 100%; }
table { border-collapse: collapse; }
h1, h2, h3, p { margin: 0; }

.mx-auto { margin-left: auto; margin-right: auto; }
.max-w-\\[210mm\\], .print\\:max-w-none { max-width: 210mm; }
.bg-white { background: #fff; }
.text-\\[12\\.5px\\] { font-size: 12.5px; }
.text-\\[11px\\] { font-size: 11px; }
.text-\\[10px\\] { font-size: 10px; }
.text-sm { font-size: 14px; }
.text-base { font-size: 16px; }
.text-3xl { font-size: 30px; line-height: 36px; }
.leading-relaxed { line-height: 1.625; }
.text-\\[\\#1a1a1a\\], .text-black { color: #1a1a1a; }
.text-white { color: #fff; }
.text-slate-400 { color: #94a3b8; }
.text-slate-500 { color: #64748b; }
.text-slate-600 { color: #475569; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.font-bold { font-weight: 700; }
.uppercase { text-transform: uppercase; }
.tracking-tight { letter-spacing: -0.025em; }
.whitespace-nowrap { white-space: nowrap; }
.whitespace-pre-wrap { white-space: pre-wrap; }
.whitespace-pre-line { white-space: pre-line; }
.tabular-nums { font-variant-numeric: tabular-nums; }
.w-full { width: 100%; }
.w-auto { width: auto; }
.w-28 { width: 7rem; }
.w-40 { width: 10rem; }
.w-82\\.5 { width: 20.625rem; }
.h-12 { height: 3rem; }
.h-14 { height: 3.5rem; }
.h-16 { height: 4rem; }
.h-28 { height: 7rem; }
.h-\\[14mm\\] { height: 14mm; }
.block { display: block; }
.flex { display: flex; }
.inline-flex { display: inline-flex; }
.grid { display: grid; }
.table-header-group { display: table-header-group; }
.flex-col { flex-direction: column; }
.items-start { align-items: flex-start; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.justify-end { justify-content: flex-end; }
.grid-cols-2 { grid-template-columns: 1fr 1fr; }
.grid-cols-\\[1fr_auto_1fr\\] { grid-template-columns: 1fr auto 1fr; }
.gap-2 { gap: 0.5rem; }
.gap-5 { gap: 1.25rem; }
.gap-10 { gap: 2.5rem; }
.gap-x-8 { column-gap: 2rem; }
.gap-x-12 { column-gap: 3rem; }
.gap-y-2 { row-gap: 0.5rem; }
.gap-y-4 { row-gap: 1rem; }
.space-y-0\\.5 > * + * { margin-top: 0.125rem; }
.space-y-3 > * + * { margin-top: 0.75rem; }
.border { border: 1px solid #cbd5e1; }
.border-b { border-bottom: 1px solid #e2e8f0; }
.border-t { border-top: 1px solid #cbd5e1; }
.border-slate-200 { border-color: #e2e8f0; }
.border-slate-300 { border-color: #cbd5e1; }
.border-slate-400 { border-color: #94a3b8; }
.rounded { border-radius: 0.25rem; }
.border-collapse { border-collapse: collapse; }
.object-contain { object-fit: contain; }
.opacity-90 { opacity: 0.9; }
.text-left { text-align: left; }
.text-center { text-align: center; }
.text-right { text-align: right; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.py-0\\.5 { padding-top: 0.125rem; padding-bottom: 0.125rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-2\\.5 { padding-top: 0.625rem; padding-bottom: 0.625rem; }
.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
.py-4 { padding-top: 1rem; padding-bottom: 1rem; }
.pt-5 { padding-top: 1.25rem; }
.pb-6 { padding-bottom: 1.5rem; }
.px-\\[14mm\\] { padding-left: 14mm; padding-right: 14mm; }
.-mx-\\[14mm\\] { margin-left: -14mm; margin-right: -14mm; }
.mt-0\\.5 { margin-top: 0.125rem; }
.mt-1 { margin-top: 0.25rem; }
.mt-1\\.5 { margin-top: 0.375rem; }
.mt-2 { margin-top: 0.5rem; }
.mt-2\\.5 { margin-top: 0.625rem; }
.mt-3 { margin-top: 0.75rem; }
.mt-4 { margin-top: 1rem; }
.mt-6 { margin-top: 1.5rem; }
.mt-7 { margin-top: 1.75rem; }
.mb-1\\.5 { margin-bottom: 0.375rem; }
.mb-3 { margin-bottom: 0.75rem; }
.mb-4 { margin-bottom: 1rem; }
.break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }

.pdf-terms p { margin: 0 0 0.45em; line-height: 1.5; }
.pdf-terms ol, .pdf-terms ul { margin: 0; padding-left: 1.15em; }
.pdf-terms li { margin: 0 0 0.45em; line-height: 1.5; }
.pdf-terms ol { list-style: decimal; }
.pdf-terms ul { list-style: disc; }

.pdf-sheet-row--commercial {
  page-break-after: auto;
  break-after: auto;
}
.pdf-sheet-row--commercial-alone {
  page-break-after: auto !important;
  break-after: auto !important;
}
.pdf-bank-block {
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  break-after: avoid;
  page-break-after: avoid;
  margin-bottom: 3mm;
}
.pdf-sign-block {
  break-inside: avoid;
  page-break-inside: avoid;
}

[data-print-document] {
  display: block;
  width: 100%;
  padding: 0 14mm;
  color: #1a1a1a;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
[data-print-document] * {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Shared premium paper design: colour belongs to the issuer, not the app's
   light/dark theme. Keep these rules in the standalone PDF contract too. */
.pdf-document { font-size: 11.5px; line-height: 1.55; }
.pdf-document .pdf-letterhead { background: #f6f8fa !important; border-top: 4px solid var(--pdf-accent); padding-top: 20px; padding-bottom: 22px; }
.pdf-header { gap: 28px; align-items: flex-start; }
.pdf-header > div { min-width: 0; flex: 1; }
.pdf-header .pdf-reference { border: 0; border-radius: 0; background: transparent; padding: 0; color: var(--pdf-heading); font-size: 10px; letter-spacing: .04em; overflow-wrap: anywhere; }
.pdf-header h1 { color: #18354a; font-size: 25px; font-weight: 700; letter-spacing: -.035em; line-height: 1.15; }
.pdf-header .pdf-company-logo { width: 135px; height: 42px; object-fit: contain; flex-shrink: 0; }
.pdf-party-grid { margin-top: 20px; padding-top: 16px; gap: 30px; border-color: #dce3e9; }
.pdf-party > p:first-child { font-size: 9px; letter-spacing: .10em; text-transform: uppercase; color: #526578; }
.pdf-party h3 { font-size: 13px; color: #18354a; }
.pdf-party { overflow-wrap: anywhere; }
.pdf-info-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 20px; padding: 3px 0 6px; }
.pdf-info-grid > div { min-width: 0; overflow-wrap: anywhere; }
.pdf-info-grid > div > p:first-child { font-size: 9px; color: #526578; }
.pdf-info-grid > div > p:last-child { font-size: 10.5px; font-weight: 600; color: #18354a; }
.pdf-items { font-size: 10.5px; table-layout: fixed; }
.pdf-items td:nth-last-child(-n+3) { white-space: nowrap; overflow-wrap: normal; font-variant-numeric: tabular-nums; }
.pdf-items th { font-size: 9px; padding: 10px 9px; }
.pdf-items td { padding: 11px 9px; vertical-align: top; }
.pdf-items tbody tr:nth-child(even) { background: #f6f8fa; }
.pdf-items td:last-child { color: #18354a; font-weight: 700; }
.pdf-totals { font-variant-numeric: tabular-nums; }
.pdf-totals > div { width: 310px; }
.pdf-totals .text-base { font-size: 14px; }
.pdf-terms h2, .pdf-bank-block h2, .pdf-sign-block h2 { font-size: 12px; letter-spacing: .04em; }
.pdf-term { font-size: 10px; line-height: 1.5; margin: 0 0 7px; }
.pdf-term strong { color: #18354a; }
.pdf-bank-block { border: 1px solid #dce3e9; border-left: 3px solid var(--pdf-accent); padding: 14px 16px; }
.pdf-bank-block h2 { margin-bottom: 10px; }
.pdf-bank-block .grid { gap: 10px 24px; font-size: 10px; }
.pdf-sign-block { border-top: 1px solid #dce3e9; padding-top: 16px; }
.pdf-thank-you { margin: 10px 0 0; text-align: center; font-size: 9px; color: #526578; break-inside: avoid; }
/* Compact A4: one paper margin, no nested letterhead inset. Long documents
   paginate naturally; content is never clipped or scaled to illegibility. */
[data-print-document] { padding: 0; }
.pdf-document { font-size: 10px; line-height: 1.4; }
.pdf-document .pdf-letterhead { margin: 0; padding: 10px 0 12px; background: #fff !important; border-top-width: 2px; }
.pdf-header { gap: 18px; }
.pdf-header h1 { font-size: 21px; }
.pdf-header .pdf-reference { font-size: 9px; }
.pdf-header .pdf-company-logo { width: 112px; height: 36px; }
.pdf-party-grid { margin-top: 12px; padding-top: 10px; gap: 24px; }
.pdf-party h3 { font-size: 11px; }
.pdf-party .space-y-0\\.5 > * + * { margin-top: 1px; }
.pdf-info-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px 14px; padding: 0; margin-top: 12px; }
.pdf-info-grid > div > p:first-child { font-size: 8px; }
.pdf-info-grid > div > p:last-child { font-size: 9px; }
.pdf-items { font-size: 9.5px; }
.pdf-items th { font-size: 8px; padding: 7px 6px; }
.pdf-items td { padding: 7px 6px; }
.pdf-commercial > .mt-4 { margin-top: 12px; }
.pdf-commercial > .mt-7 { margin-top: 12px; }
.pdf-commercial > .mt-3 { margin-top: 6px; }
.pdf-totals > div { width: 275px; }
.pdf-totals .text-base { font-size: 12px; padding-top: 7px; padding-bottom: 7px; }
.pdf-totals .py-3 { padding-top: 6px; padding-bottom: 6px; }
.pdf-terms-sign { gap: 12px; }
.pdf-terms h2, .pdf-bank-block h2, .pdf-sign-block h2 { font-size: 10px; margin-bottom: 6px; }
.pdf-bank-block { padding: 8px 10px; margin-bottom: 0; }
.pdf-bank-block .grid { gap: 4px 16px; font-size: 9px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pdf-bank-block h2 { margin-bottom: 6px; }
.pdf-terms p, .pdf-term { font-size: 9px; line-height: 1.4; margin-bottom: 4px; }
.pdf-sign-block { padding-top: 10px; }
.pdf-sign-block .text-sm { font-size: 10px; }
.pdf-sign-block .h-12 { height: 24px; }
.pdf-sign-block .h-28 { height: 64px; width: 64px; }
.pdf-sign-block .h-16 { height: 36px; width: 100px; }
.pdf-sign-block .mt-3 { margin-top: 5px; }
.pdf-sign-block .mt-6 { margin-top: 8px; font-size: 8px; }
.pdf-sign-block .space-y-3 > * + * { margin-top: 5px; }
.pdf-party-grid { margin-top: 8px; padding-top: 8px; }
.pdf-party h3 { margin-bottom: 3px; }
.pdf-party { line-height: 1.3; }
.pdf-info-grid { gap: 5px 14px; margin-top: 8px; }
.pdf-bank-block { padding-top: 6px; padding-bottom: 6px; }
.pdf-bank-block .grid { gap: 2px 16px; }
.pdf-terms p, .pdf-term { margin-bottom: 2px; }
.pdf-sign-block h2 { margin-bottom: 4px; }
.pdf-sign-block .mt-1\\.5 { margin-top: 3px; }
.pdf-sign-block .h-12 { height: 18px; }
.pdf-sign-block .mt-6 { margin-top: 5px; }
.pdf-totals .py-2\\.5 { padding-top: 4px; padding-bottom: 4px; }
.pdf-totals .mt-2\\.5 { margin-top: 6px; }
.pdf-thank-you { margin-top: 5px; }
.pdf-reference-signature .pdf-signing-space { min-height: 70px; display: flex; align-items: center; gap: 12px; }
.pdf-reference-signature .pdf-approved-seal { display: block; width: 140px; height: 69px; max-width: 100%; object-fit: contain; }
.pdf-seal-error { color: #9b1c1c; font-size: 9px; max-width: 300px; }
.pdf-amount-words { font-size: 9px; line-height: 1.5; }
.pdf-amount-words > p:last-child { font-weight: 600; color: #18354a; }
.pdf-info-grid > div > p:last-child { white-space: pre-line; }

/* Restrained corporate edition: one paper grid, clear commercial hierarchy,
   compact detail groups and a strong total. Brand assets and data stay intact. */
.pdf-document { color: #263744; line-height: 1.45; }
.pdf-document .pdf-letterhead { border-top: 3px solid var(--pdf-accent); padding-top: 12px; padding-bottom: 12px; }
.pdf-header { align-items: center; gap: 24px; }
.pdf-header .pdf-reference { font-size: 8.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.pdf-header h1 { font-size: 23px; line-height: 1.2; font-weight: 700; letter-spacing: -.025em; margin-top: 7px; }
.pdf-header .pdf-company-logo { width: 124px; height: 40px; }
.pdf-party-grid { margin-top: 10px; padding-top: 10px; border-color: #dfe6eb; }
.pdf-party > p:first-child { font-size: 8px; font-weight: 600; letter-spacing: .12em; color: #647381; }
.pdf-party h3 { font-size: 11px; line-height: 1.4; }
.pdf-party .mt-2 { margin-top: 6px; }
.pdf-info-grid { background: #f5f7f8; border-top: 1px solid #e4e9ed; border-bottom: 1px solid #e4e9ed; padding: 7px 11px; gap: 6px 16px; margin-top: 10px; }
.pdf-info-grid > div > p:first-child { color: #647381; font-size: 8px; margin-bottom: 2px; }
.pdf-info-grid > div > p:last-child { color: #18354a; font-size: 9px; line-height: 1.4; }
.pdf-commercial .pdf-items th { font-weight: 600; font-size: 8px; letter-spacing: .025em; padding: 8px 7px; border: 0; }
.pdf-commercial .pdf-items td { padding: 8px 7px; border-bottom: 1px solid #e2e8ed; }
.pdf-items tbody tr:nth-child(even) { background: #f7f9fa; }
.pdf-totals > div { width: 285px; }
.pdf-totals .pdf-grand-total { background: #18354a !important; border-top: 2px solid var(--pdf-accent); border-radius: 2px; padding: 7px 12px; font-size: 12px; align-items: center; gap: 14px; }
.pdf-totals .pdf-grand-total > span:last-child { white-space: nowrap; }
.pdf-bank-block { background: #f8fafb; border: 1px solid #dfe6eb; border-left: 2px solid var(--pdf-accent); padding: 7px 11px; }
.pdf-bank-block h2, .pdf-terms h2 { font-size: 9px; letter-spacing: .09em; font-weight: 700; }
.pdf-bank-block .text-slate-500 { color: #647381; font-size: 8px; }
.pdf-bank-block .font-semibold { color: #18354a; font-size: 9px; }
.pdf-terms p, .pdf-term { line-height: 1.4; color: #263744; }
.pdf-term strong { color: #18354a; font-weight: 600; }
.pdf-sign-block { border-top-color: #dfe6eb; padding-top: 12px; }
.pdf-sign-block h2 { font-size: 9px; letter-spacing: .08em; }
.pdf-amount-words > p:first-child { color: #647381; font-size: 8px; }
.pdf-amount-words > p:last-child { font-weight: 500; }
/* Decorative issuer logo only: outside flow, with no effect on pagination.
   A very faint overlay remains visible over pale panels without reducing
   the opacity of any commercial text, signature, or bank information. */
.pdf-document { position: relative; isolation: isolate; }
.pdf-brand-watermark { position: absolute; top: 85mm; left: 50%; transform: translateX(-50%); width: 110mm; height: 70mm; max-width: 75%; object-fit: contain; opacity: .04; pointer-events: none; user-select: none; z-index: 1; }
.pdf-header .pdf-company-logo { display:block; position:relative; width: 144px; height: 48px; object-fit:contain; object-position:right center; }
.pdf-brand-watermark { width: 110mm; height: 110mm; }
`;
