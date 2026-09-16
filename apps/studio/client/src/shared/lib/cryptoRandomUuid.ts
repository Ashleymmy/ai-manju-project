/**
 * crypto.randomUUID 属于 Secure Context API，仅在 HTTPS 或 localhost 下存在。
 * 公网 IP 的 HTTP 部署（测试环境）下浏览器不提供该方法，入口处统一注入降级实现，
 * 业务代码继续按 crypto.randomUUID() 使用，无需感知差异。
 */

type RandomUUIDCapableCrypto = Crypto & { randomUUID?: () => string };

const UUID_BYTE_LENGTH = 16;
const UUID_V4_VERSION_BYTE = 6;
const UUID_V4_VARIANT_BYTE = 8;

function fillUuidBytesRandomly(bytes: Uint8Array): void {
  const cryptoObject = globalThis.crypto as RandomUUIDCapableCrypto | undefined;
  if (typeof cryptoObject?.getRandomValues === "function") {
    cryptoObject.getRandomValues(bytes);
    return;
  }
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
}

function formatUuidV4(bytes: Uint8Array): string {
  const mutated = bytes.slice();
  mutated[UUID_V4_VERSION_BYTE] = (mutated[UUID_V4_VERSION_BYTE] & 0x0f) | 0x40;
  mutated[UUID_V4_VARIANT_BYTE] = (mutated[UUID_V4_VARIANT_BYTE] & 0x3f) | 0x80;
  const hex = Array.from(mutated, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/** 生成 UUID v4 字符串；优先使用 crypto.getRandomValues，退化到 Math.random。 */
export function createRandomUUID(): string {
  const bytes = new Uint8Array(UUID_BYTE_LENGTH);
  fillUuidBytesRandomly(bytes);
  return formatUuidV4(bytes);
}

/** 给缺失 randomUUID 的 crypto 对象注入降级实现；安全上下文下不做任何事。 */
export function installCryptoRandomUUIDPolyfill(): void {
  const cryptoObject = globalThis.crypto as RandomUUIDCapableCrypto | undefined;
  if (cryptoObject && typeof cryptoObject.randomUUID !== "function") {
    (cryptoObject as { randomUUID?: () => string }).randomUUID = createRandomUUID;
  }
}

installCryptoRandomUUIDPolyfill();
