// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { badgeTextColor, colorFor, relLuminance, roleDesc, roleLabel } from '../../src/model/colors';

beforeEach(() => {
  document.body.innerHTML = '<div class="viz-root"></div>';
  const root = document.querySelector('.viz-root') as HTMLElement;
  root.style.setProperty('--new', '#2f8f6f');
  root.style.setProperty('--retx', '#8a6de0');
  root.style.setProperty('--pretx-0', '#c9a5e8');
  root.style.setProperty('--pretx-1', '#b98be0');
  root.style.setProperty('--pretx-2', '#aa72d8');
  root.style.setProperty('--pretx-3', '#9b59d0');
});

describe('colorFor / pretxColor', () => {
  it("reads the --new / --retx CSS custom properties for 'new'/'retx' items", () => {
    expect(colorFor({ kind: 'new', pretxK: null })).toBe('#2f8f6f');
    expect(colorFor({ kind: 'retx', pretxK: null })).toBe('#8a6de0');
  });

  it('reads a pretxK-indexed shade for pretx items, clamping to the last shade beyond index 3', () => {
    expect(colorFor({ kind: 'pretx', pretxK: 0 })).toBe('#c9a5e8');
    expect(colorFor({ kind: 'pretx', pretxK: 3 })).toBe('#9b59d0');
    expect(colorFor({ kind: 'pretx', pretxK: 99 })).toBe('#9b59d0');
  });
});

describe('roleLabel', () => {
  it('labels new/retx/pretx items', () => {
    expect(roleLabel({ kind: 'new', g: 0, pretxK: null })).toBe('NEW');
    expect(roleLabel({ kind: 'retx', g: 2, pretxK: null })).toBe('RTX2');
    expect(roleLabel({ kind: 'pretx', g: 3, pretxK: 1 })).toBe('PRE2');
  });
});

describe('roleDesc', () => {
  it('describes new/retx/pretx items in plain language', () => {
    expect(roleDesc({ kind: 'new', b: 0, g: 0, pretxK: null, targetEvent: 0 })).toBe(
      'New transmission',
    );
    expect(roleDesc({ kind: 'retx', b: 2, g: 1, pretxK: null, targetEvent: 0 })).toBe(
      'Repeats burst 2 of this event (group 1)',
    );
    expect(roleDesc({ kind: 'pretx', b: 0, g: 2, pretxK: 0, targetEvent: 5 })).toBe(
      'Pre-transmits event 5, 1 event early',
    );
    expect(roleDesc({ kind: 'pretx', b: 0, g: 3, pretxK: 1, targetEvent: 5 })).toBe(
      'Pre-transmits event 5, 2 events early',
    );
  });
});

describe('relLuminance / badgeTextColor', () => {
  it('gives near-1 luminance for white and near-0 for black', () => {
    expect(relLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('picks dark text on light backgrounds and white text on dark backgrounds', () => {
    expect(badgeTextColor('#ffffff')).toBe('#14151a');
    expect(badgeTextColor('#000000')).toBe('#ffffff');
  });
});
