import { describe, expect, it } from 'vitest';
import { decodeBigControlPduFromRawPacket, describeControlPdu } from '../../src/pcapng/controlPdu';

// Builds a minimal synthetic raw LL Control PDU: 10-byte PHY pseudo-header (all zero, contents
// don't matter to this decoder) + AccessAddress(4) + Header(LLID=Control in byte0, Length in
// byte1) + payload + a 3-byte CRC placeholder.
function makeControlPduBytes(payload: number[]): Uint8Array {
  const pseudoHeader = new Array(10).fill(0);
  const accessAddress = [0xaa, 0xbb, 0xcc, 0xdd];
  const header = [0x03, payload.length]; // LLID=0b11 (Control) in the low 2 bits of byte0
  const crc = [0, 0, 0];
  return new Uint8Array([...pseudoHeader, ...accessAddress, ...header, ...payload, ...crc]);
}

describe('decodeBigControlPduFromRawPacket', () => {
  it('decodes a plaintext BIG_ChannelMap_Ind when the BIG is not encrypted', () => {
    const chm = [0xff, 0x00, 0x00, 0x00, 0x00]; // channels 0-7 used
    const instantLo = 0x0a;
    const instantHi = 0x00;
    const bytes = makeControlPduBytes([0x00, ...chm, instantLo, instantHi]);
    const decoded = decodeBigControlPduFromRawPacket(bytes, false);
    expect(decoded.ok).toBe(true);
    expect(decoded.kind).toBe('channelMapUpdate');
    expect(decoded.instant).toBe(10);
  });

  it('refuses to interpret the payload at all when the BIG is encrypted, even if it looks plausible', () => {
    // Same bytes as the plaintext case above — a valid-looking BIG_ChannelMap_Ind — but with
    // encrypted=true this must not be reported as decoded, since a real encrypted payload's
    // first byte is ciphertext, not a real CtrlType. This is the exact failure mode confirmed
    // against test-enc.pcapng that motivated this guard.
    const chm = [0xff, 0x00, 0x00, 0x00, 0x00];
    const bytes = makeControlPduBytes([0x00, ...chm, 0x0a, 0x00]);
    const decoded = decodeBigControlPduFromRawPacket(bytes, true);
    expect(decoded.ok).toBe(false);
    expect(decoded.encrypted).toBe(true);
    expect(decoded.ctrlType).toBeUndefined();
    expect(decoded.kind).toBeUndefined();
  });

  it('still reports unencrypted, unrecognized CtrlTypes as a real (if unrecognized) decode failure', () => {
    const bytes = makeControlPduBytes([0x7f]);
    const decoded = decodeBigControlPduFromRawPacket(bytes, false);
    expect(decoded.ok).toBe(false);
    expect(decoded.encrypted).toBeUndefined();
    expect(decoded.ctrlType).toBe(0x7f);
  });
});

describe('describeControlPdu', () => {
  it('reports an encrypted control PDU distinctly from a generic decode failure', () => {
    const { title, desc } = describeControlPdu({ ok: false, encrypted: true, reason: 'BIG is encrypted' });
    expect(title).toContain('encrypted');
    expect(desc.toLowerCase()).toContain('ciphertext');
  });

  it('falls back to a generic message for a non-encryption decode failure', () => {
    const { desc } = describeControlPdu({ ok: false, reason: 'unrecognized CtrlType 0x7f', ctrlType: 0x7f });
    expect(desc).toBe('Could not decode content: unrecognized CtrlType 0x7f');
  });
});
