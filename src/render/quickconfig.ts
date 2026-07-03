import { $ } from '../dom';
import { estimateAirtimeUs, packingRegime, totalEventSpanUs } from '../model/timing';
import { appVars, state } from '../state';
import type { Model } from '../types';

export function renderQuickConfig(): void {
  const bisBit =
    state.numBis > 1 ? `${state.numBis} BIS, ${packingRegime(state)}` : `${state.numBis} BIS`;
  $('quickconfig').textContent =
    `BN ${state.bn} · IRC ${state.irc} · PTO ${state.pto} · ${state.npt} pre-tx grp · ISO ${state.isoIntervalMs}ms · ${bisBit}`;
  $('sourceBadge').textContent =
    state.mode === 'capture' ? `${appVars.capture!.fileName} (derived)` : 'Simulated config';
}

export function renderSummary(model: Model): void {
  const { gc, nse } = model;
  const redundancy = state.irc + state.npt;
  const dutyPct = (totalEventSpanUs(nse, state) / (state.isoIntervalMs * 1000)) * 100;
  const diversityMs = state.npt > 0 ? state.pto * state.npt * state.isoIntervalMs : 0;
  const totalSubevents = state.numBis * nse;
  const packingBit =
    state.numBis > 1 ? ` · <b>${packingRegime(state)}</b> (derived from BIS_Spacing)` : '';
  const totalBit =
    state.numBis > 1 ? ` · <b>${totalSubevents}</b> sub-events total (${state.numBis}&times;${nse})` : '';
  let captureBit = '';
  if (state.mode === 'capture') {
    const observedInWindow = (model.list as Array<{ observed?: boolean }>).filter(
      (i) => i.observed,
    ).length;
    const totalInWindow = model.list.length;
    captureBit = ` · <b>${observedInWindow}/${totalInWindow}</b> observed in this window`;
  }
  $('summaryLine').innerHTML =
    `<b>${nse}</b> sub-events per BIS${totalBit} · <b>${gc}</b> group${gc > 1 ? 's' : ''} · <b>${redundancy}&times;</b> copies per payload · ` +
    `<b>${diversityMs.toFixed(1)}ms</b> time-diversity window · <b>${dutyPct.toFixed(0)}%</b> duty cycle${packingBit}${captureBit}`;
}

export function renderWarnings(model: Model): void {
  const { nse } = model;
  const warnings: Array<{ level: 'error' | 'info'; msg: string }> = [];
  const usedUs = totalEventSpanUs(nse, state);
  const isoUs = state.isoIntervalMs * 1000;
  const regime = packingRegime(state);
  if (usedUs > isoUs) {
    const spanMsg =
      regime === 'sequential'
        ? `${state.numBis} BIS &times; ${nse} sub-events${state.showControlSubevent ? ' plus the control subevent' : ''} need ${(usedUs / 1000).toFixed(2)} ms sequentially`
        : `Sub-events${state.showControlSubevent ? ' plus the control subevent' : ''} need ${(usedUs / 1000).toFixed(2)} ms`;
    warnings.push({
      level: 'error',
      msg: `${spanMsg} but ISO_Interval is only ${state.isoIntervalMs} ms — increase ISO_Interval, raise BIS_Spacing/Sub_Interval relationship toward interleaved, or reduce Sub_Interval / NSE.`,
    });
  }
  if (nse > 31) {
    warnings.push({
      level: 'error',
      msg: `NSE = ${nse} sub-events per BIS exceeds the 31 sub-event ceiling most controllers enforce.`,
    });
  }
  if (regime === 'sequential' && state.bisSpacingUs < nse * state.subIntervalUs) {
    warnings.push({
      level: 'error',
      msg: `BIS_Spacing (${state.bisSpacingUs}&micro;s) is smaller than NSE &times; Sub_Interval (${(nse * state.subIntervalUs).toFixed(0)}&micro;s), so consecutive BIS blocks would overlap on air &mdash; raise BIS_Spacing to at least that.`,
    });
  }
  if (regime === 'interleaved') {
    const nominal = state.numBis * state.bisSpacingUs;
    if (Math.abs(nominal - state.subIntervalUs) > 0.5) {
      warnings.push({
        level: 'error',
        msg: `NumBIS &times; BIS_Spacing (${nominal.toFixed(1)}&micro;s) doesn't match Sub_Interval (${state.subIntervalUs}&micro;s) &mdash; interleaving needs these equal so each BIS still lands exactly Sub_Interval apart. Use "Auto: interleaved" to fix.`,
      });
    }
    const airtime = estimateAirtimeUs(state.maxPdu, state.phyMbps);
    if (airtime > state.bisSpacingUs) {
      warnings.push({
        level: 'error',
        msg: `Interleaving gives each BIS a ${state.bisSpacingUs.toFixed(0)}&micro;s slot, but one PDU needs roughly ${airtime.toFixed(0)}&micro;s &mdash; raise Sub_Interval (which raises BIS_Spacing with it) or move BIS_Spacing above Sub_Interval for sequential instead.`,
      });
    }
  }
  if (state.pto === 0 && state.npt > 0) {
    warnings.push({
      level: 'info',
      msg: `PTO is 0, so pre-transmission groups repeat the current event again rather than adding time diversity.`,
    });
  }
  const expectedBn = state.sduIntervalMs > 0 ? state.isoIntervalMs / state.sduIntervalMs : null;
  if (expectedBn && Math.abs(expectedBn - state.bn) > 0.01) {
    warnings.push({
      level: 'info',
      msg: `For unframed PDUs, BN is typically ISO_Interval / SDU_Interval &asymp; ${expectedBn.toFixed(2)} — currently BN = ${state.bn}.`,
    });
  }
  $('warnbanner').innerHTML = warnings
    .map(
      (w) =>
        `<div class="warn-item${w.level === 'info' ? ' info' : ''}"><b>${w.level === 'info' ? 'Note' : 'Warning'}:</b> ${w.msg}</div>`,
    )
    .join('');
}

export function renderPackingResult(nse: number): void {
  const el2 = $('packingResult');
  if (state.numBis <= 1) {
    el2.textContent = 'Only one BIS — no arrangement to derive.';
    el2.className = 'hint';
    return;
  }
  const regime = packingRegime(state);
  if (regime === 'sequential') {
    const tight = nse * state.subIntervalUs;
    el2.textContent =
      state.bisSpacingUs === tight
        ? `= Sequential (BIS_Spacing ≥ Sub_Interval), tight (no gap between BIS blocks).`
        : `= Sequential (BIS_Spacing ≥ Sub_Interval), with ${(state.bisSpacingUs - tight).toFixed(0)}µs slack after each BIS's data.`;
    el2.className = 'hint packing-sequential';
  } else {
    const nominal = state.numBis * state.bisSpacingUs;
    el2.textContent =
      Math.abs(nominal - state.subIntervalUs) < 0.5
        ? `= Interleaved (BIS_Spacing < Sub_Interval), consistent cadence.`
        : `= Interleaved (BIS_Spacing < Sub_Interval), but inconsistent with Sub_Interval — see warning below.`;
    el2.className = 'hint ' + (Math.abs(nominal - state.subIntervalUs) < 0.5 ? 'packing-interleaved' : 'packing-invalid');
  }
}
