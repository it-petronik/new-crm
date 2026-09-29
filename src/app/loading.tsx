/**
 * Shown only while the server resolves the session and the first page, which
 * is the one moment the application genuinely cannot render anything useful.
 * Ordinary navigation inside the workspace never reaches here — those
 * transitions keep their layout and swap in skeletons instead.
 *
 * The bar is indeterminate on purpose: a percentage would be invented.
 */
export default function Loading() {
  return (
    <main className="app-boot" aria-busy="true" aria-live="polite">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static brand mark, shown before anything else loads */}
      <img className="app-boot-logo" src="/brands/enercore-loader.png" alt="Enercore" width={132} height={88} fetchPriority="high" />
      <div className="app-boot-bar" aria-hidden="true"><span /></div>
      <p>Preparing your workspace</p>
    </main>
  );
}
