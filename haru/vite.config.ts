import { defineConfig } from 'vite';

// GitHub Pages serves the app from the WinBar repo under /WinBar/; local dev and preview stay at /
export default defineConfig({
  base: process.env.HARU_BASE ?? '/',
  build: {
    // keep standard properties (e.g. backdrop-filter) and add -webkit- only where these browsers need it
    cssTarget: ['chrome111', 'edge111', 'firefox115', 'safari16.4'],
  },
});
