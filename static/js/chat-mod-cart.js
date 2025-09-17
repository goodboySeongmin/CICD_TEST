// hjs 수정: 장바구니/결제 관련 메서드 분리 (ChatCart)
(function(global){
  'use strict';
  const ChatCart = {
    async initializeCart(bot){
      try {
        const url = new URL('/api/cart/get', window.location.origin);
        url.searchParams.set('t', Date.now().toString());
        url.searchParams.set('user_id', bot.userId);
        let res = await fetch(url.toString(), { method: 'GET', headers: { 'Accept':'application/json' }, credentials: 'include' });
        if (!res.ok && res.status !== 200) {
          res = await fetch('/api/cart/get', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', ...(getCSRFToken() ? { 'X-CSRFToken': getCSRFToken() } : {}) },
            body: JSON.stringify({ user_id: bot.userId }),
            credentials: 'include'
          });
        }
        if (res.ok) {
          const data = await res.json();
          if (data && data.cart) { bot.updateCart(data.cart, true); return; }
        }
      } catch (err) { console.error('Cart initialization error:', err); }
      bot.updateCart(null, true);
    },
    async ensureCartLoaded(bot){
      if (bot.cartState && Array.isArray(bot.cartState.items)) return true;
      try {
        const res = await fetch('/api/cart/get', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', ...(getCSRFToken() ? { 'X-CSRFToken': getCSRFToken() } : {}) },
          body: JSON.stringify({ user_id: bot.userId }),
          credentials: 'include'
        });
        const data = await res.json();
        if (data?.cart) { bot.updateCart(data.cart, true); return true; }
      } catch (e) { console.error('ensureCartLoaded error:', e); }
      return false;
    },
    recalculateAndRedrawCart(bot){
      // hjs 수정: 프론트 계산 제거, 서버 응답으로만 정합성 유지
      ChatCart.syncPendingCartUpdates(bot);
    },
    // hjs 수정: 장바구니 즉시 동기화(체크아웃 전 강제 적용)
    async flushCartToServer(bot){
      try{
        // 보류 중 업데이트를 합치고, 현재 화면 수량을 기준으로 서버에 강제 반영
        const map = Object.assign({}, bot.pendingCartUpdate);
        (Array.isArray(bot.cartState?.items)?bot.cartState.items:[]).forEach(it=>{ map[it.name] = parseInt(it.qty||0,10); });
        bot.pendingCartUpdate = {}; // 초기화
        const headers = { 'Content-Type':'application/json', ...(getCSRFToken()?{'X-CSRFToken':getCSRFToken()}:{}), };
        const promises = Object.entries(map).map(([productName, quantity])=>
          fetch('/api/cart/update', {
            method:'POST', headers, credentials:'include',
            body: JSON.stringify({ user_id: bot.userId, product_name: productName, quantity: Math.max(0, parseInt(quantity||0,10)) })
          }).then(r=>r.json()).then(d=>{ if (d?.cart) bot.updateCart(d.cart, true); })
        );
        await Promise.all(promises);
      }catch(e){ console.error('flushCartToServer error', e); }
    },
    optimisticRecalculateAndRedrawCart(bot){
      // hjs 수정: 프론트에서도 즉시 금액 갱신(낙관적) 후 서버 응답으로 정합성 보정
      if (!bot.cartState) return;
      try {
        const items = Array.isArray(bot.cartState.items) ? bot.cartState.items : [];
        const subtotal = items.reduce((acc, it) => acc + (parseFloat(it.unit_price||0) * parseInt(it.qty||0, 10)), 0);
        const m = (bot.cartState.membership || {});
        const rate = Number((m.discount_rate != null ? m.discount_rate : (m.meta && m.meta.discount_rate)) || 0);
        const freeThr = Number((m.free_shipping_threshold != null ? m.free_shipping_threshold : (m.meta && m.meta.free_shipping_threshold)) || 30000);

        // hjs 수정: 백엔드(_calculate_totals)와 동일한 규칙으로 계산
        const membershipDiscount = Math.floor(subtotal * rate);
        const effectiveSubtotal = subtotal - membershipDiscount;
        const BASE_SHIPPING = 3000;

        bot.cartState.subtotal = subtotal;
        bot.cartState.shipping_fee = BASE_SHIPPING; // 기본 3000 고정
        bot.cartState.discounts = [];
        if (membershipDiscount > 0) {
          bot.cartState.discounts.push({ type: 'membership_discount', amount: membershipDiscount, description: '멤버십 할인' });
        }
        if (effectiveSubtotal >= freeThr) {
          // 무료배송은 할인으로 3000을 추가하고, shipping_fee는 3000 유지 → 표시 시 0원 처리
          bot.cartState.discounts.push({ type: 'free_shipping', amount: BASE_SHIPPING, description: '무료배송' });
        }
        const totalDiscount = (bot.cartState.discounts||[]).reduce((a,b)=>a+(b.amount||0),0);
        bot.cartState.total = Math.max(0, subtotal + BASE_SHIPPING - totalDiscount);
      } catch(_) {}
      bot.updateCart(bot.cartState, false);
    },
    handleCartUpdate(bot, productName, action){
      if (!bot.cartState || !bot.cartState.items) return;
      const idx = bot.cartState.items.findIndex(i => i.name === productName);
      if (idx === -1) return;
      switch (action) {
        case 'increment': bot.cartState.items[idx].qty += 1; break;
        case 'decrement': bot.cartState.items[idx].qty -= 1; break;
        case 'remove':    bot.cartState.items[idx].qty  = 0; break;
      }
      const finalQty = bot.cartState.items[idx]?.qty ?? 0;
      if (finalQty <= 0) bot.cartState.items.splice(idx, 1);
      // hjs 수정: bot 메서드 의존 제거
      ChatCart.optimisticRecalculateAndRedrawCart(bot);
      clearTimeout(bot.debounceTimer);
      bot.pendingCartUpdate[productName] = Math.max(finalQty, 0);
      bot.debounceTimer = setTimeout(() => ChatCart.syncPendingCartUpdates(bot), 5000);
    },
    syncPendingCartUpdates(bot){
      const updates = bot.pendingCartUpdate; bot.pendingCartUpdate = {};
      if (Object.keys(updates).length === 0) return;
      for (const productName in updates) {
        const quantity = updates[productName];
        fetch('/api/cart/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(getCSRFToken() ? { 'X-CSRFToken': getCSRFToken() } : {}) },
          body: JSON.stringify({ user_id: bot.userId, product_name: productName, quantity }),
          credentials: 'include'
        })
        .then(r => r.json())
        .then(data => { if (!data.error) bot.updateCart(data.cart, true); })
        .catch(err => console.error('Cart sync fetch error:', err));
      }
    },
    updateCart(bot, cart, saveState=true){
      // hjs 수정: 렌더링은 ChatBot.updateCart를 단일 소스로 사용
      return bot.updateCart(cart, saveState);
      if (saveState && cart) {
        if (cart.items) { cart.items.forEach(item=>{ item.qty=parseInt(item.qty,10); item.unit_price=parseFloat(item.unit_price); }); }
        bot.cartState=JSON.parse(JSON.stringify(cart));
      }
      const currentCart=bot.cartState;
      const section=document.getElementById('cartSection');
      const list=document.getElementById('cartItems');
      const countBadge=document.getElementById('cartCount');
      const subtotalEl=document.getElementById('subtotalAmount');
      const discountEl=document.getElementById('discountAmount');
      const totalEl=document.getElementById('totalAmount');
      const shippingFeeEl=document.getElementById('shippingFee');
      const checkoutButton=document.getElementById('checkoutButton');

      if (!currentCart||!currentCart.items||currentCart.items.length===0){
        section.classList.remove('hidden'); list.innerHTML=`<div class="cart-empty p-4 text-center text-gray-500">장바구니가 비어있습니다.</div>`;
        countBadge.textContent='0'; subtotalEl.textContent='0원'; discountEl.textContent='- 0원'; totalEl.textContent='0원'; checkoutButton.classList.add('hidden'); return;
      }

      section.classList.remove('hidden'); countBadge.textContent=currentCart.items.length; list.innerHTML='';
      currentCart.items.forEach(item=>{
        const itemDiv=document.createElement('div');
        itemDiv.className='cart-item flex items-center justify-between bg-white rounded p-2 text-sm';
        itemDiv.innerHTML=`
          <div class="flex items-center flex-1 mr-2">
            <input type="checkbox" class="cart-select mr-2" data-product-name="${UIHelpers.escapeHtml(item.name)}" />
            <div>
              <span class="font-medium">${UIHelpers.escapeHtml(item.name)}</span>
              <div class="text-xs text-gray-500">${UIHelpers.formatPrice(item.unit_price)}원</div>
            </div>
          </div>
          <div class="quantity-controls flex items-center">
            <button class="quantity-btn minus-btn" data-product-name="${UIHelpers.escapeHtml(item.name)}">-</button>
            <span class="quantity-display">${item.qty}</span>
            <button class="quantity-btn plus-btn" data-product-name="${UIHelpers.escapeHtml(item.name)}">+</button>
          </div>
          <button class="remove-item ml-2" data-product-name="${UIHelpers.escapeHtml(item.name)}">
            <i class="fas fa-times"></i>
          </button>`;
        list.appendChild(itemDiv);
      });

      subtotalEl.textContent=UIHelpers.formatPrice(currentCart.subtotal)+'원';
      const discountAmount=(currentCart.discounts||[]).reduce((acc,d)=>acc+d.amount,0);
      discountEl.textContent=`- ${UIHelpers.formatPrice(discountAmount)}원`;
      const freeShipDiscount = (currentCart.discounts||[]).filter(d=>d.type==='free_shipping').reduce((a,b)=>a+(b.amount||0),0);
      const displayShipping = Math.max(0, (currentCart.shipping_fee||0) - freeShipDiscount);
      if (shippingFeeEl) shippingFeeEl.textContent=UIHelpers.formatPrice(displayShipping)+'원';
      totalEl.textContent=UIHelpers.formatPrice(currentCart.total)+'원';
      checkoutButton.classList.remove('hidden');
    },
    async handleCheckout(bot){
      if (!bot.cartState||!bot.cartState.items||bot.cartState.items.length===0){ alert('장바구니가 비어있습니다.'); return; }
      // hjs 수정: 체크아웃 전에 반드시 서버 수량과 동기화(낙관 갱신 → 서버 반영)
      try{ clearTimeout(bot.debounceTimer); await ChatCart.flushCartToServer(bot); }catch(_){ }
      const selected = ChatCart.getSelectedCartProducts(bot);
      if (selected.length > 0){
        bot.showCustomLoading('cart','선택한 상품만 결제 중입니다...','progress');
        try {
          const res = await fetch('/api/cart/checkout-selected', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', ...(getCSRFToken() ? { 'X-CSRFToken': getCSRFToken() } : {}) },
            body: JSON.stringify({ user_id: bot.userId, products: selected }),
            credentials: 'include'
          });
          const data = await res.json();
          if (data?.cart) bot.updateCart(data.cart, true);
          if (data && data.order && (data.order.status === 'confirmed' || data.order.order_id)) {
            if (!data.cart || (data.cart.items && data.cart.items.length > 0)) { await ChatCart.initializeCart(bot); }
          }
          if (data?.meta?.final_message) bot.addMessage(data.meta.final_message, 'bot');
          else if (data?.order?.order_id) bot.addMessage(`주문이 완료되었습니다. 주문번호: ${data.order.order_id}`, 'bot');
        } catch (e) { console.error(e); bot.addMessage('선택 결제 중 오류가 발생했습니다.', 'bot', true);
        } finally { bot.hideCustomLoading(); }
        return;
      }
      const message=`장바구니에 있는 상품들로 주문 진행하고 싶어요`;
      bot.addMessage(message,'user'); bot.sendMessage(message, false);
    },
    getSelectedCartProducts(bot){
      const nodes = Array.from(document.querySelectorAll('.cart-select:checked'));
      return nodes.map(n => n.dataset.productName).filter(Boolean);
    },
    async handleRemoveSelected(bot){
      const products = ChatCart.getSelectedCartProducts(bot);
      if (!products.length){ alert('제거할 상품을 선택하세요.'); return; }
      bot.showCustomLoading('cart', '선택한 상품을 장바구니에서 제거 중입니다...', 'dots');
      try {
        const res = await fetch('/api/cart/remove-selected', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', ...(getCSRFToken() ? { 'X-CSRFToken': getCSRFToken() } : {}) },
          body: JSON.stringify({ user_id: bot.userId, products }),
          credentials: 'include'
        });
        const data = await res.json();
        if (data?.cart) bot.updateCart(data.cart, true);
        if (data?.meta?.cart_message) bot.addMessage(data.meta.cart_message, 'bot');
      } catch (err) { console.error(err); bot.addMessage('선택 제거 중 오류가 발생했습니다.', 'bot', true);
      } finally { bot.hideCustomLoading(); }
    },
    async showCartInChat(bot){
      bot.addMessage('장바구니 보여주세요','user');
      if (!bot.cartState||!bot.cartState.items){ await ChatCart.ensureCartLoaded(bot); }
      if (!bot.cartState||!bot.cartState.items||bot.cartState.items.length===0){ bot.addMessage('현재 장바구니가 비어있습니다.','bot'); return; }
      let cartMessage='🛒 현재 장바구니 내용:\n\n';
      bot.cartState.items.forEach((item,i)=>{
        cartMessage+=`${i+1}. ${item.name}\n`;
        cartMessage+=`   수량: ${item.qty}\n`;
        cartMessage+=`   가격: ${UIHelpers.formatPrice(item.unit_price)}원\n`;
        cartMessage+=`   소계: ${UIHelpers.formatPrice(item.unit_price*item.qty)}원\n\n`;
      });
      const discountAmount=(bot.cartState.discounts||[]).reduce((acc,d)=>acc+d.amount,0);
      cartMessage+=`💰 총 상품금액: ${UIHelpers.formatPrice(bot.cartState.subtotal)}원\n`;
      if (discountAmount>0) cartMessage+=`💸 할인금액: -${UIHelpers.formatPrice(discountAmount)}원\n`;
      cartMessage+=`💳 최종 결제금액: ${UIHelpers.formatPrice(bot.cartState.total)}원`;
      bot.addMessage(cartMessage,'bot');
    }
  };

  global.ChatCart = ChatCart;
})(window);
