import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";

/** Raster QA catches PDF hairline seams and painted-over counters that text
 * extraction cannot detect. Local print-review configs require Poppler. */
export function expectContinuousFooter(pdfPath: string, pages = 1) {
  for (let page = 1; page <= pages; page++) {
    const ppm = execFileSync(
      process.env.PDFTOPPM_PATH || "pdftoppm",
      [
        "-r",
        "96",
        "-f",
        String(page),
        "-l",
        String(page),
        "-singlefile",
        pdfPath,
      ],
      { maxBuffer: 12 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
    const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(
      ppm.subarray(0, 100).toString("ascii"),
    );
    expect(header, "Poppler must return a raw RGB image").not.toBeNull();
    const width = Number(header![1]),
      height = Number(header![2]),
      offset = header![0].length;
    const x1 = Math.ceil((width * 10) / 210),
      x2 = Math.floor((width * 200) / 210);
    const y1 = Math.ceil((height * 288.6) / 297),
      y2 = Math.floor((height * 292.5) / 297);
    let fullBandPixels = 0,
      counterInk = 0;
    for (let y = y1; y < y2; y++) {
      let colored = 0;
      for (let x = x1; x < x2; x++) {
        const i = offset + (y * width + x) * 3;
        const darkest = Math.min(ppm[i], ppm[i + 1], ppm[i + 2]);
        if (darkest < 245) colored++;
        if (x > (width * 176) / 210 && darkest < 170) counterInk++;
      }
      fullBandPixels = Math.max(fullBandPixels, colored);
    }
    expect(
      fullBandPixels,
      `Page ${page}: footer background must have no white joins`,
    ).toBe(x2 - x1);
    expect(
      counterInk,
      `Page ${page}: page number must be visible, not hidden behind the band`,
    ).toBeGreaterThan(10);
    // Measure actual ink, not CSS line boxes: this catches text riding the
    // top edge even when a footer has the right nominal padding and height.
    const pixel = (x: number, y: number) =>
      Math.min(
        ...ppm.subarray(
          offset + (y * width + x) * 3,
          offset + (y * width + x) * 3 + 3,
        ),
      );
    const bandRows = Array.from(
      { length: Math.ceil((height * 15) / 297) },
      (_, i) => Math.floor((height * 280) / 297) + i,
    ).filter((y) => pixel(Math.round((width * 12) / 210), y) < 245);
    expect(bandRows.length).toBeGreaterThan(10);
    const bandTop = bandRows[0],
      bandBottom = bandRows.at(-1)! + 1;
    for (const [left, right, label] of [
      [60, 150, "contacts"],
      [176, 199, "counter"],
    ] as const) {
      const rows: number[] = [];
      for (let y = bandTop; y < bandBottom; y++)
        for (
          let x = Math.ceil((width * left) / 210);
          x < (width * right) / 210;
          x++
        ) {
          if (pixel(x, y) < 170) {
            rows.push(y);
            break;
          }
        }
      expect(rows.length, `${label}: ink must be visible`).toBeGreaterThan(2);
      const topGap = rows[0] - bandTop,
        bottomGap = bandBottom - rows.at(-1)! - 1;
      expect(
        (Math.min(topGap, bottomGap) * 297) / height,
        `${label}: genuine inner vertical padding`,
      ).toBeGreaterThan(1.2);
      expect(
        (Math.abs(topGap - bottomGap) * 297) / height,
        `${label}: optically centered in the footer band`,
      ).toBeLessThan(0.8);
    }
  }
}
