// Copies MediaPipe's segmentation runtime (WASM) from node_modules into
// public/, so meeting background effects load it from Enercore's own origin
// — never a CDN — without committing ~18 MB of binaries. Idempotent.
import { copyFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const from = "node_modules/@mediapipe/tasks-vision/wasm";
const to = "public/meetings/segmenter/wasm";
if (!existsSync(from)) {
  console.error("copy-meeting-assets: @mediapipe/tasks-vision is not installed");
  process.exit(1);
}
mkdirSync(to, { recursive: true });
let copied = 0;
for (const file of readdirSync(from)) {
  const src = join(from, file);
  const dest = join(to, file);
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  copyFileSync(src, dest);
  copied += 1;
}
console.log(`copy-meeting-assets: ${copied} file(s) updated`);
