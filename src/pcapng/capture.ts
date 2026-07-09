import { decodeBigInfoFromRawPacket } from './biginfo';
import { parsePacketComment } from './comments';
import { decodeBigControlPduFromRawPacket } from './controlPdu';
import type {
  BigInfoDecoded,
  BigInfoRow,
  Capture,
  CaptureSubeventItem,
  PacketRow,
  RawPacket,
} from '../types';

// Per-packet `irc=`/`ptc=`/`bn=` fields turned out NOT to reliably encode which repetition
// group or pre-transmission slot a packet belongs to (verified against a real capture: pretx
// rows kept the `bn` field pinned at its max instead of cycling, and `ptc` counted 1..N across
// all pretx sub-events of the event rather than naming a group). What IS reliable: `kind`
// (already tells us new/retx/pretx) and `payload_num` (a real, stable SDU id). So group/pretx
// rank and even PTO/IRC's exact meaning are derived empirically from real (bis, payload_num,
// kind, time) identity — never trusted from those ambiguous fields — and BIG's own `ptc` is
// actually the *count* of pretx sub-events (irc-groups x bn), not the PTO offset; PTO is
// measured from real event deltas instead.
export function buildCaptureFromPackets(packets: RawPacket[]): Capture {
  // Config (numBis/bn/irc/nse/timing) comes exclusively from decoding BIGInfo's own bit field on
  // the raw periodic-advertising packets — never from a synthetic "BIG ..." summary comment, even
  // when a packet carries one. A real capture (test3.pcapng) turned up a summary comment whose
  // values were impossible for BIGInfo's own bit widths (nse=227 in a 5-bit field, max 31; bn=67
  // in a 3-bit field, max 7; num_bis=88 in a 5-bit field, max 31) while every actually-captured
  // data packet only ever used bis 1-2, matching the raw decode exactly. The comment is free text
  // written by whatever produced the capture — it isn't a spec-constrained encoding and can't be
  // trusted as a config source, so it's ignored entirely here (per-packet comments are still used
  // below for event/bis/se/kind/payload_num, which have no BIGInfo equivalent).
  //
  // Also collects the timestamp of EVERY decodable periodic-advertising packet (not just the
  // first) — periodic advertising happens independently of the BIS sub-event grid, at its own
  // cadence, so every instance is a real event worth being able to show on the timelines, not
  // just one representative sample for config derivation.
  let bigInfoRaw: BigInfoDecoded | null = null;
  const bigInfoRows: BigInfoRow[] = [];
  for (const p of packets) {
    if (p.comment && !p.comment.startsWith('BIG ')) continue; // a BIS Data PDU comment, not BIGInfo
    if (p.comment) {
      // A "BIG "-prefixed comment reliably tags this packet as periodic advertising regardless of
      // whether its embedded numbers are trustworthy — the categorical tag and the numeric
      // content are separate claims. Mark it for the timeline even if the bit-level decode below
      // fails on it for some other reason.
      bigInfoRows.push({ tsUs: p.tsUs });
      const decoded = decodeBigInfoFromRawPacket(p.bytes);
      if (decoded.ok) bigInfoRaw ??= decoded;
      continue;
    }
    const decoded = decodeBigInfoFromRawPacket(p.bytes);
    if (decoded.ok) {
      bigInfoRaw ??= decoded;
      bigInfoRows.push({ tsUs: p.tsUs });
    }
  }
  bigInfoRows.sort((a, b) => a.tsUs - b.tsUs);

  if (!bigInfoRaw) {
    throw new Error(
      'No decodable BIGInfo (periodic advertising) packet found — is this an Auracast BIS capture?',
    );
  }

  const big = {
    numBis: bigInfoRaw.numBis!,
    bn: bigInfoRaw.bn!,
    ircConfig: bigInfoRaw.irc!,
    nse: bigInfoRaw.nse!,
    subIntervalUs: bigInfoRaw.subIntervalUs!,
    bisSpacingUs: bigInfoRaw.bisSpacingUs!,
    isoIntervalUs: bigInfoRaw.isoIntervalMs! * 1000,
    sduIntervalUs: bigInfoRaw.sduIntervalMs! * 1000,
    maxPdu: bigInfoRaw.maxPdu!,
  };

  const gc = big.nse / big.bn;
  const npt = gc - big.ircConfig;

  // Approximate PDU size from the captured packet length: 10 bytes of pseudo-header + 4
  // (Access Address) + 2 (LL header) + 3 (CRC) = 19 bytes of fixed overhead around the
  // payload. This capLen-based estimate is used instead of the LL header's own Length field
  // because that field didn't check out against real packet sizes in this capture (looks like
  // the BIS Data PDU payload bytes themselves are placeholder/zero-filled rather than a
  // spec-accurate encoding) — capLen is at least a real, structurally-guaranteed number.
  const PDU_OVERHEAD_BYTES = 19;
  const rows: PacketRow[] = [];
  let droppedPlaceholderCount = 0;
  for (const p of packets) {
    if (!p.comment || p.comment.startsWith('BIG ')) continue;
    const pc = parsePacketComment(p.comment);
    if (pc.event === undefined || pc.bis === undefined || pc.se === undefined) continue;
    // `bn=0` never occurs on a genuine BIS Data PDU comment (real `bn` cycles 1..cfg.bn) — it's
    // what a real sniffer capture emits on a packet it captured but couldn't decode/correlate,
    // as an all-zero placeholder (event=0 bis=0 se=0 payload_num=0 ...). Confirmed directly
    // against a real capture where 6 such rows, left unfiltered, register as a spurious "event
    // 0" and blow eventsSorted/allEventsRange out to span from 0 instead of the capture's real
    // first event — which then opens the just-loaded view on a multi-thousand-event dead zone
    // that looks like the capture failed to parse.
    if (pc.bn === 0) {
      droppedPlaceholderCount++;
      continue;
    }
    rows.push({
      event: pc.event,
      bis: pc.bis,
      chan: pc.chan ?? 0,
      se: pc.se,
      payloadNum: pc.payloadNum ?? 0,
      kindSimple: pc.kindSimple,
      firstEventRx: pc.firstEventRx,
      tsUs: p.tsUs,
      pduBytes: Math.max(p.capLen - PDU_OVERHEAD_BYTES, 0),
      ...(pc.kindSimple === 'control' ? { controlPdu: decodeBigControlPduFromRawPacket(p.bytes) } : {}),
    });
  }
  rows.sort((a, b) => a.tsUs - b.tsUs);

  // Keyed by 0-based BIS index (bis - 1), matching byKey/copiesByPayload below — this map was
  // previously keyed by the raw 1-based `r.bis`, which made every BIS-1 (row 0) lookup miss
  // (nothing is ever stored under "0:...") and every other row's lookup silently read the
  // *previous* BIS's origin event instead of its own.
  const originEvent = new Map<string, number>(); // "row:payloadNum" -> event where kind==='new'
  for (const r of rows) if (r.kindSimple === 'new') originEvent.set(`${r.bis - 1}:${r.payloadNum}`, r.event);

  const ptoVotes: Record<number, number> = {};
  for (const r of rows) {
    if (r.kindSimple !== 'pretx') continue;
    const oe = originEvent.get(`${r.bis - 1}:${r.payloadNum}`);
    if (oe === undefined) continue;
    const delta = oe - r.event;
    ptoVotes[delta] = (ptoVotes[delta] || 0) + 1;
  }
  const ptoEntries = Object.entries(ptoVotes).sort((a, b) => b[1] - a[1]);
  // A capture can legitimately contain zero pre-transmission-tagged packets (e.g. a sniffer that
  // never caught the pretx group) even though the BIG genuinely schedules one — confirmed
  // directly against test3.pcapng, which has 0 pretx rows out of 3246 packets despite BIGInfo
  // itself declaring PTO=1. In that case, fall back to the value already decoded straight from
  // BIGInfo's own bit field rather than silently reporting 0 with no evidence either way.
  const ptoSource: Capture['ptoSource'] = ptoEntries.length ? 'measured' : 'biginfo-fallback';
  const pto = ptoEntries.length ? Number(ptoEntries[0]![0]) : bigInfoRaw.pto!;
  const ptoConsistent =
    ptoEntries.length <= 1 ||
    ptoEntries[0]![1] >= 0.95 * rows.filter((r) => r.kindSimple === 'pretx').length;

  // Per the BIG spec every BIS's payload counter starts at 0 when the BIG is created and
  // advances by `bn` every event, so payloadNum = event*bn + b should hold exactly - but rather
  // than assume that zero offset, derive it by voting across real 'new' rows (same approach as
  // pto above), so a capture that doesn't start at the BIG's own event 0 still predicts
  // correctly. For a 'new' row g=0, so se===b directly.
  const sduOffsetVotes: Record<number, number> = {};
  for (const r of rows) {
    if (r.kindSimple !== 'new') continue;
    const offset = r.payloadNum - r.event * big.bn - r.se;
    sduOffsetVotes[offset] = (sduOffsetVotes[offset] || 0) + 1;
  }
  const sduOffsetEntries = Object.entries(sduOffsetVotes).sort((a, b) => b[1] - a[1]);
  const sduOriginOffset = sduOffsetEntries.length ? Number(sduOffsetEntries[0]![0]) : 0;

  const byKey = new Map<string, PacketRow>(); // "event:row:se" -> row
  const copiesByPayload = new Map<string, PacketRow[]>(); // "row:payloadNum" -> [rows] sorted by time, with rank
  for (const r of rows) {
    byKey.set(`${r.event}:${r.bis - 1}:${r.se}`, r);
    // A control PDU's `payload_num` isn't a real SDU id — it reuses the same numbering space and
    // was confirmed directly to collide with a genuine BIS Data payload's payload_num on the same
    // BIS. Grouping it into that payload's copiesByPayload bucket would show it as if it were one
    // of that SDU's redundant copies when expanding the SDU's thread.
    if (r.kindSimple === 'control') continue;
    const pk = `${r.bis - 1}:${r.payloadNum}`;
    if (!copiesByPayload.has(pk)) copiesByPayload.set(pk, []);
    copiesByPayload.get(pk)!.push(r);
  }
  for (const arr of copiesByPayload.values()) {
    arr.sort((a, b) => a.tsUs - b.tsUs);
    let retxN = 0;
    let pretxN = 0;
    for (const r of arr) {
      if (r.kindSimple === 'retx') r.rank = ++retxN;
      else if (r.kindSimple === 'pretx') r.rank = ++pretxN;
      else r.rank = 0;
    }
  }

  const controlPdus = rows.filter((r) => r.kindSimple === 'control'); // `rows` is already tsUs-sorted

  const eventsSorted = [...new Set(rows.map((r) => r.event))].sort((a, b) => a - b);
  const regimeFromRatio: Capture['regimeFromRatio'] =
    big.bisSpacingUs >= big.subIntervalUs ? 'sequential' : 'interleaved';

  // Real capture timestamps, not the formula's `event x ISO_Interval`, are the source of truth
  // for "where does this event start" — event numbers can skip (a whole event with zero
  // captured packets) and ISO_Interval may not exactly match observed cadence.
  const eventBaseUs = new Map<number, number>();
  for (const r of rows) {
    const cur = eventBaseUs.get(r.event);
    if (cur === undefined || r.tsUs < cur) eventBaseUs.set(r.event, r.tsUs);
  }
  const originUs = rows.length ? Math.min(...rows.map((r) => r.tsUs)) : 0;

  return {
    config: {
      bn: big.bn,
      irc: big.ircConfig,
      npt,
      pto,
      subIntervalUs: big.subIntervalUs,
      bisSpacingUs: big.bisSpacingUs,
      isoIntervalMs: big.isoIntervalUs / 1000,
      sduIntervalMs: big.sduIntervalUs / 1000,
      maxPdu: big.maxPdu,
      numBis: big.numBis,
      // BIGInfo itself doesn't signal which PHY was used, so config.phyMbps is never set here —
      // the caller's existing PHY selection is left alone rather than getting silently blanked.
    },
    nse: big.nse,
    bigInfoRaw,
    regimeFromRatio,
    ptoConsistent,
    ptoSource,
    rows,
    byKey,
    copiesByPayload,
    eventsSorted,
    originEvent,
    eventBaseUs,
    originUs,
    sduOriginOffset,
    bigInfoRows,
    controlPdus,
    // The full contiguous event-number span, including numbers with zero captured packets (an
    // entirely missed event) — used for navigation/overview so a total gap is shown as "not
    // observed" rather than silently skipped.
    allEventsRange: eventsSorted.length
      ? Array.from(
          { length: eventsSorted[eventsSorted.length - 1]! - eventsSorted[0]! + 1 },
          (_, i) => eventsSorted[0]! + i,
        )
      : [],
    totalPackets: packets.length,
    rawUncommentedCount: packets.filter((p) => !p.comment).length,
    droppedPlaceholderCount,
  };
}

