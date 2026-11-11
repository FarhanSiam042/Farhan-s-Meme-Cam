// Copies MediaPipe's WASM runtime into public/wasm so the site serves it itself
// (same version as the JS package, cacheable offline). Runs before dev/build.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const to = join(root, "public", "wasm");

if (!existsSync(from)) {
  console.error("MediaPipe isn't installed. Run npm install first.");
  process.exit(1);
}
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log("Copied MediaPipe WASM to public/wasm");
