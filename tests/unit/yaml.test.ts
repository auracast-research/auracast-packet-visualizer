import { describe, expect, it } from 'vitest';
import { applyParsedConfig, parseYamlFlat, serializeConfigYaml } from '../../src/yaml';
import type { YamlConfigState } from '../../src/yaml';

const state: YamlConfigState = {
  bn: 4,
  irc: 2,
  pto: 2,
  npt: 1,
  maxPdu: 40,
  phyMbps: 2,
  isoIntervalMs: 20,
  sduIntervalMs: 10,
  subIntervalUs: 400,
  numBis: 2,
  bisSpacingUs: 4800,
  eventsShown: 3,
  showControlSubevent: false,
};

describe('serializeConfigYaml / parseYamlFlat / applyParsedConfig round-trip', () => {
  it('round-trips every numeric/boolean field through serialize -> parse -> apply', () => {
    const yaml = serializeConfigYaml(state, 'sequential');
    const { raw, errors: parseErrors } = parseYamlFlat(yaml);
    expect(parseErrors).toEqual([]);
    const { next, errors: applyErrors } = applyParsedConfig(raw);
    expect(applyErrors).toEqual([]);
    expect(next).toEqual(state);
  });

  it('ignores comments and blank lines', () => {
    const { raw, errors } = parseYamlFlat('# a comment\n\nbn: 4  # inline comment\n');
    expect(errors).toEqual([]);
    expect(raw.bn).toBe('4');
  });

  it('reports an error for an unparseable line (no colon)', () => {
    const { errors } = parseYamlFlat('not a valid line');
    expect(errors.length).toBe(1);
  });

  it('clamps out-of-range numeric fields rather than rejecting them', () => {
    const { next, errors } = applyParsedConfig({ bn: '999' });
    expect(errors).toEqual([]);
    expect(next.bn).toBe(7); // clamped to max
  });

  it('rejects a non-numeric value for a numeric field with a descriptive error', () => {
    const { next, errors } = applyParsedConfig({ bn: 'not-a-number' });
    expect(next.bn).toBeUndefined();
    expect(errors[0]).toMatch(/"bn" should be a number/);
  });

  it('accepts events_shown up to 12, not silently truncating at the old max of 6 (regression: the slider was widened to 12 without updating this clamp)', () => {
    const { next, errors } = applyParsedConfig({ events_shown: '10' });
    expect(errors).toEqual([]);
    expect(next.eventsShown).toBe(10);
  });

  it('only accepts one of the four legal PHY values', () => {
    expect(applyParsedConfig({ phy_mbps: '2' }).next.phyMbps).toBe(2);
    expect(applyParsedConfig({ phy_mbps: '0.125' }).next.phyMbps).toBe(0.125);
    const bad = applyParsedConfig({ phy_mbps: '3' });
    expect(bad.next.phyMbps).toBeUndefined();
    expect(bad.errors[0]).toMatch(/should be one of/);
  });

  it('parses show_control_subevent as a strict true/false, erroring otherwise', () => {
    expect(applyParsedConfig({ show_control_subevent: 'true' }).next.showControlSubevent).toBe(true);
    expect(applyParsedConfig({ show_control_subevent: 'false' }).next.showControlSubevent).toBe(false);
    const bad = applyParsedConfig({ show_control_subevent: 'yes' });
    expect(bad.next.showControlSubevent).toBeUndefined();
    expect(bad.errors.length).toBe(1);
  });

  it('does not accept a pasted "packing" field — it is derived, not independent', () => {
    const { next } = applyParsedConfig({ packing: 'interleaved' });
    expect(next).not.toHaveProperty('packing');
  });
});
