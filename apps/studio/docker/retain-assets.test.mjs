import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./40-retain-assets.sh", import.meta.url));
const sh = process.env.STUDIO_TEST_SH || (process.platform === "win32" ? "C:/Program Files/Git/bin/sh.exe" : "sh");
const shellPath = value => value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

test("keeps old bundles across releases and rollbacks, prunes expired files, and never archives HTML", () => {
  const root = mkdtempSync(path.join(tmpdir(), "studio-asset-retention-"));
  const source = path.join(root, "live");
  const cache = path.join(root, "cache");
  const put = (relative, content) => {
    const target = path.join(source, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const run = () => {
    const result = spawnSync(sh, [shellPath(script)], {
      env: { ...process.env, STUDIO_WEB_ROOT: shellPath(source), STUDIO_ASSET_CACHE: shellPath(cache) },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
  };
  try {
    put("index.html", "old entry");
    put("assets/page-old.js", "old page");
    put("assets/shared.js", "shared");
    put("director-desk/assets/scene-old.js", "old scene");
    run();
    unlinkSync(path.join(source, "assets/page-old.js"));
    put("index.html", "new entry");
    put("assets/page-new.js", "new page");
    const expired = path.join(cache, "assets/expired.js");
    writeFileSync(expired, "expired");
    const past = new Date(Date.now() - 40 * 86400000);
    utimesSync(expired, past, past);
    utimesSync(path.join(cache, "assets/shared.js"), past, past);
    run();
    assert.equal(readFileSync(path.join(cache, "assets/page-old.js"), "utf8"), "old page");
    assert.equal(readFileSync(path.join(cache, "assets/page-new.js"), "utf8"), "new page");
    assert.equal(readFileSync(path.join(cache, "director-desk/assets/scene-old.js"), "utf8"), "old scene");
    assert.ok(existsSync(path.join(cache, "assets/shared.js")));
    assert.ok(!existsSync(expired));
    assert.ok(!existsSync(path.join(cache, "index.html")));
    assert.equal(readFileSync(path.join(source, "index.html"), "utf8"), "new entry");
    put("assets/page-old.js", "old page");
    run();
    assert.ok(existsSync(path.join(cache, "assets/page-new.js")));
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("studio-asset-retention-"));
    rmSync(root, { recursive: true, force: true });
  }
});
