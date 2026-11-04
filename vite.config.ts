import { defineConfig } from 'vite'

// Relative paths, so the built game works at any address (GitHub Pages serves it from /crashlab/)
export default defineConfig({
  base: './',
})
