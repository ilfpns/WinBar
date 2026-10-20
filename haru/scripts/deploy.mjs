// Builds Haru for GitHub Pages (served from the WinBar repo under /WinBar/) and force-pushes dist/ to gh-pages.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const remote = execSync('git remote get-url origin').toString().trim();

run('npm run calendar');
run('npm run news');
// the school timetable is a nice-to-have: if comci.net is down, the last snapshot ships
try {
  run('npm run school');
} catch {
  console.log('school timetable not refreshed (keeping the last one)');
}
run('npm run build', { env: { ...process.env, HARU_BASE: '/WinBar/' } });
// files GitHub Actions keeps on the published site (not built here): carried over, or a deploy would take them
// down until the next scheduled run (which GitHub may put off for hours)
for (const file of ['data/attendance.json']) {
  try {
    execSync('git fetch -q origin gh-pages', { stdio: 'ignore' });
    const body = execSync(`git show FETCH_HEAD:${file}`, { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    mkdirSync(`dist/${file.split('/').slice(0, -1).join('/')}`, { recursive: true });
    writeFileSync(`dist/${file}`, body);
    console.log(`kept ${file} from the published site`);
  } catch {
    console.log(`${file} not on the published site yet (the next Actions run adds it)`);
  }
}
const cwd = 'dist';
run('git init -q -b gh-pages', { cwd });
run('git add -A', { cwd });
run('git commit -q -m "Deploy to GitHub Pages"', { cwd });
run(`git push -q -f "${remote}" gh-pages`, { cwd });
console.log('Deployed: https://ilfpns.github.io/WinBar/');
