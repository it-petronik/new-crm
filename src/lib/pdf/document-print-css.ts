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
`;
