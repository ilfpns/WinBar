import { icon } from '../ui/icons';
import { renderMarkdown } from '../ui/markdown';

/**
 * "Chat 사용 규칙", pinned in the Archive under the Updates page: how the chat works — calling people (@),
 * commands (/), messages, reactions, drawing, notifications — and how to behave there. Written here (it changes
 * with the app), the same for everyone.
 */
const RULES = `## 부르기 — @
- \`@이름\`: 그 사람을 불러요. 그 사람에게 알림이 가고, 아카이브에도 점이 찍혀요.
- \`@ALL\`: 모두를 불러요. 꼭 필요할 때만 써 주세요.

## 명령어 — /
- 채팅에서 \`/\`는 명령어예요. 쓸 수 있는 명령어가 있으면 \`/\`를 칠 때 메뉴에 나와요.
- 글 꾸미기는 마크다운으로 바로 써요: \`# \` 제목, \`- \` 목록, \`- [ ] \` 할 일, \`> \` 인용, \`**굵게**\`.
- \`/변경요청 내용\` (관리자만): Haru를 이렇게 고쳐 달라는 요청이에요. 요청 목록에 모이고, 확인한 뒤 반영돼요. 반영되면 메시지 아래에 "변경요청 · 반영됨 · 버전"이, 하지 않기로 하면 "보류"와 이유가 보여요.

## 메시지
- Enter로 보내고, Shift+Enter로 줄을 바꿔요.
- 사진은 한 번에 4장까지 올릴 수 있어요. 이모지 버튼으로 이모지를 넣어요.
- 내 메시지는 마우스를 올리면 나오는 x로 지울 수 있어요.

## 반응
- 다른 사람 메시지에 마우스를 올리면 하트와 체크가 나와요. 다시 누르면 취소돼요.
- 휴대폰에서는 메시지를 누르면 나와요.

## 그리기
- 붓 버튼을 누르면 채팅 위에 그릴 수 있어요. 그림은 메시지에 붙어서 같이 스크롤돼요.
- Ctrl+Z로 내 마지막 획을 지우고, Ctrl+Shift+Z로 다시 그려요. 지우개 버튼은 내 그림을 모두 지워요.

## 알림
- 채팅 제목 옆 종 버튼으로 알림을 켜고 꺼요. 다른 페이지를 보고 있으면 오른쪽 아래에 카드가, 다른 창을 보고 있으면 시스템 알림이 떠요.

## 지켜 주세요
- 서로 존중해 주세요. 욕설, 비방, 도배는 하지 않아요.
- 전화번호, 주소, 비밀번호 같은 개인정보나 비밀은 올리지 않아요.
- 채팅과 그림은 초대된 모두가 봐요.`;

/** The pinned item for the list (it sits with the Updates item). */
export function rulesItem(on: boolean, open: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `j-item a-pin-item${on ? ' on' : ''}`;
  b.innerHTML = '<span class="j-i-top"><span class="j-i-title"></span><span class="meta j-i-date">Rules</span></span><span class="a-by meta">Haru</span>';
  b.querySelector('.j-i-title')!.textContent = 'Chat 사용 규칙';
  b.querySelector('.j-i-top')!.prepend(icon('pin', 'ic a-pin-ic'));
  b.addEventListener('click', open);
  return b;
}

/** The page itself. */
export function rulesPage(): HTMLElement[] {
  const head = document.createElement('div');
  head.className = 'j-ed-head';
  const by = document.createElement('span');
  by.className = 'a-by a-by-lg';
  by.append(icon('pin', 'ic a-pin-ic'), '고정됨');
  head.append(by);
  const title = document.createElement('h2');
  title.className = 'a-title';
  title.textContent = 'Chat 사용 규칙';
  const body = document.createElement('div');
  body.className = 'a-pin-body';
  const text = document.createElement('div');
  text.className = 'md-view a-notice';
  // the app's own text, rendered like any page
  text.innerHTML = renderMarkdown(RULES);
  body.append(text);
  return [head, title, body];
}
