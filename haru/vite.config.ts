import { defineConfig } from 'vite';

// GitHub Pages serves the app from the WinBar repo under /WinBar/; local dev and preview stay at /
export default defineConfig({
  base: process.env.HARU_BASE ?? '/',
  // a stamp per build: data files are fetched as `…json?v=<stamp>`, so a deploy never meets a stale cached copy
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  build: {
    // keep standard properties (e.g. backdrop-filter) and add -webkit- only where these browsers need it
    cssTarget: ['chrome111', 'edge111', 'firefox115', 'safari16.4'],
  },
});
