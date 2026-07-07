import type { BigControlPduDecoded } from '../types';

// Decodes a real captured LL BIG Control PDU (Core Spec Vol 6, Part B) straight from the raw LE
// LL packet — same pseudo-header convention as biginfo.ts's decodeBigInfoFromRawPacket
// (LINKTYPE_BLUETOOTH_LE_LL_WITH_PHDR, DLT 256): 10 bytes of PHY pseudo-header, then
// AccessAddress(4) + Header(2) + Payload + CRC(3). A BIS PDU's Header byte 0 carries LLID in its
// low 2 bits — 0b11 marks it Control, same encoding used across every other LL PDU type — and
// byte 1 is the payload Length.
//
// The Control payload itself is CtrlType(1) + CtrlType-specific fields:
//  - CtrlType 0x00, BIG_ChannelMap_Ind: ChM(5, channel-usage bitmap, bit=1 means used) +
//    Instant(2, LE) — the BIG event count the new map takes effect at.
//  - CtrlType 0x01, BIG_Terminate_Ind: Reason(1, HCI-style error code) + Instant(2, LE).
// Opcodes and field layout cross-checked against Zephyr's ll_sw/pdu.h
// (PDU_BIG_CTRL_TYPE_CHAN_MAP_IND=0x00, PDU_BIG_CTRL_TYPE_TERM_IND=0x01) and verified directly:
// every BIG_ChannelMap_Ind in a real capture decoded to a plausible, varying channel subset with
// Instant consistently 10 events ahead of the packet's own captured event number.
export function decodeBigControlPduFromRawPacket(bytes: Uint8Array): BigControlPduDecoded {
  if (bytes.length < 10 + 6) return { ok: false, reason: 'too short for a PHY-header LE packet' };
  const lePacket = bytes.subarray(10);
  if (lePacket.length < 6) return { ok: false, reason: 'too short after pseudo-header' };
  const header0 = lePacket[4]!;
  const llid = header0 & 0x3;
  if (llid !== 0x3) return { ok: false, reason: 'LLID is not Control (0b11)' };
  const length = lePacket[5]!;
  if (lePacket.length < 6 + length) return { ok: false, reason: 'payload shorter than declared length' };
  const payload = lePacket.subarray(6, 6 + length);
  if (payload.length < 1) return { ok: false, reason: 'empty control PDU payload' };

  const ctrlType = payload[0]!;
  if (ctrlType === 0x00) {
    if (payload.length < 8) return { ok: false, reason: 'BIG_ChannelMap_Ind shorter than expected', ctrlType };
    const chm = payload.subarray(1, 6);
    const channels: number[] = [];
    for (let i = 0; i < 37; i++) {
      if ((chm[i >> 3]! >> (i & 7)) & 1) channels.push(i);
    }
    const instant = payload[6]! | (payload[7]! << 8);
    return { ok: true, ctrlType, kind: 'channelMapUpdate', channels, instant };
  }
  if (ctrlType === 0x01) {
    if (payload.length < 4) return { ok: false, reason: 'BIG_Terminate_Ind shorter than expected', ctrlType };
    const reasonCode = payload[1]!;
    const instant = payload[2]! | (payload[3]! << 8);
    return { ok: true, ctrlType, kind: 'terminate', reasonCode, instant };
  }
  return { ok: false, reason: `unrecognized CtrlType 0x${ctrlType.toString(16)}`, ctrlType };
}

// Human-readable type name + content summary for a decoded control PDU — shared by the log and
// detail-timeline renderers so the two stay in sync.
export function describeControlPdu(cp: BigControlPduDecoded | undefined): { title: string; desc: string } {
  if (!cp || !cp.ok || !cp.kind) {
    const reason = cp?.reason;
    return { title: 'LL Control PDU', desc: reason ? `Could not decode content: ${reason}` : 'Could not decode content' };
  }
  if (cp.kind === 'channelMapUpdate') {
    return {
      title: 'LL_BIG_CHANNEL_MAP_IND',
      desc: `New channel map — ${cp.channels!.length} of 37 channels used (${cp.channels!.join(', ')}), takes effect at event ${cp.instant}`,
    };
  }
  return {
    title: 'LL_BIG_TERMINATE_IND',
    desc: `BIG termination — reason 0x${cp.reasonCode!.toString(16).padStart(2, '0')}, takes effect at event ${cp.instant}`,
  };
}
