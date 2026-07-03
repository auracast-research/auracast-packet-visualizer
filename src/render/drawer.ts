import { $ } from '../dom';
import { estimateAirtimeUs, packingRegime } from '../model/timing';
import { appVars, state } from '../state';
import { applyParsedConfig, parseYamlFlat, serializeConfigYaml } from '../yaml';
// This is a genuine circular import (overview.ts imports setDrawerEditable/syncControlsFromState
// from this file) — safe here because jumpToEventWindow is only ever called from inside an
// event-listener closure below, never at this module's own top-level evaluation time, so by the
// time it actually runs, both modules have long finished initializing. ESM's live-binding
// semantics make this work correctly (unlike a synchronous circular require() in CommonJS).
import { jumpToEventWindow } from './overview';

export function setDrawerEditable(editable: boolean): void {
  // eventsShown lives outside #drawer-body-fields entirely (it's a view setting, not a
  // broadcast parameter derived from the capture, so it stays editable regardless of mode) —
  // this only needs to disable what's actually inside the wrapper.
  $('drawer-body-fields').classList.toggle('disabled', !editable);
  $('drawer-body-fields')
    .querySelectorAll('input, select, button')
    .forEach((el2) => {
      (el2 as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled = !editable;
    });
  updateBisSpacingAvailability();
  $('detachCapture').style.display = editable ? 'none' : '';
}

// BIS_Spacing only means anything with more than one BIS — dim/disable it otherwise.
function updateBisSpacingAvailability(): void {
  const field = $('bisSpacingField');
  const isRelevant = state.numBis > 1;
  ($('bisSpacing') as HTMLInputElement).disabled = !isRelevant;
  ($('autoSeq') as HTMLButtonElement).disabled = !isRelevant;
  ($('autoInterleave') as HTMLButtonElement).disabled = !isRelevant;
  field.classList.toggle('disabled', !isRelevant);
}

// Pushes every value in `state` back into its bound DOM control (range/number/select/
// checkbox) and its paired readout label. Used after anything applies a whole new config at
// once (presets, pasted YAML) instead of one field at a time.
export function syncControlsFromState(): void {
  (['bn', 'irc', 'pto', 'npt', 'maxPdu', 'numBis'] as const).forEach((k) => {
    const r = $(k) as HTMLInputElement | null;
    if (r) r.value = String(state[k]);
    const n = $(k + '-num') as HTMLInputElement | null;
    if (n) n.value = String(state[k]);
    const lbl = $(k + '-val');
    if (lbl) lbl.textContent = String(state[k]);
  });
  ($('phy') as HTMLSelectElement).value = String(state.phyMbps);
  ($('bisSpacing') as HTMLInputElement).value = String(state.bisSpacingUs);
  $('bisSpacing-val').textContent = String(state.bisSpacingUs);
  ($('isoInterval') as HTMLInputElement).value = String(state.isoIntervalMs);
  $('isoInterval-val').textContent = String(state.isoIntervalMs);
  ($('sduInterval') as HTMLInputElement).value = String(state.sduIntervalMs);
  $('sduInterval-val').textContent = String(state.sduIntervalMs);
  ($('subInterval') as HTMLInputElement).value = String(state.subIntervalUs);
  $('subInterval-val').textContent = String(state.subIntervalUs);
  ($('eventsShown') as HTMLInputElement).value = String(state.eventsShown);
  $('eventsShown-val').textContent = String(state.eventsShown);
  ($('showControlSubevent') as HTMLInputElement).checked = !!state.showControlSubevent;
  updateBisSpacingAvailability();
}

function copyTextTo(text: string, feedbackEl: HTMLElement): void {
  const done = () => {
    feedbackEl.classList.add('show');
    setTimeout(() => feedbackEl.classList.remove('show'), 1400);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(done);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* execCommand may be unsupported — the textarea is still selected for a manual copy */
    }
    document.body.removeChild(ta);
    done();
  }
}

function setImportState(kind: string, msg: string): void {
  const el2 = $('importState');
  el2.className = 'importState' + (kind ? ' ' + kind : '');
  el2.textContent = msg;
}

function bindRangeNumber(rangeId: string, numId: string, key: keyof typeof state & string): void {
  const r = $(rangeId) as HTMLInputElement;
  const n = $(numId) as HTMLInputElement | null;
  const label = $(rangeId + '-val');
  function set(v: number) {
    (state as unknown as Record<string, number>)[key] = v;
    r.value = String(v);
    if (n) n.value = String(v);
    if (label) label.textContent = String(v);
    appVars.recompute();
  }
  r.addEventListener('input', () => set(Number(r.value)));
  if (n)
    n.addEventListener('input', () => {
      let v = Number(n.value);
      if (Number.isNaN(v)) return;
      v = Math.min(Number(r.max), Math.max(Number(r.min), v));
      set(v);
    });
}

const PRESETS: Record<string, Partial<typeof state>> = {
  reliable: { bn: 2, irc: 4, pto: 0, npt: 0 },
  latency: { bn: 1, irc: 1, pto: 0, npt: 0 },
  diversity: { bn: 2, irc: 2, pto: 3, npt: 2 },
};

