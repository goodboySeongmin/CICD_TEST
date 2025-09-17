// hjs 수정: CS/주문 상세/증빙 업로드 모듈 (ChatCS)
(function(global){
  'use strict';
  const ChatCS = {

    // 상담사 연결 대기시간 메시지 생성 추가
    createWaitingMessage(){
      const count = Math.floor(Math.random() * 15);
      const min = count * 3;
      return `현재 고객님 앞에는 ${count}명이 대기 중입니다. 예상 대기 시간은 약 ${min}분입니다. 잠시만 기다려 주세요.`;
    },
    
    updateCS(bot, cs){
      if (!cs || !Array.isArray(cs.orders) || cs.orders.length === 0) return;
      const isDelivery = !!cs.always_show || cs.category === '배송' || cs.list_type === 'delivery';
      bot.isCurrentlyDeliveryInquiry = isDelivery;
      const key = cs.orders.map(o => String(o.order_code)).join(',');
      if (!isDelivery) {
        if (bot.lastOrdersKey === key) return;
        bot.lastOrdersKey = key;
      }
      const messages = document.getElementById('messages');
      const wrap = document.createElement('div');
      wrap.className = 'mb-4 message-animation';
      const hint = UIHelpers.escapeHtml(cs.message || '최근 주문을 선택해주세요.');
      const shown = cs.orders.slice(0,3);
      const hidden = cs.orders.slice(3);
      const itemsHtml = shown.map(function(o){
        const date = UIHelpers.escapeHtml(o.order_date || '');
        const price = Number(o.total_price || 0).toLocaleString();
        const code = UIHelpers.escapeHtml(String(o.order_code));
        const status = UIHelpers.escapeHtml(o.order_status || '');
        return (
          '<button class="order-select-btn px-3 py-2 rounded-lg border hover:bg-blue-50 w-full text-left" data-order="'+code+'">\
            <div class="flex items-center justify-between">\
              <div class="font-medium">주문 #'+code+'</div>\
              <div class="text-sm text-gray-500">'+date+' · '+price+'원</div>\
            </div>\
            <div class="text-xs text-gray-500 mt-1">상태: '+status+'</div>\
          </button>'
        );
      }).join('');
      wrap.innerHTML = (
        '<div class="flex items-start">\
          <div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mr-3 flex-shrink-0">\
            <i class="fas fa-robot text-green-600 text-sm"></i>\
          </div>\
          <div class="message-bubble-bot">\
            <div class="mb-2">'+hint+'</div>\
            <div class="grid grid-cols-1 gap-2">'+itemsHtml+'</div>\
            '+(hidden.length>0?('<div class="mt-2 text-right"><button class="show-more-orders-btn text-xs px-3 py-1 border rounded" data-orders="'+encodeURIComponent(JSON.stringify(hidden))+'">더보기</button></div>'):'')+'\
          </div>\
        </div>'
      );
      messages.appendChild(wrap);
      if (bot.scrollToBottom) bot.scrollToBottom();
    },
    // hjs 수정: 더보기 버튼 처리 — 나머지 주문을 펼쳐서 보여줌
    handleShowMoreOrders(bot, e){
      const btn = e.target.closest('.show-more-orders-btn');
      if (!btn) return;
      try{
        const encoded = btn.getAttribute('data-orders')||'';
        const rest = JSON.parse(decodeURIComponent(encoded));
        const grid = btn.closest('.message-bubble-bot')?.querySelector('.grid');
        if (!grid || !Array.isArray(rest)) return;
        const html = rest.map(function(o){
          const date = UIHelpers.escapeHtml(o.order_date || '');
          const price = Number(o.total_price || 0).toLocaleString();
          const code = UIHelpers.escapeHtml(String(o.order_code));
          const status = UIHelpers.escapeHtml(o.order_status || '');
          return (
            '<button class="order-select-btn px-3 py-2 rounded-lg border hover:bg-blue-50 w-full text-left" data-order="'+code+'">\
              <div class="flex items-center justify-between">\
                <div class="font-medium">주문 #'+code+'</div>\
                <div class="text-sm text-gray-500">'+date+' · '+price+'원</div>\
              </div>\
              <div class="text-xs text-gray-500 mt-1">상태: '+status+'</div>\
            </button>'
          );
        }).join('');
        grid.insertAdjacentHTML('beforeend', html);
        btn.remove();
        if (bot.scrollToBottom) bot.scrollToBottom();
      }catch(err){ console.error('show more orders error', err); }
    },
    handleOrderSelectClick(bot, e){
      // hjs 수정: 주문 선택 시 상세 조회 호출
      const btn = e.target.closest('.order-select-btn');
      if (!btn) return;
      const orderCode = btn.dataset.order;
      if (!orderCode) return;
      if (typeof bot.fetchAndShowOrderDetails === 'function') bot.fetchAndShowOrderDetails(orderCode);
    },
    async handleOrderItemClick(bot, e){
      // hjs 수정: 행 클릭 시 증빙 업로드 시작 (배송문의 제외)
      if (e.target.closest('.evidence-upload-btn')) return;
      const row = e.target.closest('tr.order-item-row');
      if (!row) return;
      const bubble = row.closest('.order-details-bubble');
      if (!bubble) return;
      if (bot.isCurrentlyDeliveryInquiry) return; // 배송문의면 비활성

      const product = row.dataset.product || '';
      const orderCode = bubble.dataset.orderCode || '';
      if (!product || !orderCode) return;

      if (typeof bot.ensureEvidenceInput === 'function') bot.ensureEvidenceInput();
      bot.pendingEvidence = { orderCode, product, quantity: 1 };
      if (typeof bot.showCustomLoading === 'function') bot.showCustomLoading('cs', `'${product}' 사진을 업로드해주세요`, 'dots');
      if (bot.evidenceInput) bot.evidenceInput.click();
    },
    handleEvidenceUploadButtonClick(bot, e){
      // hjs 수정: 증빙 버튼 클릭 시 수량 입력 후 업로드 시작
      const btn = e.target.closest('.evidence-upload-btn');
      if (!btn) return;
      const row = btn.closest('tr.order-item-row');
      const maxQty = row ? parseInt(row.dataset.qty || '1', 10) : 1;
      const orderCode = btn.dataset.order;
      const product = btn.dataset.product;
      if (!orderCode || !product) return;
      let qty = 1;
      if (maxQty > 1) {
        const ans = prompt(`환불 요청 수량을 입력해주세요 (1 ~ ${maxQty})`, '1');
        const n = parseInt(ans || '1', 10);
        qty = isNaN(n) ? 1 : Math.min(Math.max(1, n), maxQty);
      }
      if (typeof bot.ensureEvidenceInput === 'function') bot.ensureEvidenceInput();
      bot.pendingEvidence = { orderCode, product, quantity: qty };
      if (typeof bot.showCustomLoading === 'function') bot.showCustomLoading('cs', `'${product}' 사진을 업로드해주세요`, 'dots');
      if (bot.evidenceInput) bot.evidenceInput.click();
      if (typeof bot._fileDialogClosedCheck === 'function') setTimeout(() => bot._fileDialogClosedCheck(), 700);
    },
    // hjs 수정: 주문 상세 말풍선 렌더를 모듈로 이관
    renderOrderDetailsBubble(bot, data){
      const code = UIHelpers.escapeHtml(String(data.order_code || ''));
      const date = UIHelpers.escapeHtml(data.order_date || '');
      const status = UIHelpers.escapeHtml(data.order_status || '');
      const isDelivery = data.isDeliveryInquiry || data.allow_evidence === false || data.category === '배송' || data.list_type === 'delivery';
      const rows = (data.items || []).map(function(it, idx){
        const rawName = it.product || it.name || '';
        const name = UIHelpers.escapeHtml(rawName);
        const qty = Number(it.quantity || it.qty || 0);
        // hjs 수정: order_detail.price는 라인 합계 → 단가는 (라인/수량)
        const lineTotal = Number(it.price || it.unit_price || 0);
        const unitPrice = qty > 0 ? (lineTotal / qty) : lineTotal;
        const price = unitPrice;
        const line = lineTotal;
        const evidenceCell = isDelivery ? '' : (
          '<td class="py-1 text-center">\
            <button class="evidence-upload-btn px-2 py-1 text-xs border rounded hover:bg-blue-50" data-order="'+code+'" data-product="'+name+'">\
              <i class="fas fa-camera mr-1"></i>사진 업로드\
            </button>\
          </td>'
        );
        return (
          '<tr class="border-b order-item-row" data-product="'+name+'" data-qty="'+qty+'">\
            <td class="py-1 pr-3 text-gray-800">'+(idx+1)+'.</td>\
            <td class="py-1 pr-3 text-gray-800">'+name+'</td>\
            <td class="py-1 pr-3 text-right">'+UIHelpers.formatPrice(price)+'원</td>\
            <td class="py-1 pr-3 text-right">'+qty+'</td>\
            <td class="py-1 text-right font-medium">'+UIHelpers.formatPrice(line)+'원</td>\
            '+evidenceCell+'\
          </tr>'
        );
      }).join('');
      const subtotal = Number(data.subtotal || data.total_price || 0);
      const total    = Number(data.total || subtotal);
      const discount = Math.max(0, Number(data.discount || data.discount_amount || 0));
      const shipping = Math.max(0, Number(data.shipping_fee || 0));
      const evidenceHeader = isDelivery ? '' : '<th class="text-center">증빙</th>';
      const evidenceNotice = isDelivery ? '' : '<div class="mt-2 text-xs text-gray-500">* 환불/교환하려는 상품의 <b>사진 업로드</b> 버튼을 눌러 증빙 이미지를 올려주세요.</div>';
      const html = (
        '<div class="order-details-bubble" data-order-code="'+code+'">\
          <div class="mb-2 font-semibold text-gray-800">주문 #'+code+'</div>\
          <div class="text-xs text-gray-500 mb-2">'+date+(status?(' · 상태: '+status):'')+'</div>\
          <div class="rounded-lg border overflow-hidden">\
            <table class="w-full text-sm">\
              <thead class="bg-gray-50">\
                <tr>\
                  <th class="text-left py-2 pl-3">#</th>\
                  <th class="text-left">상품명</th>\
                  <th class="text-right">단가</th>\
                  <th class="text-right">수량</th>\
                  <th class="text-right">금액</th>\
                  '+evidenceHeader+'\
                </tr>\
              </thead>\
              <tbody>'+rows+'</tbody>\
            </table>\
          </div>\
          '+evidenceNotice+'\
          <div class="mt-2 text-sm">\
            <div class="flex justify-between"><span class="text-gray-600">상품 합계</span><span class="font-medium">'+UIHelpers.formatPrice(subtotal)+'원</span></div>\
            '+(discount>0?('<div class="flex justify-between"><span class="text-gray-600">할인</span><span class="font-medium">- '+UIHelpers.formatPrice(discount)+'원</span></div>'):'')+'\
            <div class="flex justify-between"><span class="text-gray-600">배송비</span><span class="font-medium">'+UIHelpers.formatPrice(shipping)+'원</span></div>\
            <div class="flex justify-between mt-1"><span class="font-semibold">총 결제금액</span><span class="font-bold text-blue-600">'+UIHelpers.formatPrice(total)+'원</span></div>\
          </div>\
        </div>'
      );
      bot.addMessage(html, 'bot');
    }
  };
  global.ChatCS = ChatCS;
})(window);
