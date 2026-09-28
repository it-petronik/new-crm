// A regression run must keep the built Worker fixed for its whole lifetime.
// Wrangler's interactive CLI watches assets and can restart the runtime on a
// filesystem notification, dropping authenticated sockets with 1006.
// The test entrypoint includes the fake AI as a named self-service binding:
// one runtime owns D1, and no other preview can replace this test service.
import { unstable_startWorker } from "wrangler";
import { resolve } from "node:path";

let worker;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  try { await worker?.dispose(); }
  finally { process.exit(code); }
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
try {
  worker = await unstable_startWorker({
    config: resolve(process.argv[2]),
    dev: {
      remote: false,
      watch: false,
      liveReload: false,
      persist: resolve(process.argv[3]),
      inspector: false,
      server: { hostname: "127.0.0.1", port: 8788 },
    },
  });
  await worker.ready;
  console.log("Regression Worker ready: one D1 owner; watch=false; local fake AI self-binding");
} catch (error) {
  console.error(error);
  await stop(1);
}
