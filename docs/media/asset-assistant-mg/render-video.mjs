import { createServer } from "node:http";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(root, "../../..");
const pnpmRoot = join(projectRoot, "node_modules", ".pnpm");
const playwrightFolder = readdirSync(pnpmRoot).find((name) => /^playwright@\d/.test(name));
if (!playwrightFolder) throw new Error("项目 node_modules 中未找到 Playwright");
const playwrightEntry = join(pnpmRoot, playwrightFolder, "node_modules", "playwright", "index.mjs");
const { chromium } = await import(pathToFileURL(playwrightEntry).href);
const duration = Math.max(1, Number(process.argv[2] || 48));
const fps = Math.max(12, Math.min(60, Number(process.argv[3] || 30)));
const requestedOutput = process.argv[4] || join(root, "ai-manju-asset-assistant-guide.webm");
const edgeCandidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = edgeCandidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error("未找到 Microsoft Edge；可通过 EDGE_PATH 指定 Chromium 可执行文件");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "record.html" : pathname.replace(/^\/+/, "");
  const file = resolve(root, relative);
  if (!file.startsWith(`${resolve(root)}${sep}`) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling"],
});

try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  page.on("console", (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
  const downloadPromise = page.waitForEvent("download", { timeout: (duration + 35) * 1000 });
  await page.goto(`http://127.0.0.1:${address.port}/record.html?duration=${duration}&fps=${fps}`, { waitUntil: "load" });
  const captureInfo = await page.evaluate(() => window.__capture);
  console.log(`Encoder: ${captureInfo.mimeType}`);
  console.log(`Recording: ${duration}s @ ${fps}fps`);
  const download = await downloadPromise;
  const extension = captureInfo.extension;
  const output = resolve(requestedOutput.replace(/\.(?:webm|mp4)$/i, `.${extension}`));
  await mkdir(dirname(output), { recursive: true });
  await download.saveAs(output);
  console.log(`Saved: ${output}`);
  console.log(`Bytes: ${statSync(output).size}`);
  const outputRelative = relative(root, output);
  if (!outputRelative.startsWith("..") && !outputRelative.startsWith(sep)) {
    const videoUrl = `http://127.0.0.1:${address.port}/${outputRelative.split(sep).map(encodeURIComponent).join("/")}`;
    const verifyPage = await context.newPage();
    const metadata = await verifyPage.evaluate((src) => new Promise((resolveMetadata, rejectMetadata) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.addEventListener("loadedmetadata", () => {
        const finish = (resolvedDuration) => resolveMetadata({
          duration: resolvedDuration,
          width: video.videoWidth,
          height: video.videoHeight,
        });
        if (Number.isFinite(video.duration)) {
          finish(video.duration);
          return;
        }
        video.muted = true;
        video.playbackRate = 16;
        video.addEventListener("ended", () => finish(video.currentTime), { once: true });
        video.play().catch(rejectMetadata);
      }, { once: true });
      video.addEventListener("error", () => rejectMetadata(new Error("视频元数据加载失败")), { once: true });
      video.src = src;
    }), videoUrl);
    console.log(`Verified: ${metadata.width}x${metadata.height}, ${metadata.duration.toFixed(2)}s`);
    if (metadata.width !== 1920 || metadata.height !== 1080 || metadata.duration < duration - 0.5) {
      throw new Error(`视频验收失败：${JSON.stringify(metadata)}`);
    }
    await verifyPage.close();
  }
  await context.close();
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
