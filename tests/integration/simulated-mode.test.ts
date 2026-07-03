// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { mountApp } from './helpers';

function stubScrollWidth(width: number) {
  const el = document.getElementById('detailmapScroll')!;
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
}

describe('simulated mode: initial load', () => {
  beforeEach(mountApp);

  it('renders the default quickconfig/summary and a non-empty log', () => {
    expect(document.getElementById('quickconfig')!.textContent).toContain('BN 4');
    expect(document.getElementById('summaryLine')!.textContent).toContain('sub-events per BIS');
    expect(document.querySelectorAll('#log .msg-row').length).toBeGreaterThan(0);
  });

  it('hides the whole-capture overview and shows the sub-event detail timeline', () => {
    expect((document.getElementById('minimap') as HTMLElement).style.display).toBe('none');
    expect(document.getElementById('detailLabel')!.textContent).toBe('Sub-event detail');
    expect(document.querySelectorAll('#detailmap .mm-tick').length).toBeGreaterThan(0);
  });
});

describe('simulated mode: config controls drive a full recompute', () => {
  beforeEach(mountApp);

  it('changing BN via the range input updates the log and quickconfig', () => {
    const bn = document.getElementById('bn') as HTMLInputElement;
    bn.value = '2';
    bn.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('quickconfig')!.textContent).toContain('BN 2');
  });

  it('a preset button applies multiple fields at once and syncs the controls', () => {
    document.querySelector<HTMLElement>('[data-preset="latency"]')!.click();
    expect((document.getElementById('bn') as HTMLInputElement).value).toBe('1');
    expect((document.getElementById('irc') as HTMLInputElement).value).toBe('1');
    expect(document.getElementById('quickconfig')!.textContent).toContain('BN 1');
  });

  it('YAML export reflects current state and round-trips through import', () => {
    const bn = document.getElementById('bn') as HTMLInputElement;
    bn.value = '6';
    bn.dispatchEvent(new Event('input', { bubbles: true }));
    const yaml = (document.getElementById('yamlExport') as HTMLTextAreaElement).value;
    expect(yaml).toContain('bn: 6');

    document.querySelector<HTMLElement>('[data-preset="latency"]')!.click();
    expect((document.getElementById('bn') as HTMLInputElement).value).toBe('1');

    (document.getElementById('yamlImport') as HTMLTextAreaElement).value = yaml;
    document.getElementById('applyYaml')!.click();
    expect((document.getElementById('bn') as HTMLInputElement).value).toBe('6');
    expect(document.getElementById('importState')!.textContent).toBe('Configuration applied.');
  });
});

describe('simulated mode: cross-highlight sync between log and detail timeline', () => {
  beforeEach(async () => {
    await mountApp();
    stubScrollWidth(900);
  });

  it('clicking a log row selects the matching detail-timeline tick, and toggles off on a second click', () => {
    const firstRow = document.querySelector<HTMLElement>('#log .msg-row:not(.control-row):not(.not-observed)')!;
    firstRow.click();
    expect(document.querySelectorAll('#detailmap .mm-tick.selected').length).toBe(1);
    expect(document.querySelector('#log .msg-row.expanded')).not.toBeNull();

    document.querySelector<HTMLElement>('#log .msg-row.expanded')!.click();
    expect(document.querySelectorAll('#detailmap .mm-tick.selected').length).toBe(0);
    expect(document.querySelector('#log .msg-row.expanded')).toBeNull();
  });

  it('clicking a detail-timeline tick expands the matching log row', () => {
    const tick = document.querySelectorAll<SVGElement>('#detailmap .mm-tick')[3]!;
    const key = tick.getAttribute('data-key');
    tick.dispatchEvent(new Event('click', { bubbles: true }));
    const expandedRow = document.querySelector<HTMLElement>('#log .msg-row.expanded');
    expect(expandedRow?.dataset.key).toBe(key);
  });
});

describe('simulated mode: jumping to a matching copy from inside a thread', () => {
  beforeEach(async () => {
    await mountApp();
    stubScrollWidth(900);
  });

  it("clicking an on-screen copy's entry inside another copy's expanded thread jumps to and expands it", () => {
    // Default config (bn=4, irc=2, pto=2, npt=1, eventsShown=3): event 0's pre-transmission
    // group targets event 0+pto=2, which is on-screen — a case where a pre-tx row's own thread
    // has an on-screen NEW entry to jump to.
    const candidates = [...document.querySelectorAll<HTMLElement>('#log .msg-row:not(.control-row):not(.not-observed)')].filter(
      (r) => r.dataset.key?.startsWith('0:0:') && r.textContent?.includes('PRE'),
    );
    expect(candidates.length, 'expected at least one pre-tx row at event 0').toBeGreaterThan(0);
    candidates[0]!.click();
    const ownKey = candidates[0]!.dataset.key;

    // A thread includes an entry for itself too (clicking that one would just toggle the row
    // closed, per selectRow's existing toggle semantics) — this test is specifically about
    // jumping to a DIFFERENT copy, so skip that entry.
    const links = [
      ...document.querySelectorAll<HTMLElement>(`#log [data-key="${ownKey}"] + * .thread-row-link[data-jump-key]`),
    ].filter((l) => l.dataset.jumpKey !== ownKey);
    expect(links.length, 'expected at least one jumpable entry (other than itself) in the opened thread').toBeGreaterThan(0);
    const link = links[0]!;
    const targetKey = link.dataset.jumpKey!;

    link.click();
    const expandedRow = document.querySelector<HTMLElement>('#log .msg-row.expanded');
    expect(expandedRow?.dataset.key).toBe(targetKey);
    // The previously-expanded pre-tx row is no longer expanded.
    expect(document.querySelectorAll('#log .msg-row.expanded').length).toBe(1);
  });

  it('off-screen copies inside a thread are not jumpable (no data-jump-key)', () => {
    const candidates = [...document.querySelectorAll<HTMLElement>('#log .msg-row:not(.control-row):not(.not-observed)')].filter(
      (r) => r.textContent?.includes('PRE'),
    );
    candidates[0]!.click();
    const fresh = document.querySelector<HTMLElement>(`#log [data-key="${candidates[0]!.dataset.key}"]`)!;
    const offscreenEntries = fresh.nextElementSibling!.querySelectorAll('.thread-row.offscreen');
    offscreenEntries.forEach((row) => {
      expect(row.querySelector('[data-jump-key]')).toBeNull();
    });
  });
});

