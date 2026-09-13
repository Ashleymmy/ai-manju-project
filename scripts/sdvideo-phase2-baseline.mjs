import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = resolve(root, ".tmp/sdvideo-phase2/baseline.json");
const hashes = {};
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else hashes[relative(root, path).replaceAll("\\", "/")] = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
}
visit(resolve(root, "apps/studio/client"));
if (process.argv.includes("--verify")) {
  const baseline = JSON.parse(readFileSync(target, "utf8"));
  const changed = [...new Set([...Object.keys(baseline.client), ...Object.keys(hashes)])]
    .filter(path => baseline.client[path] !== hashes[path]);
  console.log(JSON.stringify({ clientFiles: Object.keys(hashes).length, changed }, null, 2));
} else {
  if (existsSync(target)) throw new Error("Baseline already exists; refusing to overwrite");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  mkdirSync(resolve(root, ".tmp/sdvideo-phase2"), { recursive: true });
  writeFileSync(target, JSON.stringify({ capturedAt: new Date().toISOString(), head: git("rev-parse", "HEAD").trim(), status: git("status", "--porcelain=v1", "--untracked-files=all"), client: hashes }, null, 2));
  console.log(`Saved ${Object.keys(hashes).length} client hashes to ${target}`);
}
