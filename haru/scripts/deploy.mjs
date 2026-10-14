// Builds Haru for GitHub Pages (served from the WinBar repo under /WinBar/) and force-pushes dist/ to gh-pages.
import { execSync } from 'node:child_process';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const remote = execSync('git remote get-url origin').toString().trim();

run('npm run calendar');
run('npm run news');
run('npm run build', { env: { ...process.env, HARU_BASE: '/WinBar/' } });
const cwd = 'dist';
run('git init -q -b gh-pages', { cwd });
run('git add -A', { cwd });
run('git commit -q -m "Deploy to GitHub Pages"', { cwd });
run(`git push -q -f "${remote}" gh-pages`, { cwd });
console.log('Deployed: https://ilfpns.github.io/WinBar/');