export function wireDrawer(): void {
  /* ---------- drawer open/close ---------- */
  const drawer = $('drawer');
  const backdrop = $('drawerBackdrop');
  const openBtn = $('openConfig');
  function openDrawer() {
    drawer.classList.add('open');
    backdrop.classList.add('open');
    openBtn.setAttribute('aria-expanded', 'true');
    drawer.removeAttribute('inert');
    $('closeConfig').focus();
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    openBtn.setAttribute('aria-expanded', 'false');
    drawer.setAttribute('inert', '');
    if (document.activeElement && drawer.contains(document.activeElement)) openBtn.focus();
  }
  openBtn.addEventListener('click', openDrawer);
  $('closeConfig').addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeDrawer();
  });

  /* ---------- control bindings ---------- */
  bindRangeNumber('bn', 'bn-num', 'bn');
  bindRangeNumber('irc', 'irc-num', 'irc');
  bindRangeNumber('pto', 'pto-num', 'pto');
  bindRangeNumber('npt', 'npt-num', 'npt');
  bindRangeNumber('maxPdu', 'maxPdu-num', 'maxPdu');
  bindRangeNumber('numBis', 'numBis-num', 'numBis');

  $('phy').addEventListener('change', () => {
    state.phyMbps = Number(($('phy') as HTMLSelectElement).value);
    appVars.recompute();
  });

  ['numBis', 'numBis-num'].forEach((id) => $(id).addEventListener('input', updateBisSpacingAvailability));
  updateBisSpacingAvailability();

  $('bisSpacing').addEventListener('input', () => {
    state.bisSpacingUs = Number(($('bisSpacing') as HTMLInputElement).value) || 0;
    $('bisSpacing-val').textContent = String(state.bisSpacingUs);
    appVars.recompute();
  });
  $('autoSeq').addEventListener('click', () => {
    const nse = (state.irc + state.npt) * state.bn;
    const v = nse * state.subIntervalUs;
    state.bisSpacingUs = v;
    ($('bisSpacing') as HTMLInputElement).value = String(v);
    $('bisSpacing-val').textContent = String(v);
    appVars.recompute();
  });
  $('autoInterleave').addEventListener('click', () => {
    const v = Math.round((state.subIntervalUs / state.numBis) * 100) / 100;
    state.bisSpacingUs = v;
    ($('bisSpacing') as HTMLInputElement).value = String(v);
    $('bisSpacing-val').textContent = String(v);
    appVars.recompute();
  });

  $('isoInterval').addEventListener('input', () => {
    state.isoIntervalMs = Number(($('isoInterval') as HTMLInputElement).value) || 0;
    $('isoInterval-val').textContent = String(state.isoIntervalMs);
    appVars.recompute();
  });
  $('sduInterval').addEventListener('input', () => {
    state.sduIntervalMs = Number(($('sduInterval') as HTMLInputElement).value) || 0;
    $('sduInterval-val').textContent = String(state.sduIntervalMs);
    appVars.recompute();
  });
  $('subInterval').addEventListener('input', () => {
    state.subIntervalUs = Number(($('subInterval') as HTMLInputElement).value) || 0;
    $('subInterval-val').textContent = String(state.subIntervalUs);
    appVars.recompute();
  });
  $('eventsShown').addEventListener('input', () => {
    state.eventsShown = Number(($('eventsShown') as HTMLInputElement).value);
    $('eventsShown-val').textContent = String(state.eventsShown);
    // In capture mode, re-clamp windowStartIdx against the new window size (e.g. widening the
    // window while parked at the tail end of the file should shift left to stay full rather
    // than silently showing fewer events than requested).
    if (state.mode === 'capture') jumpToEventWindow(state.windowStartIdx);
    else appVars.recompute();
  });
  $('showControlSubevent').addEventListener('change', () => {
    state.showControlSubevent = ($('showControlSubevent') as HTMLInputElement).checked;
    appVars.recompute();
  });

  $('autoSub').addEventListener('click', () => {
    const airtime = estimateAirtimeUs(state.maxPdu, state.phyMbps);
    const suggested = Math.max(50, Math.round((airtime * 1.3) / 10) * 10);
    state.subIntervalUs = suggested;
    ($('subInterval') as HTMLInputElement).value = String(suggested);
    $('subInterval-val').textContent = String(suggested);
    appVars.recompute();
  });

  document.querySelectorAll<HTMLElement>('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      Object.assign(state, PRESETS[btn.dataset.preset!]);
      syncControlsFromState();
      appVars.expandedKey = null;
      appVars.lost.clear();
      appVars.recompute();
    });
  });

  $('copyYaml').addEventListener('click', () => copyTextTo(($('yamlExport') as HTMLTextAreaElement).value, $('copyYamlState')));

  $('applyYaml').addEventListener('click', () => {
    const text = ($('yamlImport') as HTMLTextAreaElement).value;
    if (!text.trim()) {
      setImportState('err', 'Paste a configuration first.');
      return;
    }
    const { raw, errors: parseErrors } = parseYamlFlat(text);
    const { next, errors: applyErrors } = applyParsedConfig(raw);
    const errors = parseErrors.concat(applyErrors);
    if (Object.keys(next).length === 0) {
      setImportState('err', errors.length ? errors.join(' ') : 'No recognized configuration keys found.');
      return;
    }
    Object.assign(state, next);
    if (state.mode === 'capture') {
      state.mode = 'simulated';
      setDrawerEditable(true);
      $('sourceBadge').textContent = 'Simulated config';
    }
    syncControlsFromState();
    appVars.expandedKey = null;
    appVars.lost.clear();
    appVars.recompute();
    setImportState(
      errors.length ? 'warn' : 'ok',
      errors.length
        ? `Applied, but ${errors.length} field${errors.length > 1 ? 's were' : ' was'} skipped: ${errors.join(' ')}`
        : 'Configuration applied.',
    );
  });
}

export function updateYamlExport(): void {
  ($('yamlExport') as HTMLTextAreaElement).value = serializeConfigYaml(state, packingRegime(state));
}