export interface MissingSdu {
  row: number; // 0-based BIS index
  b: number; // burst index within the event
  sdu: number; // predicted payloadNum (see sduOriginOffset) - never directly observed
}

export interface EventRecoveryStats {
  totalPayloads: number;
  lostPayloads: number; // zero copies (new/retx/pretx) observed anywhere
  partialPayloads: number; // at least one copy observed, but not every scheduled copy
  fullPayloads: number; // every scheduled copy (irc + npt) observed
  status: 'lost' | 'degraded' | 'full';
  missingSdus: MissingSdu[]; // which SDUs make up lostPayloads, for surfacing *what's* missing
}

// Whether event E's own data actually made it across, accounting for retransmissions AND
// pre-transmissions — not just "how many raw sub-event packets landed in this event's own
// slots" (that conflates "retransmitted a few events late" with "genuinely missing"). Each BIS
// contributes `bn` distinct payloads originating in E; each has `irc` copies scheduled inside E
// itself and `npt` pre-transmission copies scheduled at earlier events (E - pto*(k+1)) — a
// payload only counts as lost if NONE of those (irc + npt) scheduled slots were observed
// anywhere, matching the same recoverability notion threadHtmlCapture already reports per SDU.
// `includedRows` (0-based, from state.completenessRows) lets a capture that only reliably
// received a subset of the BIG's BIS score completeness over just those rows — a BIS excluded
// here is skipped entirely rather than contributing permanent "missing" payloads. Undefined, or a
// row past the array's end, defaults to included (so callers that don't care about this still get
// the original all-BIS behavior).
export function computeEventRecoveryStats(
  capture: Capture,
  event: number,
  includedRows?: boolean[],
): EventRecoveryStats {
  const cfg = capture.config;
  const isIncluded = (row: number) => includedRows === undefined || includedRows[row] !== false;
  const copiesExpected = cfg.irc + cfg.npt;
  let includedRowCount = 0;
  let lostPayloads = 0;
  let partialPayloads = 0;
  let fullPayloads = 0;
  const missingSdus: MissingSdu[] = [];
  for (let row = 0; row < cfg.numBis; row++) {
    if (!isIncluded(row)) continue;
    includedRowCount++;
    for (let b = 0; b < cfg.bn; b++) {
      let copiesObserved = 0;
      // A slot can be occupied by a real LL Control PDU instead of the scheduled BIS Data copy
      // (confirmed directly: a real capture's control PDUs land exactly on what would otherwise
      // be a pre-transmission slot) — that's the control PDU pre-empting the airtime, not a copy
      // of this payload, so it must NOT count toward copiesObserved or this payload reads as
      // "recovered" from a redundancy slot that never actually carried it.
      for (let g = 0; g < cfg.irc; g++) {
        const r = capture.byKey.get(`${event}:${row}:${g * cfg.bn + b}`);
        if (r && r.kindSimple !== 'control') copiesObserved++;
      }
      for (let k = 0; k < cfg.npt; k++) {
        const srcEvent = event - cfg.pto * (k + 1);
        const r = capture.byKey.get(`${srcEvent}:${row}:${(cfg.irc + k) * cfg.bn + b}`);
        if (r && r.kindSimple !== 'control') copiesObserved++;
      }
      if (copiesObserved === 0) {
        lostPayloads++;
        missingSdus.push({ row, b, sdu: event * cfg.bn + b + capture.sduOriginOffset });
      } else if (copiesObserved >= copiesExpected) fullPayloads++;
      else partialPayloads++;
    }
  }
  const totalPayloads = includedRowCount * cfg.bn;
  const status: EventRecoveryStats['status'] =
    lostPayloads > 0 ? 'lost' : fullPayloads < totalPayloads ? 'degraded' : 'full';
  return { totalPayloads, lostPayloads, partialPayloads, fullPayloads, status, missingSdus };
}

