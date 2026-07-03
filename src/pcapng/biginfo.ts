import type { BigInfoDecoded } from '../types';

// Reads consecutive bits LSB-first across a byte string — the packing order the Bluetooth
// Core Spec uses for bit-field structures like BIGInfo.
export function makeBitReader(bytes: Uint8Array): { read(n: number): number } {
  let bitPos = 0;
  return {
    read(n: number): number {
      let v = 0;
      for (let i = 0; i < n; i++) {
        const bytePos = (bitPos + i) >> 3;
        const bit = (bytes[bytePos]! >> ((bitPos + i) & 7)) & 1;
        v |= bit << i;
      }
      bitPos += n;
      return v;
    },
  };
}

// Decodes BIGInfo (Core Spec Vol 6, Part B §4.4.6.11) straight from a raw, uncommented LE LL
// packet — the periodic advertising / AUX_SYNC_IND PDU a real sniffer captures, with no
// synthetic annotation. Field layout verified field-by-field against this tool's own
// synthetic-comment ground truth (every field below matched exactly, incl. seedAccessAddress
// and an independently-measured PTO) across multiple packets in a real capture — see the
// git history / session notes for that validation. Stops at SDU_Interval: fields after that
// (Max_SDU, BaseCRCInit, payload counter, encryption) aren't used by this tool and weren't
// independently verified, so they're deliberately not decoded rather than guessed.
//
// Pseudo-header is LINKTYPE_BLUETOOTH_LE_LL_WITH_PHDR (DLT 256): 10 bytes — rf_channel(1),
// signal_power(1, signed), noise_power(1, signed), aa_offenses(1), ref_access_address(4, LE),
// flags(2, LE) — then the LE packet itself: AccessAddress(4) + Header(2) + Payload + CRC(3).
export function decodeBigInfoFromRawPacket(bytes: Uint8Array): BigInfoDecoded {
  if (bytes.length < 10 + 6) return { ok: false, reason: 'too short for a PHY-header LE packet' };
  const lePacket = bytes.subarray(10);
  if (lePacket.length < 6) return { ok: false, reason: 'too short after pseudo-header' };
  const leDv = new DataView(lePacket.buffer, lePacket.byteOffset, lePacket.byteLength);
  const header = leDv.getUint16(4, true);
  const pduType = header & 0xf;
  const length = (header >> 8) & 0xff;
  if (pduType !== 0x7) {
    return { ok: false, reason: 'not an extended-advertising PDU (AUX_SYNC_IND expected)' };
  }
  if (lePacket.length < 6 + length) return { ok: false, reason: 'payload shorter than declared length' };
  const payload = lePacket.subarray(6, 6 + length);
  if (payload.length < 2) return { ok: false, reason: 'no extended header' };

  const extHdrLen = payload[0]! & 0x3f;
  const flagsByte = payload[1]!;
  const fieldSizes: Array<[number, number]> = [
    [0, 6], // AdvA
    [1, 6], // TargetA
    [2, 1], // CTEInfo
    [3, 2], // ADI
    [4, 3], // AuxPtr
    [5, 18], // SyncInfo
    [6, 1], // TxPower
  ];
  let pos = 2;
  for (const [bit, size] of fieldSizes) {
    if ((flagsByte >> bit) & 1) pos += size;
  }
  const acadEnd = 1 + extHdrLen;
  if (acadEnd > payload.length || pos > acadEnd) {
    return { ok: false, reason: 'extended header fields overrun its declared length' };
  }
  const acad = payload.subarray(pos, acadEnd);

  // ACAD is a run of standard AD structures (Length, Type, Data...) — walk them looking for
  // BIGInfo (AD type 0x2C, Bluetooth SIG assigned number).
  let acadPos = 0;
  let bigInfoBytes: Uint8Array | null = null;
  while (acadPos + 1 < acad.length) {
    const adLen = acad[acadPos]!;
    if (adLen === 0) break;
    const adType = acad[acadPos + 1]!;
    if (adType === 0x2c) {
      bigInfoBytes = acad.subarray(acadPos + 2, acadPos + 1 + adLen);
      break;
    }
    acadPos += 1 + adLen;
  }
  if (!bigInfoBytes) return { ok: false, reason: 'no BIGInfo (AD type 0x2C) found in ACAD' };
  if (bigInfoBytes.length < 20) return { ok: false, reason: 'BIGInfo shorter than expected' };

  const br = makeBitReader(bigInfoBytes);
  const bigOffset = br.read(14);
  const bigOffsetUnits = br.read(1);
  const isoIntervalRaw = br.read(12);
  const numBis = br.read(5);
  const nse = br.read(5);
  const bn = br.read(3);
  const subIntervalUs = br.read(20);
  const pto = br.read(4);
  const bisSpacingUs = br.read(20);
  const irc = br.read(4);
  const maxPdu = br.read(8);
  br.read(7); // RFU
  const framing = br.read(1);
  const seedAccessAddress = br.read(32);
  const sduIntervalUs = br.read(20);

  return {
    ok: true,
    bigOffset,
    bigOffsetUnits,
    isoIntervalMs: isoIntervalRaw * 1.25,
    numBis,
    nse,
    bn,
    subIntervalUs,
    pto,
    bisSpacingUs,
    irc,
    maxPdu,
    framing,
    seedAccessAddress,
    sduIntervalMs: sduIntervalUs / 1000,
  };
}
