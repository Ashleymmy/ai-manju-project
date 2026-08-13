#!/usr/bin/env node

const enabled = truthy(process.env.REAL_PROVIDER_SMOKE);
if (!enabled) {
    console.log("[real-provider-smoke] skipped; set REAL_PROVIDER_SMOKE=true to call the real provider.");
    process.exit(0);
}

const apiUrl = stripTrailingSlash(process.env.REAL_PROVIDER_API_URL || process.env.E2E_API_URL || "http://127.0.0.1:3101");
const authToken = process.env.REAL_PROVIDER_AUTH_TOKEN || "";
const account = process.env.REAL_PROVIDER_ACCOUNT || process.env.E2E_ADMIN_ACCOUNT || process.env.ADMIN_USERNAME || "admin";
const password = process.env.REAL_PROVIDER_PASSWORD || process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "admin123456";
const timeoutMs = positiveInt(process.env.REAL_PROVIDER_JOB_TIMEOUT_MS, 420_000);
const imageModel = process.env.REAL_PROVIDER_IMAGE_MODEL || "";
const imageSize = process.env.REAL_PROVIDER_IMAGE_SIZE || "1024x1024";
const imageQuality = process.env.REAL_PROVIDER_IMAGE_QUALITY || "";

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}

async function main() {
    await assertHealthy();
    const session = await login();
    await maybeConfigureProvider(session.token);

    const generation = await submitImageGeneration(session.token);
    const generationJob = await waitForTerminalJob(session.token, generation.job_id || generation.id, "image.generate");
    assertSucceeded(generationJob, "image.generate");

    const generatedImage = await downloadFirstGeneratedImage(session.token, generationJob);
    const edit = await submitImageEdit(session.token, generatedImage);
    const editJob = await waitForTerminalJob(session.token, edit.job_id || edit.id, "image.edit");
    assertSucceeded(editJob, "image.edit");

    console.log(
        JSON.stringify(
            {
                status: "passed",
                api_url: apiUrl,
                generate_job_id: generationJob.job_id || generationJob.id,
                edit_job_id: editJob.job_id || editJob.id,
                generated_image_bytes: generatedImage.bytes.byteLength,
                generated_image_type: generatedImage.contentType,
            },
            null,
            2,
        ),
    );
}

async function assertHealthy() {
    const response = await fetch(`${apiUrl}/health`);
    if (!response.ok) {
        throw new Error(`health check failed: ${response.status} ${await response.text().catch(() => "")}`);
    }
}

async function login() {
    if (authToken) return { token: authToken };
    return apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ account, password }),
    });
}

async function maybeConfigureProvider(token) {
    const baseUrl = process.env.REAL_PROVIDER_BASE_URL || "";
    const apiKey = process.env.REAL_PROVIDER_API_KEY || "";
    const authType = process.env.REAL_PROVIDER_AUTH_TYPE || "bearer";
    if (!baseUrl && !apiKey) {
        console.log("[real-provider-smoke] using existing model_provider_configs row.");
        return;
    }
    if (!baseUrl) throw new Error("REAL_PROVIDER_BASE_URL is required when REAL_PROVIDER_API_KEY is set.");
    if (authType !== "none" && !apiKey) throw new Error("REAL_PROVIDER_API_KEY is required unless REAL_PROVIDER_AUTH_TYPE=none.");
    if (!process.env.REAL_PROVIDER_IMAGE_MODEL && !process.env.REAL_PROVIDER_TEXT_MODEL) {
        throw new Error("REAL_PROVIDER_IMAGE_MODEL or REAL_PROVIDER_TEXT_MODEL is required when configuring a provider.");
    }

    await apiFetch("/api/admin/model-provider", {
        method: "PUT",
        token,
        body: JSON.stringify({
            mode: process.env.REAL_PROVIDER_MODE || "local_openai",
            base_url: baseUrl,
            auth_type: authType,
            ...(apiKey ? { api_key: apiKey } : {}),
            ...(process.env.REAL_PROVIDER_TEXT_MODEL ? { text_model: process.env.REAL_PROVIDER_TEXT_MODEL } : {}),
            ...(process.env.REAL_PROVIDER_IMAGE_MODEL ? { image_model: process.env.REAL_PROVIDER_IMAGE_MODEL } : {}),
            timeout_ms: positiveInt(process.env.REAL_PROVIDER_TIMEOUT_MS, 300_000),
            enabled: true,
        }),
    });
    console.log("[real-provider-smoke] provider config saved from REAL_PROVIDER_* env.");
}

