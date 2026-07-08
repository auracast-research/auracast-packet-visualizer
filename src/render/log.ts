import { $, cssVar } from '../dom';
import { badgeTextColor, colorFor, pretxColor, roleDesc, roleLabel, sduLabel } from '../model/colors';
import { allCopiesOf } from '../model/subevents';
import { controlOffsetUs, subeventTimeUs } from '../model/timing';
import { computeEventRecoveryStats } from '../pcapng/capture';
import { describeControlPdu } from '../pcapng/controlPdu';
import { appVars, state } from '../state';
import type { BigControlPduDecoded, CaptureSubeventItem, Model, SubeventItem } from '../types';
import { jumpToEventWindow, windowEvents } from './overview';

// A per-event summary tacked onto the log's sticky "Event N" header, so the reason for a
// missing/red sub-event further down is visible without having to scroll past it first or hop
// over to the whole-capture overview. Capture mode only - computeEventRecoveryStats reads real
// byKey data that simulated mode doesn't have.
const MAX_NAMED_MISSING = 6;
function eventHeaderStatusHtml(event: number): string {
  const capture = appVars.capture;
  if (state.mode !== 'capture' || !capture) return '';
  const stats = computeEventRecoveryStats(capture, event, state.completenessRows);
  if (stats.status === 'full') return '';
  if (stats.status === 'degraded') {
    const degraded = stats.totalPayloads - stats.fullPayloads;
    return ` <span class="event-status degraded">${degraded} of ${stats.totalPayloads} payload(s) missing some copies, still recoverable</span>`;
  }
  const names = stats.missingSdus.map((m) => sduLabel(m.sdu, m.row, state.numBis));
  const shown =
    names.length > MAX_NAMED_MISSING
      ? `${names.slice(0, MAX_NAMED_MISSING).join(', ')}, +${names.length - MAX_NAMED_MISSING} more`
      : names.join(', ');
  return ` <span class="event-status lost">${stats.lostPayloads} of ${stats.totalPayloads} payload(s) unrecoverable - missing ${shown}</span>`;
}

function threadHtml(sdu: number, row: number, nse: number, altClass: string): string {
  const { originEvent, copies } = allCopiesOf(sdu, state);
  const rowsHtml = copies
    .map((c) => {
      const onScreen = c.event >= 0 && c.event < state.eventsShown;
      const color =
        c.kind === 'new' ? cssVar('--new') : c.kind === 'retx' ? cssVar('--retx') : pretxColor(c.pretxK!);
      const label = c.kind === 'new' ? 'NEW' : c.kind === 'retx' ? 'RTX' : 'PRE';
      const s = c.g * state.bn + c.b;
      const key = row + ':' + c.event + ':' + s;
      const isLost = appVars.lost.has(key);
      const timeLabel = onScreen
        ? `${(subeventTimeUs({ event: c.event, s }, row, nse, state) / 1000).toFixed(3)} ms`
        : '';
      // Off-screen copies can't be jumped to — simulated mode always shows a fixed 0..
      // eventsShown-1 range rather than a navigable window, so there's nowhere to jump.
      return `<div class="thread-row${onScreen ? '' : ' offscreen'}">
        <span class="thread-row-link"${onScreen ? ` data-jump-key="${key}"` : ''}><span class="roletag" style="background:${color}; color:${badgeTextColor(color)}">${label}</span>
        &nbsp;Event ${c.event}${onScreen ? '' : ' (off-screen)'}, group ${c.g}${timeLabel ? ` &middot; <span class="mono">${timeLabel}</span>` : ''}</span>
        <label><input type="checkbox" data-copykey="${key}" ${isLost ? 'checked' : ''} ${onScreen ? '' : 'disabled'}> lost</label>
      </div>`;
    })
    .join('');
  const lostCount = copies.filter((c) => appVars.lost.has(row + ':' + c.event + ':' + (c.g * state.bn + c.b))).length;
  const survivors = copies.length - lostCount;
  const msg =
    survivors > 0
      ? `<div class="recovery-msg ok">Recoverable &mdash; ${survivors} of ${copies.length} copies still available.</div>`
      : `<div class="recovery-msg bad">Not recoverable &mdash; all ${copies.length} copies marked lost.</div>`;
  return `<div class="thread${altClass || ''}">
      <p class="thread-lead">${sduLabel(sdu, row, state.numBis)} originates in Event ${originEvent} and is sent <b>${copies.length}</b> time(s) total (IRC=${state.irc} + ${state.npt} pre-tx group(s)):</p>
      ${rowsHtml}
      ${lostCount > 0 ? msg : ''}
    </div>`;
}

