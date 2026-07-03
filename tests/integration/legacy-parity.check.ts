// @vitest-environment jsdom
// One-time parity verification between the legacy /workspace/auracast-bis-visualizer-v4.html
// and this migrated app — NOT part of the regular `npm test` run (the .check.ts extension is
// deliberately outside Vitest's default .test.ts glob). Run explicitly:
//   npx vitest run tests/integration/legacy-parity.check.ts
// Kept for anyone reviewing the migration's fidelity later; not a standing regression test,
// since asserting "matches the frozen legacy snapshot forever" would fight future intentional
// changes to the new app.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { mountApp } from './helpers';

const legacyHtml = readFileSync(path.resolve(__dirname, '..', '..', '..', 'auracast-bis-visualizer-v4.html'), 'utf8');
const pcapngBuf = readFileSync(path.resolve(__dirname, '..', 'fixtures', 'auracast.pcapng'));
const pcapngArrayBuffer = pcapngBuf.buffer.slice(pcapngBuf.byteOffset, pcapngBuf.byteOffset + pcapngBuf.byteLength);

class FakeFileReader {
  onload: (() => void) | null = null;
  result: ArrayBuffer | null = null;
  readAsArrayBuffer(file: { arrayBuffer: ArrayBuffer }) {
    setTimeout(() => {
      this.result = file.arrayBuffer;
      this.onload?.();
    }, 0);
  }
}

interface Snapshot {
  quickconfig: string;
  summaryLine: string;
  warnbanner: string;
  logRowCount: number;
  logRowTitles: string[];
  pduTags: string[];
  detailTickCount: number;
  detailEventLabels: string[];
  dimLabels: string[];
  yamlExport: string;
}

async function snapshotLegacy(setup: (doc: Document, win: Window) => Promise<void> | void): Promise<Snapshot> {
  const dom = new JSDOM(legacyHtml, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    url: 'https://example.test/auracast.html',
    beforeParse(window) {
      window.matchMedia =
        window.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));
      Object.defineProperty(window.Element.prototype, 'scrollIntoView', { value: () => {}, configurable: true });
    },
  });
  (dom.window as unknown as { FileReader: unknown }).FileReader = FakeFileReader;
  await new Promise((r) => setTimeout(r, 30));
  await setup(dom.window.document, dom.window as unknown as Window);
  await new Promise((r) => setTimeout(r, 30));
  return extractSnapshot(dom.window.document);
}

async function snapshotNew(setup: (doc: Document) => Promise<void> | void): Promise<Snapshot> {
  vi.resetModules();
  await mountApp();
  (globalThis as { FileReader: unknown }).FileReader = FakeFileReader;
  await setup(document);
  return extractSnapshot(document);
}

function extractSnapshot(doc: Document): Snapshot {
  return {
    quickconfig: doc.getElementById('quickconfig')!.textContent!,
    summaryLine: doc.getElementById('summaryLine')!.textContent!,
    warnbanner: doc.getElementById('warnbanner')!.textContent!,
    logRowCount: doc.querySelectorAll('#log .msg-row').length,
    logRowTitles: [...doc.querySelectorAll('#log .msg-title')].map((e) => e.textContent!),
    pduTags: [...doc.querySelectorAll('#log .pdutag')].map((e) => e.textContent!),
    detailTickCount: doc.querySelectorAll('#detailmap .mm-tick').length,
    detailEventLabels: [...doc.querySelectorAll('#detailmap .mm-evlabel')].map((e) => e.textContent!),
    dimLabels: [...doc.querySelectorAll('#detailmap .dim-label')].map((e) => e.textContent!),
    yamlExport: (doc.getElementById('yamlExport') as HTMLTextAreaElement).value,
  };
}

function loadCaptureLegacy(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    const fileInput = doc.getElementById('captureFile') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [{ name: 'auracast.pcapng', arrayBuffer: pcapngArrayBuffer }],
      configurable: true,
    });
    fileInput.addEventListener('change', () => setTimeout(resolve, 25), { once: true });
    fileInput.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event('change'));
  });
}

function loadCaptureNew(): Promise<void> {
  return new Promise((resolve) => {
    const fileInput = document.getElementById('captureFile') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [{ name: 'auracast.pcapng', arrayBuffer: pcapngArrayBuffer }],
      configurable: true,
    });
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

describe('legacy v4.html vs migrated app — behavioral parity', () => {
  it('default simulated-mode state renders identically', async () => {
    const legacy = await snapshotLegacy(() => {});
    const migrated = await snapshotNew(() => {});
    expect(migrated).toEqual(legacy);
  });

  it('a preset applied renders identically', async () => {
    const legacy = await snapshotLegacy((doc) => {
      doc.querySelector<HTMLElement>('[data-preset="diversity"]')!.click();
    });
    const migrated = await snapshotNew(() => {
      document.querySelector<HTMLElement>('[data-preset="diversity"]')!.click();
    });
    expect(migrated).toEqual(legacy);
  });

  it('interleaved + control-subevent + 4 BIS renders identically', async () => {
    const legacy = await snapshotLegacy((doc) => {
      doc.getElementById('openConfig')!.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event('click'));
      const numBis = doc.getElementById('numBis') as HTMLInputElement;
      numBis.value = '4';
      numBis.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event('input', { bubbles: true } as never));
      doc.getElementById('autoInterleave')!.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event('click'));
      (doc.getElementById('showControlSubevent') as HTMLInputElement).click();
    });
    const migrated = await snapshotNew(() => {
      const numBis = document.getElementById('numBis') as HTMLInputElement;
      numBis.value = '4';
      numBis.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('autoInterleave')!.click();
      document.getElementById('showControlSubevent')!.click();
    });
    expect(migrated).toEqual(legacy);
  });

  it('a loaded real capture (default window) renders identically', async () => {
    const legacy = await snapshotLegacy(async (doc) => {
      await loadCaptureLegacy(doc);
    });
    const migrated = await snapshotNew(async () => {
      await loadCaptureNew();
    });
    expect(migrated).toEqual(legacy);
  });

  it('a loaded real capture, navigated to a window with real gaps (windowStartIdx=279), renders identically', async () => {
    const legacy = await snapshotLegacy(async (doc, win) => {
      await loadCaptureLegacy(doc);
      const w = win as unknown as { state: { windowStartIdx: number }; jumpToEventWindow?: (n: number) => void };
      // The legacy file's `state`/`jumpToEventWindow` are closed over an IIFE, not on window —
      // drive it via the real Prev/Next buttons instead. Each click advances by exactly
      // eventsShown (3), so only multiples of 3 are reachable this way — 279 (93 clicks) is
      // used instead of 280 so both sides land on the exact same window.
      const nextBtn = doc.getElementById('captureNext') as HTMLButtonElement;
      for (let i = 0; i < 279 / 3 && !nextBtn.disabled; i++) nextBtn.click();
      void w;
    });
    const migrated = await snapshotNew(async () => {
      await loadCaptureNew();
      const { state, appVars } = await import('../../src/state');
      state.windowStartIdx = 279; // must match the legacy side's reachable (multiple-of-3) window
      appVars.recompute();
    });
    expect(migrated).toEqual(legacy);
  }, 60000);
});
