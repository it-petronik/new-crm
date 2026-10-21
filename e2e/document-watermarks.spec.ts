import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { makePreview } from "../src/lib/fixtures";
import { expectContinuousFooter } from "./pdf-footer-check";
import { brandMarkFor } from "../src/lib/brand-marks";

function raster(pdf: Buffer) {
  return execFileSync("pdftoppm", ["-r", "72", "-"], { input: pdf, maxBuffer: 25 * 1024 * 1024 });
}
for (const type of ["quotation", "proforma"] as const)
  for (const company of ["Petronik", "Afrilube", "Petronex", "Istanegry", "Enercore"] as const)
    for (const count of company === "Petronik" ? [1, 45] : [1])
      test(`${company} ${type}: faint watermark on every sheet (${count} items)`, async ({ page }, info) => {
        const base = makePreview().records.find(r => r.kind === "quotations" && r.company === "Petronik")!;
        const record = { ...base, company, title: "Fictional Watermark Review Customer", kind: type === "quotation" ? "quotations" : "accounts", unit: "kg", detail: "1. Review: Fictional layout check only. FINAL-REVIEW-CLAUSE", attributes: { ...(type === "proforma" ? { documentType: "proforma" } : {}), bankName: "Fictional Test Bank", bankAccountName: "Fictional Holder", bankAccountNumber: "TEST-ONLY" }, lines: Array.from({ length: count }, (_, i) => ({ description: `Review product ${i + 1}`, quantity: 80, unitPriceCents: 161000, packaging: "Flexi Bags" })) };
        await page.route("http://pdf.test/brands/**", route => {
          const file = new URL(route.request().url()).pathname;
          return route.fulfill({ contentType: file.endsWith(".svg") ? "image/svg+xml" : "image/png", body: readFileSync(`public${file}`) });
        });
        // The private signature is not needed for branding QA; never replace
        // the production authenticated seal route or use a different brand's.
        await page.route("**/api/document-seals**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="69"/>' }));
        const html = execFileSync(process.execPath, ["--import", "tsx", "scripts/render-document-review.ts"], { input: JSON.stringify(record), encoding: "utf8" });
        await page.setContent(`<html><head><base href="http://pdf.test/"><style>${readFileSync("src/app/reference-document.css", "utf8")}</style></head><body>${html}</body></html>`);
        const mark = page.locator(".pdf-brand-watermark");
        const logo = page.locator(".pdf-company-logo");
        const source = mark.locator("img");
        const logoSource=(await logo.getAttribute("src"))!;
        await expect(source).toHaveAttribute("src", brandMarkFor(logoSource)?.src||logoSource);
        await expect(logo).toHaveJSProperty("tagName","IMG");
        await expect(logo).toHaveCSS("object-fit","contain");
        if (company === "Petronik") {
          const crop = mark.locator("span");
          await expect(crop).toHaveCSS("overflow", "hidden");
          const frame = await crop.boundingBox();
          const artwork = await source.boundingBox();
          expect(frame!.height / frame!.width).toBeCloseTo(480 / 456, 2);
          expect(artwork!.width / frame!.width).toBeCloseTo(1325 / 456, 2);
          // The symbol ends at x=455; lettering begins after x=500 in the
          // original asset. The 456px viewport includes only the full flame.
          // Layout CSS pixels, before the preview's intentional 82% zoom.
          expect(await mark.evaluate(node => parseFloat(getComputedStyle(node).width))).toBeGreaterThan(400);
        }
        await expect(mark).toHaveAttribute("aria-hidden", "true");
        await expect(mark).toHaveCSS("opacity", "0.04");
        await expect(mark).toHaveCSS("position", "absolute");
        await page.emulateMedia({ media: "print" });
        await expect(mark).toHaveCSS("position", "fixed");
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
        const pdf = await page.pdf({ path: info.outputPath(`${company}-${type}-${count}.pdf`), preferCSSPageSize: true, printBackground: true });
        const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
        if (count === 1) expect(pages).toBe(1); else expect(pages).toBeGreaterThan(1);
        expectContinuousFooter(info.outputPath(`${company}-${type}-${count}.pdf`), pages);
        await mark.evaluate(node => { (node as HTMLElement).style.visibility = "hidden"; });
        const plain = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        expect((plain.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length).toBe(pages);
        const markedPixels = raster(pdf), plainPixels = raster(plain);
        expect(markedPixels.length).toBe(plainPixels.length);
        // Compare actual PDF pixels, not only DOM style: every sheet must
        // contain a watermark, and its effect must stay below 5% per channel.
        const sheetBytes = markedPixels.length / pages;
        for (let sheet = 0; sheet < pages; sheet++) {
          let changed = 0, largestChange = 0;
          for (let i = Math.floor(sheet * sheetBytes); i < (sheet + 1) * sheetBytes; i++) {
            const delta = Math.abs(markedPixels[i] - plainPixels[i]);
            if (delta) changed++;
            largestChange = Math.max(largestChange, delta);
          }
          expect(changed, `Sheet ${sheet + 1}: rendered logo must be present`).toBeGreaterThan(500);
          expect(largestChange, "Watermark must stay faint over text and panels").toBeLessThanOrEqual(12);
        }
        const text = execFileSync(process.env.PDF_REVIEW_PYTHON || "python3", ["-c", "import sys,io; from pypdf import PdfReader; print('\\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))"], { input: pdf, encoding: "utf8" });
        expect(text).toContain("FINAL-REVIEW-CLAUSE");
        expect(text).toContain("QTY kg");
        expect(text.replace(/\s+/g, " ")).toContain(`Review product ${count}`);
      });
