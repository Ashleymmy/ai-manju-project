import { build } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 与正常 dev/dist 分开；不读取本机 .env，也不把父进程的 VITE_* 带进浏览器。
for (const key of Object.keys(process.env)) {
  if (key.startsWith("VITE_") || key === "NEXT_PUBLIC_CANVAS_ENGINE") delete process.env[key];
}
await build({
  configFile: path.join(studio, "vite.config.ts"),
  envDir: false,
  // 现有客户端把空串解释为本地开发默认值；"/" 经 normalize 后才是同源路径。
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("/") },
  build: { outDir: path.resolve(studio, "../../.tmp/sdvideo-phase2/browser/web") },
});
