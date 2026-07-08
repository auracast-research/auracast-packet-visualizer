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

// 'control' is a real captured LL Control PDU (channel map update, BIG termination, etc.) — it
// shares the sub-event grid with BIS Data PDUs (same event/bis/se addressing, same irc/pto-style
// redundancy) but isn't a data payload, so it's tracked as its own kind rather than folded into
// new/retx/pretx.
export type PacketKind = 'new' | 'retx' | 'pretx' | 'control';

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
  bn: number | undefined;
  kindSimple: PacketKind;
  firstEventRx: boolean;
}

// Decoded content of a real captured LL BIG Control PDU (see pcapng/controlPdu.ts). `kind` is
// undefined when `ok` is false, or when the CtrlType byte didn't match either of the two known
// BIG control opcodes (still worth surfacing as "captured but unrecognized" rather than nothing).
export interface BigControlPduDecoded {
  ok: boolean;
  reason?: string;
  ctrlType?: number;
  kind?: 'channelMapUpdate' | 'terminate';
  channels?: number[]; // channelMapUpdate only — used-channel indices, 0..36
  reasonCode?: number; // terminate only — raw Reason byte (an HCI-style error code)
  instant?: number; // both kinds — the BIG event count at which this takes effect
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
  // Only set when kindSimple === 'control' — the decoded content of a real LL BIG Control PDU.
  controlPdu?: BigControlPduDecoded;
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
  // Capture mode only — which 0-based BIS rows count toward completeness/recovery stats (event
  // overview coloring, per-event header status). Lets a capture that only reliably received a
  // subset of the BIG's BIS (e.g. only BIS 1 of a 2-BIS stream) score complete events as complete
  // instead of forever "missing" the uncaptured BIS. Sized to capture.config.numBis and reset to
  // all-true whenever a new capture loads.
  completenessRows: boolean[];
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
  // Packets whose comment carried `bn=0` — never a real value (real `bn` cycles 1..cfg.bn) but
  // seen from a real sniffer capture as an all-zero placeholder (event=0 bis=0 se=0 payload_num=0
  // etc.) on packets the extcap tool captured but couldn't decode/correlate. Counted separately
  // from rawUncommentedCount (which is packets with no comment at all) so a capture summary can
  // report both instead of silently letting these masquerade as a real event 0.
  droppedPlaceholderCount: number;
  fileName?: string;
  bigInfoRows: BigInfoRow[];
  // Every real captured LL BIG Control PDU (kindSimple === 'control'), time-sorted — unlike
  // bigInfoRows these land on a real, exact event number (they share the sub-event grid), so no
  // interpolation is needed to place them on the whole-capture overview.
  controlPdus: PacketRow[];
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
  // Only set when kind === 'control' and it was actually observed.
  controlPdu?: BigControlPduDecoded;
}
