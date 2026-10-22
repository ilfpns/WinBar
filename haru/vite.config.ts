import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// a stamp per build: data files are fetched as `…json?v=<stamp>`, so a deploy never meets a stale cached copy
const BUILD_ID = Date.now().toString(36);

/** Writes the build's id and its files into dist/sw.js: a new build is a new service worker (see public/sw.js). */
const serviceWorker = (): Plugin => ({
  name: 'haru-sw',
  apply: 'build',
  closeBundle() {
    const assets = readdirSync('dist/assets').map((f) => `assets/${f}`);
    const sw = readFileSync('dist/sw.js', 'utf8')
      .replace("const BUILD = 'dev';", `const BUILD = '${BUILD_ID}';`)
      .replace('const ASSETS = [];', `const ASSETS = ${JSON.stringify(assets)};`);
    if (!sw.includes(BUILD_ID)) throw new Error('sw.js: build id not written');
    writeFileSync('dist/sw.js', sw);
  },
});

// GitHub Pages serves the app from the WinBar repo under /WinBar/; local dev and preview stay at /
export default defineConfig({
  base: process.env.HARU_BASE ?? '/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [serviceWorker()],
  build: {
    // keep standard properties (e.g. backdrop-filter) and add -webkit- only where these browsers need it
    cssTarget: ['chrome111', 'edge111', 'firefox115', 'safari16.4'],
  },
});
