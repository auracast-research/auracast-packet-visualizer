import { $, cssVar, el } from '../dom';
import { sduLabel } from '../model/colors';
import { extractEnhancedPackets } from '../pcapng/blocks';
import { buildCaptureFromPackets, computeEventRecoveryStats, estimateEventIndexForTimeUs } from '../pcapng/capture';
import { describeControlPdu } from '../pcapng/controlPdu';
import { appVars, state } from '../state';
import { setDrawerEditable, syncControlsFromState } from './drawer';

export function windowEvents(): number[] {
  if (!appVars.capture) return [];
  return appVars.capture.allEventsRange.slice(state.windowStartIdx, state.windowStartIdx + state.eventsShown);
}

export function jumpToEventWindow(newStartIdx: number): void {
  const capture = appVars.capture;
  if (!capture) return;
  const maxStart = Math.max(0, capture.allEventsRange.length - state.eventsShown);
  state.windowStartIdx = Math.min(Math.max(0, newStartIdx), maxStart);
  // Keep the log window visible inside the overview's current zoom viewport, panning the
  // least amount necessary rather than always re-centering (so zooming in and stepping
  // through nearby events doesn't keep yanking the view around).
  const viewEnd = state.mmViewStart + state.mmZoomLen;
  const winEnd = state.windowStartIdx + state.eventsShown;
  if (state.windowStartIdx < state.mmViewStart) state.mmViewStart = state.windowStartIdx;
  else if (winEnd > viewEnd) state.mmViewStart += winEnd - viewEnd;
  clampMinimapView();
  appVars.expandedKey = null;
  appVars.recompute();
}

export function clampMinimapView(): void {
  const capture = appVars.capture;
  if (!capture) return;
  state.mmZoomLen = Math.min(
    Math.max(state.mmZoomLen, Math.min(5, capture.allEventsRange.length)),
    capture.allEventsRange.length,
  );
  const maxStart = Math.max(0, capture.allEventsRange.length - state.mmZoomLen);
  state.mmViewStart = Math.min(Math.max(0, state.mmViewStart), maxStart);
}

export function setCaptureLoadState(kind: string, msg: string): void {
  const el2 = $('captureLoadState');
  el2.className = 'importState' + (kind ? ' ' + kind : '');
  el2.textContent = msg;
}

// Lets a capture that only reliably received a subset of the BIG's BIS (e.g. only BIS 1 of a
// 2-BIS stream) score completeness over just those rows instead of forever reading "missing" for
// a BIS that was never meant to be captured. Rebuilt every render (cheap — at most a few dozen
// checkboxes) so it always reflects the currently loaded capture's own numBis; the last remaining
// checked box is disabled so completeness scoring can't be narrowed down to nothing.
function renderCompletenessRows(): void {
  const container = $('completenessRows');
  const capture = appVars.capture;
  if (!capture || capture.config.numBis <= 1) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  const includedCount = state.completenessRows.filter(Boolean).length;
  container.innerHTML =
    `<span class="hint" style="margin:0;">Count toward completeness:</span>` +
    Array.from({ length: capture.config.numBis }, (_, row) => {
      const checked = state.completenessRows[row] !== false;
      const isSoleChecked = checked && includedCount <= 1;
      return `<label class="mm-checkbox"><input type="checkbox" data-bis-row="${row}" ${checked ? 'checked' : ''} ${isSoleChecked ? 'disabled title="At least one BIS must count toward completeness"' : ''}> BIS ${row + 1}</label>`;
    }).join('');
  container.querySelectorAll<HTMLInputElement>('[data-bis-row]').forEach((cb) => {
    cb.addEventListener('change', () => {
      state.completenessRows[Number(cb.dataset.bisRow)] = cb.checked;
      appVars.recompute();
    });
  });
}

