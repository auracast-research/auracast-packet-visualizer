import { cssVar } from '../dom';
import type { PacketKind } from '../types';

const PRETX_SHADES = ['pretx-0', 'pretx-1', 'pretx-2', 'pretx-3'];

export function pretxColor(k: number): string {
  const idx = Math.min(k, PRETX_SHADES.length - 1);
  return cssVar('--' + PRETX_SHADES[idx]);
}

export function colorFor(item: { kind: PacketKind; pretxK: number | null }): string {
  if (item.kind === 'new') return cssVar('--new');
  if (item.kind === 'retx') return cssVar('--retx');
  if (item.kind === 'control') return cssVar('--control');
  return pretxColor(item.pretxK!);
}

export function roleLabel(item: { kind: PacketKind; g: number; pretxK: number | null }): string {
  if (item.kind === 'new') return 'NEW';
  if (item.kind === 'retx') return 'RTX' + item.g;
  if (item.kind === 'control') return 'CTRL';
  return 'PRE' + (item.pretxK! + 1);
}

// A bare "SDU #109812" is ambiguous once there's more than one BIS: each BIS has its own
// payload-number sequence (per the BIG spec, they all start at 0 and advance in lockstep), so
// the exact same number legitimately shows up on two different BIS for two unrelated payloads.
// Qualifying with the BIS whenever there's more than one avoids reading those as the same thread.
export function sduLabel(sdu: number, row: number, numBis: number): string {
  return numBis > 1 ? `BIS ${row + 1} · SDU #${sdu}` : `SDU #${sdu}`;
}

export function roleDesc(item: {
  kind: PacketKind;
  b: number;
  g: number;
  pretxK: number | null;
  targetEvent: number;
}): string {
  if (item.kind === 'new') return 'New transmission';
  if (item.kind === 'retx') return `Repeats burst ${item.b} of this event (group ${item.g})`;
  if (item.kind === 'control') return 'LL Control PDU (e.g. channel map update, BIG termination) — not audio payload';
  const n = item.pretxK! + 1;
  return `Pre-transmits event ${item.targetEvent}, ${n} event${n > 1 ? 's' : ''} early`;
}

// Pick whichever of near-black / near-white text gives higher contrast against a given badge
// background color, per WCAG relative luminance. Role colors span a wide range (dark teal to
// pale lavender) across the light/dark palettes, so a single fixed text color (e.g. always
// white) fails contrast for the lighter swatches.
export function relLuminance(hex: string): number {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const r = parseInt(full.substr(0, 2), 16) / 255;
  const g = parseInt(full.substr(2, 2), 16) / 255;
  const b = parseInt(full.substr(4, 2), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function badgeTextColor(hex: string): string {
  const L = relLuminance(hex);
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastBlack = (L + 0.05) / 0.05;
  return contrastBlack > contrastWhite ? '#14151a' : '#ffffff';
}
