/**
 * Korean for the interface (Settings → Language). The app is written in English; with Korean picked, every
 * label, button, hint and tooltip is swapped for its Korean on the way into the page — static markup and
 * whatever the pages render later (a MutationObserver) — and dates use Korean formats. What you write
 * (tasks, memos, journal, your words) and the vocabulary itself are never touched. Switching reloads.
 */
const LANG_KEY = 'haru:lang';

export const lang = (): 'en' | 'ko' => {
  try {
    return localStorage.getItem(LANG_KEY) === 'ko' ? 'ko' : 'en';
  } catch {
    return 'en';
  }
};

const KO: Record<string, string> = {
  // pages and navigation
  Today: '오늘', Calendar: '캘린더', News: '뉴스', Words: '단어', Journal: '일기', Settings: '설정', Overview: '개요',
  'Search tasks': '할 일 검색', 'Search tasks  /': '할 일 검색  /', Pages: '페이지', Main: '메인',
  'Open overview': '개요 열기', 'Open overview  [': '개요 열기  [', 'Close overview': '개요 닫기', 'Close  [': '닫기  [',
  'Navigation and overview': '탐색과 개요', 'Haru menu': 'Haru 메뉴', 'Haru · settings and more': 'Haru · 설정 등',
  'Today · the day\'s timetable': '오늘 · 하루 시간표', 'Calendar · month, notes, stats': '캘린더 · 월간, 메모, 통계',
  'News · headlines on the globe, attendance': '뉴스 · 지구본 헤드라인, 출석', 'Words · learn English vocabulary': '단어 · 영어 단어 학습',
  'Journal · write and keep entries': '일기 · 기록하고 보관하기', 'Light mode': '라이트 모드', 'Dark mode': '다크 모드',
  // overview drawer
  Now: '지금', Day: '하루', Categories: '카테고리', Done: '완료', Planned: '계획', Free: '여유', 'Free time': '여유 시간',
  Work: '업무', Study: '공부', Meeting: '회의', Meal: '식사', Health: '건강', Personal: '개인', Sleep: '수면', Other: '기타',
  'Nothing planned yet': '아직 계획이 없어요', 'Not planned yet': '아직 계획 없음',
  // tasks drawer
  Tasks: '할 일', 'Tasks  ]': '할 일  ]', 'Toggle tasks': '할 일 열고 닫기', 'Tasks panel': '할 일 패널', New: '새로 만들기',
  'New task': '새 할 일', 'Edit task': '할 일 편집', 'What are you doing?': '무엇을 하나요?', Start: '시작', End: '끝',
  'Start time': '시작 시간', 'End time': '끝 시간', Save: '저장', Cancel: '취소', Delete: '삭제', Category: '카테고리',
  'Batch actions': '일괄 작업', Clear: '해제', 'Mark done': '완료로 표시', 'Mark not done': '미완료로 표시', Move: '이동',
  Length: '길이', 'Overlaps another task': '다른 할 일과 겹쳐요', 'Would overlap another task': '다른 할 일과 겹쳐요',
  'Start and end are the same': '시작과 끝이 같아요', 'Start and end can’t be the same': '시작과 끝이 같을 수 없어요',
  'Too short': '너무 짧아요', 'Too long': '너무 길어요', 'Check the times': '시간을 확인하세요', 'Resize panel': '패널 크기 조절',
  'Drag to resize · double-click to reset': '드래그해 크기 조절 · 더블클릭하면 원래대로', Undo: '되돌리기', Restored: '복원했어요',
  // templates
  Templates: '템플릿', 'Template name': '템플릿 이름', 'New template name': '새 템플릿 이름', 'From today': '오늘에서',
  'An empty template to fill in': '빈 템플릿을 만들어 채워요', "A template of Today's tasks": '오늘 할 일로 템플릿 만들기',
  'Name it first': '이름을 먼저 적어 주세요', 'Today is empty': '오늘이 비어 있어요', 'Saved from Today': '오늘에서 저장했어요',
  'No tasks yet: add the first below': '아직 할 일이 없어요. 아래에서 추가하세요', Use: '적용', 'Use on Today': '오늘에 적용',
  'Back to templates': '템플릿 목록으로', 'Task name': '할 일 이름', Task: '할 일', Add: '추가', 'Times look like 09:00': '시간은 09:00처럼 적어요',
  'No templates yet. Name one above, then New to build it or From today to copy today.': '아직 템플릿이 없어요. 위에 이름을 적고 새로 만들기나 오늘에서를 누르세요.',
  // today views
  Dial: '다이얼', Slices: '조각', Chart: '차트', View: '보기', 'Today, live': '오늘, 실시간', free: '비어 있음',
  '24-hour timetable. Drag the ring to add a block.': '24시간 시간표. 링을 드래그해 할 일을 추가하세요.',
  // calendar
  'Previous month': '이전 달', 'Next month': '다음 달', Statistics: '통계', Show: '표시', Holidays: '공휴일', Observances: '기념일',
  School: '학교', Holiday: '공휴일', Observance: '기념일', 'Day off': '쉬는 날', Note: '메모', Timetable: '시간표',
  'Note for the selected day (Markdown)': '선택한 날의 메모 (마크다운)', 'Rendered note — click to edit': '메모 보기 — 클릭해 편집',
  'Export this day as PDF': '이 날을 PDF로 내보내기', 'Export as PDF': 'PDF로 내보내기', 'Timetable of this day': '이 날의 시간표',
  'No timetable saved for this day': '이 날 저장된 시간표가 없어요', 'Use for Today': '오늘에 사용', 'Today set from this day': '이 날 시간표로 오늘을 채웠어요',
  'Saved that day': '그날 저장됨', 'By category': '카테고리별', Sun: '일', Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토',
  'Write it as  ! 12:00~12:30 category title': '이렇게 적어요  ! 12:00~12:30 카테고리 제목',
  // stats
  Month: '월', 'All time': '전체', 'Avg. done': '평균 완료', 'Plan hit': '계획 달성', 'Done per day': '하루 완료량', 'Done by time': '시간대별 완료',
  'Focus time': '집중 시간', 'No days recorded yet': '아직 기록된 날이 없어요',
  // news and attendance
  'Interactive globe': '인터랙티브 지구본', Heatmap: '히트맵', 'Heatmap: countries by amount of news': '히트맵: 뉴스 양에 따른 국가',
  'Toggle news': '뉴스 열고 닫기', 'News  ]': '뉴스  ]', Live: '실시간', 'This week': '이번 주', 'Hottest keyword': '가장 뜨거운 키워드',
  'Most covered': '가장 많이 다룬 기사', Topics: '주제', 'All countries': '모든 나라', 'No headlines right now': '지금은 헤드라인이 없어요',
  Attendance: '출석', 'Check in': '출석하기', 'Checked in today': '오늘 출석 완료', 'Mark today as attended': '오늘 출석으로 표시',
  'Click to undo today’s check-in': '클릭하면 오늘 출석을 취소해요', 'Today · not checked in yet': '오늘 · 아직 출석 전',
  Low: '낮음', Medium: '보통', High: '높음', Best: '최고',
  // words
  'Add your word': '내 단어 추가', Word: '단어', Meaning: '뜻', 'Meaning (Korean is fine)': '뜻 (한국어 가능)',
  Example: '예문', Filters: '필터', 'done / planned': '완료 / 계획', 'TOEIC · new': 'TOEIC · 새 단어',
  'one per line\nresilient - 회복력 있는\nubiquitous: 어디에나 있는': '한 줄에 하나씩\nresilient - 회복력 있는\nubiquitous: 어디에나 있는',
  Robotics: '로보틱스', Chips: '반도체', Embedded: '임베디드', Software: '소프트웨어', Hardware: '하드웨어',
  'Example sentence (optional)': '예문 (선택)', 'Paste a list': '목록 붙여넣기', 'Add all': '모두 추가', 'Word list': '단어 목록',
  Cards: '카드', Search: '검색', 'Search cards': '카드 검색', 'Your cards': '내 카드', 'Your cards will show up here': '카드가 여기에 표시돼요',
  'No match': '일치하는 항목 없음', Again: '다시', Flip: '뒤집기', 'Got it': '알아요', 'Space to flip': '스페이스로 뒤집기',
  'I already know this word': '이미 아는 단어예요', 'All caught up': '다 끝냈어요', 'Review all words': '모든 단어 복습',
  'Turn on a deck or add your own words': '덱을 켜거나 단어를 추가하세요', All: '전체', 'My words': '내 단어', 'My word': '내 단어',
  Decks: '덱', Added: '추가했어요', 'Already in your cards': '이미 카드에 있어요',
  'Added · turn on My words to study it': '추가했어요 · 내 단어를 켜면 공부할 수 있어요', 'Pronounce (p)': '발음 듣기 (p)',
  'Pronounce  p': '발음 듣기  p', 'English definition  e': '영어 뜻풀이  e',
  // journal
  'New page': '새 페이지', 'Search this folder': '이 폴더에서 검색', 'Move to folder': '폴더 이동', 'Delete page': '페이지 삭제',
  'Export this page as PDF': '이 페이지를 PDF로 내보내기', 'Page (Markdown)': '본문 (마크다운)', 'No pages in this folder yet': '이 폴더에 아직 페이지가 없어요',
  'Page deleted': '페이지를 삭제했어요', Folders: '폴더',
  Entries: '글 목록', 'Search entries': '글 검색', 'Nothing written yet': '아직 쓴 글이 없어요', 'Nothing in this folder yet': '이 폴더는 비어 있어요',
  Title: '제목', Date: '날짜', Folder: '폴더', 'No folder': '폴더 없음', 'New folder': '새 폴더', 'Folder name': '폴더 이름',
  'Delete folder': '폴더 삭제', 'Delete entry': '글 삭제', 'Delete this entry?': '이 글을 삭제할까요?', 'Export this entry as PDF': '이 글을 PDF로 내보내기',
  'Saved as you type': '입력하면 자동 저장돼요', 'Editing…': '편집 중…', Untitled: '제목 없음', 'Entry (Markdown)': '본문 (마크다운)',
  'Write about your day…  (Markdown: # heading, **bold**, - list, - [ ] to-do)': '오늘 하루를 적어 보세요…  (마크다운: # 제목, **굵게**, - 목록, - [ ] 할 일)',
  // notes
  'Write, or type / for headings, lists, to-dos…': '쓰거나 / 를 눌러 제목, 목록, 할 일을 넣어 보세요…', 'Heading 1': '제목 1', 'Heading 2': '제목 2', 'Heading 3': '제목 3',
  Table: '표', 'Bulleted list': '글머리 목록', 'Numbered list': '번호 목록', 'To-do': '할 일', Quote: '인용', 'Code block': '코드 블록', Divider: '구분선',
  'Today’s date': '오늘 날짜', 'Move to another folder': '다른 폴더로 옮기기', 'Make another folder to move pages into': '옮길 폴더를 먼저 하나 더 만들어 주세요',
  // settings window
  'Search settings': '설정 검색', 'Settings pages': '설정 페이지', More: '더 보기', Features: '기능', Shortcuts: '단축키', About: '정보',
  'Close settings': '설정 닫기', 'Close  Esc': '닫기  Esc', 'Keep a copy': '사본 남기기',
  'Everything lives on this device. A backup file keeps it safe.': '모든 데이터는 이 기기에 있어요. 백업 파일로 안전하게 지키세요.',
  'Export backup': '백업 내보내기', 'This device': '이 기기', 'Local · sign-in off': '로컬 · 로그인 꺼짐', 'Synced to your account. A backup file is a second copy you keep.': '계정에 동기화돼요. 백업 파일은 따로 간직하는 사본이에요.',
  'Kept in this browser and synced to your account (Firestore), so your other devices have it too': '이 브라우저에 저장되고 계정(Firestore)에 동기화돼서 다른 기기에서도 볼 수 있어요',
  'How Haru looks on this device.': '이 기기에서 Haru가 보이는 모습이에요.', 'Dark, light, or whatever the system uses': '다크, 라이트, 또는 시스템 설정을 따라요',
  'Turn pages and tools on or off. What is off leaves the rail and the overview; nothing in it is deleted.': '페이지와 도구를 켜고 끌 수 있어요. 끈 항목은 사이드바와 개요에서 사라질 뿐, 안의 내용은 지워지지 않아요.',
  'The language of labels and dates. What you write stays as you wrote it.': '화면 글자와 날짜의 언어예요. 직접 쓴 내용은 그대로 남아요.',
  'Haru reloads in the one you pick': '고르면 그 언어로 다시 열려요',
  'Your timetable, memos, images, templates, words, journal and attendance in one file.': '시간표, 메모, 사진, 템플릿, 단어, 일기, 출석을 한 파일에 담아요.',
  'Keeps a file up to date after every change': '바뀔 때마다 파일을 최신으로 유지해요', 'Download a backup file now': '지금 백업 파일을 내려받아요',
  'Restore from a backup file': '백업 파일에서 복원해요', 'Start the day over.': '하루를 새로 시작해요.',
  'Keys that work anywhere outside a text box.': '입력 칸 밖이라면 어디서나 되는 키예요.',
  'Open or close the overview': '개요 열기/닫기', 'Open or close the right drawer': '오른쪽 서랍 열기/닫기', 'Select every task': '모든 할 일 선택',
  'Delete the selected tasks': '선택한 할 일 삭제', 'Close, one layer at a time': '한 겹씩 닫기',
  'Words: flip · again · got it': '단어: 뒤집기 · 다시 · 알아요', 'Words: English definition · pronounce': '단어: 영어 뜻풀이 · 발음',
  'Sign-in and sync across devices.': '로그인과 기기 간 동기화예요.', 'A day planner: timetable, calendar, news, words and journal.': '하루 플래너: 시간표, 캘린더, 뉴스, 단어, 일기.',
  Build: '빌드', 'Your data': '내 데이터',
  'Kept in this browser (local storage and IndexedDB), never sent anywhere while sign-in is off': '이 브라우저(로컬 저장소와 IndexedDB)에만 저장되고, 로그인이 꺼져 있는 동안 어디로도 보내지지 않아요',
  'TOEIC Service List 1.2 by Browne & Culligan, CC BY-SA 4.0': 'TOEIC Service List 1.2 (Browne & Culligan, CC BY-SA 4.0)',
  'Nothing matches': '일치하는 설정이 없어요',
  'Month view, memos and statistics': '월간 보기, 메모, 통계', 'Headlines on the globe, attendance': '지구본 헤드라인, 출석',
  'TOEIC vocabulary cards': '토익 단어 카드', 'Pages in folders': '폴더 속 페이지', 'Task search on the rail and the / key': '사이드바의 할 일 검색과 / 키',
  // dialogs and menus
  OK: '확인', Rename: '이름 바꾸기', Create: '만들기', Restore: '복원', 'Rename folder': '폴더 이름 바꾸기', 'Rename or delete': '이름 바꾸기 또는 삭제',
  'e.g. School, Ideas': '예: 학교, 아이디어', 'Restore this backup?': '이 백업으로 복원할까요?',
  'Today’s tasks and all memos are replaced with the ones in the file.': '오늘 할 일과 모든 메모가 파일의 내용으로 바뀌어요.',
  'Clear today?': '오늘을 비울까요?', 'Every task on today’s timetable is removed.': '오늘 시간표의 할 일이 모두 지워져요.',
  'The template goes; Today keeps its tasks.': '템플릿만 지워지고 오늘 할 일은 그대로예요.', 'Its progress goes with it.': '학습 기록도 함께 지워져요.',
  'You can undo this for a few seconds.': '몇 초 동안은 되돌릴 수 있어요.', 'The folder is empty.': '빈 폴더예요.',
  // settings
  Appearance: '화면', Theme: '테마', Dark: '다크', Light: '라이트', System: '시스템', Language: '언어', Account: '계정',
  Backup: '백업', 'Auto-backup': '자동 백업', 'Auto-backup on': '자동 백업 켜짐', Export: '내보내기', Import: '가져오기',
  'Reconnect backup': '백업 다시 연결', 'Not a Haru backup': 'Haru 백업 파일이 아니에요', 'Clear all': '모두 지우기',
  'Clear every task on today\'s timetable': '오늘 시간표의 할 일을 모두 지워요', 'Clear every block?': '할 일을 모두 지울까요?',
  'New day': '새 하루', 'At this time the day\'s timetable is kept in the calendar and Today starts empty': '이 시간이 되면 하루 시간표는 캘린더에 남고 오늘은 빈 상태로 시작해요',
  'New day time': '새 하루 시작 시간', 'Start a new day automatically': '자동으로 새 하루 시작',
  'Replace today’s tasks and all memos with this backup?': '오늘 할 일과 모든 메모를 이 백업으로 바꿀까요?', Close: '닫기',
  'Sign-in is off for now. Everything stays on this device; use Backup to keep a copy.': '지금은 로그인이 꺼져 있어요. 모든 데이터는 이 기기에만 있으니 백업으로 사본을 남기세요.',
  'Sign out': '로그아웃', 'Sign in with Google': 'Google로 로그인', 'Use another account': '다른 계정 사용', Synced: '동기화됨',
  'Syncing…': '동기화 중…', Offline: '오프라인', 'Sync error': '동기화 오류', 'Checking access…': '접근 권한 확인 중…',
  'Sign in with an invited Google account.': '초대된 Google 계정으로 로그인하세요.', 'Sign-in failed. Try again.': '로그인에 실패했어요. 다시 시도하세요.',
  Invites: '초대', 'Only you so far': '아직 나만 있어요',
  // sharing and other people's Today
  Archive: '아카이브', 'Archive · pages everyone shared': '아카이브 · 모두가 공유한 페이지', 'Journal pages everyone shared': '모두가 공유한 일기 페이지',
  Shared: '공유됨', 'Shared pages': '공유된 페이지', 'Nothing shared yet': '아직 공유된 페이지가 없어요', 'Sign in to see shared pages': '로그인하면 공유된 페이지를 볼 수 있어요',
  'Pages shared from Journal show here once you sign in.': '로그인하면 일기에서 공유한 페이지가 여기에 보여요.',
  'Share a page from Journal and it shows here for everyone invited.': '일기에서 페이지를 공유하면 초대된 모두에게 여기에 보여요.',
  'Share to Archive': '아카이브에 공유', 'Shared to Archive': '아카이브에 공유했어요', 'Write something to share first': '먼저 내용을 써 주세요',
  'Couldn’t share. Check your connection.': '공유하지 못했어요. 연결을 확인하세요.', 'Remove from Archive': '아카이브에서 내리기',
  'The page stays in its author’s Journal.': '페이지는 작성자의 일기에 그대로 남아요.', 'The Archive couldn’t be loaded. Check your connection.': '아카이브를 불러오지 못했어요. 연결을 확인하세요.',
  'See someone’s Today': '다른 사람의 오늘 보기', 'Someone’s Today (read only)': '다른 사람의 오늘 (보기 전용)', 'Back to my Today': '내 오늘로 돌아가기', 'Back to my Today (Esc)': '내 오늘로 돌아가기 (Esc)', 'My Today': '내 오늘',
  'Connecting…': '연결하는 중…', 'Back to my words (Esc)': '내 단어장으로 돌아가기 (Esc)', 'See someone’s words': '다른 사람의 단어장 보기',
  'No words yet': '아직 단어가 없어요', 'See someone’s Haru': '다른 사람의 Haru 보기', 'Back to mine (Esc)': '내 화면으로 돌아가기 (Esc)',
  'Back to mine  Esc': '내 화면으로  Esc', 'No pages yet': '아직 페이지가 없어요', 'No memos yet': '아직 메모가 없어요',
  'Their words couldn’t be loaded.': '단어장을 불러오지 못했어요.', 'Their pages couldn’t be loaded.': '페이지를 불러오지 못했어요.',
  'Their memos couldn’t be loaded.': '메모를 불러오지 못했어요.', 'Name in Notion': 'Notion에서 쓰는 이름', 'Notes (optional)': '메모 (선택)', Notes: '메모',
  'School timetable': '학교 시간표', 'Find a school': '학교 검색', Find: '찾기', 'No schools found': '찾는 학교가 없어요',
  'Add photos': '사진 추가', 'Add photos (or paste with Ctrl+V)': '사진 추가 (Ctrl+V로 붙여넣기도 돼요)', Copy: '복사', Remove: '지우기',
  'Photo copied': '사진을 복사했어요', 'Couldn’t copy the photo': '사진을 복사하지 못했어요',
  'Pin to top': '맨 위에 고정', Unpin: '고정 해제', Pinned: '고정됨', 'Pinned to the top': '맨 위에 고정했어요', Unpinned: '고정을 풀었어요',
  'Your days': '나의 하루들', 'Days tracked': '기록한 날', 'Planned a day': '하루 계획', 'Sleep a night': '하루 수면', 'on average': '평균',
  'Plan a day on Today': 'Today에서 하루를 계획해 보세요', 'Most time on': '가장 많이 한 일', 'By weekday': '요일별', 'Puts your class\'s lessons for today on Today, at their periods (컴시간알리미)': '우리 반 오늘 수업을 교시 시간에 맞춰 Today에 넣어요 (컴시간알리미)',
  Class: '반', Apply: '적용', 'Pick your class first': '먼저 반을 골라 주세요', 'No classes today': '오늘은 수업이 없어요',
  'No timetable for this week yet': '이번 주 시간표가 아직 없어요', 'The school timetable isn’t loaded yet': '학교 시간표를 아직 불러오지 못했어요',
  'The school timetable isn’t available right now': '지금은 학교 시간표를 불러올 수 없어요', 'Put today’s lessons on Today?': '오늘 수업을 Today에 넣을까요?',
  'Type your column name in the Notion attendance table exactly as it is there (e.g. 세현). Check-ins then go both ways.': 'Notion 출석 표에 있는 내 열 이름을 그대로 적어 주세요 (예: 세현). 그러면 출석 체크가 양쪽에 함께 반영돼요.',
  'This name is linked to another Haru account': '이 이름은 다른 Haru 계정과 연결되어 있어요', 'Not a column in the Notion table yet': 'Notion 표에 없는 이름이에요', 'Their pages': '그 사람의 페이지', 'Their memos': '그 사람의 메모',
  'Read only': '보기 전용', 'No one else yet': '아직 다른 사람이 없어요', 'Loading…': '불러오는 중…',
  'Their Today couldn’t be loaded.': '오늘 시간표를 불러오지 못했어요.', Me: '나', 'Getting your Haru ready…': 'Haru를 준비하는 중…',
  'Ctrl+click to open': 'Ctrl+클릭으로 열기', 'Copy photo': '사진 복사', 'Remove photo': '사진 지우기', 'Drag to resize · double-click for the original size': '끌어서 크기 조절 · 더블클릭하면 원래 크기', 'Photo removed': '사진을 지웠어요', 'Rename or delete this folder': '폴더 이름 바꾸기 또는 삭제',
  'A folder with that name already exists': '같은 이름의 폴더가 이미 있어요', 'A template of Today': 'Today를 템플릿으로',
  // Your days
  Less: '접기', 'Last 14 days': '최근 14일', '@ you': '@나', List: '목록', Tree: '트리', 'Tree: every folder and its pages': '트리: 모든 폴더와 페이지', 'Show pages as': '페이지 보기 방식', Empty: '비어 있음',
  'Days with at least one task planned on Today': 'Today에 할 일을 하나 이상 계획한 날 수',
  'Time planned on Today, averaged over the days tracked (24h is a full day)': '기록한 날들의 하루 평균 계획 시간 (24시간이 꽉 찬 하루)',
  'How much of all the planned time was checked off as done': '계획한 전체 시간 중 완료로 체크한 비율',
  'Time in the Sleep category, averaged over the days tracked': '수면 카테고리 시간의 하루 평균',
  'Each column is a day: its height is the time planned on Today, the solid part what was done': '막대 하나가 하루예요. 높이는 계획한 시간, 진한 부분은 완료한 시간',
  'All the planned time, split by category; the solid part was done': '계획한 시간을 카테고리별로 나눈 것, 진한 부분은 완료',
  'The five tasks (by name) that took the most planned time': '계획 시간이 가장 많았던 할 일 5개 (이름 기준)',
  'An average day of each weekday: time planned, and how much of it was done': '요일별 하루 평균 계획 시간과 완료 비율',
  // what's new
  'What’s new': '새 소식', 'Patch notes, newest first.': '패치노트, 최신 순.',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LEVEL_KO: Record<string, string> = { Low: '낮음', Medium: '보통', High: '높음', Best: '최고' };
const t = (s: string) => KO[s] ?? s;

/** Strings with numbers or names in them. */
const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  // sharing and other people's Today
  [/^(.+)’s Today$/, (_, n) => `${n}의 오늘`],
  [/^(.+)’s Today \(read only\)$/, (_, n) => `${n}의 오늘 (보기 전용)`],
  [/^(.+)’s words$/, (_, n) => `${n}의 단어장`],
  [/^(\d+(?:h(?: \d+m)?|m)) of (\d+(?:h(?: \d+m)?|m))$/, (_, a, b) => `${b} 중 ${a}`],
  [/^(.+) · (\d+(?:h(?: \d+m)?|m)) planned · (\d+(?:h(?: \d+m)?|m)) done \((\d+)%\)$/, (_, d, p, c, n) => `${d} · 계획 ${p} · 완료 ${c} (${n}%)`],
  [/^(.+) · nothing planned$/, (_, d) => `${d} · 계획 없음`],
  [/^What’s new · (\d+) unread$/, (_, n) => `새 소식 · 안 읽은 버전 ${n}개`],
  [/^(\d+) words$/, (_, n) => `단어 ${n}개`],
  [/^Found in Notion · (\d+) days$/, (_, n) => `Notion에서 찾음 · ${n}일`],
  [/^Saved Today as “(.+)”$/, (_, n) => `오늘을 “${n}”(으)로 저장했어요`],
  [/^(\d+) photos? added$/, (_, n) => `사진 ${n}장을 추가했어요`],
  [/^since (.+)$/, (_, d) => `${d}부터`],
  [/^(.+) planned in all$/, (_, h) => `전체 ${h} 계획`],
  [/^(.+) of the plan$/, (_, h) => `계획 중 ${h}`],
  [/^(Open|Copy|Remove) photo (\d+)$/, (_, a, n) => `사진 ${n} ${a === 'Open' ? '크게 보기' : a === 'Copy' ? '복사' : '지우기'}`],
  [/^(\d+) lessons, (.+)\. Tasks in those hours are replaced\.$/, (_, n, s) => `수업 ${n}개, ${s}. 그 시간대의 작업은 바뀌어요.`],
  [/^Added (\d+) lessons$/, (_, n) => `수업 ${n}개를 넣었어요`],
  [/^Added (\d+) lessons · NEIS gives only the first (\d+) periods without a key$/, (_, n, k) => `수업 ${n}개를 넣었어요 · NEIS 인증키가 없으면 ${k}교시까지만 받아와요`],
  [/^Added (\d+) lessons · replaced (.+)$/, (_, n, r) => `수업 ${n}개를 넣었어요 · 바뀐 작업: ${r}`],
  [/^(.+) checked in today$/, (_, n) => `${n}님은 오늘 출석했어요`],
  [/^(.+) hasn’t checked in yet$/, (_, n) => `${n}님은 아직 출석 전이에요`],
  [/^(\d+) shared$/, (_, n) => `${n}개 공유됨`],
  [/^Remove “(.+)” from Archive\?$/, (_, n) => `“${n}”을(를) 아카이브에서 내릴까요?`],
  [/^(.+) planned · (\d+)% of the day done$/, (_, p, n) => `${p} 계획 · 하루의 ${n}% 완료`],
  // the calendar memo's quick-add hint (the syntax itself stays)
  [/^! 12:00~12:30 work Title\n {2}→ moves to Today\n\ncategories\n([\s\S]*)$/, (_, cats) => `! 12:00~12:30 work 제목\n  → 오늘 시간표로 옮겨져요\n\n카테고리\n${cats}`],
  // dates as JavaScript writes them (calendar cells), weekday · hour blocks (stats), ring tooltips, done toggles
  [/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}) (\d{4})(?:: ([\s\S]*))?$/, (_, wd, mo, d, y, rest) =>
    `${y}년 ${MONTHS.indexOf(mo) + 1}월 ${Number(d)}일 (${t(wd)})${rest ? `: ${rest}` : ''}`],
  [/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d+–\d+h) · (.+)$/, (_, wd, h, v) => `${t(wd)} ${h} · ${v}`],
  [/^(Done|Planned|Free|Work|Study|Health|Personal|Sleep|Other) · (.+)$/, (_, k, v) => `${t(k)} · ${v}`],
  [/^Mark (.+) not done$/, (_, n) => `${n} 미완료로 표시`],
  [/^Mark (.+) done$/, (_, n) => `${n} 완료로 표시`],
  [/^(.+)\. Flip to see the meaning$/, (_, w) => `${w}. 뒤집어서 뜻 보기`],
  [/^TOEIC · box (\d+) of (\d+) · next (.+) · right (\d+) · missed (\d+)$/, (_, b, m, n, r, w) => `TOEIC · ${b}/${m}단계 · 다음 ${n === 'today' ? '오늘' : n} · 맞힘 ${r} · 틀림 ${w}`],
  [/^My words · box (\d+) of (\d+) · next (.+) · right (\d+) · missed (\d+)$/, (_, b, m, n, r, w) => `내 단어 · ${b}/${m}단계 · 다음 ${n === 'today' ? '오늘' : n} · 맞힘 ${r} · 틀림 ${w}`],
  [/^Attendance: (\d+) days in the last (\d+) weeks, current streak (\d+) days, best (\d+) days$/, (_, n, w, s, b) => `출석: 최근 ${w}주 동안 ${n}일, 현재 ${s}일 연속, 최고 ${b}일`],
  [/^Best streak · (\d+) days?$/, (_, b) => `최고 연속 · ${b}일`],
  [/^(\d{4}-\d{2}-\d{2}) · (attended|missed)$/, (_, d, a) => `${d} · ${a === 'attended' ? '출석' : '결석'}`],
  [/^(\d+) left$/, (_, n) => `${n}개 남음`],
  [/^(.+) left$/, (_, d) => `${d} 남음`],
  [/^next (.+)$/, (_, h) => `다음 ${h}`],
  [/^(\d+)-day streak$/, (_, n) => `${n}일 연속`],
  [/^(\d+) selected$/, (_, n) => `${n}개 선택됨`],
  [/^Delete (\d+)$/, (_, n) => `${n}개 삭제`],
  [/^(\d+) due · (\d+) \/ (\d+) new today · (\d+) learning · (\d+) mastered$/, (_, a, b, c, d, e) => `복습 ${a} · 오늘 새 단어 ${b}/${c} · 학습 중 ${d} · 마스터 ${e}`],
  [/^(\d+) new today · come back tomorrow for the next (\d+)$/, (_, a, b) => `오늘 새 단어 ${a}개 · 내일 ${b}개가 더 나와요`],
  [/^(\d+) folders? · (\d+) pages? · (\d+) words?$/, (_, f, n, w) => `폴더 ${f}개 · 페이지 ${n}개 · ${w}단어`],
  [/^Delete “(.+)”\?$/, (_, n) => `“${n}”을(를) 삭제할까요?`],
  [/^Its (\d+) pages? go(?:es)? with it\. You can undo this for a few seconds\.$/, (_, n) => `안의 페이지 ${n}개도 함께 지워져요. 몇 초 동안은 되돌릴 수 있어요.`],
  [/^(.+) options$/, (_, n) => `${n} 옵션`],
  [/^Move to (.+)$/, (_, n) => `${n}(으)로 옮기기`],
  [/^In (.+)\. Move to another folder$/, (_, n) => `${n}에 있음. 다른 폴더로 옮기기`],
  [/^Moved to (.+)$/, (_, n) => `${n}(으)로 옮겼어요`],
  [/^Deleted (.+)$/, (_, n) => `${n} 삭제함`],
  [/^(.+) · drop a page here to move it$/, (_, n) => `${n} · 페이지를 끌어다 놓으면 옮겨져요`],
  [/^Delete the page “(.+)”\?$/, (_, n) => `“${n}” 페이지를 삭제할까요?`],
  [/^(\d+) (?:entry|entries) · (\d+) words?$/, (_, a, b) => `글 ${a}개 · ${b}단어`],
  [/^(\d+) words? · (\d+) min read$/, (_, a, b) => `${a}단어 · ${b}분 분량`],
  [/^Saved (\d\d:\d\d)$/, (_, h) => `${h} 저장됨`],
  [/^(.+) · ahead$/, (_, w) => `${t(w)} · 예정`],
  [/^(.+) · missed$/, (_, w) => `${t(w)} · 결석`],
  [/^(.+) · (Low|Medium|High|Best) · (\d+)% of plan$/, (_, w, l, p) => `${t(w)} · ${LEVEL_KO[l]} · 계획의 ${p}%`],
  [/^(.+) · (\d+)% of plan done$/, (_, w, p) => `${w} · 계획 ${p}% 달성`],
  [/^(.+) is on Today$/, (_, n) => `${n}을(를) 오늘에 적용했어요`],
  [/^Overlaps (.+)$/, (_, n) => `${n}와(과) 겹쳐요`],
  [/^Edit “(.+)”$/, (_, n) => `“${n}” 편집`],
  [/^Set Today to “(.+)”$/, (_, n) => `오늘을 “${n}”(으)로`],
  [/^Remove (.+)$/, (_, n) => `${n} 빼기`],
  [/^Delete (.+)$/, (_, n) => `${n} 삭제`],
  [/^(\d+) stories$/, (_, n) => `기사 ${n}개`],
  [/^(\d+) outlets$/, (_, n) => `언론사 ${n}곳`],
  [/^Updated (.+)$/, (_, w) => `${w} 업데이트`],
  [/^Added (\d+)(.*)$/, (_, n, rest) => `${n}개 추가${rest.replace(/ · (\d+) already there/, ' · $1개는 이미 있음').replace(/ · (\d+) unreadable/, ' · $1개는 읽을 수 없음')}`],
];

