// Centralizes jsdom stubs that used to be copy-pasted at the top of every ad-hoc scratch
// script. Only applies when a jsdom `window` actually exists for this test file (unit tests
// run in the default 'node' environment and have no window at all).
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((): MediaQueryList =>
    ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }) as unknown as MediaQueryList) as unknown as typeof window.matchMedia;

  Element.prototype.scrollIntoView ??= function scrollIntoView() {};

  // jsdom does no layout, so getBoundingClientRect always returns zeros. Give it a mockable,
  // non-zero default (matching the app's own `|| 1000` fallback width) so tests that need the
  // real width-calculation path can override it per-test with vi.spyOn(...).mockReturnValue(...).
  if (!('__stubbedGetBoundingClientRect' in Element.prototype)) {
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        width: 1000,
        height: 64,
        top: 0,
        left: 0,
        right: 1000,
        bottom: 64,
        toJSON() {
          return this;
        },
      } as DOMRect;
    };
    (Element.prototype as unknown as Record<string, unknown>).__stubbedGetBoundingClientRect =
      true;
  }
}

// Not currently used by the app (confirmed via grep), but Vitest's jsdom pool is a documented
// spot where Node's native structuredClone can go missing — cheap insurance for whoever adds
// state snapshotting/undo later. A JSON round-trip is not a faithful structuredClone (no
// cycles/Map/Set support) but is plenty for this purpose as a fallback-only stub.
globalThis.structuredClone ??= ((value: unknown) => JSON.parse(JSON.stringify(value))) as typeof structuredClone;
