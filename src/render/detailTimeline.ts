import { $, cssVar, el, pingAt, reduceMotion } from '../dom';
import { colorFor, roleDesc, sduLabel } from '../model/colors';
import { controlOffsetUs, estimateAirtimeUs, slotWidthUs, subeventTimeUs } from '../model/timing';
import { estimateEventBaseUs } from '../pcapng/capture';
import { appVars, state } from '../state';
import type { CaptureSubeventItem, Model, SubeventItem } from '../types';
import { jumpToEventWindow, windowEvents } from './overview';
import { selectRow } from './log';

// One labeled dimension bracket spanning [x1, x2] at height y: end ticks, a line between them,
// and a floating label pill — draws exactly one representative instance of a repeating
// interval (Sub_Interval, BIS_Spacing, ISO_Interval), the way a datasheet/spec timing figure
// annotates one span rather than every occurrence.
// maxW clamps the floating label so it stays on-screen even when the bracket's own span is
// narrow or sits near an edge (the line/tick marks stay at their true geometric positions —
// only the label pill's horizontal position is nudged to remain readable).
function dimBracket(svg: SVGSVGElement, x1: number, x2: number, y: number, label: string, maxW: number): void {
  el('line', { class: 'dim-tick', x1, x2: x1, y1: y - 5, y2: y + 5 }, svg);
  el('line', { class: 'dim-tick', x1: x2, x2, y1: y - 5, y2: y + 5 }, svg);
  el('line', { class: 'dim-line', x1, x2, y1: y, y2: y }, svg);
  const tw = label.length * 5.4 + 14;
  let tagX = (x1 + x2) / 2 - tw / 2;
  if (maxW) tagX = Math.min(Math.max(tagX, 2), maxW - tw - 2);
  el('rect', { class: 'dim-tag', x: tagX, y: y - 9, width: tw, height: 18, rx: 9 }, svg);
  el('text', { class: 'dim-label', x: tagX + tw / 2, y: y + 3.5, 'text-anchor': 'middle' }, svg).textContent = label;
}

interface DetailRow {
  event: number;
  row: number;
  s: number;
  timeUs: number | null;
  sdu?: number | null;
  expectedSdu?: number;
  chan?: number | null;
  pduBytes?: number | null;
  observed?: boolean;
  kind: SubeventItem['kind'];
  b?: number;
  g?: number | null;
  pretxK?: number | null;
  targetEvent?: number;
}