function translate(s: string): string | null {
  const key = s.trim();
  if (!key || !/[A-Za-z]/.test(key)) return null;
  const hit = KO[key];
  if (hit) return s.replace(key, hit);
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(key);
    if (m) return s.replace(key, fn(...m));
  }
  return null;
}

/** Where the words are yours (or the vocabulary itself): left as written. */
const KEEP = [
  '[data-no-i18n]', 'script', 'md-editor', '.j-folder-name', 'style', '.md-view', '.w-word', '.w-word-sm', '.w-def', '.w-ko', '.w-example',
  '.w-l-word', '.w-l-mean', '.j-list', '.j-tab span:first-child', '.cal-evs', '.cal-day-list .t', '#list .n', '.callout-name',
  '.slice-sub.on', '#dial .block-label', '.news-list', '.news-hot .kw', '.news-hot-rest', '.globe-readout', '.tpl-name', '.now-card .title', '.cal-tt-legend', '.tt-name',
].join(', ');
const ATTRS = ['placeholder', 'aria-label', 'title', 'data-tip', 'data-placeholder'];

function translateText(n: Text): void {
  if (!n.parentElement || n.parentElement.closest(KEEP)) return;
  const next = translate(n.data);
  if (next !== null && next !== n.data) n.data = next;
}
/** Text outside what you wrote; attributes (labels, tooltips) everywhere — even on buttons inside your content. */
function translateNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) return translateText(node as Text);
  if (!(node instanceof Element)) return;
  translateAttrs(node);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n instanceof Element) translateAttrs(n);
    else translateText(n as Text);
  }
}
function translateAttrs(el: Element): void {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const next = translate(v);
    if (next !== null && next !== v) el.setAttribute(a, next);
  }
}

