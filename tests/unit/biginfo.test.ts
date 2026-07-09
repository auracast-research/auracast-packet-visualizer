import { describe, expect, it } from 'vitest';
import { decodeBigInfoFromRawPacket } from '../../src/pcapng/biginfo';

describe('decodeBigInfoFromRawPacket', () => {
  it('rejects packets too short to contain a PHY-header LE packet', () => {
    expect(decodeBigInfoFromRawPacket(new Uint8Array(8)).ok).toBe(false);
  });
});
