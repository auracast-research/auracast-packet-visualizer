import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    // No chunks exist to preload in a single-file output — omit the polyfill/link entirely.
    modulePreload: false,
    target: 'es2020',
  },
});
