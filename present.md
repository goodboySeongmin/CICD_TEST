# Qook 챗봇/마이페이지 개선 요약 (팀 공유용)

## 핵심 변경점
- 장바구니 UX
  - 프론트 낙관적(Optimistic) 업데이트 추가: 수량 +/-/삭제 즉시 반영 → 이후 서버 응답으로 보정
  - 배송비 표시 보정: 표시용 배송비 = `shipping_fee - free_shipping 할인`, 초기 진입 시에도 무료배송 반영
  - 프론트 계산은 화면 응답용으로만 사용하고, 최종 계산은 백엔드 결과로 일치화

- 결제/선택 결제
  - 선택 결제(체크박스) 지원: `/api/cart/checkout-selected { user_id, products[] }`
  - 주문 완료 후 안내 문구가 즉시 말풍선으로 표시되도록 처리

- 저장한 레시피 → 챗봇 연동
  - 레시피 카드의 “재료 추천받기” 버튼 → /chat 브릿지
  - 로컬스토리지 `chat_pending_message_{uid}`에 레시피 정보 저장 → 챗봇 초기화 시 자동 전송

- 마이페이지 실데이터
  - 주문내역: `/api/orders/history`로 목록, “상세 보기” 클릭 시 `/api/orders/details`로 상세(품목/합계/할인/배송비)
  - 배송내역: 상태 필터링 후 카드로 렌더
  - 채팅 히스토리: `/api/orders/chat-history`로 데이터 조회, 날짜별 그룹 + 상세 토글
  - 저장한 레시피: chat에서 즐겨찾기한 레시피를 카드로 렌더 + 바로 “재료 추천받기”

- 인증/로그아웃
  - 세션 쿠키 + 런타임 솔트로 프로세스 재시작/브라우저 종료 시 자동 로그아웃 효과
  - 로그아웃 시 로컬 기록 삭제: `chat_messages_{uid}`, `chat_session_{uid}`, `chat_pending_message_{uid}`

- UI/가독성
  - 봇 답변 마크다운 렌더(코드블록/리스트/링크 등)
  - 채팅 날짜 구분선 추가
  - 네비게이션(/chat, /mypage) 전환 효과 일관화

## 참고 API/엔드포인트
- Cart
  - `POST /api/cart/get`, `POST /api/cart/update`
  - `POST /api/cart/checkout-selected`, `POST /api/cart/remove-selected`
- Orders
  - `POST /api/orders/history`, `POST /api/orders/details`, `POST /api/orders/chat-history`
- Auth
  - `POST /auth/logout`, `POST /auth/logout-beacon`

## 변경된 주요 파일
- 프론트: `static/js/chat_ver2.js`, `static/js/mypage.js`, `static/js/markdown.js`, `static/js/chat.js`
- 템플릿: `templates/chat.html`, `templates/mypage.html`, `templates/landing.html`, `templates/tab-layout.html`, `templates/app-layout.html`
- 백엔드: `nodes/cart_order.py`, `orders_routes.py`, `cart_routes.py`, `auth_routes.py`, `app.py`

## 운영 주의
- 로컬스토리지 기반(대화 복원/레시피 즐겨찾기/브릿지) 요소가 있으므로, 사파리/시크릿 모드 제한에 유의
- 배송비/할인 표시 로직은 프론트·백엔드 모두 동일한 정책을 따르므로 정책 변경 시 양쪽 동시 수정 권장

