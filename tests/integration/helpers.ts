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
