/**
 * WebDAV 同源代理：浏览器无法直连任意 WebDAV 服务（CORS + 自定义方法受限），
 * 由本服务转发。协议与旧版 Next 路由 app/webdav-proxy/route.ts 保持一致：
 * 目标地址与真实请求头通过 x-webdav-* 头传入，响应仅回传必要头。
 */

const WEBDAV_PROXY_TIMEOUT_MS = 120_000;

const FORWARDED_HEADERS: Array<[string, string]> = [
  ["x-webdav-authorization", "Authorization"],
  ["x-webdav-depth", "Depth"],
  ["x-webdav-destination", "Destination"],
  ["x-webdav-overwrite", "Overwrite"],
  ["x-webdav-content-type", "Content-Type"],
];

const RESPONSE_HEADERS = ["content-type", "etag", "last-modified", "dav"];

export type WebdavProxyRequest = {
  header: (name: string) => string | undefined;
  body: () => Promise<Uint8Array | undefined>;
};

export type WebdavProxyResult = {
  status: number;
  headers: Record<string, string>;
  body?: ArrayBuffer;
  text?: string;
};

export async function proxyWebdavRequest(request: WebdavProxyRequest): Promise<WebdavProxyResult> {
  const target = request.header("x-webdav-target") || "";
  const method = (request.header("x-webdav-method") || "GET").toUpperCase();
  if (!target) return { status: 400, headers: {}, text: "Missing x-webdav-target" };

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { status: 400, headers: {}, text: "Invalid x-webdav-target" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { status: 400, headers: {}, text: "Unsupported WebDAV target" };
  }

  const headers = new Headers();
  FORWARDED_HEADERS.forEach(([from, to]) => {
    const value = request.header(from);
    if (value) headers.set(to, value);
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBDAV_PROXY_TIMEOUT_MS);
  try {
    const raw = method === "GET" || method === "HEAD" ? undefined : await request.body();
    const body = raw && raw.length ? raw : undefined;
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    const forwarded: Record<string, string> = {};
    RESPONSE_HEADERS.forEach((key) => {
      const value = response.headers.get(key);
      if (value) forwarded[key] = value;
    });
    if (method === "HEAD") return { status: response.status, headers: forwarded };
    return { status: response.status, headers: forwarded, body: await response.arrayBuffer() };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: 504, headers: {}, text: "WebDAV proxy timeout" };
    }
    return { status: 502, headers: {}, text: error instanceof Error ? error.message : "WebDAV proxy error" };
  } finally {
    clearTimeout(timer);
  }
}

/** 读取 node IncomingMessage 的完整请求体。 */
export function readNodeRequestBody(req: NodeJS.ReadableStream): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    req.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
      total += chunk.length;
    });
    req.on("end", () => {
      const result = new Uint8Array(total);
      let offset = 0;
      chunks.forEach((chunk) => {
        result.set(chunk, offset);
        offset += chunk.length;
      });
      resolve(result);
    });
    req.on("error", reject);
  });
}
