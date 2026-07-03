import { decodeBigInfoFromRawPacket } from './biginfo';
import { parseBigComment, parsePacketComment } from './comments';
import type {
  BigInfoCrossCheck,
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
  const bigPkt = packets.find((p) => p.comment?.startsWith('BIG '));

  // Decode BIGInfo straight from the raw, uncommented periodic-advertising packets — this is
  // what a real sniffer capture (without a synthetic summary comment) would have to rely on.
  // Also collects the timestamp of EVERY such packet (not just the first) — periodic
  // advertising happens independently of the BIS sub-event grid, at its own cadence, so every
  // instance is a real event worth being able to show on the timelines, not just one
  // representative sample for config derivation.
  let bigInfoRaw: BigInfoDecoded | null = null;
  const bigInfoRows: BigInfoRow[] = [];
  for (const p of packets) {
    if (p.comment && !p.comment.startsWith('BIG ')) continue; // a BIS Data PDU comment, not BIGInfo
    if (p.comment) {
      bigInfoRows.push({ tsUs: p.tsUs });
      continue;
    }
    const decoded = decodeBigInfoFromRawPacket(p.bytes);
    if (decoded.ok) {
      bigInfoRaw ??= decoded;
      bigInfoRows.push({ tsUs: p.tsUs });
    }
  }
  bigInfoRows.sort((a, b) => a.tsUs - b.tsUs);

  if (!bigPkt && !bigInfoRaw) {
    throw new Error(
      'No "BIG ..." summary comment and no decodable BIGInfo packet found — is this an Auracast BIS capture?',
    );
  }

  let big: {
    numBis: number;
    bn: number;
    ircConfig: number;
    nse: number;
    subIntervalUs: number;
    bisSpacingUs: number;
    isoIntervalUs: number;
    sduIntervalUs: number;
    maxPdu: number;
    phyMbps: number | null;
    packingDeclared: string | undefined | null;
  };
  let bigInfoSource: Capture['bigInfoSource'];
  if (bigPkt) {
    big = parseBigComment(bigPkt.comment!);
    bigInfoSource = 'comment';
  } else {
    // Fall back to the raw decode as the config source when there's no annotation to read.
    big = {
      numBis: bigInfoRaw!.numBis!,
      bn: bigInfoRaw!.bn!,
      ircConfig: bigInfoRaw!.irc!,
      nse: bigInfoRaw!.nse!,
      subIntervalUs: bigInfoRaw!.subIntervalUs!,
      bisSpacingUs: bigInfoRaw!.bisSpacingUs!,
      isoIntervalUs: bigInfoRaw!.isoIntervalMs! * 1000,
      sduIntervalUs: bigInfoRaw!.sduIntervalMs! * 1000,
      maxPdu: bigInfoRaw!.maxPdu!,
      phyMbps: null,
      packingDeclared: null,
    };
    bigInfoSource = 'raw-biginfo';
  }

  // If we have BOTH a comment and a raw decode, cross-check them field by field — this is the
  // strongest evidence either is trustworthy, and catches drift if a real capture's encoding
  // differs from what was validated here.
  let bigInfoCrossCheck: BigInfoCrossCheck | null = null;
  if (bigPkt && bigInfoRaw) {
    const checks: Array<[string, number, number]> = [
      ['num_bis', big.numBis, bigInfoRaw.numBis!],
      ['bn', big.bn, bigInfoRaw.bn!],
      ['irc', big.ircConfig, bigInfoRaw.irc!],
      ['nse', big.nse, bigInfoRaw.nse!],
      ['sub_interval_us', big.subIntervalUs, bigInfoRaw.subIntervalUs!],
      ['bis_spacing_us', big.bisSpacingUs, bigInfoRaw.bisSpacingUs!],
      ['iso_interval_ms', big.isoIntervalUs / 1000, bigInfoRaw.isoIntervalMs!],
      ['sdu_interval_ms', big.sduIntervalUs / 1000, bigInfoRaw.sduIntervalMs!],
      ['max_pdu', big.maxPdu, bigInfoRaw.maxPdu!],
    ];
    const mismatches = checks.filter(([, a, b]) => Math.abs(a - b) > 0.01).map(([name]) => name!);
    bigInfoCrossCheck = { mismatches, matched: mismatches.length === 0 };
  }

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
  for (const p of packets) {
    if (!p.comment || p.comment.startsWith('BIG ')) continue;
    const pc = parsePacketComment(p.comment);
    if (pc.event === undefined || pc.bis === undefined || pc.se === undefined) continue;
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
  const pto = ptoEntries.length ? Number(ptoEntries[0]![0]) : 0;
  const ptoConsistent =
    ptoEntries.length <= 1 ||
    ptoEntries[0]![1] >= 0.95 * rows.filter((r) => r.kindSimple === 'pretx').length;

  const byKey = new Map<string, PacketRow>(); // "event:row:se" -> row
  const copiesByPayload = new Map<string, PacketRow[]>(); // "row:payloadNum" -> [rows] sorted by time, with rank
  for (const r of rows) {
    byKey.set(`${r.event}:${r.bis - 1}:${r.se}`, r);
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
      // BIGInfo itself doesn't signal which PHY was used, and the raw-decode fallback has no
      // annotation to read it from either — only set phyMbps when we actually know it, so the
      // caller's existing PHY selection is left alone rather than getting silently blanked.
      ...(big.phyMbps != null ? { phyMbps: big.phyMbps } : {}),
    },
    nse: big.nse,
    packingDeclared: big.packingDeclared,
    bigInfoSource,
    bigInfoRaw,
    bigInfoCrossCheck,
    regimeFromRatio,
    ptoConsistent,
    rows,
    byKey,
    copiesByPayload,
    eventsSorted,
    originEvent,
    eventBaseUs,
    originUs,
    bigInfoRows,
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
  };
}

