import type { PcapngBlock, PcapngOption, RawPacket } from '../types';

export function parsePcapngBlocks(dv: DataView): { blocks: PcapngBlock[]; little: boolean } {
  let off = 0;
  let little = true;
  const blocks: PcapngBlock[] = [];
  while (off + 8 <= dv.byteLength) {
    const blockType = dv.getUint32(off, true);
    if (blockType === 0x0a0d0d0a) {
      const magic = dv.getUint32(off + 8, true);
      little = magic === 0x1a2b3c4d;
    }
    const blockLen = dv.getUint32(off + 4, little);
    if (blockLen < 12 || off + blockLen > dv.byteLength) break;
    blocks.push({ type: blockType, off, len: blockLen });
    off += blockLen;
  }
  return { blocks, little };
}

export function parsePcapngOptions(
  dv: DataView,
  start: number,
  end: number,
  little: boolean,
): PcapngOption[] {
  const opts: PcapngOption[] = [];
  let off = start;
  while (off + 4 <= end) {
    const code = dv.getUint16(off, little);
    const len = dv.getUint16(off + 2, little);
    off += 4;
    if (code === 0 && len === 0) break;
    const val = new Uint8Array(dv.buffer, dv.byteOffset + off, len);
    off += len + ((4 - (len % 4)) % 4);
    opts.push({ code, val });
  }
  return opts;
}

export function extractEnhancedPackets(arrayBuffer: ArrayBuffer): RawPacket[] {
  const dv = new DataView(arrayBuffer);
  const { blocks, little } = parsePcapngBlocks(dv);
  const decoder = new TextDecoder('utf-8');
  const packets: RawPacket[] = [];
  for (const b of blocks) {
    if (b.type !== 0x00000006) continue; // Enhanced Packet Block
    const o = b.off;
    const tsHigh = dv.getUint32(o + 12, little);
    const tsLow = dv.getUint32(o + 16, little);
    const capLen = dv.getUint32(o + 20, little);
    const dataOff = o + 28;
    const bytes = new Uint8Array(arrayBuffer, dataOff, capLen);
    const optStart = dataOff + capLen + ((4 - (capLen % 4)) % 4);
    const opts = parsePcapngOptions(dv, optStart, o + b.len - 4, little);
    let comment: string | null = null;
    for (const opt of opts) if (opt.code === 1) comment = decoder.decode(opt.val);
    packets.push({ tsUs: tsHigh * 4294967296 + tsLow, capLen, comment, bytes });
  }
  return packets;
}