export function renderCaptureSummary(): void {
  const box = $('captureSummary');
  const nav = $('captureNav');
  const capture = appVars.capture;
  if (!capture) {
    box.textContent = '';
    box.style.display = 'none';
    nav.style.display = 'none';
    $('completenessRows').style.display = 'none';
    return;
  }
  box.style.display = '';
  nav.style.display = 'flex';
  renderCompletenessRows();
  const regimeNote =
    capture.packingDeclared && capture.packingDeclared !== capture.regimeFromRatio
      ? ` (file says "${capture.packingDeclared}" — mismatch!)`
      : '';
  let bigInfoLine = '';
  if (capture.bigInfoSource === 'raw-biginfo') {
    bigInfoLine = `Config source: <b>decoded from raw BIGInfo</b> (packet had no summary comment)<br>`;
  } else if (capture.bigInfoCrossCheck && !capture.bigInfoCrossCheck.matched) {
    bigInfoLine = `<span class="packing-invalid">Raw BIGInfo decode disagrees with the summary comment on: ${capture.bigInfoCrossCheck.mismatches.join(', ')}</span><br>`;
  } else if (!capture.bigInfoCrossCheck) {
    bigInfoLine = `Raw BIGInfo: no decodable packet found (relying on the summary comment only)<br>`;
  }
  box.innerHTML =
    `<b>${capture.eventsSorted.length}</b> events captured (#${capture.eventsSorted[0]}–#${capture.eventsSorted[capture.eventsSorted.length - 1]})<br>` +
    `<b>${capture.rows.length}</b> annotated sub-event packets, <b>${capture.rawUncommentedCount}</b> raw/undecoded (periodic advertising)<br>` +
    `Derived packing: <b>${capture.regimeFromRatio}</b>${regimeNote}<br>` +
    bigInfoLine +
    (capture.ptoConsistent
      ? ''
      : `<span class="packing-invalid">PTO offset was inconsistent across pre-transmissions — using the most common value.</span>`) +
    (capture.droppedPlaceholderCount > 0
      ? `<br><span class="packing-invalid">${capture.droppedPlaceholderCount} packet(s) had an undecodable placeholder comment ("bn=0") and were dropped.</span>`
      : '') +
    (state.completenessRows.some((included) => !included)
      ? `<br><span class="packing-invalid">Completeness computed over BIS ${state.completenessRows.flatMap((included, row) => (included ? [row + 1] : [])).join(', ')} only.</span>`
      : '');
  ($('capturePrev') as HTMLButtonElement).disabled = state.windowStartIdx <= 0;
  ($('captureNext') as HTMLButtonElement).disabled =
    state.windowStartIdx + state.eventsShown >= capture.allEventsRange.length;
}

export function loadCaptureFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const packets = extractEnhancedPackets(reader.result as ArrayBuffer);
      const capture = buildCaptureFromPackets(packets);
      capture.fileName = file.name;
      appVars.capture = capture;
      state.mode = 'capture';
      state.windowStartIdx = 0;
      state.mmViewStart = 0;
      state.mmZoomLen = capture.allEventsRange.length;
      state.detailZoom = 1;
      // All BIS included by default — a no-op on completeness scoring until the user narrows it
      // down to whichever BIS this capture actually received.
      state.completenessRows = Array(capture.config.numBis).fill(true);
      Object.assign(state, capture.config);
      syncControlsFromState();
      setDrawerEditable(false);
      appVars.expandedKey = null;
      appVars.lost.clear();
      renderCaptureSummary();
      appVars.recompute();
      setCaptureLoadState('ok', `Loaded ${capture.eventsSorted.length} events from "${file.name}".`);
    } catch (err) {
      setCaptureLoadState('err', 'Could not read this file: ' + (err as Error).message);
    }
  };
  reader.onerror = () => setCaptureLoadState('err', 'Could not read this file.');
  reader.readAsArrayBuffer(file);
}

export function detachFromCapture(): void {
  state.mode = 'simulated';
  setDrawerEditable(true);
  $('sourceBadge').textContent = 'Simulated config';
  $('mmToolbar').style.display = 'none';
  state.detailZoom = 1;
  appVars.recompute();
}

