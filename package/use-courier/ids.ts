let fallbackCounter = 0;

/**
 * A unique id for a tracked file or a chunked upload's uploadId.
 *
 * #28: crypto.randomUUID only exists in secure contexts (HTTPS or
 * localhost) and Safari 15.4+, so calling it unconditionally made addFile
 * throw on, e.g., a dev server opened from a phone over the LAN. Falls back
 * to a v4 UUID built from crypto.getRandomValues, which is available in
 * insecure contexts too, and only as a last resort (no Web Crypto at all)
 * to an id that's unique within the page but not random.
 */
export function createId(): string {
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    // Set the version (4) and variant (10xx) bits, as randomUUID does.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  fallbackCounter += 1;
  return `${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
