import http from "node:http";

const port = Number(process.env.E2E_PROVIDER_PORT || 45991);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
const davFiles = new Map();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
  if (url.pathname.startsWith("/dav/")) return handleDAV(request, response, url);
  if (request.method === "GET" && url.pathname === "/v1/models") {
    return json(response, 200, { data: [{ id: "e2e-text-model" }, { id: "e2e-seedream-image-codex" }] });
  }
  if (request.method === "POST" && url.pathname === "/v1/responses") {
    await readBody(request);
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    response.end(
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "e2e mock response" })}\n\n` +
      `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", item: { type: "message", content: [{ type: "output_text", text: "e2e mock response" }] } })}\n\n` +
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { model: "e2e-text-model", status: "completed", output: [] } })}\n\n` +
      "data: [DONE]\n\n",
    );
    return;
  }
  if (request.method === "POST" && ["/v1/images/generations", "/v1/images/edits"].includes(url.pathname)) {
    const body = (await readBody(request)).toString("utf8");
    if (body.includes("e2e-characterization-slow")) await delay(30_000);
    else if (body.includes("e2e-slow")) await delay(5_000);
    return json(response, 200, {
      created: Math.floor(Date.now() / 1000),
      model: "e2e-seedream-image-codex",
      data: [{ b64_json: png.toString("base64"), mime_type: "image/png" }],
    });
  }
  json(response, 404, { error: { message: `not found: ${url.pathname}` } });
});

server.listen(port, "0.0.0.0", () => console.log(`E2E provider/WebDAV server listening on ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));

async function handleDAV(request, response, url) {
  if (request.method === "MKCOL") {
    response.writeHead(201);
    response.end();
    return;
  }
  if (request.method === "PROPFIND") {
    response.writeHead(207, { "content-type": "application/xml; charset=utf-8", "dav": "1, 2" });
    response.end(`<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>${url.pathname}</href></response></multistatus>`);
    return;
  }
  if (request.method === "PUT") {
    const body = await readBody(request);
    davFiles.set(url.pathname, body);
    response.writeHead(201, { etag: `"${body.byteLength}"` });
    response.end();
    return;
  }
  if (request.method === "GET" || request.method === "HEAD") {
    const body = davFiles.get(url.pathname);
    if (!body) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream", etag: `"${body.byteLength}"` });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }
  response.writeHead(405);
  response.end();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