// Periodic advertising (which carries BIGInfo) runs on its own cadence, entirely independent of
// the BIS sub-event grid — it isn't tied to any specific event's sub-events, so placing a
// BIGInfo marker requires estimating "where in the event timeline" its real timestamp falls,
// rather than looking it up from a byKey-style slot the way sub-events are.
//
// Real observed eventBaseUs is exact when available. For an event with zero captured packets
// (no eventBaseUs entry), this interpolates linearly between the nearest OBSERVED events
// surrounding it, using their real measured cadence — deliberately not assuming the configured
// ISO_Interval holds exactly, since real captures can drift and even this tool's own synthetic
// test fixtures turn out not to advance event numbers in lockstep with it (confirmed directly:
// auracast.pcapng's real inter-event gaps average ~10ms despite an ISO_Interval of 30ms). The
// configured ISO_Interval is only used as a last-resort extrapolation beyond the very first or
// very last observed event, where no better data exists.
export function estimateEventBaseUs(capture: Capture, event: number): number {
  const observed = capture.eventBaseUs.get(event);
  if (observed !== undefined) return observed;
  const sorted = capture.eventsSorted;
  if (sorted.length === 0) return capture.originUs;

  const isoUs = capture.config.isoIntervalMs * 1000;
  // Binary search: smallest index whose event number is >= `event`.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < event) lo = mid + 1;
    else hi = mid;
  }
  const after = lo < sorted.length ? sorted[lo] : undefined;
  const before = lo > 0 ? sorted[lo - 1] : undefined;

  if (before !== undefined && after !== undefined) {
    const tBefore = capture.eventBaseUs.get(before)!;
    const tAfter = capture.eventBaseUs.get(after)!;
    const frac = (event - before) / (after - before);
    return tBefore + frac * (tAfter - tBefore);
  }
  if (before !== undefined) return capture.eventBaseUs.get(before)! + (event - before) * isoUs;
  if (after !== undefined) return capture.eventBaseUs.get(after)! - (after - event) * isoUs;
  return capture.originUs;
}