// Capture mode's minimap is a different shape of overview: with 600+ real events, a
// per-sub-event tick is meaningless at this scale. Instead it's one bar per event across the
// WHOLE capture, colored by how completely that event was observed, with the current window
// highlighted — click anywhere to jump the window there.
// The overview supports zoom (mouse wheel or +/- buttons) and pan (drag, or Prev/Next
// auto-scrolling it into view) across the whole capture — `mmViewStart`/`mmZoomLen` pick which
// slice of `allEventsRange` is currently drawn, independent of which slice the log below is
// showing (`windowStartIdx`/`eventsShown`), though the highlighted rectangle ties the two
// together visually.
export function renderMinimapCapture(): void {
  const capture = appVars.capture!;
  if (!state.mmZoomLen) {
    state.mmZoomLen = capture.allEventsRange.length;
  }
  clampMinimapView();
  $('mmToolbar').style.display = 'flex';

  const svg = $('minimap') as unknown as SVGSVGElement;
  svg.innerHTML = '';
  const events = capture.allEventsRange;
  const n = events.length;
  const viewStart = state.mmViewStart;
  const viewLen = state.mmZoomLen;
  const viewSlice = events.slice(viewStart, viewStart + viewLen);

  const vw = Math.max(Math.round(svg.getBoundingClientRect().width) || 1000, 300);
  const vh = 64;
  svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('height', String(vh));

  // A selected log row (expandedKey = "row:event:se") highlights the EVENT tick it belongs to
  // here — the overview is per-event, not per-sub-event, so that's the finest-grained match
  // possible at this zoom level.
  const selectedEvent = appVars.expandedKey ? Number(appVars.expandedKey.split(':')[1]) : null;

  // Unlike bigInfoRows (placed by interpolated real time — periodic advertising runs on its own
  // cadence), a captured control PDU shares the sub-event grid and so lands on an exact, real
  // event number — no interpolation needed, just a lookup keyed by that event.
  const controlPdusByEvent = new Map<number, typeof capture.controlPdus>();
  for (const r of capture.controlPdus) {
    if (!controlPdusByEvent.has(r.event)) controlPdusByEvent.set(r.event, []);
    controlPdusByEvent.get(r.event)!.push(r);
  }

  const barW = Math.max(vw / viewLen, 1);
  viewSlice.forEach((E, iRel) => {
    const i = viewStart + iRel;
    const x = (iRel / viewLen) * vw;
    // Colored by whether event E's data actually made it across — every one of its payloads
    // recoverable via at least one of its scheduled copies (new/retx/pretx), not just "how many
    // raw sub-event packets landed exactly on this event's own slots" (that would flag a
    // payload as missing even when a pre-transmission elsewhere already delivered it).
    const stats = computeEventRecoveryStats(capture, E, state.completenessRows);
    const color =
      stats.status === 'lost'
        ? cssVar('--critical')
        : stats.status === 'degraded'
          ? cssVar('--retx')
          : cssVar('--new');
    const isSelected = E === selectedEvent;
    const rect = el(
      'rect',
      {
        class: 'mm-tick' + (isSelected ? ' selected' : ''),
        x,
        y: 10,
        width: Math.max(barW - 0.3, 0.6),
        height: vh - 22,
        fill: color,
        'data-event': E,
      },
      svg,
    );
    // Name the actual missing SDUs (not just a count) so the red/orange status is legible at a
    // glance instead of requiring a trip into the log to find which payloads it refers to.
    const MAX_NAMED = 8;
    const missingNames = stats.missingSdus.map((m) => sduLabel(m.sdu, m.row, capture.config.numBis));
    const missingList =
      missingNames.length > MAX_NAMED
        ? `${missingNames.slice(0, MAX_NAMED).join(', ')}, +${missingNames.length - MAX_NAMED} more`
        : missingNames.join(', ');
    const statusLabel =
      stats.status === 'lost'
        ? `${stats.lostPayloads} of ${stats.totalPayloads} payload(s) unrecoverable - every scheduled copy missing: ${missingList}`
        : stats.status === 'degraded'
          ? `All payloads recoverable, but ${stats.totalPayloads - stats.fullPayloads} of ${stats.totalPayloads} missing some copies`
          : `All ${stats.totalPayloads} payload(s) fully received`;
    el('title', {}, rect).textContent = `Event ${E}: ${statusLabel}`;
    rect.addEventListener('click', () => {
      if (appVars.mmDidDrag) return; // this click followed a drag — don't also jump the window
      jumpToEventWindow(i - Math.floor(state.eventsShown / 2));
    });

    // A real captured LL BIG Control PDU (channel map update, BIG termination, ...) — flagged as
    // a small triangle below the bar, distinct in shape and color from the BIGInfo diamonds
    // above it, since the two are unrelated real-capture phenomena that can both land near the
    // same event.
    const controlHere = controlPdusByEvent.get(E);
    if (controlHere) {
      const cx = x + Math.max(barW - 0.3, 0.6) / 2;
      const cy = vh - 5;
      const r = 4;
      const marker = el(
        'path',
        { class: 'mm-control-marker', d: `M ${cx} ${cy - r} L ${cx + r} ${cy + r} L ${cx - r} ${cy + r} Z` },
        svg,
      );
      const descs = controlHere.map((cp) => {
        const d = describeControlPdu(cp.controlPdu);
        return `${d.title}: ${d.desc}`;
      });
      el('title', {}, marker).textContent =
        `Event ${E} — ${controlHere.length > 1 ? `${controlHere.length} control PDUs` : 'control PDU'}:\n${descs.join('\n')}`;
      marker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (appVars.mmDidDrag) return;
        jumpToEventWindow(i - Math.floor(state.eventsShown / 2));
      });
    }
  });

  const winStartRel = state.windowStartIdx - viewStart;
  const winX = (winStartRel / viewLen) * vw;
  const winW = Math.max((state.eventsShown / viewLen) * vw, 2);
  if (winStartRel + state.eventsShown > 0 && winStartRel < viewLen) {
    el(
      'rect',
      { x: winX, y: 2, width: winW, height: vh - 4, fill: 'none', stroke: cssVar('--ink'), 'stroke-width': 2, rx: 2 },
      svg,
    );
  }

  // Captured BIGInfo (periodic advertising) transmissions, as small diamonds along the top —
  // these run on their own cadence, independent of any specific event's sub-events, so they're
  // placed by their real timestamp (via estimateEventIndexForTimeUs), not looked up by slot.
  if (state.showBigInfo) {
    const r = 4;
    for (const b of capture.bigInfoRows) {
      const fracIndex = estimateEventIndexForTimeUs(capture, b.tsUs);
      const relIndex = fracIndex - viewStart;
      if (relIndex < 0 || relIndex > viewLen) continue;
      const cx = (relIndex / viewLen) * vw;
      const cy = 5;
      const diamond = el(
        'path',
        { class: 'mm-biginfo', d: `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z` },
        svg,
      );
      el('title', {}, diamond).textContent =
        `BIGInfo (periodic advertising) at t = ${((b.tsUs - capture.originUs) / 1000).toFixed(3)} ms`;
    }
  }

  const zoomedNote = viewLen < n ? ` (zoomed to ${viewLen} of ${n})` : '';
  $('mmRangeLabel').textContent =
    `Event ${events[state.windowStartIdx]} – ${events[Math.min(state.windowStartIdx + state.eventsShown, n) - 1]} of ${events[0]}–${events[n - 1]}${zoomedNote}`;
  ($('mmZoomOut') as HTMLButtonElement).disabled = viewLen >= n;
  ($('mmZoomIn') as HTMLButtonElement).disabled = viewLen <= 5;
}

