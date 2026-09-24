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
      <div className="app-boot-mark" aria-hidden="true">e</div>
      <div className="app-boot-bar" aria-hidden="true"><span /></div>
      <p>Preparing your workspace</p>
    </main>
  );
}
