// server/index.ts
import { createServer } from "node:http";
import { createReadStream, statSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var __dirname = fileURLToPath(new URL(".", import.meta.url));
var STATIC_DIR = process.env.NODE_ENV === "production" ? resolve(__dirname, "public") : resolve(__dirname, "..", "dist", "public");
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};
function serveFile(filePath, res, status = 200) {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    const ext = extname(filePath).toLowerCase();
    res.writeHead(status, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000"
    });
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}
var server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname).replace(/\.\./g, "");
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  const candidate = join(STATIC_DIR, pathname);
  if (existsSync(candidate) && serveFile(candidate, res)) return;
  const indexCandidate = join(STATIC_DIR, pathname, "index.html");
  if (existsSync(indexCandidate) && serveFile(indexCandidate, res)) return;
  const indexHtml = join(STATIC_DIR, "index.html");
  if (!serveFile(indexHtml, res)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});
var port = Number(process.env.PORT) || 3e3;
server.listen(port, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${port}/`);
});
