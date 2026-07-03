// Enforces the "ships as one self-contained file" requirement as a real regression check
// instead of a config assumption: run `npm run build` first, then this test.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const distDir = path.resolve(__dirname, '..', 'dist');
const distIndex = path.join(distDir, 'index.html');

describe('single-file build output', () => {
  it('produced dist/index.html', () => {
    expect(existsSync(distIndex), 'run `npm run build` before `npm test`').toBe(true);
  });

  it('contains exactly one file in dist/', () => {
    const entries = readdirSync(distDir);
    expect(entries).toEqual(['index.html']);
  });

  it('has no external script/stylesheet/modulepreload references', () => {
    const html = readFileSync(distIndex, 'utf8');
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<link[^>]*\brel=["']?stylesheet["']?[^>]*\shref=/i);
    expect(html).not.toMatch(/<link[^>]*\brel=["']?modulepreload["']?/i);
  });

  it('has no unresolved bare import/import() tokens in the inlined script', () => {
    const html = readFileSync(distIndex, 'utf8');
    const scriptMatch = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
    expect(scriptMatch, 'expected an inline <script type="module"> in the built output').not.toBeNull();
    const body = scriptMatch![1]!;
    expect(body).not.toMatch(/^\s*import\s/m);
    expect(body).not.toMatch(/[^.\w]import\(/);
  });
});
