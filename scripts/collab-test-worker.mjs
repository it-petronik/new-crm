// A regression run must keep the built Worker fixed for its whole lifetime.
// Wrangler's interactive CLI watches assets and can restart the runtime on a
// filesystem notification, dropping authenticated sockets with 1006.
// The test entrypoint includes the fake AI as a named self-service binding:
// one runtime owns D1, and no other preview can replace this test service.
import { unstable_startWorker } from "wrangler";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

let worker;
let stopping = false;
let mailboxTimer;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(mailboxTimer);
  try {
    await worker?.dispose();
  } finally {
    process.exit(code);
  }
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
  const localConfig = JSON.parse(
    readFileSync(resolve(process.argv[2]), "utf8"),
  );
  if (
    localConfig.vars?.APP_URL === "http://localhost:8788" &&
    localConfig.vars?.MAIL_MODE === "sandbox" &&
    localConfig.vars?.COLLAB_TEST_CONTROL
  ) {
    mailboxTimer = setInterval(
      () =>
        void fetch("http://127.0.0.1:8788/__test/mailbox-sweep", {
          method: "POST",
          headers: { "X-Test-Control": localConfig.vars.COLLAB_TEST_CONTROL },
        }).catch(() => {}),
      120000,
    );
  }
  console.log(
    "Regression Worker ready: one D1 owner; watch=false; local fake AI self-binding",
  );
} catch (error) {
  console.error(error);
  await stop(1);
}
