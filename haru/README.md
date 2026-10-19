# Haru

Haru is WinBar's day planner: a web app built around a 24-hour dial, opened from the emblem next to the flame in the menu bar. Drag the ring to plan, check tasks off, and watch the dot emblem in the centre fill as the day gets done.

**Live:** https://ilfpns.github.io/WinBar/

- **Today** — drag on the ring to add a block; drag across tasks to select several and edit them together. Done tasks are filled and carry a check; a task can hold a note (a dot by its name). A new day starts at a time you set (drag the ↺ mark on the ring, or Settings → Today); the day that ended stays in the calendar.
- **School timetable** — Settings → Today: find a school, pick a class, Apply puts today's lessons on Today. 대덕소프트웨어마이스터고 comes from 컴시간알리미 (with its bell times); other schools from NEIS.
- **Calendar** — Korean holidays & observances, the school's academic calendar, day memos (with images) and statistics.
- **News** — headlines on the globe, and attendance: check in daily; the grass also fills from the Notion attendance table.
- **Words**, **Journal** (pages in folders, photos inline in the text, pinning, share to **Archive**), and **Your days** — Today's history as statistics at the top of Journal.
- **Accounts** — invite-only Google sign-in; everyone's planner is their own and syncs across devices (Firestore). Today of another member can be looked at, read only.
- Progress is measured against the whole day: finishing every block of a fully planned 24h is 100%.
- Opened from WinBar (`?winbar=1`), finishing tasks updates the WinBar menu-bar emblem via `winbar://`.

## Develop

```sh
cd haru
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm run calendar # refresh holidays + school calendar (public/data/calendar.json)
npm run school   # refresh the school timetable from 컴시간알리미 (public/data/school-timetable.json)
npm run deploy   # publish to https://ilfpns.github.io/WinBar/
```

`npm run deploy` builds for GitHub Pages and publishes `dist/` to the `gh-pages` branch.

### Cloud & data

- `firestore.rules` — paste into Firebase console → Firestore → Rules after it changes (owners, invites, profiles, Archive, Notion check-ins, `config`).
- GitHub Actions: `haru-news.yml` (headlines + school timetable) and `haru-attendance.yml` (Notion attendance both ways) publish into `gh-pages`. GitHub runs scheduled jobs late, sometimes by hours.
- Secrets: `NOTION_TOKEN` (Notion integration), `FIREBASE_API_KEY` (reads the open `notion-checkins` collection). An NEIS API key, if any, goes in Firestore `config/neis` (`{ key }`), never in the site.

## Changes

- **2026-10-19** — QA pass: a six-week month scrolls inside its card on short screens; on phones the calendar's month buttons no longer cover the title and Journal / Words scroll to the end; folder names are unique; Done in the editor applies at once; missing Korean labels; bigger touch targets for the small delete buttons. *What's new* in Settings shows this record inside Haru (`src/ui/changelog.ts`). Journal photos go into the text where the caret is (or where they're dropped), as in Notion or Obsidian; older photos stay under the text. Today: a check badge pops in when a task is done; the right drawer always opens on Today. School timetable: subjects were read from the teacher digits, so a class showed the wrong lessons; now decoded as 컴시간알리미 does. Journal: *Your days* statistics, page pinning, photos (add, Ctrl+V, drop, copy). School timetable from any school (컴시간알리미 / NEIS). Categories School, Meeting, Meal with darker distinct colours. Today: done badges, task notes, the new-day mark you can drag. Notion attendance both ways (undo included) every 5 minutes. Search removed. Only Today of another member can be looked at.
- **2026-10-18** — Invite-only accounts with per-person data, shared Archive, reconnect screen, simpler attendance grass.

## Design

`design-references/` holds the research behind the look (refs.gallery picks, measured tokens, `DESIGN.md`).

## Credits

Icons: [Lucide](https://lucide.dev) (ISC).
