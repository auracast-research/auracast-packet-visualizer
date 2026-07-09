import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractEnhancedPackets, parsePcapngBlocks } from '../../src/pcapng/blocks';
import { parsePacketComment, tokenizeKeyValue } from '../../src/pcapng/comments';

function loadFixtureArrayBuffer(name: string): ArrayBuffer {
  const buf = readFileSync(path.resolve(__dirname, '..', 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('tokenizeKeyValue', () => {
  it('splits key=value tokens, folding trailing bare words into the previous value', () => {
    expect(tokenizeKeyValue('event=3 bis=1 kind=data new')).toEqual({
      event: '3',
      bis: '1',
      kind: 'data new',
    });
  });

  it('returns an empty object for an empty string', () => {
    expect(tokenizeKeyValue('')).toEqual({});
  });
});

describe('parsePacketComment', () => {
  it('classifies retransmission/pretransmission/new from the kind field', () => {
    expect(parsePacketComment('event=3 bis=1 chan=10 se=2 payload_num=5 kind=data new').kindSimple).toBe(
      'new',
    );
    expect(
      parsePacketComment('event=3 bis=1 chan=10 se=3 payload_num=5 kind=data retransmission')
        .kindSimple,
    ).toBe('retx');
    expect(
      parsePacketComment('event=3 bis=1 chan=10 se=8 payload_num=17 kind=data pretransmission')
        .kindSimple,
    ).toBe('pretx');
  });
});

describe('pcapng block/packet extraction against real captures', () => {
  it.each(['auracast.pcapng', 'auracast2.pcapng', 'auracast3.pcapng'])(
    'parses %s into a non-empty, well-formed set of Enhanced Packet Blocks',
    (fixture) => {
      const arrayBuffer = loadFixtureArrayBuffer(fixture);
      const dv = new DataView(arrayBuffer);
      const { blocks, little } = parsePcapngBlocks(dv);
      expect(blocks.length).toBeGreaterThan(0);
      expect(typeof little).toBe('boolean');

      const packets = extractEnhancedPackets(arrayBuffer);
      expect(packets.length).toBeGreaterThan(0);
      for (const p of packets) {
        expect(p.tsUs).toBeGreaterThanOrEqual(0);
        expect(p.bytes.length).toBe(p.capLen);
      }
      // NOT asserting timestamps come out monotonically non-decreasing here: real captures can
      // have the occasional out-of-order block (confirmed directly against auracast2.pcapng's
      // raw bytes — 1 out-of-order adjacent pair among 14618 blocks), which is exactly why
      // buildCaptureFromPackets explicitly re-sorts by tsUs downstream rather than trusting
      // block order. extractEnhancedPackets is only responsible for preserving raw block order
      // faithfully, not for sorting.
    },
  );

  it('matches the frozen golden totalPackets count for auracast.pcapng', () => {
    const golden = JSON.parse(
      readFileSync(path.resolve(__dirname, '..', 'fixtures', 'golden', 'auracast.golden.json'), 'utf8'),
    );
    const packets = extractEnhancedPackets(loadFixtureArrayBuffer('auracast.pcapng'));
    expect(packets.length).toBe(golden.totalPackets);
  });
});
