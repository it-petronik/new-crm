// TEST ONLY: the fake Workers AI worker imports the app's AI config, which
// lazily imports OpenNext; that code path is never used there.
export async function getCloudflareContext() {
  throw new Error("Not available in the fake AI worker.");
}
