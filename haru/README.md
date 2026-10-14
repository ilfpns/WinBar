# Haru

Haru is WinBar's day planner: a web app built around a 24-hour dial, opened from the emblem next to the flame in the menu bar. Drag the ring to plan, check tasks off, and watch the dot emblem in the centre fill as the day gets done.

**Live:** https://ilfpns.github.io/WinBar/

- Drag on the ring to add a block, drag across tasks (on the dial or in the list) to select several and edit them together.
- Progress is measured against the whole day: finishing every block of a fully planned 24h is 100%.
- Side drawers stay tucked away; click the background left or right of the dial, their tabs, or `[` / `]` to slide them out.
- Works from phone to desktop: drawers push the dial aside on wide screens and overlay it on narrow ones.
- Opened from WinBar (`?winbar=1`), finishing tasks updates the WinBar menu-bar emblem via `winbar://`.
- Data stays in your browser (localStorage).

## Develop

```sh
cd haru
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm run calendar # refresh holidays + school calendar (public/data/calendar.json)
npm run deploy   # publish to https://ilfpns.github.io/WinBar/
```

`npm run deploy` builds for GitHub Pages and publishes `dist/` to the `gh-pages` branch.

## Design

`design-references/` holds the research behind the look (refs.gallery picks, measured tokens, `DESIGN.md`).

## Credits

Icons: [Lucide](https://lucide.dev) (ISC).
