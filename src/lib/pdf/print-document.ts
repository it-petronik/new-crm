/** Do not open the print dialog while an approved seal is missing/undecoded. */
export async function waitForSealImages(
  images: Pick<HTMLImageElement, "complete" | "naturalWidth" | "decode">[],
  timeoutMs = 8000,
) {
  await Promise.all(
    images.map(async (image) => {
      if (image.complete && image.naturalWidth > 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          image.decode(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Signature loading timed out")),
              timeoutMs,
            );
          }),
        ]);
        if (!image.naturalWidth) throw new Error("Signature image is missing");
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}
export async function printSalesDocument() {
  const unavailable = () =>
    new Error(
      "The approved signature and stamp could not be loaded. Reload the document and try again before printing or issuing.",
    );
  if (document.querySelector(".reference-document .pdf-seal-error"))
    throw unavailable();
  try {
    await waitForSealImages([
      ...document.querySelectorAll<HTMLImageElement>(
        ".reference-document .pdf-approved-seal",
      ),
    ]);
  } catch {
    throw unavailable();
  }
  if (document.querySelector(".reference-document .pdf-seal-error"))
    throw unavailable();
  try {
    await waitForSealImages([
      ...document.querySelectorAll<HTMLImageElement>(
        ".reference-document img.pdf-company-logo, .reference-document .pdf-company-logo img, .reference-document img.pdf-brand-watermark, .reference-document .pdf-brand-watermark img",
      ),
    ]);
  } catch {
    throw new Error(
      "The company logo could not be loaded. Reload the document and try printing again.",
    );
  }
  window.print();
}
