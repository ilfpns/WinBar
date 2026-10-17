# Word lists for the Words page

- `tsl.csv` — **TOEIC Service List (TSL) 1.2**, 1,250 words, by Browne, C. and Culligan, B.
  https://www.newgeneralservicelist.com/toeic-service-list
- `ngsl.csv` — **New General Service List (NGSL) 1.2**, 2,809 words, by Browne, C., Culligan, B. and Phillips, J.
  https://www.newgeneralservicelist.com/new-general-service-list

Columns: `rank,word,definition,ko`. `rank` and `word` and the English `definition` come from the official
list and definition files (definitions kept as published). `ko` (Korean meanings) was written for Haru.

Both lists are licensed under the Creative Commons Attribution-ShareAlike 4.0 International License
(https://creativecommons.org/licenses/by-sa/4.0/), and so are these files, including the added Korean meanings.

`node scripts/build-words.mjs` turns `tsl.csv` into `public/data/words.json`. The Basic deck (`ngsl.csv`) was dropped
from the app; the file stays here, unused.
