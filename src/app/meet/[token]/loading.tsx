/** A guest's loading screen: nothing about the CRM, just the meeting. */
export default function Loading() {
  return (
    <main className="app-boot" aria-busy="true" aria-live="polite">
      <div className="app-boot-bar" aria-hidden="true"><span /></div>
      <p>Opening the meeting</p>
    </main>
  );
}