// Real-capture equivalent of threadHtml: every copy actually seen of this exact (BIS,
// payload_num) in the whole capture, ordered by real time — no formula involved. If fewer
// copies were observed than the config implies (IRC + pre-tx groups), that's real loss, not a
// hypothetical toggle.
function threadHtmlCapture(sdu: number, row: number, altClass: string): string {
  const capture = appVars.capture!;
  const key = `${row}:${sdu}`;
  const copies = capture.copiesByPayload.get(key) || [];
  const originEvent = capture.originEvent.get(key);
  const expectedTotal = capture.config.irc + capture.config.npt;
  const rowsHtml = copies
    .map((c) => {
      const color =
        c.kindSimple === 'new'
          ? cssVar('--new')
          : c.kindSimple === 'retx'
            ? cssVar('--retx')
            : c.kindSimple === 'control'
              ? cssVar('--control')
              : pretxColor(c.rank! - 1);
      const label =
        c.kindSimple === 'new'
          ? 'NEW'
          : c.kindSimple === 'retx'
            ? 'RTX' + c.rank
            : c.kindSimple === 'control'
              ? 'CTRL'
              : 'PRE' + c.rank;
      const timeMs = ((c.tsUs - capture.originUs) / 1000).toFixed(3);
      // Every copy here is a real, observed packet with a genuine (row, event, sub-event)
      // slot — always jumpable, shifting the window to bring its event into view first if it
      // isn't already visible (unlike simulated mode, capture mode has a real navigable window).
      const jumpKey = `${row}:${c.event}:${c.se}`;
      return `<div class="thread-row">
        <span class="thread-row-link" data-jump-key="${jumpKey}"><span class="roletag" style="background:${color}; color:${badgeTextColor(color)}">${label}</span>
        &nbsp;Event ${c.event}, chan ${c.chan} &middot; <span class="mono">${timeMs} ms</span></span>
      </div>`;
    })
    .join('');
  const missingNote =
    copies.length < expectedTotal
      ? `<div class="recovery-msg bad">Only ${copies.length} of ${expectedTotal} expected cop${expectedTotal > 1 ? 'ies' : 'y'} observed &mdash; ${expectedTotal - copies.length} really w${expectedTotal - copies.length > 1 ? 'ere' : 'as'} not captured.</div>`
      : `<div class="recovery-msg ok">All ${expectedTotal} expected copies observed.</div>`;
  const label = sduLabel(sdu, row, capture.config.numBis);
  return `<div class="thread${altClass || ''}">
      <p class="thread-lead">${originEvent !== undefined ? `${label} originates in Event ${originEvent}` : `${label}'s original transmission was never captured`} &mdash; ${copies.length} real cop${copies.length === 1 ? 'y' : 'ies'} captured:</p>
      ${rowsHtml}
      ${missingNote}
    </div>`;
}

interface LogRow {
  event: number;
  row: number;
  s?: number;
  timeUs: number | null;
  isControl?: boolean;
  observed?: boolean;
  sdu?: number | null;
  expectedSdu?: number;
  chan?: number | null;
  pduBytes?: number | null;
  kind?: SubeventItem['kind'];
  pretxK?: number | null;
  targetEvent?: number;
  b?: number;
  g?: number | null;
  controlPdu?: BigControlPduDecoded;
}

export function renderLog(model: Model): void {
  const { list, nse } = model;
  const isCapture = state.mode === 'capture';
  const container = $('log');
  let html = '';
  let currentEvent = -1;
  let eventParity = 0;
  // Build a flat, time-ordered list across BIS rows for a single continuous log. In simulated
  // mode each item's actual on-air time depends on the BIS packing scheme (see subeventTimeUs),
  // so BIS 2's messages naturally fall after BIS 1's whole block (sequential) or interleave
  // sub-event by sub-event (interleaved) once sorted by that real time. Capture-mode models
  // arrive already expanded per BIS row with real times.
  const rows: LogRow[] = [];
  if (model.preExpanded) {
    (list as CaptureSubeventItem[]).forEach((item) => rows.push(item));
  } else {
    for (let row = 0; row < state.numBis; row++) {
      (list as SubeventItem[]).forEach((item) =>
        rows.push({ ...item, row, timeUs: subeventTimeUs(item, row, nse, state) }),
      );
    }
  }
  if (state.showControlSubevent && !isCapture) {
    for (let E = 0; E < state.eventsShown; E++) {
      rows.push({
        isControl: true,
        event: E,
        row: state.numBis,
        timeUs: E * state.isoIntervalMs * 1000 + controlOffsetUs(nse, state),
      });
    }
  }
  rows.sort((a, b) => a.event - b.event || (a.timeUs ?? 0) - (b.timeUs ?? 0) || a.row - b.row);

  rows.forEach((item) => {
    if (item.event !== currentEvent) {
      currentEvent = item.event;
      eventParity = 1 - eventParity;
      html += `<div class="event-divider">Event ${currentEvent}${eventHeaderStatusHtml(currentEvent)}</div>`;
    }
    const altClass = eventParity ? ' ev-alt' : '';
    const capture = appVars.capture;
    const eventBaseUs = isCapture
      ? capture!.eventBaseUs.has(item.event)
        ? capture!.eventBaseUs.get(item.event)! - capture!.originUs
        : (item.timeUs ?? 0)
      : item.event * state.isoIntervalMs * 1000;
    const posPct = item.timeUs === null ? 0 : Math.min(((item.timeUs - eventBaseUs) / (state.isoIntervalMs * 1000)) * 100, 100);
    const POSBAR_W = 46;
    const MARKER_W = 5;
    const posLeftPx = (posPct / 100) * (POSBAR_W - MARKER_W);

    if (item.isControl) {
      html += `<div class="msg-row control-row${altClass}" id="row-ctrl-${item.event}">
          <span class="posbar"><i style="left:${posLeftPx.toFixed(2)}px; background:${cssVar('--control')}"></i></span>
          <span class="roletag" style="background:${cssVar('--control')}; color:${badgeTextColor(cssVar('--control'))}">CTRL</span>
          <span class="msg-main">
            <span class="msg-title">BIG Control subevent</span>
            <span class="msg-desc">Reserved for LL Control PDUs (e.g. channel map update, BIG termination) &mdash; not audio payload</span>
          </span>
          <span class="msg-time mono">${(item.timeUs! / 1000).toFixed(3)} ms</span>
        </div>`;
      return;
    }

    const chanTag = isCapture && item.chan !== null && item.chan !== undefined ? `<span class="chantag">CH${item.chan}</span>` : '';
    const pduBytesForItem = isCapture ? item.pduBytes : state.maxPdu;
    const pduTag =
      pduBytesForItem !== null && pduBytesForItem !== undefined
        ? `<span class="pdutag" title="${isCapture ? 'Approximate size from the captured packet length' : 'Configured Max_PDU'}">${isCapture ? '~' : ''}${pduBytesForItem}B</span>`
        : '';
    const timeLabel = item.timeUs === null ? '&mdash;' : `${(item.timeUs! / 1000).toFixed(3)} ms`;
    const key = item.row + ':' + item.event + ':' + item.s;
    const rowIdSafe = 'row-' + key.replace(/:/g, '-');
    const colorItem = { kind: item.kind!, pretxK: item.pretxK ?? null };
    const roleItem = { kind: item.kind!, g: item.g ?? 0, pretxK: item.pretxK ?? null };
    const descItem = { kind: item.kind!, b: item.b ?? 0, g: item.g ?? 0, pretxK: item.pretxK ?? null, targetEvent: item.targetEvent ?? 0 };

    // A real captured LL Control PDU (see comments.ts's `kind=control` handling) — it's not a
    // BIS payload, so it gets its own non-expandable row (reusing the simulated CTRL row's
    // `.control-row` styling/click-exclusion) rather than being labeled/expanded as an SDU.
    if (isCapture && item.kind === 'control') {
      const color = colorFor(colorItem);
      const { title: ctrlTitle, desc: ctrlDesc } = describeControlPdu(item.controlPdu);
      html += `<div class="msg-row control-row${altClass}" id="${rowIdSafe}">
          <span class="posbar"><i style="left:${posLeftPx.toFixed(2)}px; background:${color}"></i></span>
          <span class="roletag" style="background:${color}; color:${badgeTextColor(color)}">${roleLabel(roleItem)}</span>
          ${state.numBis > 1 ? `<span class="bistag">BIS ${item.row + 1}</span>` : ''}
          ${chanTag}
          ${pduTag}
          <span class="msg-main">
            <span class="msg-title">${ctrlTitle}</span>
            <span class="msg-desc">${ctrlDesc}</span>
          </span>
          <span class="msg-time mono">${timeLabel}</span>
        </div>`;
      return;
    }

    if (isCapture && !item.observed) {
      html += `<div class="msg-row not-observed${altClass}" id="${rowIdSafe}">
          <span class="posbar"><i style="left:${posLeftPx.toFixed(2)}px; background:${colorFor(colorItem)}"></i></span>
          <span class="roletag" style="background:${colorFor(colorItem)}; color:${badgeTextColor(colorFor(colorItem))}">${roleLabel(roleItem)}</span>
          ${state.numBis > 1 ? `<span class="bistag">BIS ${item.row + 1}</span>` : ''}
          <span class="msg-main">
            <span class="msg-title">Not observed &mdash; expected ${sduLabel(item.expectedSdu!, item.row, state.numBis)}</span>
            <span class="msg-desc">Expected ${roleDesc(descItem).charAt(0).toLowerCase() + roleDesc(descItem).slice(1)}, but never appears in the capture</span>
          </span>
          <span class="msg-time mono">${timeLabel}</span>
        </div>`;
      return;
    }

    const isExpanded = appVars.expandedKey === key;
    html += `<button class="msg-row${isExpanded ? ' expanded' : ''}${altClass}" id="${rowIdSafe}" data-key="${key}" data-sdu="${item.sdu}" data-row="${item.row}" aria-expanded="${isExpanded}">
        <span class="posbar"><i style="left:${posLeftPx.toFixed(2)}px; background:${colorFor(colorItem)}"></i></span>
        <span class="roletag" style="background:${colorFor(colorItem)}; color:${badgeTextColor(colorFor(colorItem))}">${roleLabel(roleItem)}</span>
        ${state.numBis > 1 ? `<span class="bistag">BIS ${item.row + 1}</span>` : ''}
        ${chanTag}
        ${pduTag}
        <span class="msg-main">
          <span class="msg-title">${sduLabel(item.sdu!, item.row, state.numBis)}</span>
          <span class="msg-desc">${roleDesc(descItem)}</span>
        </span>
        <span class="msg-time mono">${timeLabel}</span>
        <span class="msg-chevron">&#8250;</span>
      </button>`;
    if (isExpanded) {
      html += isCapture ? threadHtmlCapture(item.sdu!, item.row, altClass) : threadHtml(item.sdu!, item.row, nse, altClass);
    }
  });

  container.innerHTML = html;

  container.querySelectorAll('.msg-row:not(.control-row):not(.not-observed)').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectRow((btn as HTMLElement).dataset.key!);
    });
  });
  container.querySelectorAll('[data-copykey]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const checkbox = cb as HTMLInputElement;
      const copykey = checkbox.dataset.copykey!;
      if (checkbox.checked) appVars.lost.add(copykey);
      else appVars.lost.delete(copykey);
      renderLog(model);
    });
  });
  // Inside an expanded thread, every other copy of the same SDU (its NEW transmission, its
  // retransmissions, its pre-transmissions) links to that copy's own row — e.g. from a
  // pre-transmission's thread, clicking the NEW entry jumps straight to it.
  container.querySelectorAll<HTMLElement>('[data-jump-key]').forEach((link) => {
    link.addEventListener('click', (ev) => {
      ev.stopPropagation(); // don't also trigger the parent thread-row / msg-row's own click
      jumpToRowAndSelect(link.dataset.jumpKey!);
    });
  });
}

// Single entry point for "select this sub-event" from either the log or the overview, so the
// two stay in sync: whichever one you click, expandedKey changes and a full recompute
// re-renders both the log (expanded/highlighted row) and the minimap (highlighted tick).
export function selectRow(key: string): void {
  appVars.expandedKey = appVars.expandedKey === key ? null : key;
  appVars.recompute();
}

// Like selectRow, but for jumping to a specific copy of a SDU from inside another copy's
// expanded thread — in capture mode the target event may not be in the currently-shown window
// at all, so this shifts the window there first (centered, matching how clicking an event tick
// in the whole-capture overview already jumps) before selecting the row.
function jumpToRowAndSelect(key: string): void {
  if (state.mode === 'capture') {
    const event = Number(key.split(':')[1]);
    if (!windowEvents().includes(event)) {
      const capture = appVars.capture!;
      const idxInRange = capture.allEventsRange.indexOf(event);
      if (idxInRange !== -1) jumpToEventWindow(idxInRange - Math.floor(state.eventsShown / 2));
    }
  }
  selectRow(key);
}