// The detail timeline: the same fidelity in both modes — individual sub-event ticks per BIS
// lane, colored by role, plus the dimension brackets — but sourced from real capture data
// (including a distinct dashed style for "expected but never observed") when in capture mode,
// rather than a different, coarser visualization. Always shows the CURRENT WINDOW (the same
// events the log below is showing), each event getting an equal-width column regardless of any
// real timing irregularities between events — the whole-capture overview above (capture mode
// only) is where real gaps/irregularities across the whole file show up.
export function renderMinimap(model: Model): void {
  const isCapture = state.mode === 'capture';
  const svg = $('detailmap') as unknown as SVGSVGElement;
  svg.innerHTML = '';
  const { nse, list } = model;
  const columns = isCapture ? windowEvents() : Array.from({ length: state.eventsShown }, (_, i) => i);
  const numCols = Math.max(columns.length, 1);

  // Flatten to one entry per (row, event, s), matching how renderLog builds its row list.
  const rows: DetailRow[] = [];
  if (model.preExpanded) {
    (list as CaptureSubeventItem[]).forEach((item) => rows.push(item));
  } else {
    for (let row = 0; row < state.numBis; row++) {
      (list as SubeventItem[]).forEach((item) =>
        rows.push({ ...item, row, timeUs: subeventTimeUs(item, row, nse, state) }),
      );
    }
  }
  function withinEventUs(item: DetailRow): number {
    if (item.timeUs === null || item.timeUs === undefined) return 0;
    if (!isCapture) return item.timeUs - item.event * state.isoIntervalMs * 1000;
    const capture = appVars.capture!;
    const base = capture.eventBaseUs.has(item.event) ? capture.eventBaseUs.get(item.event)! - capture.originUs : item.timeUs;
    return item.timeUs - base;
  }
  function posX(item: DetailRow, vw: number, totalUs: number): number {
    const colIndex = columns.indexOf(item.event);
    const col = colIndex === -1 ? 0 : colIndex;
    return ((col * state.isoIntervalMs * 1000 + withinEventUs(item)) / totalUs) * vw;
  }

  // Measure the SCROLL CONTAINER's width (not the svg's own, which is often already wider than
  // it from a previous zoomed render) as the natural, zoom=1 baseline, then stretch the svg's
  // actual width by the zoom factor and let .detailmap-scroll's overflow-x handle the rest —
  // this is what makes "zoom in" actually give dimension-bracket labels more room instead of
  // just relabeling the same pixels.
  const scrollBox = $('detailmapScroll');
  const naturalVw = Math.max(Math.round(scrollBox.clientWidth) || 1000, 300);
  const vw = naturalVw * state.detailZoom;
  const totalUs = numCols * state.isoIntervalMs * 1000;
  const topOff = 24;
  const labelY = 15;
  // Lanes share a ~130px budget when there are few BIS (matching the old fixed sizing); beyond
  // that, each lane keeps shrinking (down to a legible floor) rather than the minimap staying a
  // fixed height regardless of how many BIS are configured.
  const laneGap = state.numBis > 8 ? 3 : 8;
  const lanesBudget = 130;
  const laneH = state.numBis <= 1 ? 56 : Math.max((lanesBudget - (state.numBis - 1) * laneGap) / state.numBis, 6);
  const controlLaneGap = state.showControlSubevent && !isCapture ? 6 : 0;
  const controlLaneH = state.showControlSubevent && !isCapture ? 12 : 0;
  const showBigInfoLane = isCapture && state.showBigInfo;
  const bigInfoLaneGap = showBigInfoLane ? 10 : 0;
  const bigInfoLaneH = showBigInfoLane ? 12 : 0;
  const lanesBottomY =
    topOff +
    state.numBis * laneH +
    Math.max(state.numBis - 1, 0) * laneGap +
    controlLaneGap +
    controlLaneH +
    bigInfoLaneGap +
    bigInfoLaneH;
  // Below the lanes: one labeled dimension bracket per repeating interval this schedule
  // actually has — Sub_Interval always, BIS_Spacing only with more than one BIS, ISO_Interval
  // always — stacked smallest-span-first like nested dimension lines in a drafting diagram.
  const dimBandH = 22;
  const dimBandGap = 5;
  const dimBands = 2 + (state.numBis > 1 ? 1 : 0);
  const dimStartY = lanesBottomY + 16;
  const vh = dimStartY + dimBands * dimBandH + (dimBands - 1) * dimBandGap + 6;
  svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('width', String(vw));
  svg.setAttribute('height', String(vh));
  ($('detailZoomOut') as HTMLButtonElement).disabled = state.detailZoom <= 1;
  ($('detailZoomIn') as HTMLButtonElement).disabled = state.detailZoom >= 24;
  // Shifting the window one event at a time only means anything in capture mode (simulated
  // mode's "events" are just the fixed 0..eventsShown-1 range, nothing to page through).
  const capture = appVars.capture;
  ($('detailPrevEvent') as HTMLButtonElement).disabled = !isCapture || state.windowStartIdx <= 0;
  ($('detailNextEvent') as HTMLButtonElement).disabled =
    !isCapture || !capture || state.windowStartIdx + state.eventsShown >= capture.allEventsRange.length;

  for (let c = 0; c < numCols; c++) {
    const xStart = ((c * state.isoIntervalMs * 1000) / totalUs) * vw;
    const xEnd = (((c + 1) * state.isoIntervalMs * 1000) / totalUs) * vw;
    if (c % 2 === 1) {
      el('rect', { class: 'mm-frame', x: xStart, y: 0, width: xEnd - xStart, height: vh }, svg);
    }
  }
  for (let c = 1; c < numCols; c++) {
    const x = ((c * state.isoIntervalMs * 1000) / totalUs) * vw;
    el('line', { class: 'mm-evline', x1: x, x2: x, y1: 0, y2: vh - 2 }, svg);
  }
  for (let c = 0; c < numCols; c++) {
    const x = ((c * state.isoIntervalMs * 1000) / totalUs) * vw + 6;
    el('text', { class: 'mm-evlabel', x, y: labelY }, svg).textContent = 'EVENT ' + columns[c];
  }

  const slotUs = slotWidthUs(state);
  for (let row = 0; row < state.numBis; row++) {
    const y = topOff + row * (laneH + laneGap);
    rows
      .filter((item) => item.row === row)
      .forEach((item) => {
        const x = posX(item, vw, totalUs);
        const pduBytesForTitle = isCapture ? item.pduBytes : state.maxPdu;
        // A tick's true on-air duration (preamble/AA/header/payload/CRC at the configured PHY
        // rate) is normally much shorter than its Sub_Interval/BIS_Spacing slot — that gap is
        // guard time, not part of the transmission. Drawing ticks at full slot width made
        // adjacent same-color sub-events touch edge-to-edge with no visible seam, which reads
        // as overlap once zoomed in. Clamp to the slot width too, so an inconsistent config
        // (already flagged by renderWarnings) can't draw a tick wider than its own slot.
        const airtimeUs = Math.min(estimateAirtimeUs(pduBytesForTitle ?? state.maxPdu, state.phyMbps), slotUs);
        const w = Math.max((airtimeUs / totalUs) * vw, 1.75);
        const key = row + ':' + item.event + ':' + item.s;
        const isSelected = key === appVars.expandedKey;
        const notObserved = isCapture && !item.observed;
        const colorItem = { kind: item.kind, pretxK: item.pretxK ?? null };
        const attrs: Record<string, string | number> = {
          class: 'mm-tick' + (isSelected ? ' selected' : '') + (notObserved ? ' not-observed' : ''),
          x,
          y,
          width: w,
          height: laneH,
          rx: 2,
          'data-key': key,
        };
        if (notObserved) {
          attrs.fill = 'none';
          attrs.stroke = colorFor(colorItem);
        } else attrs.fill = colorFor(colorItem);
        const rect = el('rect', attrs, svg);
        const descItem = { kind: item.kind, b: item.b ?? 0, g: item.g ?? 0, pretxK: item.pretxK ?? null, targetEvent: item.targetEvent ?? 0 };
        const titleParts = [
          notObserved
            ? `Not observed - expected ${sduLabel(item.expectedSdu!, row, state.numBis)}`
            : sduLabel(item.sdu!, row, state.numBis),
          roleDesc(descItem),
          `Event ${item.event}, sub-event ${item.s}${state.numBis > 1 ? `, BIS ${row + 1}` : ''}`,
          item.timeUs !== null ? `t = ${(item.timeUs! / 1000).toFixed(3)} ms` : null,
          isCapture && item.chan !== null && item.chan !== undefined ? `channel ${item.chan}` : null,
          pduBytesForTitle !== null && pduBytesForTitle !== undefined ? `${isCapture ? '~' : ''}${pduBytesForTitle} bytes` : null,
          `~${airtimeUs.toFixed(0)}µs on air (of a ${slotUs}µs slot)`,
        ].filter(Boolean);
        el('title', {}, rect).textContent = titleParts.join(' · ');
        rect.addEventListener('click', () => {
          // No pingAt here: selectRow() triggers a full recompute that rebuilds this SVG from
          // scratch, which would destroy the ping element before it could animate. The
          // persistent `.selected` pulse (see CSS) is the click feedback here instead.
          const target = document.getElementById('row-' + key.replace(/:/g, '-'));
          if (target) target.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
          selectRow(key);
        });
      });
  }

  if (state.showControlSubevent && !isCapture) {
    const cy = topOff + state.numBis * laneH + Math.max(state.numBis - 1, 0) * laneGap + controlLaneGap;
    const ch = controlLaneH;
    const controlAirtimeUs = Math.min(estimateAirtimeUs(state.maxPdu, state.phyMbps), state.subIntervalUs);
    const cw = Math.max((controlAirtimeUs / totalUs) * vw, 1.75);
    for (let c = 0; c < numCols; c++) {
      const x = ((c * state.isoIntervalMs * 1000 + controlOffsetUs(nse, state)) / totalUs) * vw;
      const rect = el('rect', { class: 'mm-tick mm-control', x, y: cy, width: cw, height: ch, rx: 2, fill: cssVar('--control') }, svg);
      rect.addEventListener('click', () => {
        const target = document.getElementById('row-ctrl-' + columns[c]);
        if (target) target.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
        pingAt(svg, x + cw / 2, cy + ch / 2);
      });
    }
  }

  // Captured BIGInfo (periodic advertising) transmissions that fall within the currently
  // visible window — placed by real time within whichever column their timestamp lands in
  // (periodic advertising runs on its own cadence, independent of the BIS sub-event grid, so
  // there's no slot to look them up by the way sub-events are).
  if (showBigInfoLane) {
    const cy = topOff + state.numBis * laneH + Math.max(state.numBis - 1, 0) * laneGap + controlLaneGap + controlLaneH + bigInfoLaneGap;
    const ch = bigInfoLaneH;
    const isoUs = state.isoIntervalMs * 1000;
    for (const b of appVars.capture!.bigInfoRows) {
      const relUs = b.tsUs - appVars.capture!.originUs;
      let matchedCol = -1;
      for (let c = 0; c < numCols; c++) {
        const colStartUs = estimateEventBaseUs(appVars.capture!, columns[c]!) - appVars.capture!.originUs;
        if (relUs >= colStartUs && relUs < colStartUs + isoUs) {
          matchedCol = c;
          break;
        }
      }
      if (matchedCol === -1) continue;
      const colStartUs = estimateEventBaseUs(appVars.capture!, columns[matchedCol]!) - appVars.capture!.originUs;
      const withinUs = relUs - colStartUs;
      const x = ((matchedCol * isoUs + withinUs) / totalUs) * vw;
      const w = Math.max(1.75, 2);
      const rect = el('rect', { class: 'mm-tick mm-biginfo', x, y: cy, width: w, height: ch, rx: 1 }, svg);
      el('title', {}, rect).textContent = `BIGInfo (periodic advertising) at t = ${(relUs / 1000).toFixed(3)} ms`;
    }
  }

  // Dimension brackets — one representative instance of each repeating interval, smallest span
  // first: Sub_Interval between two consecutive sub-events of BIS 1, BIS_Spacing between BIS 1
  // and BIS 2's copy of sub-event 0 (this gap is exactly BIS_Spacing in BOTH packing regimes,
  // since that's what BIS_Spacing means by definition), and ISO_Interval spanning one whole
  // event. Reference points are looked up from `rows` (which always has a full grid — real or
  // synthesized "not observed" — so this works in capture mode too).
  const find = (row: number, s: number) => rows.find((r) => r.event === columns[0] && r.row === row && r.s === s);
  let bandI = 0;
  const bandY = () => dimStartY + bandI++ * (dimBandH + dimBandGap) + dimBandH / 2;
  if (nse >= 2) {
    const a = find(0, 0);
    const b = find(0, 1);
    if (a && b) dimBracket(svg, posX(a, vw, totalUs), posX(b, vw, totalUs), bandY(), `Sub_Interval ${state.subIntervalUs}µs`, vw);
  }
  if (state.numBis > 1) {
    const a = find(0, 0);
    const b = find(1, 0);
    if (a && b) {
      const x1 = posX(a, vw, totalUs);
      const x2 = posX(b, vw, totalUs);
      dimBracket(svg, Math.min(x1, x2), Math.max(x1, x2), bandY(), `BIS_Spacing ${state.bisSpacingUs}µs`, vw);
    }
  }
  {
    const x1 = 0;
    const x2 = ((state.isoIntervalMs * 1000) / totalUs) * vw;
    dimBracket(svg, x1, x2, bandY(), `ISO_Interval ${state.isoIntervalMs}ms`, vw);
  }
}

