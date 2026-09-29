/** A guest's loading screen: nothing about the CRM, just the meeting. */
export default function Loading() {
  return (
    <main className="app-boot" aria-busy="true" aria-live="polite">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static brand mark, shown before anything else loads */}
      <img className="app-boot-logo" src="/brands/enercore-loader.png" alt="Enercore" width={132} height={88} fetchPriority="high" />
      <div className="app-boot-bar" aria-hidden="true"><span /></div>
      <p>Opening the meeting</p>
    </main>
  );
}