/** Korean dates and times wherever the app formats them for English. */
function koreanDates(): void {
  const swap = (locales: Intl.LocalesArgument) => (typeof locales === 'string' && locales.startsWith('en') ? 'ko-KR' : locales);
  const date = Date.prototype.toLocaleDateString;
  const time = Date.prototype.toLocaleTimeString;
  Date.prototype.toLocaleDateString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return date.call(this, swap(locales), options);
  };
  Date.prototype.toLocaleTimeString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    // 24-hour clock, as the app shows times
    return time.call(this, swap(locales), { hourCycle: 'h23', ...options });
  };
}

/** Call before the pages mount: translates the static page now and everything rendered from then on. */
export function mountI18n(): void {
  if (lang() !== 'ko') return;
  document.documentElement.lang = 'ko';
  koreanDates();
  translateNode(document.body);
  // the tab's title too (the router sets it per page)
  const title = () => {
    const m = /^Haru — (.+)$/.exec(document.title);
    if (m && KO[m[1]!]) document.title = `Haru — ${KO[m[1]!]}`;
  };
  title();
  const head = document.querySelector('title');
  if (head) new MutationObserver(title).observe(head, { childList: true, characterData: true, subtree: true });
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(translateNode);
      else if (r.type === 'characterData') translateNode(r.target);
      else if (r.type === 'attributes' && r.target instanceof Element) translateAttrs(r.target);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
