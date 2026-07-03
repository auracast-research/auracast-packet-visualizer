import { readFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

const indexHtml = readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');
const bodyMarkup = indexHtml.match(/<body>([\s\S]*)<\/body>/)![1]!;

class FakeFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: ArrayBuffer | null = null;
  readAsArrayBuffer(file: { arrayBuffer: ArrayBuffer }) {
    setTimeout(() => {
      this.result = file.arrayBuffer;
      this.onload?.();
    }, 0);
  }
}

/** Re-imports the whole app fresh (via vi.resetModules(), so `state.ts`'s module-level mutable
 * state starts over each time) against a clean copy of index.html's body markup — the
 * import-based equivalent of a real page load, since jsdom can't execute the built bundle's
 * `<script type="module">` (see the plan file's "Correction found during implementation" note). */
export async function mountApp(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = bodyMarkup;
  (globalThis as { FileReader: unknown }).FileReader = FakeFileReader;
  await import('../../src/main');
}

export function loadFixtureFile(name: string): { name: string; arrayBuffer: ArrayBuffer } {
  const buf = readFileSync(path.resolve(__dirname, '..', 'fixtures', name));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return { name, arrayBuffer };
}

/** Must be called AFTER mountApp() and via dynamic import (not a static top-of-file import) —
 * mountApp() calls vi.resetModules(), so a statically-imported binding would be a stale
 * reference to the previous test's module instance rather than the one main.ts just booted. */
export async function getAppState() {
  return import('../../src/state');
}

/** Same dynamic-import-after-mountApp rule as getAppState — returns the real event numbers the
 * current capture-mode window shows, matching the currently-booted app instance. */
export async function getWindowEvents(): Promise<number[]> {
  const { windowEvents } = await import('../../src/render/overview');
  return windowEvents();
}

export function loadCaptureIntoApp(fixtureName: string): Promise<void> {
  return new Promise((resolve) => {
    const file = loadFixtureFile(fixtureName);
    const fileInput = document.getElementById('captureFile') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    const loadState = document.getElementById('captureLoadState')!;
    const observer = new MutationObserver(() => {
      if (loadState.textContent && loadState.textContent !== 'Loading…') {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(loadState, { childList: true, characterData: true, subtree: true });
    fileInput.dispatchEvent(new Event('change'));
  });
}
