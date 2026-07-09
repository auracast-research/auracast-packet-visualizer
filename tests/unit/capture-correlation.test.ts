import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractEnhancedPackets } from '../../src/pcapng/blocks';
import { buildCaptureFromPackets, buildSubeventsFromCapture, windowEvents } from '../../src/pcapng/capture';

function loadCapture(fixture: string) {
  const buf = readFileSync(path.resolve(__dirname, '..', 'fixtures', fixture));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return buildCaptureFromPackets(extractEnhancedPackets(arrayBuffer));
}

function loadGolden(name: string) {
  return JSON.parse(
    readFileSync(path.resolve(__dirname, '..', 'fixtures', 'golden', `${name}.golden.json`), 'utf8'),
  );
}

describe.each(['auracast', 'auracast2', 'auracast3'])(
  'buildCaptureFromPackets matches the frozen golden output for %s.pcapng',
  (name) => {
    const capture = loadCapture(`${name}.pcapng`);
    const golden = loadGolden(name);

    it('matches config, derived regime, and BIGInfo cross-check', () => {
      expect(capture.config).toEqual(golden.config);
      expect(capture.nse).toBe(golden.nse);
      expect(capture.regimeFromRatio).toBe(golden.regimeFromRatio);
      expect(capture.ptoConsistent).toBe(golden.ptoConsistent);
    });

    it('matches packet/row/event counts', () => {
      expect(capture.totalPackets).toBe(golden.totalPackets);
      expect(capture.rawUncommentedCount).toBe(golden.rawUncommentedCount);
      expect(capture.rows.length).toBe(golden.rowsCount);
      expect(capture.eventsSorted).toEqual(golden.eventsSorted);
      expect(capture.allEventsRange.length).toBe(golden.allEventsRangeLength);
      expect(capture.byKey.size).toBe(golden.byKeySize);
      expect(capture.copiesByPayload.size).toBe(golden.copiesByPayloadSize);
      expect(capture.originEvent.size).toBe(golden.originEventSize);
      expect(capture.originUs).toBe(golden.originUs);
    });

    it('matches the first/last rows exactly (spot check of row shape and ordering)', () => {
      expect(capture.rows.slice(0, 5)).toEqual(golden.rowsSample);
      expect(capture.rows.slice(-5)).toEqual(golden.rowsSampleTail);
    });

    it('matches a sample of originEvent entries', () => {
      const sample = Object.fromEntries([...capture.originEvent.entries()].slice(0, 10));
      expect(sample).toEqual(golden.originEventSample);
    });

    it('matches per-BIS-row pre-transmission origin-correlation stats', () => {
      const pretxByRow: Record<number, number> = {};
      const foundByRow: Record<number, number> = {};
      const newByRow: Record<number, number> = {};
      for (const r of capture.rows) {
        const row0 = r.bis - 1;
        if (r.kindSimple === 'new') newByRow[row0] = (newByRow[row0] || 0) + 1;
        if (r.kindSimple === 'pretx') {
          pretxByRow[row0] = (pretxByRow[row0] || 0) + 1;
          if (capture.originEvent.get(`${row0}:${r.payloadNum}`) !== undefined) {
            foundByRow[row0] = (foundByRow[row0] || 0) + 1;
          }
        }
      }
      expect({ newByRow, pretxByRow, foundByRow }).toEqual(golden.pretxOriginStatsByRow);
    });
  },
);

describe('BIS-1 (row 0) pre-transmission origin-correlation regression guard', () => {
  // Dedicated, explicit guard against the bug fixed this session: originEvent was keyed by the
  // raw 1-based BIS number while every lookup used 0-based row indices, so BIS row 0's lookups
  // ("0:payloadNum") never matched anything stored (nothing is ever stored under "0:..."),
  // making BIS 1 permanently report "never captured" even when its original transmission was
  // right there in the log. This test fails loudly (not just via the broader golden-diff above)
  // if that specific regression is ever reintroduced.
  const capture = loadCapture('auracast.pcapng');

  it('BIS row 0 resolves the origin event for the large majority of its pre-transmission copies', () => {
    let pretxRow0 = 0;
    let foundRow0 = 0;
    for (const r of capture.rows) {
      if (r.bis - 1 !== 0 || r.kindSimple !== 'pretx') continue;
      pretxRow0++;
      if (capture.originEvent.get(`0:${r.payloadNum}`) !== undefined) foundRow0++;
    }
    expect(pretxRow0).toBeGreaterThan(0);
    // Not 100% because some origins genuinely fall outside the captured window — but it must
    // not be anywhere near 0, which is what the bug produced.
    expect(foundRow0 / pretxRow0).toBeGreaterThan(0.5);
  });

  it('"new" transmissions exist for BIS row 0, so a 0-find rate could only be a lookup bug, never real data absence', () => {
    const newRow0 = capture.rows.filter((r) => r.bis - 1 === 0 && r.kindSimple === 'new').length;
    expect(newRow0).toBeGreaterThan(0);
  });
});

describe('buildSubeventsFromCapture', () => {
  it('expands exactly eventsShown x numBis x nse entries for a full in-range window', () => {
    const capture = loadCapture('auracast.pcapng');
    const eventsShown = 3;
    const windowStartIdx = 0;
    const model = buildSubeventsFromCapture(capture, windowStartIdx, eventsShown);
    const events = windowEvents(capture, windowStartIdx, eventsShown);
    expect(events.length).toBe(eventsShown);
    expect(model.preExpanded).toBe(true);
    expect(model.list.length).toBe(eventsShown * capture.config.numBis * model.nse);
  });

  it('marks entries with no matching real packet as observed:false with a null pduBytes/sdu', () => {
    const capture = loadCapture('auracast.pcapng');
    // windowStartIdx=0 (the file's very first 3 events) happens to have 100% real-packet
    // coverage in this fixture — confirmed by direct inspection, not a bug — so it can't
    // exercise the "never captured" branch. windowStartIdx=280 is a window confirmed (by the
    // same direct inspection) to contain real gaps.
    const model = buildSubeventsFromCapture(capture, 280, 3);
    const unobserved = model.list.filter((i) => !i.observed);
    expect(unobserved.length).toBeGreaterThan(0);
    for (const item of unobserved) {
      expect(item.sdu).toBeNull();
      expect(item.pduBytes).toBeNull();
    }
    const observed = model.list.filter((i) => i.observed);
    expect(observed.length).toBeGreaterThan(0);
    for (const item of observed) {
      expect(item.sdu).not.toBeNull();
      expect(typeof item.pduBytes).toBe('number');
    }
  });

  it('always populates expectedSdu - the real payloadNum when observed, a formula prediction otherwise', () => {
    const capture = loadCapture('auracast.pcapng');
    const model = buildSubeventsFromCapture(capture, 280, 3);
    for (const item of model.list) {
      expect(typeof item.expectedSdu).toBe('number');
      if (item.observed) expect(item.expectedSdu).toBe(item.sdu);
    }
  });
});
