// hjs 수정: 상품 목록/페이지네이션/정렬 모듈 (ChatProducts)
(function(global){
  'use strict';
  const ChatProducts = {
    updateProductsList(bot, products){
      const section=document.getElementById('productsSection');
      if (products) { bot.productCandidates = products; bot.productPage = 0; bot.productSortBy = 'popular'; }
      if (!bot.productCandidates || bot.productCandidates.length === 0) { section.classList.add('hidden'); return; }
      section.classList.remove('hidden');
      ChatProducts._renderProductPage(bot);
    },
    handleProductSortChange(bot, newSortBy){ bot.productSortBy = newSortBy; bot.productPage = 0; ChatProducts._renderProductPage(bot); },
    _renderProductPage(bot){
      const sortedProducts = bot.sortProducts(bot.productCandidates, bot.productSortBy);
      const sortConfig = bot.createSortSelectBox(bot.productSortBy, function(v){ ChatProducts.handleProductSortChange(bot,v); }, 'productSortSelect');
      bot._renderPaginatedList({
        listElement: document.getElementById('productsList'),
        dataArray: sortedProducts,
        currentPage: bot.productPage,
        itemsPerPage: bot.PRODUCTS_PER_PAGE,
        renderItemCallback: function(product){
          const card = document.createElement('div');
          card.className = 'product-card';
          // hjs 수정: 템플릿 문자열 대신 구형 호환 문자열 결합으로 구성
          var html = ''
            + '<div class="product-info">'
            +   '<h4 class="font-medium text-sm text-gray-800">'+UIHelpers.escapeHtml(product.name)+'</h4>'
            +   '<p class="text-xs text-gray-500 mt-1">'+UIHelpers.escapeHtml(product.origin || '원산지 정보 없음')+'</p>'
            +   '<div class="flex items-center mt-1">'
            +     '<p class="text-green-600 font-bold text-sm">'+UIHelpers.formatPrice(product.price)+'원</p>'
            +     (product.organic ? '<span class="ml-2 px-1 py-0.5 bg-green-100 text-green-700 text-xs rounded">유기농</span>' : '')
            +   '</div>'
            + '</div>'
            + '<button class="add-to-cart bg-green-100 text-green-600 px-3 py-1 rounded text-xs hover:bg-green-200 ml-auto" data-product-name="'+UIHelpers.escapeHtml(product.name)+'">담기</button>';
          card.innerHTML = html;
          card.querySelector('.add-to-cart').addEventListener('click', async function(e){
            e.stopPropagation();
            try {
              if (!bot.cartState || !bot.cartState.items) {
                if (global.ChatCart) await ChatCart.ensureCartLoaded(bot);
              }
              if (!bot.cartState) bot.cartState = { items: [], discounts: [], subtotal: 0, total: 0 };
              if (!Array.isArray(bot.cartState.items)) bot.cartState.items = [];
              var idx = bot.cartState.items.findIndex(function(i){ return i.name === product.name; });
              if (idx >= 0) bot.cartState.items[idx].qty += 1; else bot.cartState.items.push({ name: product.name, qty: 1, unit_price: product.price });
              if (global.ChatCart) ChatCart.optimisticRecalculateAndRedrawCart(bot);
            } catch(_){ }

            try {
              if (typeof bot.showCustomLoading === 'function') bot.showCustomLoading('cart','장바구니에 담는 중입니다...','progress');
              var headers = { 'Content-Type':'application/json' };
              var csrf = getCSRFToken && getCSRFToken(); if (csrf) headers['X-CSRFToken'] = csrf;
              var res = await fetch('/api/cart/bulk-add', {
                method:'POST', headers: headers, credentials:'include',
                body: JSON.stringify({ user_id: bot.userId, products: [{ name: product.name, price: product.price||0, origin: product.origin||'', organic: !!product.organic }] })
              });
              var data = await res.json();
              if (data && data.cart && typeof bot.updateCart === 'function') bot.updateCart(data.cart, true);
              // hjs 수정: 담기 확인 메시지 출력
              try { bot.addMessage(UIHelpers.escapeHtml(product.name)+'을 장바구니에 담았습니다.', 'bot'); } catch(_) {}
            } catch(err){ console.error('add-to-cart error', err); }
            finally { if (typeof bot.hideCustomLoading === 'function') bot.hideCustomLoading(); }
          });
          return card;
        },
        onPageChange: function(p){ bot.productPage=p; ChatProducts._renderProductPage(bot); },
        sortConfig: sortConfig
      });
    }
  };
  global.ChatProducts = ChatProducts;
})(window);
