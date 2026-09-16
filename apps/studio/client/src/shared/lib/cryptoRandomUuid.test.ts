import { describe, expect, it } from "vitest";

import { createRandomUUID, installCryptoRandomUUIDPolyfill } from "./cryptoRandomUuid";

describe("crypto.randomUUID polyfill", () => {
  it("generates well-formed UUID v4 strings", () => {
    const uuid = createRandomUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(createRandomUUID()).not.toBe(uuid);
  });

  it("injects a fallback when crypto.randomUUID is missing", () => {
    const original = globalThis.crypto;
    const cryptoWithoutRandomUUID = {
      getRandomValues: (array: Uint8Array) => {
        for (let index = 0; index < array.length; index += 1) {
          array[index] = (index * 17) % 256;
        }
        return array;
      },
    };
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: cryptoWithoutRandomUUID,
    });

    try {
      installCryptoRandomUUIDPolyfill();
      expect(typeof globalThis.crypto.randomUUID).toBe("function");
      expect(globalThis.crypto.randomUUID()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: original,
      });
    }
  });

  it("keeps the native implementation in secure contexts", () => {
    const native = globalThis.crypto.randomUUID;
    installCryptoRandomUUIDPolyfill();
    expect(globalThis.crypto.randomUUID).toBe(native);
  });
});