export interface EventRecoveryStats {
  totalPayloads: number;
  lostPayloads: number; // zero copies (new/retx/pretx) observed anywhere
  partialPayloads: number; // at least one copy observed, but not every scheduled copy
  fullPayloads: number; // every scheduled copy (irc + npt) observed
  status: 'lost' | 'degraded' | 'full';
}

// Whether event E's own data actually made it across, accounting for retransmissions AND
// pre-transmissions — not just "how many raw sub-event packets landed in this event's own
// slots" (that conflates "retransmitted a few events late" with "genuinely missing"). Each BIS
// contributes `bn` distinct payloads originating in E; each has `irc` copies scheduled inside E
// itself and `npt` pre-transmission copies scheduled at earlier events (E - pto*(k+1)) — a
// payload only counts as lost if NONE of those (irc + npt) scheduled slots were observed
// anywhere, matching the same recoverability notion threadHtmlCapture already reports per SDU.
export function computeEventRecoveryStats(capture: Capture, event: number): EventRecoveryStats {
  const cfg = capture.config;
  const copiesExpected = cfg.irc + cfg.npt;
  let lostPayloads = 0;
  let partialPayloads = 0;
  let fullPayloads = 0;
  for (let row = 0; row < cfg.numBis; row++) {
    for (let b = 0; b < cfg.bn; b++) {
      let copiesObserved = 0;
      for (let g = 0; g < cfg.irc; g++) {
        if (capture.byKey.has(`${event}:${row}:${g * cfg.bn + b}`)) copiesObserved++;
      }
      for (let k = 0; k < cfg.npt; k++) {
        const srcEvent = event - cfg.pto * (k + 1);
        if (capture.byKey.has(`${srcEvent}:${row}:${(cfg.irc + k) * cfg.bn + b}`)) copiesObserved++;
      }
      if (copiesObserved === 0) lostPayloads++;
      else if (copiesObserved >= copiesExpected) fullPayloads++;
      else partialPayloads++;
    }
  }
  const totalPayloads = cfg.numBis * cfg.bn;
  const status: EventRecoveryStats['status'] =
    lostPayloads > 0 ? 'lost' : fullPayloads < totalPayloads ? 'degraded' : 'full';
  return { totalPayloads, lostPayloads, partialPayloads, fullPayloads, status };
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
            chan: real.chan,
            timeUs: real.tsUs - capture.originUs,
            observed: true,
            pduBytes: real.pduBytes,
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
