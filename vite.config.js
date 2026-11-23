import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Live site is https://inventory.inmarsystems.com/ (old kg3924.github.io/parts-inventory/ redirects there). Relative base so the build works at either address. PR preview still overrides with --base /parts-inventory-preview/.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        archive: resolve(root, 'archive.html')
      }
    }
  }
});
