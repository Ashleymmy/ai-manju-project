import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { cpSync, createReadStream, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

/** 构建期读取仓库根 CHANGELOG，注入给版本说明弹窗（避免 Vite root 之外的 ?raw 导入）。 */
function readChangelog() {
  const candidates = [
    path.resolve(repositoryRoot, "CHANGELOG.md"),
    path.resolve(import.meta.dirname, "CHANGELOG.md"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  return "";
}

const directorDeskSource = path.resolve(repositoryRoot, "apps", "director-desk", "dist");
// 部分编辑器会用隐藏 tmpdir 原子替换大文件；Windows 无法稳定监听其中的瞬时文件。
const temporaryEditorDirectoryPattern = /(^|[/\\])\.[^/\\]+\.tmpdir([/\\]|$)/;

const directorDeskMimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".fbx": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".obj": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
};

function directorDeskIntegration(): Plugin {
  return {
    name: "director-desk-integration",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url || "/";
        let pathname: string;
        try {
          pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
        } catch {
          response.statusCode = 400;
          response.end("Invalid Director Desk URL");
          return;
        }
        if (pathname !== "/director-desk" && !pathname.startsWith("/director-desk/")) {
          next();
          return;
        }
        if (pathname === "/director-desk") {
          response.statusCode = 308;
          response.setHeader("Location", `/director-desk/${new URL(requestUrl, "http://localhost").search}`);
          response.end();
          return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 405;
          response.setHeader("Allow", "GET, HEAD");
          response.end();
          return;
        }
        if (!existsSync(directorDeskSource)) {
          response.statusCode = 503;
          response.end("Director Desk build is missing. Run pnpm --filter @ai-manju/director-desk build.");
          return;
        }

        const relativePath = pathname.slice("/director-desk/".length) || "index.html";
        const sourceRoot = path.resolve(directorDeskSource);
        let filePath = path.resolve(sourceRoot, relativePath);
        if (filePath !== sourceRoot && !filePath.startsWith(`${sourceRoot}${path.sep}`)) {
          response.statusCode = 403;
          response.end();
          return;
        }
        try {
          if (statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
        } catch {
          if (path.extname(relativePath)) {
            response.statusCode = 404;
            response.end();
            return;
          }
          filePath = path.join(sourceRoot, "index.html");
        }
        try {
          const stat = statSync(filePath);
          if (!stat.isFile()) throw new Error("not a file");
          response.statusCode = 200;
          response.setHeader("Content-Type", directorDeskMimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
          response.setHeader("Content-Length", stat.size);
          response.setHeader("Cache-Control", "no-cache");
          if (request.method === "HEAD") {
            response.end();
            return;
          }
          createReadStream(filePath).pipe(response);
        } catch {
          response.statusCode = 404;
          response.end();
        }
      });
    },
    closeBundle() {
      const target = path.resolve(import.meta.dirname, "dist", "public", "director-desk");
      if (!existsSync(directorDeskSource)) {
        throw new Error("[copy-director-desk] apps/director-desk/dist not found; run the workspace build dependencies first");
      }
      rmSync(target, { recursive: true, force: true });
      cpSync(directorDeskSource, target, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), directorDeskIntegration()],
  define: {
    "process.env.NEXT_PUBLIC_CANVAS_ENGINE": JSON.stringify(process.env.NEXT_PUBLIC_CANVAS_ENGINE || ""),
    __APP_CHANGELOG__: JSON.stringify(readChangelog()),
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "@ai-manju/canvas-agent-protocol", replacement: path.resolve(repositoryRoot, "packages", "canvas-agent-protocol", "src", "index.ts") },
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
    manifest: true,
  },
  server: {
    port: 3100,
    strictPort: false,
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    watch: {
      ignored: temporaryEditorDirectoryPattern,
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": { target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3101", changeOrigin: false },
      "/health": { target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3101", changeOrigin: false },
      "/webdav-proxy": { target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3101", changeOrigin: false },
    },
  },
});
