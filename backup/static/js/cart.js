(function(){
  function setup(bot){
    bot.recalculateAndRedrawCart = function(){
      if (!bot.cartState) return;
      const items = bot.cartState.items || [];
      // 낙관적(optimistic) 로컬 계산: 서버 메타(멤버십) 기반으로 즉시 합계 계산
      const subtotal = items.reduce((acc, it) => acc + (parseFloat(it.unit_price)||0) * (parseInt(it.qty,10)||0), 0);
      const mem = bot.cartState.membership || {};
      const rate = Number(mem.discount_rate ?? 0) || 0;
      const thr  = Number(mem.free_shipping_threshold ?? 30000) || 30000;
      const shipping = 3000;
      const discounts = [];
      if (rate > 0) discounts.push({ type:'membership_discount', amount: Math.round(subtotal * rate), description:`멤버십 ${Math.round(rate*100)}% 할인` });
      if (subtotal >= thr) discounts.push({ type:'free_shipping', amount: 3000, description:'무료배송' });
      const totalDiscount = discounts.reduce((s,d)=> s + (Number(d.amount)||0), 0);
      // 로컬 상태 갱신 후 즉시 렌더
      bot.cartState.subtotal = subtotal;
      bot.cartState.shipping_fee = shipping;
      bot.cartState.discounts = discounts;
      bot.cartState.total = Math.max(0, subtotal + shipping - totalDiscount);
      bot.updateCart(bot.cartState, false);
    };

    bot.handleCartUpdate = function(productName, action){
      if (!bot.cartState || !bot.cartState.items) return;
      const idx = bot.cartState.items.findIndex(i => i.name === productName);
      if (idx === -1) return;
      switch(action){
        case 'increment': bot.cartState.items[idx].qty += 1; break;
        case 'decrement': bot.cartState.items[idx].qty -= 1; break;
        case 'remove': bot.cartState.items[idx].qty = 0; break;
      }
      const finalQty = bot.cartState.items[idx]?.qty ?? 0;
      if (finalQty <= 0) bot.cartState.items.splice(idx, 1);
      bot.recalculateAndRedrawCart();
      clearTimeout(bot.debounceTimer);
      bot.pendingCartUpdate[productName] = Math.max(finalQty, 0);
      bot.debounceTimer = setTimeout(() => bot.syncPendingCartUpdates(), 5000);
    };
  }

  window.CartModule = { setup };
})();
