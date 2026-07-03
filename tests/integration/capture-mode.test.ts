// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getAppState, getWindowEvents, loadCaptureIntoApp, mountApp } from './helpers';

function stubRect(el: Element, width: number) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width, height: 64, right: width, bottom: 64, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true,
  });
}

describe('capture mode: loading a real capture', () => {
  beforeEach(mountApp);

  it('loads auracast.pcapng and switches into capture mode', async () => {
    await loadCaptureIntoApp('auracast.pcapng');
    expect(document.getElementById('captureLoadState')!.textContent).toMatch(/^Loaded \d+ events/);
    expect(document.getElementById('sourceBadge')!.textContent).toContain('auracast.pcapng');
    expect((document.getElementById('minimap') as HTMLElement).style.display).not.toBe('none');
    expect(document.getElementById('detailLabel')!.textContent).toBe('Current window, sub-event detail');
  });

  it('rejects a garbage file without crashing', async () => {
    const fileInput = document.getElementById('captureFile') as HTMLInputElement;
    const garbage = { name: 'garbage.pcapng', arrayBuffer: new ArrayBuffer(4) };
    Object.defineProperty(fileInput, 'files', { value: [garbage], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 10));
    expect(document.getElementById('captureLoadState')!.textContent).toMatch(/Could not read this file/);
  });

  it('locks broadcast-parameter fields but keeps eventsShown editable', async () => {
    await loadCaptureIntoApp('auracast.pcapng');
    expect((document.getElementById('bn') as HTMLInputElement).disabled).toBe(true);
    expect((document.getElementById('eventsShown') as HTMLInputElement).disabled).toBe(false);
  });

  it('places eventsShown outside the disabled broadcast-config wrapper, next to capture nav (discoverability — it was previously buried inside a mostly-grayed-out section)', () => {
    const field = document.getElementById('eventsShownField')!;
    expect(document.getElementById('drawer-body-fields')!.contains(field)).toBe(false);
    // Structurally near the capture nav controls it's paired with in capture mode.
    const nav = document.getElementById('captureNav')!;
    expect(field.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('detaching returns to simulated mode with fields editable again', async () => {
    await loadCaptureIntoApp('auracast.pcapng');
    document.getElementById('detachCapture')!.click();
    expect((document.getElementById('bn') as HTMLInputElement).disabled).toBe(false);
    expect(document.getElementById('sourceBadge')!.textContent).toBe('Simulated config');
    expect((document.getElementById('minimap') as HTMLElement).style.display).toBe('none');
  });
});

describe('capture mode: navigation', () => {
  beforeEach(async () => {
    await mountApp();
    await loadCaptureIntoApp('auracast.pcapng');
  });

  it('Prev is disabled and Next is enabled at the start of the file', () => {
    expect((document.getElementById('capturePrev') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('captureNext') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Next/Prev move the window and update the range label', () => {
    const before = document.getElementById('mmRangeLabel')!.textContent;
    document.getElementById('captureNext')!.click();
    const after = document.getElementById('mmRangeLabel')!.textContent;
    expect(after).not.toBe(before);
    document.getElementById('capturePrev')!.click();
    expect(document.getElementById('mmRangeLabel')!.textContent).toBe(before);
  });

  it('detail-view prev/next arrows shift the window by exactly one event, not a full eventsShown page', async () => {
    const { state } = await getAppState();
    const before = state.windowStartIdx;
    document.getElementById('detailNextEvent')!.click();
    expect(state.windowStartIdx).toBe(before + 1); // one event, not eventsShown (3)
    document.getElementById('detailPrevEvent')!.click();
    expect(state.windowStartIdx).toBe(before);
  });

  it('detail-view prev arrow is disabled at the start of the file, next arrow enabled', () => {
    expect((document.getElementById('detailPrevEvent') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('detailNextEvent') as HTMLButtonElement).disabled).toBe(false);
  });

  it('detail-view next arrow becomes disabled at the tail of the file', async () => {
    const { state, appVars } = await getAppState();
    state.windowStartIdx = appVars.capture!.allEventsRange.length - state.eventsShown;
    appVars.recompute();
    expect((document.getElementById('detailNextEvent') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('detailPrevEvent') as HTMLButtonElement).disabled).toBe(false);
  });

  it('is disabled in simulated mode (nothing to page through)', () => {
    document.getElementById('detachCapture')!.click();
    expect((document.getElementById('detailPrevEvent') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('detailNextEvent') as HTMLButtonElement).disabled).toBe(true);
  });

  it('widening eventsShown while parked at the tail re-clamps to stay a full window', async () => {
    // Jump straight to the tail instead of clicking Next hundreds of times — this test is about
    // the eventsShown re-clamp behavior, not about repeatedly exercising Next itself.
    const { state, appVars } = await getAppState();
    state.windowStartIdx = appVars.capture!.allEventsRange.length - state.eventsShown;
    appVars.recompute();
    expect((document.getElementById('captureNext') as HTMLButtonElement).disabled).toBe(true);

    const es = document.getElementById('eventsShown') as HTMLInputElement;
    es.value = '10';
    es.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('#detailmap .mm-evlabel').length).toBe(10);
  });
});

describe('capture mode: whole-capture overview zoom/pan', () => {
  beforeEach(async () => {
    await mountApp();
    await loadCaptureIntoApp('auracast.pcapng');
    stubRect(document.getElementById('minimap')!, 1000);
  });

  it('zoom-in reduces the number of events shown in the overview label', () => {
    const before = document.getElementById('mmRangeLabel')!.textContent;
    document.getElementById('mmZoomIn')!.click();
    document.getElementById('mmZoomIn')!.click();
    document.getElementById('mmZoomIn')!.click();
    expect(document.getElementById('mmRangeLabel')!.textContent).not.toBe(before);
    expect(document.getElementById('mmRangeLabel')!.textContent).toMatch(/zoomed to/);
  });

  it('a drag pans the overview (mmViewStart) and suppresses the trailing click that follows it', async () => {
    // Dragging is only enabled once zoomed in (mmZoomLen < allEventsRange.length is the gate in
    // wireOverview's mousedown handler, matching the original) — at the initial fit-all view a
    // drag is a no-op by design, so zoom in first.
    document.getElementById('mmZoomIn')!.click();
    document.getElementById('mmZoomIn')!.click();
    document.getElementById('mmZoomIn')!.click();

    const { state } = await getAppState();
    const svg = document.getElementById('minimap')!;
    // mmRangeLabel reflects the LOG window (windowStartIdx), not the overview's own pan
    // position — a pure pan only moves mmViewStart, so that's what must be checked here, not
    // the label text (which a pan alone never changes).
    const viewStartBefore = state.mmViewStart;
    svg.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('mousemove', { clientX: 560, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('mouseup', { clientX: 560, bubbles: true }));
    expect(state.mmViewStart).not.toBe(viewStartBefore);
    const viewStartAfterPan = state.mmViewStart;
    const windowStartBefore = state.windowStartIdx;

    const firstTick = document.querySelector('#minimap .mm-tick');
    firstTick?.dispatchEvent(new Event('click', { bubbles: true }));
    // the trailing click must NOT have additionally jumped the log window on top of the pan
    expect(state.windowStartIdx).toBe(windowStartBefore);
    expect(state.mmViewStart).toBe(viewStartAfterPan);
  });

  it('Fit all restores the full-file view', () => {
    document.getElementById('mmZoomIn')!.click();
    document.getElementById('mmFit')!.click();
    expect(document.getElementById('mmRangeLabel')!.textContent).not.toMatch(/zoomed to/);
  });
});

describe('capture mode: cross-highlight sync', () => {
  beforeEach(async () => {
    await mountApp();
    await loadCaptureIntoApp('auracast.pcapng');
  });

  it('clicking a log row selects the event tick in the overview and the sub-event tick in the detail timeline', () => {
    const row = document.querySelector<HTMLElement>('#log .msg-row:not(.control-row):not(.not-observed)')!;
    row.click();
    expect(document.querySelectorAll('#minimap .mm-tick.selected').length).toBe(1);
    expect(document.querySelectorAll('#detailmap .mm-tick.selected').length).toBe(1);
  });
});

describe('capture mode: PDU size and pre-transmission origin correlation (BIS-1 regression, end-to-end)', () => {
  beforeEach(async () => {
    await mountApp();
    await loadCaptureIntoApp('auracast.pcapng');
  });

  it('shows a real, non-configured PDU size (prefixed with ~) for observed sub-events', () => {
    const tags = [...document.querySelectorAll('#log .pdutag')].map((t) => t.textContent);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((t) => t?.startsWith('~'))).toBe(true);
  });

  it("a BIS-1 pre-transmission row's thread correctly reports its origin event instead of always claiming 'never captured'", async () => {
    // Regression test for the session's off-by-one bug: BIS row 0 (displayed as "BIS 1") used to
    // always report its original transmission as never captured, even when it plainly was.
    // windowStartIdx=280 is confirmed (via the unit-level golden-fixture tests) to contain real
    // BIS-1 pre-transmission rows whose origin IS resolvable. Jumping directly there (rather
    // than clicking Next ~93 times) keeps this test about the correlation bug, not navigation.
    const { state, appVars } = await getAppState();
    state.windowStartIdx = 280;
    appVars.recompute();

    const bis1PretxRow = [...document.querySelectorAll<HTMLElement>('#log .msg-row:not(.control-row):not(.not-observed)')].find(
      (r) => r.textContent?.includes('PRE') && r.querySelector('.bistag')?.textContent?.trim() === 'BIS 1',
    );
    expect(bis1PretxRow, 'expected to find at least one BIS-1 pre-transmission row in this window').toBeTruthy();
    const targetKey = bis1PretxRow!.dataset.key;
    bis1PretxRow!.click();

    // Scoped to #log: data-key is used by both log-row buttons AND detail-timeline SVG ticks,
    // and an unscoped querySelector matches whichever comes first in DOM order (the timeline,
    // since .minimap-wrap precedes .log-scroll in the page) rather than the log row.
    const freshBtn = document.querySelector(`#log [data-key="${targetKey}"]`);
    const thread = freshBtn!.nextElementSibling;
    const lead = thread!.querySelector('.thread-lead')!.textContent!;
    expect(lead).toMatch(/originates in Event \d+/);
    expect(lead).not.toMatch(/never captured/);
  });
});

describe('capture mode: BIGInfo markers on both timelines', () => {
  beforeEach(async () => {
    await mountApp();
    await loadCaptureIntoApp('auracast.pcapng');
    stubRect(document.getElementById('minimap')!, 1000);
  });

  it('the toggle defaults unchecked (BIGInfo hidden by default) and is only shown in capture mode', () => {
    const toggle = document.getElementById('showBigInfo') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect((document.getElementById('mmToolbar') as HTMLElement).style.display).not.toBe('none');
    document.getElementById('mmFit')!.click();
    expect(document.querySelectorAll('#minimap .mm-biginfo').length).toBe(0);
    expect(document.querySelectorAll('#detailmap .mm-biginfo').length).toBe(0);
  });

  it('checking the toggle shows BIGInfo markers on both timelines; unchecking hides them again', () => {
    const toggle = document.getElementById('showBigInfo') as HTMLInputElement;
    toggle.click();
    expect(toggle.checked).toBe(true);
    document.getElementById('mmFit')!.click(); // fit-all so every marker is in the viewport
    const overviewMarkers = document.querySelectorAll('#minimap .mm-biginfo');
    expect(overviewMarkers.length).toBeGreaterThan(0);
    expect(overviewMarkers[0]!.querySelector('title')!.textContent).toMatch(
      /BIGInfo \(periodic advertising\) at t = [\d.]+ ms/,
    );
    // windowStartIdx=0 (the file's very first events, where every capture load starts) is
    // confirmed to have a BIGInfo transmission nearby.
    expect(document.querySelectorAll('#detailmap .mm-biginfo').length).toBeGreaterThan(0);

    toggle.click();
    expect(toggle.checked).toBe(false);
    expect(document.querySelectorAll('#minimap .mm-biginfo').length).toBe(0);
    expect(document.querySelectorAll('#detailmap .mm-biginfo').length).toBe(0);
  });

  it('does not render BIGInfo markers in simulated mode (no toggle, no markers, no error)', () => {
    document.getElementById('detachCapture')!.click();
    expect(document.querySelectorAll('#detailmap .mm-biginfo').length).toBe(0);
    expect((document.getElementById('mmToolbar') as HTMLElement).style.display).toBe('none');
  });

  it('regression: the checkbox is forced to match state.showBigInfo at boot, even if the browser restored a stale checked value on the live DOM before scripts ran', async () => {
    // Simulates what real browsers sometimes do across a page reload: restore a form control's
    // live `checked` property from the previous session, independent of the HTML's `checked`
    // attribute (which was removed/absent) and independent of our JS default. Previously this
    // desynced the visible checkbox from the actually-rendered markers until clicked twice.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const indexHtml = readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');
    const bodyMarkup = indexHtml.match(/<body>([\s\S]*)<\/body>/)![1]!;
    const { vi } = await import('vitest');
    vi.resetModules();
    document.body.innerHTML = bodyMarkup;
    // Simulate browser-restored stale state BEFORE main.ts's wiring runs.
    (document.getElementById('showBigInfo') as HTMLInputElement).checked = true;
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
    (globalThis as { FileReader: unknown }).FileReader = FakeFileReader;
    await import('../../src/main');

    // state.showBigInfo defaults false — the checkbox must be forced back to match it, not left
    // at the stale restored `true`.
    expect((document.getElementById('showBigInfo') as HTMLInputElement).checked).toBe(false);
  });
});

describe('capture mode: jumping to a matching copy from inside a thread', () => {
  beforeEach(async () => {
    await mountApp();
    await loadCaptureIntoApp('auracast.pcapng');
  });

  it("jumping to a copy outside the current window shifts the window there and expands it", async () => {
    const { state, appVars } = await getAppState();
    state.windowStartIdx = 280; // confirmed (golden-fixture tests) to contain real pre-tx rows
    appVars.recompute();
    const windowBefore = await getWindowEvents();
    const lastEvent = windowBefore[windowBefore.length - 1]!;

    // A pre-tx copy points FORWARD in time to the later (real, observed) event it's ahead of —
    // not backward — so it's a pre-tx row at the window's LAST event whose sibling copy is
    // likeliest to land just past the window's end. Only a couple of these exist (one per BIS),
    // so trying each is fast, unlike scanning every pre-tx row in the whole window.
    const candidateKeys = [
      ...document.querySelectorAll<HTMLElement>('#log .msg-row:not(.control-row):not(.not-observed)'),
    ]
      .filter((r) => r.textContent?.includes('PRE') && Number(r.dataset.key!.split(':')[1]) === lastEvent)
      .map((r) => r.dataset.key!);
    expect(candidateKeys.length, `expected at least one pre-tx row at event ${lastEvent}`).toBeGreaterThan(0);

    let target: HTMLElement | undefined;
    for (const key of candidateKeys) {
      document.querySelector<HTMLElement>(`#log [data-key="${key}"]`)!.click();
      const links = [
        ...document.querySelectorAll<HTMLElement>(`#log [data-key="${key}"] + * .thread-row-link[data-jump-key]`),
      ].filter((l) => l.dataset.jumpKey !== key);
      target = links.find((l) => !windowBefore.includes(Number(l.dataset.jumpKey!.split(':')[1])));
      if (target) break;
      document.querySelector<HTMLElement>(`#log [data-key="${key}"]`)!.click(); // collapse, try the next
    }
    expect(target, 'expected at least one pre-tx row at the first event with a linked copy outside the window').toBeTruthy();
    const targetKey = target!.dataset.jumpKey!;
    const targetEvent = Number(targetKey.split(':')[1]);

    target!.click();
    expect(await getWindowEvents()).toContain(targetEvent);
    const expandedRow = document.querySelector<HTMLElement>('#log .msg-row.expanded');
    expect(expandedRow?.dataset.key).toBe(targetKey);
  });

  it('jumping to a copy already inside the current window selects it without moving the window', async () => {
    const { state } = await getAppState();
    const windowStartBefore = state.windowStartIdx;

    const preRow = [...document.querySelectorAll<HTMLElement>('#log .msg-row:not(.control-row):not(.not-observed)')].find(
      (r) => r.textContent?.includes('PRE'),
    );
    expect(preRow).toBeTruthy();
    const ownKey = preRow!.dataset.key!;
    preRow!.click();

    const links = [
      ...document.querySelectorAll<HTMLElement>(`#log [data-key="${ownKey}"] + * .thread-row-link[data-jump-key]`),
    ].filter((l) => l.dataset.jumpKey !== ownKey);
    const windowNow = await getWindowEvents();
    const target = links.find((l) => windowNow.includes(Number(l.dataset.jumpKey!.split(':')[1])));
    if (!target) return; // this window happens to have no same-window linked copy; nothing to assert
    target.click();
    expect(state.windowStartIdx).toBe(windowStartBefore);
    expect(document.querySelector<HTMLElement>('#log .msg-row.expanded')?.dataset.key).toBe(target.dataset.jumpKey);
  });
});
