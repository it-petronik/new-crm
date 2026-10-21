import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { desktopWorkspaceViewport } from "../src/lib/workspace-viewport";

test("phone workspace fits a desktop layout without disabling pinch zoom", () => {
  assert.equal(desktopWorkspaceViewport.width, 1280);
  assert.equal(desktopWorkspaceViewport.initialScale, undefined);
  assert.equal(desktopWorkspaceViewport.userScalable, true);
  assert.equal(desktopWorkspaceViewport.maximumScale, undefined);
  assert.equal(desktopWorkspaceViewport.minimumScale, undefined);
});

test("all workspace entry routes share desktop mode; authentication keeps the device viewport", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  assert.match(
    read("src/app/page.tsx"),
    /desktopWorkspaceViewport as viewport/,
  );
  assert.match(
    read("src/app/my-requests/page.tsx"),
    /desktopWorkspaceViewport as viewport/,
  );
  assert.match(
    read("src/app/workspace/[...path]/page.tsx"),
    /default, dynamic, viewport/,
  );
  assert.match(read("src/app/layout.tsx"), /width: "device-width"/);
  assert.doesNotMatch(
    read("src/app/login/page.tsx"),
    /desktopWorkspaceViewport/,
  );
  assert.doesNotMatch(
    read("src/app/reset-password/page.tsx"),
    /desktopWorkspaceViewport/,
  );
});
