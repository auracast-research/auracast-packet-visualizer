import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractEnhancedPackets } from '../../src/pcapng/blocks';
import { buildCaptureFromPackets, estimateEventBaseUs, estimateEventIndexForTimeUs } from '../../src/pcapng/capture';

function loadCapture(fixture: string) {
  const buf = readFileSync(path.resolve(__dirname, '..', 'fixtures', fixture));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return buildCaptureFromPackets(extractEnhancedPackets(arrayBuffer));
}

describe('estimateEventBaseUs', () => {
  it('returns the exact observed base time for an observed event', () => {
    const capture = loadCapture('auracast.pcapng');
    const event = capture.eventsSorted[10]!;
    expect(estimateEventBaseUs(capture, event)).toBe(capture.eventBaseUs.get(event));
  });

  it('interpolates between real neighbors for an unobserved event, not the configured ISO_Interval', () => {
    // Confirmed directly: this fixture's real inter-event cadence (~10ms) does not match its
    // configured ISO_Interval (30ms) — a nominal-schedule estimate would be off by ~3x.
    const capture = loadCapture('auracast.pcapng');
    const sorted = capture.eventsSorted;
    const gapIdx = sorted.findIndex((e, i) => i > 0 && e - sorted[i - 1]! > 1);
    expect(gapIdx, 'expected at least one real gap between observed events in this fixture').toBeGreaterThan(0);
    const before = sorted[gapIdx - 1]!;
    const after = sorted[gapIdx]!;
    const missing = before + 1;
    expect(missing).toBeLessThan(after);
    const estimated = estimateEventBaseUs(capture, missing);
    const tBefore = capture.eventBaseUs.get(before)!;
    const tAfter = capture.eventBaseUs.get(after)!;
    expect(estimated).toBeGreaterThan(tBefore);
    expect(estimated).toBeLessThan(tAfter);
  });
});

describe('estimateEventIndexForTimeUs (inverse of estimateEventBaseUs)', () => {
  it.each(['auracast.pcapng', 'auracast2.pcapng', 'auracast3.pcapng'])(
    'round-trips exactly through an observed event\'s own base time, in %s',
    (fixture) => {
      const capture = loadCapture(fixture);
      const event = capture.eventsSorted[10]!;
      const idx = estimateEventIndexForTimeUs(capture, capture.eventBaseUs.get(event)!);
      expect(idx).toBeCloseTo(event - capture.allEventsRange[0]!, 1);
    },
  );

  it('is robust to a real out-of-order timestamp elsewhere in the file (auracast2.pcapng)', () => {
    // auracast2.pcapng has exactly one event whose observed base time is ~67s out of sequence
    // relative to its event-number neighbors — a naive binary search directly against
    // eventsSorted (sorted by event number, not time) breaks on queries far from the anomaly
    // too, since binary search requires the array be sorted by the search key.
    const capture = loadCapture('auracast2.pcapng');
    for (const i of [5, 50, 500]) {
      const event = capture.eventsSorted[i]!;
      const idx = estimateEventIndexForTimeUs(capture, capture.eventBaseUs.get(event)!);
      expect(idx).toBeCloseTo(event - capture.allEventsRange[0]!, 1);
    }
  });
});
