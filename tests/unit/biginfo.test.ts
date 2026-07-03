import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractEnhancedPackets } from '../../src/pcapng/blocks';
import { decodeBigInfoFromRawPacket } from '../../src/pcapng/biginfo';

function loadFixtureArrayBuffer(name: string): ArrayBuffer {
  const buf = readFileSync(path.resolve(__dirname, '..', 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('decodeBigInfoFromRawPacket', () => {
  it('rejects packets too short to contain a PHY-header LE packet', () => {
    expect(decodeBigInfoFromRawPacket(new Uint8Array(8)).ok).toBe(false);
  });

  it('decodes a real BIGInfo AD structure out of raw, uncommented periodic-advertising packets, agreeing with the file\'s own synthetic BIG summary comment', () => {
    const golden = JSON.parse(
      readFileSync(path.resolve(__dirname, '..', 'fixtures', 'golden', 'auracast.golden.json'), 'utf8'),
    );
    const packets = extractEnhancedPackets(loadFixtureArrayBuffer('auracast.pcapng'));
    const rawUncommented = packets.filter((p) => !p.comment);
    expect(rawUncommented.length).toBe(golden.rawUncommentedCount);

    const decoded = rawUncommented.map((p) => decodeBigInfoFromRawPacket(p.bytes)).find((d) => d.ok);
    expect(decoded, 'expected at least one raw packet to decode a BIGInfo AD structure').toBeTruthy();

    // Cross-check against the config this same file's synthetic "BIG ..." comment declares
    // (captured in the golden fixture) — this is the same cross-check the original tool
    // performs live (`bigInfoCrossCheck`), just pinned as a fixture-backed regression test.
    expect(decoded!.numBis).toBe(golden.config.numBis);
    expect(decoded!.bn).toBe(golden.config.bn);
    expect(decoded!.irc).toBe(golden.config.irc);
    expect(decoded!.subIntervalUs).toBe(golden.config.subIntervalUs);
    expect(decoded!.bisSpacingUs).toBe(golden.config.bisSpacingUs);
    expect(decoded!.maxPdu).toBe(golden.config.maxPdu);
    expect(decoded!.isoIntervalMs).toBeCloseTo(golden.config.isoIntervalMs, 5);
    expect(decoded!.sduIntervalMs).toBeCloseTo(golden.config.sduIntervalMs, 5);
  });
});
