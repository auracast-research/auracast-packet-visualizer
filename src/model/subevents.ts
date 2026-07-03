import type { CopyOf, SimulatedConfig, SubeventItem } from '../types';

export function buildSubevents(cfg: SimulatedConfig): { gc: number; nse: number; list: SubeventItem[] } {
  const gc = cfg.irc + cfg.npt;
  const nse = gc * cfg.bn;
  const list: SubeventItem[] = [];
  for (let E = 0; E < cfg.eventsShown; E++) {
    for (let s = 0; s < nse; s++) {
      const g = Math.floor(s / cfg.bn);
      const b = s % cfg.bn;
      let kind: SubeventItem['kind'];
      let targetEvent: number;
      let pretxK: number | null = null;
      if (g < cfg.irc) {
        kind = g === 0 ? 'new' : 'retx';
        targetEvent = E;
      } else {
        pretxK = g - cfg.irc;
        kind = 'pretx';
        targetEvent = E + cfg.pto * (pretxK + 1);
      }
      const sdu = targetEvent * cfg.bn + b;
      list.push({ event: E, s, g, b, kind, pretxK, targetEvent, sdu });
    }
  }
  return { gc, nse, list };
}

export function allCopiesOf(
  sdu: number,
  cfg: Pick<SimulatedConfig, 'bn' | 'irc' | 'npt' | 'pto'>,
): { originEvent: number; copies: CopyOf[] } {
  const originEvent = Math.floor(sdu / cfg.bn);
  const b = sdu % cfg.bn;
  const copies: CopyOf[] = [];
  for (let g = 0; g < cfg.irc; g++) {
    copies.push({ event: originEvent, g, b, kind: g === 0 ? 'new' : 'retx', pretxK: null });
  }
  for (let k = 0; k < cfg.npt; k++) {
    const srcEvent = originEvent - cfg.pto * (k + 1);
    copies.push({ event: srcEvent, g: cfg.irc + k, b, kind: 'pretx', pretxK: k });
  }
  copies.sort((a, c) => a.event - c.event || a.g - c.g);
  return { originEvent, copies };
}
