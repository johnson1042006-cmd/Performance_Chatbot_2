import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  tokenStorageKey,
  readStoredSessionToken,
  writeStoredSessionToken,
} from "../sessionTokenStorage";

// Minimal Storage stub so the helpers (which read window.localStorage) can be
// exercised in the node test env, plus a throwing variant to prove the
// defensive try/catch never surfaces into the widget.
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

function setWindow(storage: Storage | (() => never) | undefined) {
  if (storage === undefined) {
    delete (globalThis as { window?: unknown }).window;
    return;
  }
  Object.defineProperty(globalThis, "window", {
    value:
      typeof storage === "function"
        ? {
            get localStorage(): Storage {
              return storage();
            },
          }
        : { localStorage: storage },
    configurable: true,
    writable: true,
  });
}

describe("sessionTokenStorage", () => {
  afterEach(() => setWindow(undefined));

  describe("with working localStorage", () => {
    beforeEach(() => setWindow(makeStorage()));

    it("round-trips a token keyed by customerIdentifier", () => {
      writeStoredSessionToken("embed_abc", "tok-123");
      expect(readStoredSessionToken("embed_abc")).toBe("tok-123");
      // Namespaced key so distinct customers never collide.
      expect(tokenStorageKey("embed_abc")).toBe("pc-st:embed_abc");
      expect(readStoredSessionToken("embed_other")).toBeNull();
    });

    it("overwrites with the latest (rotated) token", () => {
      writeStoredSessionToken("embed_abc", "tok-1");
      writeStoredSessionToken("embed_abc", "tok-2");
      expect(readStoredSessionToken("embed_abc")).toBe("tok-2");
    });

    it("returns null for an empty identifier and does not persist one", () => {
      writeStoredSessionToken("", "tok-x");
      expect(readStoredSessionToken("")).toBeNull();
    });
  });

  it("no-ops (never throws) when window is undefined (SSR)", () => {
    setWindow(undefined);
    expect(() => writeStoredSessionToken("embed_abc", "tok")).not.toThrow();
    expect(readStoredSessionToken("embed_abc")).toBeNull();
  });

  it("swallows storage access errors (privacy mode / blocked storage)", () => {
    setWindow(() => {
      throw new Error("SecurityError: localStorage is not available");
    });
    expect(() => writeStoredSessionToken("embed_abc", "tok")).not.toThrow();
    expect(readStoredSessionToken("embed_abc")).toBeNull();
  });
});
