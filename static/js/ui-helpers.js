// hjs 수정: UI 헬퍼(클램프/포맷/이스케이프 등)
(function(global){
  'use strict';

  function escapeHtml(text){
    const div=document.createElement('div');
    div.textContent=text||'';
    return div.innerHTML;
  }

  function formatPrice(price){
    if (price===null||price===undefined) return '0';
    return new Intl.NumberFormat('ko-KR').format(price);
  }

  // 화면 폭과 유사한 폭에서 라인 수를 계산해 8줄 초과 시 접기 대상 판정
  function needsClamp(html){
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute; left:-9999px; top:-9999px; visibility:hidden; max-width:520px; line-height:1.4; font-size:14px;';
    probe.className = 'bot-text';
    probe.innerHTML = html;
    document.body.appendChild(probe);
    const height = probe.scrollHeight;
    const lineHeight = parseFloat(getComputedStyle(probe).lineHeight) || 20;
    const lines = height / lineHeight;
    document.body.removeChild(probe);
    return lines > 8;
  }

  function applyClamp(el, clamp){
    if (!el) return;
    if (clamp) {
      el.style.display = '-webkit-box';
      el.style.webkitBoxOrient = 'vertical';
      el.style.webkitLineClamp = '8';
      el.style.overflow = 'hidden';
      el.style.maxWidth = '520px';
    } else {
      el.style.display = '';
      el.style.webkitBoxOrient = '';
      el.style.webkitLineClamp = '';
      el.style.overflow = '';
      el.style.maxWidth = '';
    }
  }

  global.UIHelpers = {
    escapeHtml,
    formatPrice,
    needsClamp,
    applyClamp,
  };
})(window);