async function submitImageGeneration(token) {
    return apiFetch("/api/ai/images/generations", {
        method: "POST",
        token,
        body: JSON.stringify(compactObject({
            model: imageModel,
            prompt: process.env.REAL_PROVIDER_GENERATE_PROMPT || "real provider smoke: simple clean test tile",
            size: imageSize,
            quality: imageQuality,
            n: 1,
        })),
    });
}

async function submitImageEdit(token, generatedImage) {
    const formData = new FormData();
    if (imageModel) formData.set("model", imageModel);
    formData.set("prompt", process.env.REAL_PROVIDER_EDIT_PROMPT || "real provider smoke: keep composition, add a small blue square");
    formData.set("size", imageSize);
    if (imageQuality) formData.set("quality", imageQuality);
    formData.set("image", new Blob([generatedImage.bytes], { type: generatedImage.contentType }), "generated-smoke.png");

    return apiFetch("/api/ai/images/edits", {
        method: "POST",
        token,
        body: formData,
    });
}

async function waitForTerminalJob(token, jobId, label) {
    if (!jobId) throw new Error(`${label} did not return a job id.`);
    const deadline = Date.now() + timeoutMs;
    let lastJob = null;
    while (Date.now() <= deadline) {
        lastJob = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { token });
        if (["succeeded", "failed", "canceled"].includes(lastJob.status)) return lastJob;
        await sleep(2_000);
    }
    throw new Error(`${label} job ${jobId} timed out after ${timeoutMs}ms; last=${JSON.stringify(lastJob)}`);
}

async function downloadFirstGeneratedImage(token, job) {
    const assetUrl = firstAssetUrl(job.result);
    if (!assetUrl) {
        throw new Error(`image.generate job ${job.job_id || job.id} did not expose an asset_url: ${JSON.stringify(job.result)}`);
    }
    const response = await fetch(assetUrl.startsWith("/") ? `${apiUrl}${assetUrl}` : assetUrl, {
        headers: authHeaders(token),
    });
    if (!response.ok) {
        throw new Error(`generated asset download failed: ${response.status} ${await response.text().catch(() => "")}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
        bytes: new Uint8Array(arrayBuffer),
        contentType: response.headers.get("content-type") || "image/png",
    };
}

function firstAssetUrl(result) {
    const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
    for (const output of outputs) {
        if (output && typeof output.asset_url === "string" && output.asset_url) return output.asset_url;
    }
    const assets = Array.isArray(result?.assets) ? result.assets : [];
    for (const asset of assets) {
        if (asset && typeof asset.url === "string" && asset.url) return asset.url;
    }
    return "";
}

function assertSucceeded(job, label) {
    if (job.status !== "succeeded") {
        throw new Error(`${label} job ${job.job_id || job.id} ended as ${job.status}: ${JSON.stringify(job.error || job)}`);
    }
}

async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.token) {
        for (const [key, value] of Object.entries(authHeaders(options.token))) headers.set(key, value);
    }
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    if (options.body !== undefined && !isFormData && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
    }
    const response = await fetch(`${apiUrl}${path}`, {
        ...options,
        headers,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok || payload.success === false) {
        throw new Error(`${path} failed: ${response.status} ${sanitize(JSON.stringify(payload))}`);
    }
    return payload.data;
}

function authHeaders(token) {
    return { Authorization: `Bearer ${token}` };
}

function compactObject(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function truthy(value) {
    return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function positiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stripTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
}

function sanitize(value) {
    return String(value)
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***")
        .replace(/(api[_-]?key["'=:\s]+)[^"',\s}]+/gi, "$1***");
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
