import { describe, expect, it } from 'vitest';
import { parsePacketComment, tokenizeKeyValue } from '../../src/pcapng/comments';

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
