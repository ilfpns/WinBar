import { defineConfig } from 'vite';

// GitHub Pages serves the app from the WinBar repo under /WinBar/; local dev and preview stay at /
export default defineConfig({
  base: process.env.HARU_BASE ?? '/',
});