// ---------- sub-event detail timeline zoom (both modes) wiring ----------
// Panning is native horizontal scroll on .detailmap-scroll (simpler than the overview's custom
// drag, and there's no whole-capture-vs-window distinction to keep separate here) — Shift+wheel
// (which browsers natively map to horizontal scroll) is left unintercepted for this reason,
// same as dragging the scrollbar directly.
function zoomDetail(factor: number): void {
  state.detailZoom = Math.min(Math.max(state.detailZoom * factor, 1), 24);
  if (appVars.lastModel) renderMinimap(appVars.lastModel);
}

// Cursor-centered zoom: the content pixel under the mouse stays under the mouse after
// zooming, matching the whole-capture overview's wheel-zoom feel (zoomMinimap's `aroundIdx`)
// rather than always zooming from the left edge and leaving the user to re-scroll to what they
// were looking at.
function zoomDetailAtCursor(factor: number, clientX: number): void {
  const scrollBox = $('detailmapScroll');
  const rect = scrollBox.getBoundingClientRect();
  const cursorOffsetInViewport = clientX - rect.left;
  const contentXBefore = scrollBox.scrollLeft + cursorOffsetInViewport;
  const oldZoom = state.detailZoom;
  zoomDetail(factor);
  const scaleRatio = state.detailZoom / oldZoom;
  scrollBox.scrollLeft = contentXBefore * scaleRatio - cursorOffsetInViewport;
}

export function wireDetailTimeline(): void {
  $('detailZoomIn').addEventListener('click', () => zoomDetail(1.6));
  $('detailZoomOut').addEventListener('click', () => zoomDetail(1 / 1.6));
  $('detailFit').addEventListener('click', () => {
    state.detailZoom = 1;
    if (appVars.lastModel) renderMinimap(appVars.lastModel);
  });
  $('detailmapScroll').addEventListener(
    'wheel',
    (ev) => {
      if (ev.shiftKey) return; // let native shift+wheel horizontal scroll/pan through unintercepted
      ev.preventDefault();
      zoomDetailAtCursor(ev.deltaY < 0 ? 1.3 : 1 / 1.3, ev.clientX);
    },
    { passive: false },
  );
  // Shift the window by exactly one event — finer-grained than the drawer's Prev/Next (which
  // page by the full eventsShown-sized window) — for stepping through the timeline one event
  // at a time once zoomed in on its fine sub-event detail.
  $('detailPrevEvent').addEventListener('click', () => jumpToEventWindow(state.windowStartIdx - 1));
  $('detailNextEvent').addEventListener('click', () => jumpToEventWindow(state.windowStartIdx + 1));
}
