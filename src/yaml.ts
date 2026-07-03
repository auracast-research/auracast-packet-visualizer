import type { PackingRegime } from './model/timing';

export interface YamlConfigState {
  bn: number;
  irc: number;
  pto: number;
  npt: number;
  maxPdu: number;
  phyMbps: number;
  isoIntervalMs: number;
  sduIntervalMs: number;
  subIntervalUs: number;
  numBis: number;
  bisSpacingUs: number;
  eventsShown: number;
  showControlSubevent: boolean;
}

export function serializeConfigYaml(state: YamlConfigState, regime: PackingRegime): string {
  return (
    [
      '# Auracast BIS broadcast configuration',
      `bn: ${state.bn}`,
      `irc: ${state.irc}`,
      `pto: ${state.pto}`,
      `pretransmission_groups: ${state.npt}`,
      `max_pdu_bytes: ${state.maxPdu}`,
      `phy_mbps: ${state.phyMbps}  # 1 = LE 1M, 2 = LE 2M, 0.5 = LE Coded S=2, 0.125 = LE Coded S=8`,
      `iso_interval_ms: ${state.isoIntervalMs}`,
      `sdu_interval_ms: ${state.sduIntervalMs}`,
      `sub_interval_us: ${state.subIntervalUs}`,
      `num_bis: ${state.numBis}`,
      `bis_spacing_us: ${state.bisSpacingUs}  # only used when num_bis > 1`,
      `# packing: ${regime}  — derived from bis_spacing_us vs sub_interval_us, not a separate input`,
      `events_shown: ${state.eventsShown}`,
      `show_control_subevent: ${state.showControlSubevent}`,
    ].join('\n') + '\n'
  );
}

// A hand-rolled parser for the flat "key: value" mapping style this tool exports — not a
// general YAML implementation, but that subset is itself valid YAML, so real YAML tooling can
// read it too. Strips comments/blank lines, splits each line on its first colon.
export function parseYamlFlat(text: string): { raw: Record<string, string>; errors: string[] } {
  const raw: Record<string, string> = {};
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line) => {
    const noComment = line.replace(/#.*$/, '').trim();
    if (!noComment) return;
    const idx = noComment.indexOf(':');
    if (idx === -1) {
      errors.push(`Could not parse line: "${line.trim()}"`);
      return;
    }
    const key = noComment.slice(0, idx).trim();
    const val = noComment
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!key) {
      errors.push(`Could not parse line: "${line.trim()}"`);
      return;
    }
    raw[key] = val;
  });
  return { raw, errors };
}

export function applyParsedConfig(raw: Record<string, string>): {
  next: Partial<YamlConfigState>;
  errors: string[];
} {
  const errors: string[] = [];
  const next: Partial<YamlConfigState> = {};
  function num(key: string, min: number, max: number, target: keyof YamlConfigState) {
    if (raw[key] === undefined) return;
    const v = Number(raw[key]);
    if (Number.isNaN(v)) {
      errors.push(`"${key}" should be a number (got "${raw[key]}")`);
      return;
    }
    (next as Record<string, number>)[target] = Math.min(max, Math.max(min, v));
  }
  num('bn', 1, 7, 'bn');
  num('irc', 1, 15, 'irc');
  num('pto', 0, 15, 'pto');
  num('pretransmission_groups', 0, 6, 'npt');
  num('max_pdu_bytes', 0, 251, 'maxPdu');
  num('iso_interval_ms', 5, 200, 'isoIntervalMs');
  num('sdu_interval_ms', 1, 200, 'sduIntervalMs');
  num('sub_interval_us', 50, 5000, 'subIntervalUs');
  num('num_bis', 1, 31, 'numBis');
  num('bis_spacing_us', 1, 1000000, 'bisSpacingUs');
  // Keep in sync with the #eventsShown slider's max (index.html) — a view setting, not a
  // broadcast parameter, whose range was widened from 6 to 12 to be useful when navigating a
  // real capture; this clamp was previously left at the old max, silently truncating any pasted
  // YAML that requested more than 6.
  num('events_shown', 1, 12, 'eventsShown');

  if (raw.phy_mbps !== undefined) {
    const v = Number(raw.phy_mbps);
    if ([1, 2, 0.5, 0.125].includes(v)) next.phyMbps = v;
    else errors.push(`"phy_mbps" should be one of 1, 2, 0.5, 0.125 (got "${raw.phy_mbps}")`);
  }
  // "packing" is intentionally not accepted here — it's derived from bis_spacing_us vs
  // sub_interval_us, not an independent field, so a pasted value for it is ignored.
  if (raw.show_control_subevent !== undefined) {
    const v = String(raw.show_control_subevent).toLowerCase();
    if (v === 'true' || v === 'false') next.showControlSubevent = v === 'true';
    else errors.push(`"show_control_subevent" should be true or false (got "${raw.show_control_subevent}")`);
  }
  return { next, errors };
}
