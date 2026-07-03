import './style.css';
import { $ } from './dom';
import { buildSubeventsFromCapture } from './pcapng/capture';
import { buildSubevents } from './model/subevents';
import { renderPackingResult, renderQuickConfig, renderSummary, renderWarnings } from './render/quickconfig';
import { renderCaptureSummary, renderMinimapCapture, wireOverview } from './render/overview';
import { renderMinimap, wireDetailTimeline } from './render/detailTimeline';
import { renderLog } from './render/log';
import { updateYamlExport, wireDrawer } from './render/drawer';
import { wireTheme } from './render/theme';
import { appVars, state } from './state';
import type { Model } from './types';

function recompute(): void {
  const isCapture = state.mode === 'capture';
  const model: Model = isCapture
    ? buildSubeventsFromCapture(appVars.capture!, state.windowStartIdx, state.eventsShown)
    : buildSubevents(state);
  appVars.lastModel = model;
  renderQuickConfig();
  renderSummary(model);
  renderWarnings(model);
  renderPackingResult(model.nse);
  // The whole-capture per-event overview only exists in capture mode (simulated mode never has
  // more events than the window already shows, so there's nothing to navigate). The detail
  // timeline — individual sub-event ticks, colors, dimension brackets — always renders, in both
  // modes, so the two give the same kind of information either way.
  $('minimap').style.display = isCapture ? '' : 'none';
  // Always shown (in both modes) rather than hidden in simulated mode, so the two toolbars stay
  // visually identical — see the .mm-toolbar-btns CSS comment for why a hidden label used to
  // also shift the zoom buttons to the wrong side.
  $('detailLabel').textContent = isCapture ? 'Current window, sub-event detail' : 'Sub-event detail';
  if (isCapture) {
    renderMinimapCapture();
    renderCaptureSummary();
  }
  renderMinimap(model);
  renderLog(model);
  updateYamlExport();
}

appVars.recompute = recompute;

wireOverview();
wireDetailTimeline();
wireDrawer();
wireTheme();

// Both minimaps' viewBoxes are derived from their rendered pixel width, so re-render after the
// viewport is resized to keep tick sizing accurate.
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!appVars.lastModel) return;
    if (state.mode === 'capture') renderMinimapCapture();
    renderMinimap(appVars.lastModel);
  }, 120);
});

recompute();
