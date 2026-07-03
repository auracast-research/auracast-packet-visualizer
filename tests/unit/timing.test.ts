import { describe, expect, it } from 'vitest';
import {
  controlOffsetUs,
  dataSpanUs,
  estimateAirtimeUs,
  packingRegime,
  slotWidthUs,
  subeventTimeUs,
  totalEventSpanUs,
} from '../../src/model/timing';
import type { TimingConfig } from '../../src/types';

const sequentialCfg: TimingConfig = {
  numBis: 2,
  bisSpacingUs: 4800, // tight sequential: NSE(12) x Sub_Interval(400)
  subIntervalUs: 400,
  isoIntervalMs: 20,
  showControlSubevent: false,
};

const interleavedCfg: TimingConfig = {
  numBis: 2,
  bisSpacingUs: 200, // Sub_Interval / NumBIS
  subIntervalUs: 400,
  isoIntervalMs: 20,
  showControlSubevent: false,
};

const singleBisCfg: TimingConfig = {
  numBis: 1,
  bisSpacingUs: 4800,
  subIntervalUs: 400,
  isoIntervalMs: 20,
  showControlSubevent: false,
};

describe('estimateAirtimeUs', () => {
  it('adds fixed overhead bytes and converts to microseconds at the given PHY rate', () => {
    expect(estimateAirtimeUs(40, 2)).toBeCloseTo(((40 + 14) * 8) / 2, 6);
    expect(estimateAirtimeUs(40, 1)).toBeCloseTo(((40 + 14) * 8) / 1, 6);
  });
});

describe('packingRegime', () => {
  it('is "single" with one BIS regardless of spacing', () => {
    expect(packingRegime(singleBisCfg)).toBe('single');
  });
  it('is "sequential" when BIS_Spacing >= Sub_Interval', () => {
    expect(packingRegime(sequentialCfg)).toBe('sequential');
  });
  it('is "interleaved" when BIS_Spacing < Sub_Interval', () => {
    expect(packingRegime(interleavedCfg)).toBe('interleaved');
  });
});

describe('subeventTimeUs', () => {
  it('single BIS: eventBase + s * Sub_Interval', () => {
    expect(subeventTimeUs({ event: 1, s: 3 }, 0, 12, singleBisCfg)).toBe(
      1 * 20 * 1000 + 3 * 400,
    );
  });

  it('sequential: row block offset by row * BIS_Spacing, then s * Sub_Interval within it', () => {
    expect(subeventTimeUs({ event: 0, s: 0 }, 0, 12, sequentialCfg)).toBe(0);
    expect(subeventTimeUs({ event: 0, s: 0 }, 1, 12, sequentialCfg)).toBe(4800);
    expect(subeventTimeUs({ event: 0, s: 5 }, 1, 12, sequentialCfg)).toBe(4800 + 5 * 400);
  });

  it('interleaved: slot index is (s * numBis + row) * BIS_Spacing', () => {
    expect(subeventTimeUs({ event: 0, s: 0 }, 0, 12, interleavedCfg)).toBe(0);
    expect(subeventTimeUs({ event: 0, s: 0 }, 1, 12, interleavedCfg)).toBe(200);
    expect(subeventTimeUs({ event: 0, s: 1 }, 0, 12, interleavedCfg)).toBe(2 * 200);
    // Same BIS's own consecutive sub-events land exactly Sub_Interval apart when the
    // interleaved invariant (numBis * BIS_Spacing === Sub_Interval) holds.
    expect(
      subeventTimeUs({ event: 0, s: 1 }, 0, 12, interleavedCfg) -
        subeventTimeUs({ event: 0, s: 0 }, 0, 12, interleavedCfg),
    ).toBe(interleavedCfg.subIntervalUs);
  });
});

describe('dataSpanUs / slotWidthUs / controlOffsetUs / totalEventSpanUs', () => {
  it('sequential: dataSpan is (numBis-1)*BIS_Spacing + nse*Sub_Interval', () => {
    expect(dataSpanUs(12, sequentialCfg)).toBe(1 * 4800 + 12 * 400);
  });
  it('interleaved: dataSpan is just nse*Sub_Interval', () => {
    expect(dataSpanUs(12, interleavedCfg)).toBe(12 * 400);
  });
  it('slotWidthUs is Sub_Interval sequentially, BIS_Spacing when interleaved', () => {
    expect(slotWidthUs(sequentialCfg)).toBe(400);
    expect(slotWidthUs(interleavedCfg)).toBe(200);
  });
  it('controlOffsetUs is numBis*BIS_Spacing sequentially, nse*Sub_Interval interleaved', () => {
    expect(controlOffsetUs(12, sequentialCfg)).toBe(2 * 4800);
    expect(controlOffsetUs(12, interleavedCfg)).toBe(12 * 400);
  });
  it('totalEventSpanUs adds one more Sub_Interval only when the control subevent is shown', () => {
    expect(totalEventSpanUs(12, sequentialCfg)).toBe(dataSpanUs(12, sequentialCfg));
    expect(totalEventSpanUs(12, { ...sequentialCfg, showControlSubevent: true })).toBe(
      controlOffsetUs(12, sequentialCfg) + sequentialCfg.subIntervalUs,
    );
  });
});
