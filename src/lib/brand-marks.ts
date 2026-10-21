/** Crop the approved artwork, never redraw the brand symbol or include its wordmark. */
export const brandMarks = {
  Petronik: {
    src: "/brands/petronik.png",
    width: 1325,
    height: 480,
    crop: [0, 0, 456, 480],
  },
  Afrilube: {
    src: "/brands/afrilube.png",
    width: 2373,
    height: 708,
    crop: [5, 5, 452, 698],
  },
  Petronex: {
    src: "/brands/petronex-symbol.svg",
    width: 263,
    height: 372,
    crop: [0, 0, 263, 372],
  },
  Istanegry: {
    src: "/brands/istanergy.svg",
    width: 251,
    height: 62,
    crop: [0, 0, 64, 62],
  },
  Enercore: {
    src: "/brands/enercore-flame.svg",
    width: 64,
    height: 64,
    crop: [0, 0, 64, 64],
  },
} as const;
export function brandMarkFor(source: string) {
  return (
    (source.startsWith("/brands/petronex") ? brandMarks.Petronex : undefined) ||
    Object.values(brandMarks).find((mark) => mark.src === source) ||
    (source.startsWith("/brands/enercore") ? brandMarks.Enercore : undefined)
  );
}
