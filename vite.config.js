import { defineConfig } from 'vite';

// Live site is https://inventory.inmarsystems.com/ (old kg3924.github.io/parts-inventory/ redirects there). Relative base so the build works at either address. PR preview still overrides with --base /parts-inventory-preview/.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
