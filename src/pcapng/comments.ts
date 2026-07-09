import type { PacketCommentFields } from '../types';

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

export function parsePacketComment(str: string): PacketCommentFields {
  const kv = tokenizeKeyValue(str);
  const num = (k: string) => (kv[k] !== undefined ? Number(kv[k]) : undefined);
  // `kind=` carries a PDU-type prefix ("data" or "control") followed by optional
  // retransmission/pretransmission suffixes — e.g. "control retransmission pretransmission" on a
  // real LL Control PDU (channel map update, BIG termination, ...) that's been repeated with the
  // same irc/pto-style redundancy as data. The "control" prefix must win over those suffixes:
  // checking retransmission/pretransmission first (as this used to) misreads every control PDU
  // as a plain pretx/retx BIS Data copy.
  let kindSimple: PacketCommentFields['kindSimple'] = 'new';
  if (/^control\b/.test(kv.kind || '')) kindSimple = 'control';
  else if (/pretransmission/.test(kv.kind || '')) kindSimple = 'pretx';
  else if (/retransmission/.test(kv.kind || '')) kindSimple = 'retx';
  return {
    event: num('event'),
    bis: num('bis'),
    chan: num('chan'),
    se: num('se'),
    payloadNum: num('payload_num'),
    bn: num('bn'),
    kindSimple,
    firstEventRx: /first_event_rx/.test(str),
  };
}