describe('simulated mode: detail-timeline zoom', () => {
  beforeEach(async () => {
    await mountApp();
    stubScrollWidth(900);
  });

  it('zoom buttons widen the SVG, and Fit resets it to the container width', () => {
    const svg = document.getElementById('detailmap')!;
    const initial = Number(svg.getAttribute('width'));
    document.getElementById('detailZoomIn')!.click();
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(initial);
    document.getElementById('detailFit')!.click();
    expect(Number(svg.getAttribute('width'))).toBe(900);
  });

  it('plain wheel zooms directly (matching the overview\'s mouse-wheel zoom), shift+wheel does not', () => {
    const svg = document.getElementById('detailmap')!;
    const scrollEl = document.getElementById('detailmapScroll')!;
    Object.defineProperty(scrollEl, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 900, height: 200, right: 900, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    const before = Number(svg.getAttribute('width'));
    scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, shiftKey: true, bubbles: true, cancelable: true }));
    expect(Number(svg.getAttribute('width'))).toBe(before);
    scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 450, bubbles: true, cancelable: true }));
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(before);
  });

  it('wheel-zoom is centered on the cursor: the content pixel under the cursor stays fixed', () => {
    const scrollEl = document.getElementById('detailmapScroll')!;
    Object.defineProperty(scrollEl, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 900, height: 200, right: 900, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    scrollEl.scrollLeft = 100;
    const cursorClientX = 300; // content position under cursor: 100 (scrollLeft) + 300 = 400
    scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: cursorClientX, bubbles: true, cancelable: true }));
    // after zooming in, the same content point (scaled by the zoom ratio) should still align
    // under the cursor: scrollLeft + cursorClientX ≈ 400 * scaleRatio
    const svg = document.getElementById('detailmap')!;
    const newWidth = Number(svg.getAttribute('width'));
    const scaleRatio = newWidth / 900;
    expect(scrollEl.scrollLeft + cursorClientX).toBeCloseTo(400 * scaleRatio, 0);
  });

  it('dimension-bracket labels never run past the SVG width, even zoomed in', () => {
    for (let i = 0; i < 8; i++) document.getElementById('detailZoomIn')!.click();
    const vw = Number(document.getElementById('detailmap')!.getAttribute('width'));
    const tags = document.querySelectorAll('#detailmap .dim-tag');
    expect(tags.length).toBeGreaterThan(0);
    tags.forEach((t) => {
      const x = Number(t.getAttribute('x'));
      const w = Number(t.getAttribute('width'));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(vw + 0.5);
    });
  });
});

describe('simulated mode: dimension brackets and PDU tags across configs', () => {
  beforeEach(async () => {
    await mountApp();
    stubScrollWidth(900);
  });

  it('shows Sub_Interval and ISO_Interval brackets, and BIS_Spacing only with >1 BIS', () => {
    let labels = [...document.querySelectorAll('#detailmap .dim-label')].map((t) => t.textContent);
    expect(labels.some((l) => l?.includes('Sub_Interval'))).toBe(true);
    expect(labels.some((l) => l?.includes('ISO_Interval'))).toBe(true);
    expect(labels.some((l) => l?.includes('BIS_Spacing'))).toBe(true);

    const numBis = document.getElementById('numBis') as HTMLInputElement;
    numBis.value = '1';
    numBis.dispatchEvent(new Event('input', { bubbles: true }));
    labels = [...document.querySelectorAll('#detailmap .dim-label')].map((t) => t.textContent);
    expect(labels.some((l) => l?.includes('BIS_Spacing'))).toBe(false);
  });

  it('PDU tag on each log row equals the configured Max_PDU', () => {
    const tags = [...document.querySelectorAll('#log .pdutag')].map((t) => t.textContent);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((t) => t === '40B')).toBe(true);
  });

  it('no script errors are produced across interleaved / control-subevent / many-BIS configs', () => {
    const errors: unknown[] = [];
    window.addEventListener('error', (e) => errors.push(e.error ?? e.message));

    document.getElementById('autoInterleave')!.click();
    document.getElementById('showControlSubevent')!.click();
    const numBis = document.getElementById('numBis') as HTMLInputElement;
    numBis.value = '4';
    numBis.dispatchEvent(new Event('input', { bubbles: true }));

    expect(errors).toEqual([]);
    expect(document.querySelectorAll('#detailmap .mm-tick').length).toBeGreaterThan(0);
  });
});