// Inverse of estimateEventBaseUs: given a real absolute timestamp, which (fractional) position
// in allEventsRange's index scale does it fall at — used to place a BIGInfo marker on the
// whole-capture overview, whose bars are laid out by event INDEX, not by real elapsed time.
// allEventsRange is contiguous by construction (allEventsRange[i] === allEventsRange[0] + i), so
// an event NUMBER offset from allEventsRange[0] is directly an INDEX offset too — this returns
// a fractional EVENT NUMBER (via the same real-neighbor interpolation as estimateEventBaseUs,
// just inverted: bracketing by TIME instead of by event number) minus allEventsRange[0].
//
// `eventsSorted` is sorted by event NUMBER, not by time — real captures can have the rare
// out-of-order timestamp (confirmed directly: auracast2.pcapng has exactly one event whose
// observed base time is ~67s out of sequence relative to its neighbors, likely sniffer/clock
// jitter), which breaks binary search if done directly against `eventsSorted`. So this builds
// its own time-sorted view first, guaranteeing the search is always valid regardless of any
// such anomaly elsewhere in the file.
export function estimateEventIndexForTimeUs(capture: Capture, tsUs: number): number {
  const first = capture.allEventsRange[0];
  const sorted = capture.eventsSorted;
  if (first === undefined || sorted.length === 0) return 0;
  const isoUs = capture.config.isoIntervalMs * 1000;

  const byTime = sorted
    .map((event) => ({ event, timeUs: capture.eventBaseUs.get(event)! }))
    .sort((a, b) => a.timeUs - b.timeUs);

  // Binary search: smallest index whose real time is >= tsUs.
  let lo = 0;
  let hi = byTime.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (byTime[mid]!.timeUs < tsUs) lo = mid + 1;
    else hi = mid;
  }
  const after = lo < byTime.length ? byTime[lo] : undefined;
  const before = lo > 0 ? byTime[lo - 1] : undefined;

  let eventNumber: number;
  if (before !== undefined && after !== undefined) {
    const frac = after.timeUs === before.timeUs ? 0 : (tsUs - before.timeUs) / (after.timeUs - before.timeUs);
    eventNumber = before.event + frac * (after.event - before.event);
  } else if (before !== undefined) {
    eventNumber = before.event + (tsUs - before.timeUs) / isoUs;
  } else if (after !== undefined) {
    eventNumber = after.event - (after.timeUs - tsUs) / isoUs;
  } else {
    eventNumber = first;
  }
  return eventNumber - first;
}

