import { build } from "esbuild";

await build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["express", "zod", "@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*", "@openai/codex"],
});
