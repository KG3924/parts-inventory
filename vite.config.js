import { defineConfig } from 'vite';

// Live site is https://kg3924.github.io/parts-inventory/
// PR preview overrides this with: vite build --base /parts-inventory-preview/
export default defineConfig({
  base: '/parts-inventory/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
