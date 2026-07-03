import type { BigCommentFields, PacketCommentFields } from '../types';

// "key=value key2=value2 kind=data retransmission pretransmission packing=interleaved" —
// a value can contain spaces up until the next `word=` token.
export function tokenizeKeyValue(str: string): Record<string, string> {
  const tokens = str.trim().split(/\s+/);
  const kv: Record<string, string> = {};
  let curKey: string | null = null;
  let curVal: string[] = [];
  const flush = () => {
    if (curKey) kv[curKey] = curVal.join(' ');
    curKey = null;
    curVal = [];
  };
  for (const tok of tokens) {
    const m = tok.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
    if (m) {
      flush();
      curKey = m[1]!;
      curVal = [m[2]!];
    } else if (curKey) curVal.push(tok);
  }
  flush();
  return kv;
}

export const CAPTURE_PHY_MAP: Record<string, number> = { '1M': 1, '2M': 2, S2: 0.5, S8: 0.125 };

export function parseBigComment(str: string): BigCommentFields {
  const kv = tokenizeKeyValue(str.replace(/^BIG\s+/, ''));
  const num = (k: string) => Number(String(kv[k]).replace(/[^\d.\-]/g, ''));
  return {
    numBis: num('num_bis'),
    bn: num('bn'),
    ircConfig: num('irc'),
    ptcTotal: num('ptc'),
    nse: num('nse'),
    subIntervalUs: num('sub_interval'),
    bisSpacingUs: num('bis_spacing'),
    isoIntervalUs: num('iso_interval'),
    sduIntervalUs: num('sdu_interval'),
    maxPdu: num('max_pdu'),
    phyMbps: kv.phy !== undefined ? (CAPTURE_PHY_MAP[kv.phy] ?? null) : null,
    packingDeclared: kv.packing,
  };
}

export function parsePacketComment(str: string): PacketCommentFields {
  const kv = tokenizeKeyValue(str);
  const num = (k: string) => (kv[k] !== undefined ? Number(kv[k]) : undefined);
  let kindSimple: PacketCommentFields['kindSimple'] = 'new';
  if (/pretransmission/.test(kv.kind || '')) kindSimple = 'pretx';
  else if (/retransmission/.test(kv.kind || '')) kindSimple = 'retx';
  return {
    event: num('event'),
    bis: num('bis'),
    chan: num('chan'),
    se: num('se'),
    payloadNum: num('payload_num'),
    kindSimple,
    firstEventRx: /first_event_rx/.test(str),
  };
}
