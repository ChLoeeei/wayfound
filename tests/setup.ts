import '@testing-library/jest-dom/vitest';

/**
 * Ensure a working window.localStorage in the test environment.
 *
 * Root cause: Vitest's jsdom environment aliases `window` directly to
 * `globalThis` (it does not expose the jsdom Window instance itself), and
 * jsdom's own `localStorage` implementation is a getter on the Window
 * *prototype* — so it's never copied onto that aliased global. Meanwhile
 * Node 22+ ships its own experimental `globalThis.localStorage` as an own
 * property, which is what `window.localStorage` resolves to instead. That
 * built-in is inert without the `--localstorage-file` CLI flag: it logs
 * "ExperimentalWarning: localStorage is not available because
 * --localstorage-file was not provided" once, and the property reads back
 * as `undefined`, so any `window.localStorage.getItem(...)` throws.
 *
 * Rather than take a dependency on that Node CLI flag (which needs a
 * backing file path and is a runtime/environment concern, not a test
 * concern), install a tiny in-memory Storage polyfill for the test
 * environment only. Production code (src/lib/memory.ts) is untouched and
 * keeps using the real browser window.localStorage.
 *
 * This only installs when the existing localStorage isn't actually
 * functional, so it becomes a no-op automatically once Vitest/jsdom/Node
 * wire this up properly upstream.
 */
function hasWorkingStorage(candidate: unknown): candidate is Storage {
  if (!candidate || typeof (candidate as Storage).setItem !== 'function') return false;
  try {
    const probeKey = '__wayfound_storage_probe__';
    const storage = candidate as Storage;
    storage.setItem(probeKey, '1');
    const ok = storage.getItem(probeKey) === '1';
    storage.removeItem(probeKey);
    return ok;
  } catch {
    return false;
  }
}

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

function installStoragePolyfillIfNeeded(propertyName: 'localStorage' | 'sessionStorage') {
  const existing = (globalThis as any)[propertyName];
  if (hasWorkingStorage(existing)) return;
  Object.defineProperty(globalThis, propertyName, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

installStoragePolyfillIfNeeded('localStorage');
installStoragePolyfillIfNeeded('sessionStorage');
