// hjs 수정: 공용 유틸 모음 (chat_ver2.js 등에서 사용)
(function(global){
  'use strict';

  // 쿠키/CSRF 유틸
  function getCookie(name) {
    const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m.pop()) : null;
  }
  function setCookie(name, value, days = 365) {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
  }
  function getCSRFToken() { return getCookie('csrftoken'); }

  // user_id 해결 (+ 영속화) — hjs 수정: 서버/쿠키 우선, 로컬 스토리지는 최후순위로 변경
  function resolveUserId() {
    // 1) 서버에서 템플릿 메타로 주입된 현재 사용자 (가장 신뢰)
    if (global.CURRENT_USER_ID && String(global.CURRENT_USER_ID).trim()) {
      return String(global.CURRENT_USER_ID).trim();
    }
    // 2) 서버 쿠키(user_id)
    const c = getCookie('user_id');
    if (c) return c;
    // 3) 로컬 스토리지(이전 로그인 정보), 이메일로 유추는 최후 보조
    try {
      const raw = localStorage.getItem('user_info');
      if (raw) {
        const u = JSON.parse(raw);
        if (u?.user_id) return u.user_id;
        if (u?.id) return u.id;
        if (u?.uid) return u.uid;
        if (u?.email) return `user_${u.email}`;
      }
    } catch (_) {}
    // 4) 게스트 발급
    const guest = 'guest_' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem('user_info', JSON.stringify({ user_id: guest })); } catch (_) {}
    setCookie('user_id', guest, 365);
    return guest;
  }

  // SpeechRecognition 지원 체크
  function getSpeechRecognitionCtor() {
    return global.SpeechRecognition || global.webkitSpeechRecognition || null;
  }

  // HTML 여부 탐지(텍스트/HTML 구분)
  function isLikelyHtml(str = "") {
    return /<\/?[a-z][\s\S]*>/i.test(String(str).trim());
  }

  // 내보내기
  global.getCookie = getCookie;       // hjs 수정
  global.setCookie = setCookie;       // hjs 수정
  global.getCSRFToken = getCSRFToken; // hjs 수정
  global.resolveUserId = resolveUserId; // hjs 수정
  global.getSpeechRecognitionCtor = getSpeechRecognitionCtor; // hjs 수정
  global.isLikelyHtml = isLikelyHtml; // hjs 수정
})(window);
