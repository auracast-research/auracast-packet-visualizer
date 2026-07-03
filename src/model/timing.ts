import type { TimingConfig } from '../types';

export function estimateAirtimeUs(maxPduBytes: number, phyMbps: number): number {
  const overheadBytes = 14; // preamble/access-address/header/CRC/MIC, approximate
  return ((maxPduBytes + overheadBytes) * 8) / phyMbps;
}

export type PackingRegime = 'single' | 'sequential' | 'interleaved';

// Sequential vs interleaved is NOT an independent switch — it's what the relationship between
// BIS_Spacing and Sub_Interval *is*. BIS_Spacing > Sub_Interval means each BIS's turn lasts
// longer than one sub-event, so BISes necessarily run one after another (sequential);
// BIS_Spacing < Sub_Interval means a BIS's turn is shorter than one sub-event, so BISes
// necessarily cycle within a sub-event's time (interleaved). There is no separate host/user
// "packing" field in the over-the-air schedule — only this ratio.
export function packingRegime(cfg: TimingConfig): PackingRegime {
  if (cfg.numBis <= 1) return 'single';
  return cfg.bisSpacingUs >= cfg.subIntervalUs ? 'sequential' : 'interleaved';
}

// Absolute on-air time of a sub-event, in µs from t=0 of the whole shown window.
//  - Sequential regime: BIS i's turn starts i x BIS_Spacing after the event's start; within
//    a turn, sub-events still step by Sub_Interval. Needs BIS_Spacing >= NSE x Sub_Interval
//    so one BIS's block finishes before the next starts (checked in renderWarnings).
//  - Interleaved regime: sub-event index s of every BIS airs back-to-back before s+1 of any
//    BIS, so BIS i's copy of sub-event s sits at slot (s x NumBIS + i) x BIS_Spacing. For
//    that to keep the same BIS's own sub-events exactly Sub_Interval apart, NumBIS x
//    BIS_Spacing must equal Sub_Interval (checked in renderWarnings).
// Both reduce to eventBase + s x Sub_Interval when there's only one BIS.
export function subeventTimeUs(
  item: { event: number; s: number },
  row: number,
  _nse: number,
  cfg: TimingConfig,
): number {
  const eventBaseUs = item.event * cfg.isoIntervalMs * 1000;
  if (cfg.numBis <= 1) return eventBaseUs + item.s * cfg.subIntervalUs;
  if (packingRegime(cfg) === 'interleaved') {
    return eventBaseUs + (item.s * cfg.numBis + row) * cfg.bisSpacingUs;
  }
  return eventBaseUs + row * cfg.bisSpacingUs + item.s * cfg.subIntervalUs;
}

// On-air span from the event's start to the end of the last DATA sub-event (excludes any
// control subevent). In sequential regime the last BIS's block still only takes NSE x
// Sub_Interval once it starts, even if BIS_Spacing has slack built in.
export function dataSpanUs(nse: number, cfg: TimingConfig): number {
  if (cfg.numBis <= 1 || packingRegime(cfg) === 'interleaved') return nse * cfg.subIntervalUs;
  return (cfg.numBis - 1) * cfg.bisSpacingUs + nse * cfg.subIntervalUs;
}

// Width of a single transmission's on-air slot: full Sub_Interval, except interleaved regime
// squeezes NumBIS transmissions into that same Sub_Interval window (each BIS_Spacing wide).
export function slotWidthUs(cfg: TimingConfig): number {
  if (cfg.numBis > 1 && packingRegime(cfg) === 'interleaved') return cfg.bisSpacingUs;
  return cfg.subIntervalUs;
}

// BIG_Control_Offset: where the (optional) control subevent for LL Control PDUs sits. Per
// spec this is Num_BIS x BIS_Spacing in sequential regime — i.e. the slot right after where a
// hypothetical extra BIS would have started, which can sit a little after the last real BIS's
// own data if BIS_Spacing has slack — and NSE x Sub_Interval in interleaved regime.
export function controlOffsetUs(nse: number, cfg: TimingConfig): number {
  if (cfg.numBis <= 1) return nse * cfg.subIntervalUs;
  if (packingRegime(cfg) === 'interleaved') return nse * cfg.subIntervalUs;
  return cfg.numBis * cfg.bisSpacingUs;
}

// Total on-air span of one BIG event including the control subevent, if shown — this is what
// actually has to fit inside ISO_Interval.
export function totalEventSpanUs(nse: number, cfg: TimingConfig): number {
  return cfg.showControlSubevent
    ? controlOffsetUs(nse, cfg) + cfg.subIntervalUs
    : dataSpanUs(nse, cfg);
}