/** Which real event numbers the current window shows — a plain slice, so it naturally returns
 * fewer than `eventsShown` events near the tail of the file rather than throwing. */
export function windowEvents(capture: Capture, windowStartIdx: number, eventsShown: number): number[] {
  return capture.allEventsRange.slice(windowStartIdx, windowStartIdx + eventsShown);
}

// Real-capture equivalent of buildSubevents(): expands the currently-windowed events into one
// list item per (event, BIS row, sub-event index), each carrying its own real `row`/`timeUs`
// (not formula-derived) since real per-BIS data genuinely differs — consumers should NOT
// re-expand this list per BIS row the way they do for the simulated model (`preExpanded` flags
// that).
export function buildSubeventsFromCapture(
  capture: Capture,
  windowStartIdx: number,
  eventsShown: number,
): { gc: number; nse: number; list: CaptureSubeventItem[]; preExpanded: true } {
  const cfg = capture.config;
  const nse = capture.nse;
  const gc = cfg.irc + cfg.npt;
  const events = windowEvents(capture, windowStartIdx, eventsShown);
  const list: CaptureSubeventItem[] = [];
  for (const E of events) {
    const eventBaseUs = capture.eventBaseUs.has(E) ? capture.eventBaseUs.get(E)! - capture.originUs : null;
    for (let row = 0; row < cfg.numBis; row++) {
      for (let s = 0; s < nse; s++) {
        const real = capture.byKey.get(`${E}:${row}:${s}`);
        if (real) {
          const g = real.kindSimple === 'new' ? 0 : real.kindSimple === 'retx' ? real.rank! : null;
          const pretxK = real.kindSimple === 'pretx' ? real.rank! - 1 : null;
          const targetEvent =
            real.kindSimple === 'pretx' ? capture.originEvent.get(`${row}:${real.payloadNum}`) : E;
          const b = ((real.payloadNum % cfg.bn) + cfg.bn) % cfg.bn;
          list.push({
            event: E,
            row,
            s,
            g,
            b,
            kind: real.kindSimple,
            pretxK,
            targetEvent,
            sdu: real.payloadNum,
            expectedSdu: real.payloadNum,
            chan: real.chan,
            timeUs: real.tsUs - capture.originUs,
            observed: true,
            pduBytes: real.pduBytes,
            ...(real.controlPdu ? { controlPdu: real.controlPdu } : {}),
          });
        } else {
          // Never captured. Infer its role from position using the config we already know
          // (bn/irc/npt/pto), so the log still shows what *should* have been there.
          const gFormula = Math.floor(s / cfg.bn);
          const bFormula = s % cfg.bn;
          let kind: CaptureSubeventItem['kind'];
          let pretxK: number | null = null;
          let targetEvent = E;
          if (gFormula < cfg.irc) {
            kind = gFormula === 0 ? 'new' : 'retx';
          } else {
            kind = 'pretx';
            pretxK = gFormula - cfg.irc;
            targetEvent = E + cfg.pto * (pretxK + 1);
          }
          // Estimate a position within the event from the config's Sub_Interval — better than
          // pinning every missing sub-event of the same event to the same instant, which would
          // stack them all on top of each other in any timeline view.
          const estTimeUs = eventBaseUs === null ? null : eventBaseUs + s * cfg.subIntervalUs;
          // The payload originates in E itself (new/retx) or in the future event this slot
          // pre-transmits for - same rule the observed branch above uses for `targetEvent`.
          const originEventForSdu = kind === 'pretx' ? targetEvent : E;
          list.push({
            event: E,
            row,
            s,
            g: gFormula,
            b: bFormula,
            kind,
            pretxK,
            targetEvent,
            sdu: null,
            expectedSdu: originEventForSdu * cfg.bn + bFormula + capture.sduOriginOffset,
            chan: null,
            timeUs: estTimeUs,
            observed: false,
            pduBytes: null,
          });
        }
      }
    }
  }
  return { gc, nse, list, preExpanded: true };
}
