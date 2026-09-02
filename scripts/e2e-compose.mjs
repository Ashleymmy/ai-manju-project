#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const isCI = args.has("--ci") || Boolean(process.env.CI);
const composeProject = process.env.E2E_COMPOSE_PROJECT || `ai-manju-preview-${process.pid}`;
const postgresHostPort = process.env.POSTGRES_HOST_PORT || String(await findAvailablePort(55432));
const redisHostPort = process.env.REDIS_HOST_PORT || String(await findAvailablePort(56379));
const apiHostPort = process.env.API_HOST_PORT || String(await findAvailablePort(33101));
const webHostPort = process.env.WEB_HOST_PORT || String(await findAvailablePort(33100));
const workerHealthHostPort = process.env.WORKER_HEALTH_HOST_PORT || String(await findAvailablePort(58101));
const playwrightBin = path.resolve(
    "node_modules/.bin",
    process.platform === "win32" ? "playwright.CMD" : "playwright",
);
const playwrightArgs = ["test"];
if (args.has("--headed")) playwrightArgs.push("--headed");
if (args.has("--ci")) playwrightArgs.push("--reporter=list");

const env = {
    ...process.env,
    CI: isCI ? "true" : process.env.CI,
    APP_ENV: process.env.APP_ENV || "production",
    POSTGRES_USER: process.env.POSTGRES_USER || "postgres",
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || "e2e-postgres-password",
    POSTGRES_DB: process.env.POSTGRES_DB || "ai_manju",
    DB_USER: process.env.DB_USER || process.env.POSTGRES_USER || "postgres",
    DB_PASSWORD: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || "e2e-postgres-password",
    DB_NAME: process.env.DB_NAME || process.env.POSTGRES_DB || "ai_manju",
    FRONTEND_URLS:
        process.env.FRONTEND_URLS ||
        `http://localhost:${webHostPort},http://127.0.0.1:${webHostPort}`,
    APP_SECRET: process.env.APP_SECRET || "e2e-local-session-secret-change-before-prod",
    COOKIE_SECURE: process.env.COOKIE_SECURE || "false",
    ALLOW_PUBLIC_SIGNUP: process.env.ALLOW_PUBLIC_SIGNUP || "false",
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || "admin",
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin123456",
    ADMIN_DISPLAY_NAME: process.env.ADMIN_DISPLAY_NAME || "E2E Admin",
    POSTGRES_HOST_PORT: postgresHostPort,
    REDIS_HOST_PORT: redisHostPort,
    VITE_API_URL: process.env.VITE_API_URL || `http://127.0.0.1:${webHostPort}`,
    API_HOST_PORT: apiHostPort,
    WEB_HOST_PORT: webHostPort,
    WORKER_HEALTH_HOST_PORT: workerHealthHostPort,
    E2E_BASE_URL: process.env.E2E_BASE_URL || `http://127.0.0.1:${webHostPort}`,
    E2E_API_URL: process.env.E2E_API_URL || `http://127.0.0.1:${apiHostPort}`,
    E2E_WORKER_URL: process.env.E2E_WORKER_URL || `http://127.0.0.1:${workerHealthHostPort}`,
    E2E_ADMIN_ACCOUNT: process.env.E2E_ADMIN_ACCOUNT || process.env.ADMIN_USERNAME || "admin",
    E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "admin123456",
    WEBDAV_ALLOWED_HOSTS:
        process.env.WEBDAV_ALLOWED_HOSTS ||
        "host.docker.internal,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
};

let startedCompose = false;
let exitCode = 0;

try {
    if (process.env.E2E_SKIP_COMPOSE !== "true") {
        run("docker", ["compose", "-p", composeProject, "up", "-d", "--build"], { env });
        startedCompose = true;
        await waitForStack();
    }
    playwrightArgs.push("--config", "playwright.config.ts");
    run(playwrightBin, playwrightArgs, { env });
} catch (error) {
    exitCode = typeof error === "object" && error && "exitCode" in error ? Number(error.exitCode) || 1 : 1;
    console.error(error instanceof Error ? error.message : error);
} finally {
    if (isCI && startedCompose) {
        run("docker", ["compose", "-p", composeProject, "down", "-v"], { env, allowFailure: true });
    }
}

process.exit(exitCode);

async function waitForStack() {
    await Promise.all([
        waitForHealthy(`${env.E2E_API_URL}/health`, "api"),
        waitForHealthy(`${env.E2E_WORKER_URL}/health`, "worker"),
        waitForHealthy(env.E2E_BASE_URL, "web"),
    ]);
}

async function waitForHealthy(url, label) {
    const deadline = Date.now() + 180_000;
    let lastError = "";
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
            lastError = `${response.status} ${await response.text().catch(() => "")}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`${label} did not become healthy at ${url}: ${lastError}`);
}

function run(command, commandArgs, options = {}) {
    const result = spawnSync(command, commandArgs, {
        stdio: "inherit",
        shell: process.platform === "win32",
        env: options.env || process.env,
        cwd: options.cwd || process.cwd(),
    });
    if (!options.allowFailure && result.status !== 0) {
        const error = new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status || 1}`);
        error.exitCode = result.status || 1;
        throw error;
    }
    return result;
}

function findAvailablePort(preferredPort) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once("error", () => {
            const fallback = net.createServer();
            fallback.unref();
            fallback.once("error", reject);
            fallback.listen(0, "127.0.0.1", () => {
                const address = fallback.address();
                const port = typeof address === "object" && address ? address.port : 0;
                fallback.close((error) => error ? reject(error) : resolve(port));
            });
        });
        server.listen(preferredPort, "127.0.0.1", () => {
            server.close((error) => error ? reject(error) : resolve(preferredPort));
        });
    });
}
