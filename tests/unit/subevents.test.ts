import { describe, expect, it } from 'vitest';
import { allCopiesOf, buildSubevents } from '../../src/model/subevents';
import type { SimulatedConfig } from '../../src/types';

const cfg: SimulatedConfig = { bn: 4, irc: 2, npt: 1, pto: 2, eventsShown: 3 };

describe('buildSubevents', () => {
  it('computes gc = irc + npt and nse = gc * bn', () => {
    const { gc, nse } = buildSubevents(cfg);
    expect(gc).toBe(3);
    expect(nse).toBe(12);
  });

  it('produces eventsShown * nse entries, s running 0..nse-1 per event', () => {
    const { nse, list } = buildSubevents(cfg);
    expect(list.length).toBe(cfg.eventsShown * nse);
    expect(list.filter((i) => i.event === 0).map((i) => i.s)).toEqual(
      Array.from({ length: nse }, (_, i) => i),
    );
  });

  it('classifies groups: g=0 new, 1..irc-1 retx, irc.. pretx targeting a future event', () => {
    const { list } = buildSubevents(cfg);
    const event0 = list.filter((i) => i.event === 0);
    const byGroup = (g: number) => event0.filter((i) => i.g === g);
    expect(byGroup(0).every((i) => i.kind === 'new')).toBe(true);
    expect(byGroup(1).every((i) => i.kind === 'retx')).toBe(true);
    // gc=3 groups (0,1,2): group 2 is the sole pre-tx group (irc=2..gc-1)
    expect(byGroup(2).every((i) => i.kind === 'pretx' && i.pretxK === 0)).toBe(true);
    expect(byGroup(2).every((i) => i.targetEvent === 0 + cfg.pto * 1)).toBe(true);
  });
});

describe('allCopiesOf', () => {
  it('finds originEvent = floor(sdu / bn) and lists irc "new/retx" copies plus npt pre-tx copies', () => {
    const { originEvent, copies } = allCopiesOf(9, cfg); // bn=4 -> originEvent=2, b=1
    expect(originEvent).toBe(2);
    expect(copies.filter((c) => c.kind === 'new').length).toBe(1);
    expect(copies.filter((c) => c.kind === 'retx').length).toBe(cfg.irc - 1);
    expect(copies.filter((c) => c.kind === 'pretx').length).toBe(cfg.npt);
    // pre-tx copies sit `pto * (k+1)` events before the origin.
    const pretx = copies.find((c) => c.kind === 'pretx')!;
    expect(pretx.event).toBe(originEvent - cfg.pto * 1);
  });

  it('sorts copies by event then group', () => {
    const { copies } = allCopiesOf(9, cfg);
    for (let i = 1; i < copies.length; i++) {
      const a = copies[i - 1]!;
      const b = copies[i]!;
      expect(a.event < b.event || (a.event === b.event && a.g <= b.g)).toBe(true);
    }
  });
});
