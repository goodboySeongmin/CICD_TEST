(function(){
  function getCSRFToken(){ const m=document.cookie.match('(?:^|;\s*)csrftoken=([^;]+)'); return m?decodeURIComponent(m[1]):null; }
  function formatKRW(n){ const v = Math.round(Number(n)||0); return v.toLocaleString('ko-KR'); }

  async function getHistory(userId, limit){
    const res = await fetch('/api/orders/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(getCSRFToken()?{ 'X-CSRFToken': getCSRFToken() }:{}) },
      body: JSON.stringify({ user_id: userId, limit: limit||20 }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.orders)) throw new Error(data.detail || '주문 내역 조회 실패');
    return data.orders;
  }

  function renderHistoryBubble(orders, addMessage){
    if (!orders || orders.length===0){ addMessage('최근 주문 내역이 없습니다.', 'bot'); return; }
    const itemsHtml = orders.map(o => {
      const code = escapeHtml(String(o.order_code));
      const date = escapeHtml(String(o.order_date||''));
      const status = escapeHtml(String(o.order_status||''));
      const total = formatKRW(o.total_price||0);
      return '<div class="border rounded-lg p-2 mb-2">\
        <div class="flex items-center justify-between text-sm">\
          <div class="font-medium">주문 #'+code+'</div>\
          <div class="text-gray-500">'+date+'</div>\
        </div>\
        <div class="text-xs text-gray-600 mt-1">상태: '+status+' · 총액: '+total+'</div>\
        <div class="mt-2 text-right">\
          <button class="order-select-btn px-2 py-1 text-xs border rounded hover:bg-blue-50" data-order="'+code+'">상세 보기</button>\
        </div>\
      </div>';
    }).join('');
    const html = '<div class="order-history-bubble">\
      <div class="mb-2 font-semibold text-gray-800">📦 최근 주문 내역</div>'+itemsHtml+'\
    </div>';
    addMessage(html, 'bot');
  }

  function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

  window.OrdersAPI = { getHistory };
  window.OrderUI = { renderHistoryBubble };
})();
