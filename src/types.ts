export interface RawPacket {
  tsUs: number;
  capLen: number;
  comment: string | null;
  bytes: Uint8Array;
}

export interface PcapngBlock {
  type: number;
  off: number;
  len: number;
}

export interface PcapngOption {
  code: number;
  val: Uint8Array;
}

export type PacketKind = 'new' | 'retx' | 'pretx';

export interface BigCommentFields {
  numBis: number;
  bn: number;
  ircConfig: number;
  ptcTotal: number;
  nse: number;
  subIntervalUs: number;
  bisSpacingUs: number;
  isoIntervalUs: number;
  sduIntervalUs: number;
  maxPdu: number;
  phyMbps: number | null;
  packingDeclared: string | undefined;
}

export interface PacketCommentFields {
  event: number | undefined;
  bis: number | undefined;
  chan: number | undefined;
  se: number | undefined;
  payloadNum: number | undefined;
  kindSimple: PacketKind;
  firstEventRx: boolean;
}

export interface BigInfoDecoded {
  ok: boolean;
  reason?: string;
  bigOffset?: number;
  bigOffsetUnits?: number;
  isoIntervalMs?: number;
  numBis?: number;
  nse?: number;
  bn?: number;
  subIntervalUs?: number;
  pto?: number;
  bisSpacingUs?: number;
  irc?: number;
  maxPdu?: number;
  framing?: number;
  seedAccessAddress?: number;
  sduIntervalMs?: number;
}

/** Everything the timing/domain math needs, threaded explicitly rather than read off a global
 * `state` singleton — this is what makes model/timing.ts pure and unit-testable in isolation. */
export interface TimingConfig {
  numBis: number;
  bisSpacingUs: number;
  subIntervalUs: number;
  isoIntervalMs: number;
  showControlSubevent: boolean;
}

export interface SubeventItem {
  event: number;
  s: number;
  g: number;
  b: number;
  kind: PacketKind;
  pretxK: number | null;
  targetEvent: number;
  sdu: number;
}

/** A real captured, comment-annotated BIS Data PDU, enriched with its timestamp and derived
 * PDU-size estimate. `rank` (retransmission/pre-tx ordinal, 0 for 'new') is assigned afterward
 * once all copies of the same payload are grouped and time-sorted. */
export interface PacketRow {
  event: number;
  bis: number; // 1-based, as broadcast — see byKey/originEvent for the 0-based `row` form
  chan: number;
  se: number;
  payloadNum: number;
  kindSimple: PacketKind;
  firstEventRx: boolean;
  tsUs: number;
  pduBytes: number;
  rank?: number;
}

export interface BigInfoCrossCheck {
  mismatches: string[];
  matched: boolean;
}

export interface CaptureConfig {
  bn: number;
  irc: number;
  npt: number;
  pto: number;
  subIntervalUs: number;
  bisSpacingUs: number;
  isoIntervalMs: number;
  sduIntervalMs: number;
  maxPdu: number;
  numBis: number;
  phyMbps?: number;
}

export interface Model {
  gc: number;
  nse: number;
  list: SubeventItem[] | CaptureSubeventItem[];
  preExpanded?: boolean;
}

export type AppMode = 'simulated' | 'capture';

export interface State {
  numBis: number;
  bn: number;
  irc: number;
  pto: number;
  npt: number;
  maxPdu: number;
  phyMbps: number;
  isoIntervalMs: number;
  sduIntervalMs: number;
  subIntervalUs: number;
  bisSpacingUs: number;
  eventsShown: number;
  showControlSubevent: boolean;
  mode: AppMode;
  windowStartIdx: number;
  mmViewStart: number;
  mmZoomLen: number;
  detailZoom: number;
  showBigInfo: boolean;
}

/** One real, on-air BIGInfo transmission (periodic advertising carrying the BIG's timing info)
 * — independent of the BIS sub-event grid, so all it carries is when it happened. */
export interface BigInfoRow {
  tsUs: number;
}

export interface Capture {
  config: CaptureConfig;
  nse: number;
  packingDeclared: string | undefined | null;
  bigInfoSource: 'comment' | 'raw-biginfo';
  bigInfoRaw: BigInfoDecoded | null;
  bigInfoCrossCheck: BigInfoCrossCheck | null;
  regimeFromRatio: 'sequential' | 'interleaved';
  ptoConsistent: boolean;
  rows: PacketRow[];
  byKey: Map<string, PacketRow>;
  copiesByPayload: Map<string, PacketRow[]>;
  eventsSorted: number[];
  originEvent: Map<string, number>;
  eventBaseUs: Map<number, number>;
  originUs: number;
  // payloadNum = originEvent * bn + b + sduOriginOffset, derived by voting across real 'new'
  // rows (see buildCaptureFromPackets) - lets us show an expected SDU number for a sub-event
  // that was never captured, the same way pto is derived rather than assumed.
  sduOriginOffset: number;
  allEventsRange: number[];
  totalPackets: number;
  rawUncommentedCount: number;
  fileName?: string;
  bigInfoRows: BigInfoRow[];
}

/** Config for the simulated (non-capture) model — buildSubevents/allCopiesOf. */
export interface SimulatedConfig {
  bn: number;
  irc: number;
  npt: number;
  pto: number;
  eventsShown: number;
}

export interface CopyOf {
  event: number;
  g: number;
  b: number;
  kind: PacketKind;
  pretxK: number | null;
}

export interface CaptureSubeventItem {
  event: number;
  row: number;
  s: number;
  g: number | null;
  b: number;
  kind: PacketKind;
  pretxK: number | null;
  targetEvent: number | undefined;
  sdu: number | null;
  // The SDU number this slot should carry whether or not it was actually observed - real
  // payloadNum when `observed`, otherwise a same-formula prediction (see sduOriginOffset).
  // Always populated so "not observed" rows can still say *which* SDU is missing.
  expectedSdu: number;
  chan: number | null;
  timeUs: number | null;
  observed: boolean;
  pduBytes: number | null;
}