// ---------- overview zoom & pan (capture mode) wiring ----------
function zoomMinimap(factor: number, aroundIdx?: number): void {
  if (!appVars.capture) return;
  const center = aroundIdx ?? state.mmViewStart + state.mmZoomLen / 2;
  const oldLen = state.mmZoomLen;
  state.mmZoomLen = Math.round(oldLen * factor);
  clampMinimapView();
  // Re-center on the same event index (or the one under the cursor for wheel-zoom) rather than
  // always snapping back to the left edge.
  state.mmViewStart = Math.round(center - (center - state.mmViewStart) * (state.mmZoomLen / oldLen));
  clampMinimapView();
  renderMinimapCapture();
}

export function wireOverview(): void {
  $('mmZoomIn').addEventListener('click', () => zoomMinimap(0.5));
  $('mmZoomOut').addEventListener('click', () => zoomMinimap(2));
  $('mmFit').addEventListener('click', () => {
    if (!appVars.capture) return;
    state.mmZoomLen = appVars.capture.allEventsRange.length;
    state.mmViewStart = 0;
    renderMinimapCapture();
  });
  // Force the checkbox to match state.showBigInfo at boot, rather than trusting whatever the
  // browser's own form-state restoration left it as across a reload — browsers can restore a
  // checkbox's live `checked` property independently of the HTML `checked` attribute or our JS
  // default, which previously left the visible checkbox and the actual rendered markers out of
  // sync until clicked (twice, to first "correct" the checkbox and then actually toggle it).
  ($('showBigInfo') as HTMLInputElement).checked = state.showBigInfo;
  $('showBigInfo').addEventListener('change', () => {
    state.showBigInfo = ($('showBigInfo') as HTMLInputElement).checked;
    appVars.recompute(); // affects both timelines, not just the overview
  });

  const minimapSvg = $('minimap');
  minimapSvg.addEventListener(
    'wheel',
    (ev) => {
      if (!appVars.capture || state.mode !== 'capture') return;
      ev.preventDefault();
      const rect = minimapSvg.getBoundingClientRect();
      const frac = Math.min(Math.max((ev.clientX - rect.left) / rect.width, 0), 1);
      const idxUnderCursor = state.mmViewStart + frac * state.mmZoomLen;
      zoomMinimap(ev.deltaY < 0 ? 0.7 : 1 / 0.7, idxUnderCursor);
    },
    { passive: false },
  );

  // mmDrag tracks an in-progress drag; mmDidDrag survives past mouseup (which fires before the
  // subsequent click) so a tick's click handler can tell "was this a drag, not a tap" and skip
  // jumping the log window somewhere unintended.
  minimapSvg.addEventListener('mousedown', (ev) => {
    if (!appVars.capture || state.mode !== 'capture' || state.mmZoomLen >= appVars.capture.allEventsRange.length) return;
    appVars.mmDrag = {
      startX: ev.clientX,
      startView: state.mmViewStart,
      width: minimapSvg.getBoundingClientRect().width,
    };
    appVars.mmDidDrag = false;
    minimapSvg.classList.add('panning');
  });
  window.addEventListener('mousemove', (ev) => {
    const drag = appVars.mmDrag;
    if (!drag) return;
    if (Math.abs(ev.clientX - drag.startX) > 2) appVars.mmDidDrag = true;
    const deltaEvents = ((ev.clientX - drag.startX) / drag.width) * state.mmZoomLen;
    state.mmViewStart = Math.round(drag.startView - deltaEvents);
    clampMinimapView();
    renderMinimapCapture();
  });
  window.addEventListener('mouseup', () => {
    if (!appVars.mmDrag) return;
    appVars.mmDrag = null;
    minimapSvg.classList.remove('panning');
    // Leave mmDidDrag true just long enough to suppress the click that immediately follows
    // this mouseup on the same target, then clear it — otherwise every click after the first
    // drag would stay incorrectly suppressed forever.
    setTimeout(() => {
      appVars.mmDidDrag = false;
    }, 0);
  });

  ($('captureFile') as HTMLInputElement).addEventListener('change', () => {
    const file = ($('captureFile') as HTMLInputElement).files?.[0];
    if (!file) return;
    setCaptureLoadState('', 'Loading…');
    loadCaptureFile(file);
  });
  $('capturePrev').addEventListener('click', () => jumpToEventWindow(state.windowStartIdx - state.eventsShown));
  $('captureNext').addEventListener('click', () => jumpToEventWindow(state.windowStartIdx + state.eventsShown));
  $('detachCapture').addEventListener('click', detachFromCapture);
}
