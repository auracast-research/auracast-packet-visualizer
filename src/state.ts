import type { Capture, Model, State } from './types';

export const state: State = {
  numBis: 2,
  bn: 4,
  irc: 2,
  pto: 2,
  npt: 1,
  maxPdu: 40,
  phyMbps: 2,
  isoIntervalMs: 20,
  sduIntervalMs: 10,
  subIntervalUs: 400,
  // Default BIS_Spacing = NSE x Sub_Interval for the default BN/IRC/npt (gc=3, nse=12) — a
  // tight sequential arrangement with 2 BIS, matching the tool's default.
  bisSpacingUs: 4800,
  eventsShown: 3,
  showControlSubevent: false,
  mode: 'simulated',
  windowStartIdx: 0, // index into capture.eventsSorted for the currently-shown window
  mmViewStart: 0, // index into capture.allEventsRange for the left edge of the overview viewport
  mmZoomLen: 0, // how many events the overview viewport currently spans (0 = not yet set / fit-all)
  detailZoom: 1, // width multiplier for the sub-event detail timeline; 1 = fit its container
  showBigInfo: false, // capture mode only: show periodic-advertising/BIGInfo markers on both timelines
};

interface MinimapDrag {
  startX: number;
  startView: number;
  width: number;
}

/** Every other bit of shared mutable state the original single-file app kept as sibling
 * module-level bindings alongside `state` — bundled into one object (rather than individual
 * `let` exports) so every module that needs to read or write them just shares this one
 * reference, with no ES-module live-binding subtleties to worry about. `recompute` itself is a
 * callback slot here for the same reason: view modules need to trigger a full recompute, but
 * recompute() itself has to import every view module, so it's assigned once by main.ts at
 * bootstrap rather than each view importing main.ts back (which would be circular). */
export const appVars: {
  expandedKey: string | null;
  lost: Set<string>;
  capture: Capture | null;
  lastModel: Model | null;
  mmDrag: MinimapDrag | null;
  mmDidDrag: boolean;
  recompute: () => void;
} = {
  expandedKey: null,
  lost: new Set(),
  capture: null,
  lastModel: null,
  mmDrag: null,
  mmDidDrag: false,
  recompute: () => {},
};
