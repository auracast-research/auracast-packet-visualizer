import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractEnhancedPackets } from '../../src/pcapng/blocks';
import { buildCaptureFromPackets, computeEventRecoveryStats } from '../../src/pcapng/capture';

function loadCapture(fixture: string) {
  const buf = readFileSync(path.resolve(__dirname, '..', 'fixtures', fixture));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return buildCaptureFromPackets(extractEnhancedPackets(arrayBuffer));
}

describe('computeEventRecoveryStats', () => {
  it('totalPayloads is always numBis * bn, and the three buckets sum to it', () => {
    const capture = loadCapture('auracast.pcapng');
    for (const E of capture.allEventsRange.slice(0, 50)) {
      const stats = computeEventRecoveryStats(capture, E);
      expect(stats.totalPayloads).toBe(capture.config.numBis * capture.config.bn);
      expect(stats.lostPayloads + stats.partialPayloads + stats.fullPayloads).toBe(stats.totalPayloads);
    }
  });

  it("status is 'full' only when every payload has every scheduled copy", () => {
    const capture = loadCapture('auracast.pcapng');
    const distribution = { lost: 0, degraded: 0, full: 0 };
    for (const E of capture.allEventsRange) {
      const stats = computeEventRecoveryStats(capture, E);
      distribution[stats.status]++;
      if (stats.status === 'full') {
        expect(stats.lostPayloads).toBe(0);
        expect(stats.partialPayloads).toBe(0);
      }
      if (stats.status === 'lost') {
        expect(stats.lostPayloads).toBeGreaterThan(0);
      }
      if (stats.status === 'degraded') {
        expect(stats.lostPayloads).toBe(0);
        expect(stats.partialPayloads + stats.fullPayloads).toBe(stats.totalPayloads);
      }
    }
    // Sanity: a real capture with genuine data loss should exercise all three buckets, not just
    // the trivial "everything is perfect" case.
    expect(distribution.lost).toBeGreaterThan(0);
    expect(distribution.degraded).toBeGreaterThan(0);
    expect(distribution.full).toBeGreaterThan(0);
  });

  it('a payload recovered only via a pre-transmission in an earlier event still counts as received (not lost)', () => {
    // Construct the scenario directly: an event whose own "new" copy AND in-event retx copies
    // are all missing from byKey, but whose pre-transmission (scheduled pto*(k+1) events
    // earlier) is present — computeEventRecoveryStats must not report it as lost.
    const capture = loadCapture('auracast.pcapng');
    const cfg = capture.config;
    // Find a real event/row/b combination where the own-event copies are genuinely absent but
    // at least one pre-transmission copy for it exists earlier in the file.
    let found = false;
    for (const E of capture.allEventsRange) {
      for (let row = 0; row < cfg.numBis && !found; row++) {
        for (let b = 0; b < cfg.bn && !found; b++) {
          const ownCopiesMissing = Array.from({ length: cfg.irc }, (_, g) => g).every(
            (g) => !capture.byKey.has(`${E}:${row}:${g * cfg.bn + b}`),
          );
          if (!ownCopiesMissing) continue;
          const pretxPresent = Array.from({ length: cfg.npt }, (_, k) => k).some((k) => {
            const srcEvent = E - cfg.pto * (k + 1);
            return capture.byKey.has(`${srcEvent}:${row}:${(cfg.irc + k) * cfg.bn + b}`);
          });
          if (pretxPresent) {
            const stats = computeEventRecoveryStats(capture, E);
            expect(stats.lostPayloads).toBeLessThan(stats.totalPayloads); // this payload isn't in the lost bucket
            found = true;
          }
        }
      }
    }
    expect(found, 'expected to find at least one real pre-transmission-only recovery case in this fixture').toBe(true);
  });
});
