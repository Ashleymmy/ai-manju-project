import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { defineConfig, type ViteDevServer } from "vite";
import { promptListPayload } from "./server/prompts";
import { proxyWebdavRequest, readNodeRequestBody } from "./server/webdav-proxy";

/** 构建期读取仓库根 CHANGELOG，注入给版本说明弹窗（避免 Vite root 之外的 ?raw 导入）。 */
function readChangelog() {
  const candidates = [
    path.resolve(import.meta.dirname, "..", "CHANGELOG.md"),
    path.resolve(import.meta.dirname, "CHANGELOG.md"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  return "";
}

function copyDirectorDesk() {
  return {
    name: "copy-director-desk",
    closeBundle() {
      const source = path.resolve(import.meta.dirname, "..", "apps", "director-desk", "dist");
      const target = path.resolve(import.meta.dirname, "dist", "public", "director-desk");
      if (!existsSync(source)) {
        console.warn("[copy-director-desk] skipped: apps/director-desk/dist not found");
        return;
      }
      rmSync(target, { recursive: true, force: true });
      cpSync(source, target, { recursive: true });
    },
  };
}

function promptsApiMiddleware() {
  return {
    name: "studio-prompts-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/prompts", (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        promptListPayload(url.searchParams)
          .then((payload) => {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            res.end(JSON.stringify(payload));
          })
          .catch((error) => {
            res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ items: [], tags: [], categories: [], total: 0, error: String(error) }));
          });
      });
    },
  };
}

function webdavProxyMiddleware() {
  return {
    name: "studio-webdav-proxy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/webdav-proxy", (req, res) => {
        if ((req.method || "").toUpperCase() !== "POST") {
          res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Method not allowed");
          return;
        }
        proxyWebdavRequest({
          header: (name) => {
            const value = req.headers[name];
            return Array.isArray(value) ? value[0] : value;
          },
          body: () => readNodeRequestBody(req),
        })
          .then((result) => {
            res.writeHead(result.status, result.headers);
            if (result.text !== undefined) res.end(result.text);
            else if (result.body) res.end(new Uint8Array(result.body));
            else res.end();
          })
          .catch((error) => {
            res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(String(error));
          });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyDirectorDesk(), promptsApiMiddleware(), webdavProxyMiddleware()],
  define: {
    "process.env.NEXT_PUBLIC_CANVAS_ENGINE": JSON.stringify(process.env.NEXT_PUBLIC_CANVAS_ENGINE || ""),
    __APP_CHANGELOG__: JSON.stringify(readChangelog()),
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "@ai-manju/canvas-agent-protocol", replacement: path.resolve(import.meta.dirname, "..", "packages", "canvas-agent-protocol", "src", "index.ts") },
      { find: "@", replacement: path.resolve(import.meta.dirname, "client", "src") },
      { find: "@shared", replacement: path.resolve(import.meta.dirname, "shared") },
      { find: "@assets", replacement: path.resolve(import.meta.dirname, "attached_assets") },
    ],
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    strictPort: false,
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
