export const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

const svgns = 'http://www.w3.org/2000/svg';

export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(svgns, tag) as SVGElementTagNameMap[K];
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

export function reduceMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function cssVar(name: string): string {
  return getComputedStyle(document.querySelector('.viz-root')!).getPropertyValue(name).trim();
}

export function pingAt(svg: SVGSVGElement, cx: number, cy: number): void {
  if (reduceMotion()) return;
  const ring = el('circle', { class: 'mm-ping', cx, cy, r: 12, 'stroke-width': 2.5 }, svg);
  ring.addEventListener('animationend', () => ring.remove());
  setTimeout(() => {
    if (ring.isConnected) ring.remove();
  }, 900);
}
