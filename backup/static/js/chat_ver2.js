/**
 * 챗봇 클라이언트 JavaScript (장바구니 · 이미지 업로드 · 음성녹음/취소 토글 + 페이지네이션 + 정렬)
 */

/* ===== 쿠키/CSRF 유틸 ===== */
function getCookie(name) {
  const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return m ? decodeURIComponent(m.pop()) : null;
}
function setCookie(name, value, days = 365) {
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}
function getCSRFToken() { return getCookie('csrftoken'); }

/* ===== user_id 해결 (+ 영속화) ===== */
function resolveUserId() {
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
  if (window.CURRENT_USER_ID && String(window.CURRENT_USER_ID).trim()) {
    return String(window.CURRENT_USER_ID).trim();
  }
  const c = getCookie('user_id'); if (c) return c;
  const guest = 'guest_' + Math.random().toString(36).slice(2, 10);
  try { localStorage.setItem('user_info', JSON.stringify({ user_id: guest })); } catch (_) {}
  setCookie('user_id', guest, 365);
  return guest;
}

/* ===== SpeechRecognition 지원 체크 ===== */
function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/* ====== HTML 여부 탐지(텍스트/HTML 구분) ====== */
function isLikelyHtml(str = "") {
  return /<\/?[a-z][\s\S]*>/i.test(String(str).trim());
}

class ChatBot {
  constructor() {
    this.sessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
    this.userId = resolveUserId();
    this.cartState = null;

    // ✅ 통합 페이징 상태 변수들 추가
    this.productCandidates = [];
    this.productPage = 0;
    this.PRODUCTS_PER_PAGE = 5;
    
    this.ingredientCandidates = [];
    this.ingredientPage = 0;
    this.INGREDIENTS_PER_PAGE = 5;

    // ✅ 정렬 상태 추가
    this.productSortBy = 'popular'; // 'popular', 'price_low', 'price_high', 'name'
    this.ingredientSortBy = 'popular'; // 'popular', 'price_low', 'price_high', 'name'

    this.debounceTimer = null;
    this.pendingCartUpdate = {};

    // 음성 관련 상태
    this.isRecording = false;
    this.canceled = false;
    this.recognition = null;   // Web Speech
    this.mediaRecorder = null; // MediaRecorder
    this.mediaStream = null;
    this.audioChunks = [];
    this.lastTranscript = '';

    // 증빙 업로드 상태
    this.pendingEvidence = null;        // { orderCode, product }
    this.evidenceInput = null;          // <input type="file">
    this.lastOrdersKey = null; // 주문 선택 UI 중복 방지
    
    // 배송문의 상태 추적
    this.isCurrentlyDeliveryInquiry = false;

    this.init();
  }

  init() {
    this.bindEvents();
    this.updateSessionInfo();
    this.initializeCart();
  }

  bindEvents() {
    document.getElementById('chatForm')
      .addEventListener('submit', (e) => { e.preventDefault(); this.sendMessage(); });

    document.getElementById('messageInput')
      .addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
      });

    document.querySelectorAll('.quick-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const message = btn.dataset.message;
        if (message === '장바구니 보여주세요') { this.showCartInChat(); return; }
        this.addMessage(message, 'user');
        document.getElementById('messageInput').value = message;
        this.sendMessage(message);
      });
    });

    document.getElementById('clearChat').addEventListener('click', () => this.clearChat());

    // 장바구니 버튼
    document.getElementById('cartItems').addEventListener('click', (e) => {
      const button = e.target.closest('button'); if (!button) return;
      const productName = button.dataset.productName;
      let action;
      if (button.classList.contains('plus-btn')) action = 'increment';
      else if (button.classList.contains('minus-btn')) action = 'decrement';
      else if (button.classList.contains('remove-item')) action = 'remove';
      if (action) this.handleCartUpdate(productName, action);
    });

    document.getElementById('checkoutButton').addEventListener('click', () => this.handleCheckout());

    // 마이크, 취소
    const micBtn = document.getElementById('voiceInput');
    const cancelBtn = document.getElementById('voiceCancel');
    if (micBtn) micBtn.addEventListener('click', () => this.toggleVoiceRecording());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.cancelVoiceRecording());

    // 주문 선택 버튼(동적) 클릭 위임
    document.addEventListener('click', (e) => this.handleOrderSelectClick(e));

    // 주문 상세의 "상품 행 클릭" 및 "증빙 업로드 버튼" 클릭
    document.addEventListener('click', (e) => this.handleOrderItemClick(e));
    document.addEventListener('click', (e) => this.handleEvidenceUploadButtonClick(e));

    // 긴 메시지 더보기/접기 토글
    document.addEventListener('click', (e) => this.handleClampToggle(e));
  }

  // ✅ 정렬 함수들 추가
  sortProducts(products, sortBy) {
    if (!products || products.length === 0) return products;
    
    const sortedProducts = [...products];
    
    switch (sortBy) {
      case 'price_low':
        return sortedProducts.sort((a, b) => (a.price || 0) - (b.price || 0));
      case 'price_high':
        return sortedProducts.sort((a, b) => (b.price || 0) - (a.price || 0));
      case 'name':
        return sortedProducts.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
      case 'popular':
      default:
        // 인기순은 원래 순서 유지 (서버에서 인기순으로 온다고 가정)
        return sortedProducts;
    }
  }

  sortIngredients(ingredients, sortBy) {
    if (!ingredients || ingredients.length === 0) return ingredients;
    
    const sortedIngredients = [...ingredients];
    
    switch (sortBy) {
      case 'price_low':
        return sortedIngredients.sort((a, b) => (a.price || 0) - (b.price || 0));
      case 'price_high':
        return sortedIngredients.sort((a, b) => (b.price || 0) - (a.price || 0));
      case 'name':
        return sortedIngredients.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
      case 'popular':
      default:
        return sortedIngredients;
    }
  }

  // ✅ 정렬 옵션 변경 핸들러
  handleProductSortChange(newSortBy) {
    this.productSortBy = newSortBy;
    this.productPage = 0; // 정렬이 바뀌면 첫 페이지로
    this._renderProductPage();
  }

  handleIngredientSortChange(newSortBy) {
    this.ingredientSortBy = newSortBy;
    this.ingredientPage = 0; // 정렬이 바뀌면 첫 페이지로
    this._renderIngredientsPage();
  }

  // ✅ 정렬 셀렉트박스 생성 함수
  createSortSelectBox(currentSortBy, onChangeCallback, elementId) {
    const sortOptions = [
      { value: 'popular', label: '인기순' },
      { value: 'price_low', label: '가격 낮은순' },
      { value: 'price_high', label: '가격 높은순' },
    ];

    const selectHtml = `
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm font-medium text-gray-700">정렬 기준</span>
        <select id="${elementId}" class="sort-select text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:border-green-500 focus:outline-none">
          ${sortOptions.map(option => 
            `<option value="${option.value}" ${currentSortBy === option.value ? 'selected' : ''}>${option.label}</option>`
          ).join('')}
        </select>
      </div>`;

    return { html: selectHtml, bindEvent: (container) => {
      const selectElement = container.querySelector(`#${elementId}`);
      if (selectElement) {
        selectElement.addEventListener('change', (e) => {
          onChangeCallback(e.target.value);
        });
      }
    }};
  }

  // ✅ 통합 페이징 렌더링 시스템
  _renderPaginatedList(config) {
    const { 
      listElement, 
      dataArray, 
      currentPage, 
      itemsPerPage, 
      renderItemCallback, 
      onPageChange,
      bulkActionConfig = null,
      sortConfig = null // 정렬 설정 추가
    } = config;

    listElement.innerHTML = '';

    // 정렬 셀렉트박스 추가
    if (sortConfig) {
      const sortContainer = document.createElement('div');
      sortContainer.className = 'sort-container mb-0 p-1 bg-gray-50 rounded-lg';
      sortContainer.innerHTML = sortConfig.html;
      listElement.appendChild(sortContainer);
      
      // 이벤트 바인딩
      if (sortConfig.bindEvent) {
        sortConfig.bindEvent(sortContainer);
      }
    }

    const totalItems = dataArray.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    // 페이지 번호 범위 보정
    let validPage = currentPage;
    if (validPage < 0) validPage = 0;
    if (validPage >= totalPages) validPage = totalPages - 1;
    
    const start = validPage * itemsPerPage;
    const pageItems = dataArray.slice(start, start + itemsPerPage);

    // 아이템 렌더링
    pageItems.forEach((item, index) => {
      const globalIndex = start + index;
      const itemElement = renderItemCallback(item, globalIndex);
      listElement.appendChild(itemElement);
    });

    // 페이징 UI 생성
    if (totalPages > 1) {
      const paginationDiv = document.createElement('div');
      paginationDiv.className = 'flex items-center justify-center space-x-2 mt-3';

      // 이전 페이지 버튼
      const prevBtn = document.createElement('button');
      prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
      prevBtn.className = 'pagination-btn px-2 py-1 text-xs border rounded hover:bg-gray-100 disabled:opacity-50';
      if (validPage === 0) {
        prevBtn.disabled = true;
      }
      prevBtn.addEventListener('click', () => {
        onPageChange(validPage - 1);
      });

      // 페이지 번호 표시
      const pageInfo = document.createElement('span');
      pageInfo.className = 'text-xs font-medium text-gray-600 px-2';
      pageInfo.textContent = `${validPage + 1} / ${totalPages}`;

      // 다음 페이지 버튼
      const nextBtn = document.createElement('button');
      nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
      nextBtn.className = 'pagination-btn px-2 py-1 text-xs border rounded hover:bg-gray-100 disabled:opacity-50';
      if (validPage === totalPages - 1) {
        nextBtn.disabled = true;
      }
      nextBtn.addEventListener('click', () => {
        onPageChange(validPage + 1);
      });

      paginationDiv.appendChild(prevBtn);
      paginationDiv.appendChild(pageInfo);
      paginationDiv.appendChild(nextBtn);
      listElement.appendChild(paginationDiv);
    }

    // 일괄 작업 UI 추가 (옵션)
    if (bulkActionConfig) {
      const bulkContainer = document.createElement('div');
      bulkContainer.className = 'mt-4 p-3 bg-gray-50 rounded-lg';
      bulkContainer.innerHTML = bulkActionConfig.html;
      listElement.appendChild(bulkContainer);

      // 이벤트 리스너 추가
      if (bulkActionConfig.events) {
        bulkActionConfig.events.forEach(event => {
          const element = bulkContainer.querySelector(event.selector);
          if (element) {
            element.addEventListener(event.type, event.handler);
          }
        });
      }
    }
  }

  // ✅ 상품 렌더링 (정렬 기능 추가)
  _renderProductPage() {
    // 정렬 적용
    const sortedProducts = this.sortProducts(this.productCandidates, this.productSortBy);
    
    // 정렬 셀렉트박스 설정
    const sortConfig = this.createSortSelectBox(
      this.productSortBy, 
      (newSortBy) => this.handleProductSortChange(newSortBy),
      'productSortSelect'
    );

    this._renderPaginatedList({
      listElement: document.getElementById('productsList'),
      dataArray: sortedProducts,
      currentPage: this.productPage,
      itemsPerPage: this.PRODUCTS_PER_PAGE,
      sortConfig: sortConfig, // 정렬 설정 추가
      renderItemCallback: (product, index) => {
        const card = document.createElement('div');
        card.className = 'product-card bg-white rounded-lg p-3 border hover:shadow-md transition';
        card.innerHTML = `
          <div class="flex items-center justify-between">
            <div class="flex-1">
              <h4 class="font-medium text-sm text-gray-800">${this.escapeHtml(product.name)}</h4>
              <p class="text-xs text-gray-500 mt-1">${this.escapeHtml(product.origin || '원산지 정보 없음')}</p>
              <p class="text-green-600 font-bold text-sm mt-1">${this.formatPrice(product.price)}원</p>
            </div>
            <button class="add-to-cart bg-green-100 text-green-600 px-2 py-1 rounded text-xs hover:bg-green-200" data-product-name="${this.escapeHtml(product.name)}">담기</button>
          </div>`;

        card.querySelector('.add-to-cart').addEventListener('click', (e) => {
          e.stopPropagation();
          const productName = e.target.dataset.productName;

          const products = [{
            name: productName,
            price: product.price || 0,
            origin: product.origin || '',
            organic: product.organic || false
          }];

          this.addMessage(`${productName} 담아줘`, 'user');
          this.sendBulkAddRequest(products);
        });
        return card;
      },
      onPageChange: (newPage) => {
        this.productPage = newPage;
        this._renderProductPage();
      }
    });
  }

  // ✅ 재료 렌더링 (정렬 기능 추가)
  _renderIngredientsPage() {
    // 정렬 적용
    const sortedIngredients = this.sortIngredients(this.ingredientCandidates, this.ingredientSortBy);
    
    // 정렬 셀렉트박스 설정
    const sortConfig = this.createSortSelectBox(
      this.ingredientSortBy, 
      (newSortBy) => this.handleIngredientSortChange(newSortBy),
      'ingredientSortSelect'
    );

    this._renderPaginatedList({
      listElement: document.getElementById('recipesList'),
      dataArray: sortedIngredients,
      currentPage: this.ingredientPage,
      itemsPerPage: this.INGREDIENTS_PER_PAGE,
      sortConfig: sortConfig, // 정렬 설정 추가
      renderItemCallback: (ingredient, globalIndex) => {
        const card = document.createElement('div');
        card.className = 'ingredient-card bg-white rounded-lg p-3 border hover:shadow-md transition cursor-pointer mb-2';
        card.innerHTML = `
          <div class="flex items-center justify-between">
            <div class="flex items-center flex-1">
              <input type="checkbox" 
                    class="ingredient-checkbox mr-3" 
                    id="ingredient-${globalIndex}" 
                    data-product-name="${this.escapeHtml(ingredient.name)}"
                    data-product-price="${ingredient.price}"
                    data-product-origin="${this.escapeHtml(ingredient.origin || '원산지 정보 없음')}"
                    data-product-organic="${ingredient.organic}">
              <div class="flex-1">
                <h4 class="font-medium text-sm text-gray-800">${this.escapeHtml(ingredient.name)}</h4>
                <p class="text-xs text-gray-500 mt-1">${this.escapeHtml(ingredient.origin || '원산지 정보 없음')}</p>
                <div class="flex items-center mt-1">
                  <p class="text-green-600 font-bold text-sm">${this.formatPrice(ingredient.price)}원</p>
                  ${ingredient.organic ? '<span class="ml-2 px-1 py-0.5 bg-green-100 text-green-700 text-xs rounded">유기농</span>' : ''}
                </div>
              </div>
            </div>
            <button class="add-to-cart bg-yellow-500 text-white px-3 py-1 rounded text-xs hover:bg-yellow-600 transition" data-product-name="${this.escapeHtml(ingredient.name)}">
              <i class="fas fa-shopping-basket mr-1"></i>담기
            </button>
          </div>`;

        card.querySelector('.add-to-cart').addEventListener('click', (e) => {
          e.stopPropagation();
            
          // 'ingredient' 객체의 전체 정보를 사용하여 products 배열을 생성합니다.
          const products = [{
            name:    ingredient.name,
            price:   ingredient.price || 0,
            origin:  ingredient.origin || '',
            organic: ingredient.organic || false
          }];
        
          // 사용자에게 채팅창에 피드백을 보여줍니다.
          this.addMessage(`${ingredient.name} 담아줘`, 'user');
        
          // 챗봇 메시지 전송 대신, 장바구니 API를 직접 호출합니다.
          this.sendBulkAddRequest(products);
        });
        return card;
      },
      onPageChange: (newPage) => {
        this.ingredientPage = newPage;
        this._renderIngredientsPage();
      },
      bulkActionConfig: {
        html: `
          <div class="flex items-center justify-between">
            <div class="flex items-center">
              <input type="checkbox" id="select-all-ingredients" class="mr-2">
              <label for="select-all-ingredients" class="text-sm text-gray-700">현재 페이지 전체 선택</label>
            </div>
            <button id="bulk-add-to-cart" class="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 transition">
              <i class="fas fa-shopping-basket mr-1"></i>선택한 재료 모두 담기
            </button>
          </div>`,
        events: [
          {
            selector: '#select-all-ingredients',
            type: 'change',
            handler: (e) => {
              const checkboxes = document.querySelectorAll('.ingredient-checkbox');
              checkboxes.forEach(checkbox => checkbox.checked = e.target.checked);
            }
          },
          {
            selector: '#bulk-add-to-cart',
            type: 'click',
            handler: () => this.handleBulkAddToCart()
          }
        ]
      }
    });
  }

  /* ========== 음성: UI 상태 ========== */
  startVoiceUI() {
    this.isRecording = true;
    this.canceled = false;
    const micBtn = document.getElementById('voiceInput');
    const cancelBtn = document.getElementById('voiceCancel');
    const input = document.getElementById('messageInput');
    if (micBtn) {
      micBtn.classList.add('recording');
      micBtn.innerHTML = '<i class="fas fa-stop"></i>';
    }
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    if (input) input.classList.add('recording');
  }
  stopVoiceUI() {
    this.isRecording = false;
    const micBtn = document.getElementById('voiceInput');
    const cancelBtn = document.getElementById('voiceCancel');
    const input = document.getElementById('messageInput');
    if (micBtn) {
      micBtn.classList.remove('recording');
      micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    }
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (input) input.classList.remove('recording');
  }

  /* ========== 음성: 시작/정지/취소 ========== */
  async toggleVoiceRecording() {
    if (!this.isRecording) {
      this.startVoiceUI();
      const Recog = getSpeechRecognitionCtor();
      if (Recog) {
        this.startSpeechRecognition(Recog);
      } else {
        await this.startMediaRecorder();
      }
    } else {
      if (this.recognition) this.recognition.stop();
      if (this.mediaRecorder) this.mediaRecorder.stop();
    }
  }

  // 취소 버튼
  cancelVoiceRecording() {
    if (!this.isRecording) return;

    this.canceled = true;
    this.stopVoiceUI();

    if (this.recognition) {
      try { this.recognition.abort(); } catch (_) {}
      try { this.recognition.stop(); } catch (_) {}
      this.recognition = null;
    }

    if (this.mediaRecorder) {
      try { if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop(); } catch (_) {}
      this.mediaRecorder = null;
    }
    if (this.mediaStream) {
      try { this.mediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      this.mediaStream = null;
    }

    this.audioChunks = [];
    this.lastTranscript = '';
  }

  /* --- Web Speech --- */
  startSpeechRecognition(Recog) {
    try {
      this.lastTranscript = '';
      const r = new Recog();
      this.recognition = r;
      r.lang = 'ko-KR';
      r.continuous = true;
      r.interimResults = true;

      r.onresult = (event) => {
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) finalText += res[0].transcript;
        }
        if (finalText) this.lastTranscript += finalText;
      };

      r.onerror = (e) => {
        const isAbort =
          this.canceled ||
          (e && (e.error === 'aborted' || e.name === 'AbortError'));

        if (!isAbort) {
          console.error('SpeechRecognition error:', e);
          this.addMessage('음성 인식 중 오류가 발생했어요.', 'bot', true);
        }
        this.recognition = null;
        this.stopVoiceUI();
      };

      r.onend = () => {
        const text = (this.lastTranscript || '').trim();
        this.stopVoiceUI();

        if (!this.canceled && text) {
          this.addMessage(text, 'user');
          this.sendMessage(text, false);
        }
        this.recognition = null;
      };

      r.start();
    } catch (err) {
      console.error(err);
      this.addMessage('브라우저 음성인식을 사용할 수 없어요.', 'bot', true);
      this.stopVoiceUI();
    }
  }

  /* --- MediaRecorder --- */
  async startMediaRecorder() {
    try {
      this.audioChunks = [];
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(this.mediaStream);
      this.mediaRecorder = mr;

      mr.ondataavailable = (e) => e.data && this.audioChunks.push(e.data);

      mr.onstop = async () => {
        this.stopVoiceUI();

        const finalize = () => {
          if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
          }
          this.mediaRecorder = null;
        };

        try {
          if (this.canceled) { finalize(); return; }

          const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
          const form = new FormData();
          form.append('audio', blob, 'voice.webm');
          form.append('user_id', this.userId);
          form.append('session_id', this.sessionId);

          const headers = {};
          const csrf = getCSRFToken(); if (csrf) headers['X-CSRFToken'] = csrf;

          const res = await fetch('/api/upload/audio', {
            method: 'POST',
            body: form,
            headers,
            credentials: 'include'
          });
          const data = await res.json();

          const text = (data && data.text || '').trim();
          if (text) {
            this.addMessage(text, 'user');
            this.sendMessage(text, false);
          } else if (data && data.url) {
            const hiddenMsg = `__AUDIO_UPLOADED__ ${data.url}`;
            this.sendMessage(hiddenMsg, true);
            this.addMessage('음성 전사를 받을 수 없었어요.', 'bot');
          }
        } catch (e) {
          console.error(e);
          this.addMessage('오디오 업로드 중 오류가 발생했어요.', 'bot', true);
        } finally {
          finalize();
        }
      };

      mr.start();
    } catch (err) {
      console.error(err);
      this.addMessage('마이크 접근 권한이 없거나 사용할 수 없어요.', 'bot', true);
      this.stopVoiceUI();
    }
  }

  /* ====== 장바구니/채팅 ====== */
  handleCartUpdate(productName, action) {
    if (!this.cartState || !this.cartState.items) return;
    const idx = this.cartState.items.findIndex(i => i.name === productName);
    if (idx === -1) return;
    switch (action) {
      case 'increment': this.cartState.items[idx].qty += 1; break;
      case 'decrement': this.cartState.items[idx].qty -= 1; break;
      case 'remove':    this.cartState.items[idx].qty  = 0; break;
    }
    const finalQty = this.cartState.items[idx]?.qty ?? 0;
    if (finalQty <= 0) this.cartState.items.splice(idx, 1);
    this.recalculateAndRedrawCart();
    clearTimeout(this.debounceTimer);
    this.pendingCartUpdate[productName] = Math.max(finalQty, 0);
    this.debounceTimer = setTimeout(() => this.syncPendingCartUpdates(), 5000);
  }

  syncPendingCartUpdates() {
    const updates = this.pendingCartUpdate; this.pendingCartUpdate = {};
    if (Object.keys(updates).length === 0) return;
    for (const productName in updates) {
      const quantity = updates[productName];
      fetch('/api/cart/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getCSRFToken() ? { 'X-CSRFToken': getCSRFToken() } : {})
        },
        body: JSON.stringify({ user_id: this.userId, product_name: productName, quantity }),
        credentials: 'include'
      })
      .then(r => r.json())
      .then(data => { if (!data.error) this.updateCart(data.cart, true); })
      .catch(err => console.error('Cart sync fetch error:', err));
    }
  }

  async initializeCart() {
    try {
      const url = new URL('/api/cart/get', window.location.origin);
      url.searchParams.set('t', Date.now().toString());
      url.searchParams.set('user_id', this.userId);
      let res = await fetch(url.toString(), { method: 'GET', headers: { 'Accept':'application/json' }, credentials: 'include' });
      if (!res.ok && res.status !== 200) {
        res = await fetch('/api/cart/get', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', ...(getCSRFToken() ? { 'X-CSRFToken': getCSRFToken() } : {}) },
          body: JSON.stringify({ user_id: this.userId }),
          credentials: 'include'
        });
      }
      if (res.ok) {
        const data = await res.json();
        if (data && data.cart) { this.updateCart(data.cart, true); return; }
      }
    } catch (err) { console.error('Cart initialization error:', err); }
    this.updateCart(null, true);
  }

  async ensureCartLoaded() {
    if (this.cartState && Array.isArray(this.cartState.items)) return true;
    try {
      const res = await fetch('/api/cart/get', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', ...(getCSRFToken() ? { 'X-CSRFToken': getCSRFToken() } : {}) },
        body: JSON.stringify({ user_id: this.userId }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data?.cart) { this.updateCart(data.cart, true); return true; }
    } catch (e) { console.error('ensureCartLoaded error:', e); }
    return false;
  }

  recalculateAndRedrawCart() {
    if (!this.cartState) return;
    this.cartState.subtotal = this.cartState.items.reduce((acc, it) => acc + (parseFloat(it.unit_price) * it.qty), 0);
    let discountAmount = 0;
    if (this.cartState.subtotal >= 30000) {
      discountAmount = 3000;
      this.cartState.discounts = [{ type:'free_shipping', amount:3000, description:'무료배송' }];
    } else { this.cartState.discounts = []; }
    this.cartState.total = this.cartState.subtotal - discountAmount;
    this.updateCart(this.cartState, false);
  }

  async sendMessage(messageOverride = null, silent = false) {
    const input = document.getElementById('messageInput');
    const message = messageOverride || input.value.trim();
    if (!message) return null;
    if (!silent && !messageOverride) this.addMessage(message, 'user');
    input.value = '';
    this.showSmartLoading(message);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', ...(getCSRFToken() ? { 'X-CSRFToken': getCSRFToken() } : {}) },
        body: JSON.stringify({ message, user_id: this.userId, session_id: this.sessionId }),
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        this.sessionId = data.session_id;
        const hasOrderPicker = !!(data.cs && Array.isArray(data.cs.orders) && data.cs.orders.length);
        if (!silent && data.response && !hasOrderPicker) {
          this.addMessage(data.response, 'bot');
        }
        this.updateSidebar(data);
        this.updateSessionInfo(data.metadata);
        return data;
      } else { throw new Error(data.detail || 'API 호출 실패'); }
    } catch (error) {
      console.error('Error:', error);
      if (!silent) this.addMessage('죄송합니다. 일시적인 오류가 발생했습니다.', 'bot', true);
      return null;
    } finally { this.hideCustomLoading(); }
  }

  /* ===== 메시지 렌더링(개선: HTML은 보존, 텍스트만 줄바꿈 변환 + 길이 클램프) ===== */
  formatBotMessage(content) {
    if (isLikelyHtml(content)) return content;
    const div = document.createElement('div');
    div.textContent = content || '';
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  addMessage(content, sender, isError = false) {
    const messagesContainer = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'mb-4 message-animation';

    if (sender === 'user') {
      messageDiv.innerHTML = `
        <div class="flex items-end justify-end">
          <div class="message-bubble-user mr-2">${this.escapeHtml(content)}</div>
          <div class="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center flex-shrink-0">
            <i class="fas fa-user text-white text-sm"></i>
          </div>
        </div>`;
      messagesContainer.appendChild(messageDiv);
      this.scrollToBottom();
      return;
    }

    const isHtml = isLikelyHtml(content);
    const html = this.formatBotMessage(content);
    const needClamp = !isHtml && this.needsClamp(html);

    const inner = document.createElement('div');
    inner.innerHTML = `
      <div class="flex items-start">
        <div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
          <i class="fas fa-robot text-green-600 text-sm"></i>
        </div>
        <div class="message-bubble-bot ${isError ? 'error' : ''}">
          <div class="bot-text">${html}</div>
          ${needClamp ? '<button class="text-xs text-gray-500 mt-2 hover:underline" data-action="expand">더보기</button>' : ''}
        </div>
      </div>
    `;
    messageDiv.appendChild(inner);
    messagesContainer.appendChild(messageDiv);

    if (needClamp) {
      const textEl = messageDiv.querySelector('.bot-text');
      textEl.dataset.expanded = 'false';
      this.applyClamp(textEl, true);
    }

    this.scrollToBottom();
  }

  // 화면 폭과 유사한 폭에서 라인 수를 계산해 8줄 초과 시 접기 대상
  needsClamp(html) {
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

  applyClamp(el, clamp) {
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

  handleClampToggle(e) {
    const btn = e.target.closest('button[data-action="expand"], button[data-action="collapse"]');
    if (!btn) return;
    const bubble = btn.closest('.message-bubble-bot');
    if (!bubble) return;
    const textEl = bubble.querySelector('.bot-text');
    if (!textEl) return;

    const expanded = textEl.dataset.expanded === 'true';
    if (expanded) {
      // 접기
      this.applyClamp(textEl, true);
      textEl.dataset.expanded = 'false';
      btn.dataset.action = 'expand';
      btn.textContent = '더보기';
    } else {
      // 펼치기
      this.applyClamp(textEl, false);
      textEl.dataset.expanded = 'true';
      btn.dataset.action = 'collapse';
      btn.textContent = '접기';
    }
    this.scrollToBottom();
  }

  addImageMessage(src, sender = 'user') {
    const messagesContainer = document.getElementById('messages');
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-4 message-animation';
    const bubbleCommon = 'max-w-xs rounded-2xl overflow-hidden border';
    const imgHtml = `<img src="${src}" alt="uploaded" class="block w-full h-auto">`;
    if (sender === 'user') {
      wrapper.innerHTML = `
        <div class="flex items-end justify-end">
          <div class="mr-2 ${bubbleCommon}">${imgHtml}</div>
          <div class="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center flex-shrink-0">
            <i class="fas fa-user text-white text-sm"></i>
          </div>
        </div>`;
    } else {
      wrapper.innerHTML = `
        <div class="flex items-start">
          <div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
            <i class="fas fa-robot text-green-600 text-sm"></i>
          </div>
          <div class="${bubbleCommon}">${imgHtml}</div>
        </div>`;
    }
    messagesContainer.appendChild(wrapper);
    this.scrollToBottom();
  }

  showTyping(){ document.getElementById('loadingIndicator').classList.remove('hidden'); this.scrollToBottom(); }
  hideTyping(){ document.getElementById('loadingIndicator').classList.add('hidden'); }

  // ✅ 로딩 말풍선을 "맨 아래 appendChild" 방식으로 표시/제거
  showCustomLoading(type, message, animationType = 'dots') {
    // 기존 로딩 제거(중복 방지)
    this.hideCustomLoading();

    const messagesContainer = document.getElementById('messages');
    const wrapper = document.createElement('div');
    wrapper.id = 'loadingIndicator';
    wrapper.className = 'mb-4 message-animation';

    const loadingConfigs = {
      search:  { icon: 'fas fa-search rotating-icon',  colorClass: 'loading-search',  message: message || '상품을 검색 중입니다...' },
      recipe:  { icon: 'fas fa-utensils loading-icon', colorClass: 'loading-recipe',  message: message || '레시피를 검색 중입니다...' },
      cart:    { icon: 'fas fa-shopping-cart loading-icon', colorClass: 'loading-cart', message: message || '장바구니를 업데이트 중입니다...' },
      cs:      { icon: 'fas fa-headset loading-icon', colorClass: 'loading-cs', message: message || '문의 내용을 확인 중입니다...' },
      popular: { icon: 'fas fa-fire loading-icon', colorClass: 'loading-search', message: message || '인기 상품을 준비 중입니다...' }
    };
    const config = loadingConfigs[type] || loadingConfigs['search'];

    wrapper.innerHTML = `
      <div class="flex items-start">
        <div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
          <i class="${config.icon} ${config.colorClass}"></i>
        </div>
        <div class="message-bubble-bot">
          <div class="flex items-center">
            <span>${config.message}</span>
          </div>
          <div class="mt-2 flex space-x-1">
            <div class="w-2 h-2 bg-green-500 rounded-full animate-bounce"></div>
            <div class="w-2 h-2 bg-green-500 rounded-full animate-bounce" style="animation-delay: 0.1s"></div>
            <div class="w-2 h-2 bg-green-500 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
          </div>
        </div>
      </div>
    `;

    messagesContainer.appendChild(wrapper);
    this.scrollToBottom();
  }

  hideCustomLoading() {
    const indicator = document.getElementById('loadingIndicator');
    if (indicator) indicator.remove();
  }

  showSmartLoading(message){
    const msg=message.toLowerCase();
    if (msg.includes('인기')||msg.includes('추천')) { this.showCustomLoading('popular','고객들이 많이 찾는 인기상품을 준비 중입니다...','progress'); return; }
    if (msg.includes('레시피')||msg.includes('요리')||msg.includes('만들')||msg.includes('조리')) { this.showCustomLoading('recipe','맛있는 레시피를 검색 중입니다...','pulse'); return; }
    if (msg.includes('장바구니')||msg.includes('담아')||msg.includes('주문')) { this.showCustomLoading('cart','장바구니 정보를 확인 중입니다...','dots'); return; }
    if (msg.includes('문의')||msg.includes('배송')||msg.includes('환불')||msg.includes('교환')||msg.includes('탈퇴')) { this.showCustomLoading('cs','고객지원 정보를 찾고 있습니다...','dots'); return; }
    this.showCustomLoading('search','상품 정보를 검색 중입니다...','progress');
  }

  scrollToBottom(){ const c=document.getElementById('chatContainer'); c.scrollTop=c.scrollHeight; }

  // ✅ 개선된 사이드바 업데이트 (페이지네이션 적용)
  updateSidebar(data){
    // 상품 목록 업데이트 (페이지네이션 적용)
    if (data.search?.candidates) {
      this.updateProductsList(data.search.candidates);
    } else {
      // 상품 검색 결과가 없으면 상품 섹션 숨김
      document.getElementById('productsSection').classList.add('hidden');
    }
    
    this.updateRecipesList(data.recipe);
    if (data.cart) this.updateCart(data.cart,true);
    this.updateOrderInfo(data.order);
    this.updateCS(data.cs);
  }

  // ✅ 상품 목록 업데이트 (페이지네이션 적용)
  updateProductsList(products){
    const section=document.getElementById('productsSection');

    if (products) {
      this.productCandidates = products;
      this.productPage = 0;
      this.productSortBy = 'popular'; // 새 데이터가 오면 인기순으로 초기화
    }

    if (!this.productCandidates || this.productCandidates.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    this._renderProductPage();
  }

  /* ================================
     레시피/추천 재료 (표현 방식 통일)
     - 레시피 카드: 목업(샘플)과 동일한 흰색 카드 + 즐겨찾기 별
     - "재료 추천" 결과(ingredients)는 "상품 섹션"에 표시
  =================================*/
  updateRecipesList(recipePayload){
    const recipesSection = document.getElementById('recipesSection'); 
    const recipesList = document.getElementById('recipesList');
    const recipesTitle = recipesSection?.querySelector('h3');

    // 1) 레시피가 재료(ingredients)를 동반해 내려온 경우 → "상품 섹션"에 추천 재료로 표시
    const ingredients = recipePayload?.ingredients;
    if (Array.isArray(ingredients) && ingredients.length > 0) {
      // ingredients를 productCandidates에 그대로 매핑
      this.productCandidates = ingredients.map(i => ({
        name: i.name,
        origin: i.origin || '원산지 정보 없음',
        price: i.price || 0,
        organic: !!i.organic
      }));
      this.productPage = 0;
      this.productSortBy = 'popular';

      // 상품 섹션을 보이게 하고 렌더링
      const productsSection = document.getElementById('productsSection');
      productsSection.classList.remove('hidden');
      // 제목을 "추천 재료"로 바꿔 사용자에게 명확히 전달
      const productTitle = productsSection.querySelector('h3');
      if (productTitle) {
        productTitle.innerHTML = '<i class="fas fa-shopping-bag mr-2 text-blue-500"></i>추천 재료';
      }

      this._renderProductPage();

      // 우측 탭을 상품 탭으로 전환
      const productTab = document.getElementById('productTab');
      if (productTab) productTab.click();

      // 레시피 섹션은 그대로 두되, 현재 리스트는 유지/숨김은 선택 사항
      // 필요하면 다음 한 줄의 주석을 해제해 레시피 섹션을 감추세요.
      // recipesSection.classList.add('hidden');

      return;
    }

    // 2) 기존 레시피 검색 결과 처리 (카드 UI를 목업과 동일하게)
    const recipes = recipePayload?.results;
    if (!Array.isArray(recipes) || recipes.length === 0){
      recipesSection.classList.add('hidden');
      return;
    }

    recipesSection.classList.remove('hidden');
    if (recipesTitle) recipesTitle.innerHTML = '<i class="fas fa-utensils mr-2 text-yellow-500"></i>레시피';
    recipesList.innerHTML = '';

    recipes.slice(0, 3).forEach((r) => {
      const title = this.escapeHtml(r.title || '');
      const desc = this.escapeHtml(r.description || '');
      const cooking = this.escapeHtml(r.cooking_time || '');
      const servings = this.escapeHtml(r.servings || '');
      const url = r.url || '#';

      const card = document.createElement('div');
      // 🔸 샘플 카드와 동일한 클래스 구성
      card.className = 'recipe-card bg-white rounded-lg p-3 border hover:shadow-md transition cursor-pointer mb-2';
      card.innerHTML = `
        <div class="recipe-card-body">
          <h4 class="font-semibold text-gray-800 mb-2">${title}</h4>
          <p class="text-gray-600 mb-2 text-xs">${desc}</p>
          <div class="flex items-center justify-between">
            <div class="recipe-info flex gap-3 text-xs text-gray-500">
              ${cooking ? `<span><i class="fas fa-clock mr-1"></i>${cooking}</span>` : ''}
              ${servings ? `<span><i class="fas fa-user mr-1"></i>${servings}</span>` : ''}
            </div>
            <button class="recipe-ingredients-btn bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded text-xs font-medium transition">
              <i class="fas fa-shopping-basket mr-1"></i>재료 추천받기
            </button>
          </div>
        </div>
        <button class="favorite-btn absolute top-3 right-3" onclick="toggleFavorite(this)">
          <i class="fas fa-star text-gray-300"></i>
        </button>
      `;

      // "재료 추천받기" 클릭 → 기존 requestRecipeIngredients 사용
      card.querySelector('.recipe-ingredients-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.requestRecipeIngredients({
          title: r.title,
          description: r.description,
          url: r.url
        });
      });

      // 전체 레시피 링크(원하면 카드 클릭 시 새창 이동)
      card.addEventListener('click', () => {
        if (url && url !== '#') window.open(url, '_blank');
      });

      recipesList.appendChild(card);
    });
  }

  async requestRecipeIngredients(recipe){
    const userMessage=`"${recipe.title}" 레시피에 필요한 재료들을 추천해주세요`;
    this.addMessage(userMessage,'user');

    const requestMessage=`선택된 레시피: "${recipe.title}"
레시피 설명: ${recipe.description||''}
URL: ${recipe.url||''}

이 레시피에 필요한 재료들을 우리 쇼핑몰에서 구매 가능한 상품으로 추천해주세요.`;

    const data = await this.sendMessage(requestMessage, true);
    if (data && data.response) this.addMessage(data.response, 'bot');
  }

  handleBulkAddToCart(){
    const list = document.getElementById('recipesList');
    const checks = list.querySelectorAll('.ingredient-checkbox:checked');
    if (checks.length===0){ alert('담을 재료를 선택해주세요.'); return; }

    const selected = [];
    checks.forEach(cb=>{
      selected.push({
        name: cb.dataset.productName,
        price: parseFloat(cb.dataset.productPrice),
        origin: cb.dataset.productOrigin,
        organic: cb.dataset.productOrganic === 'true'
      });
    });

    const names = selected.map(p=>p.name).join(', ');
    this.addMessage(`선택한 재료들을 장바구니에 담아주세요: ${names}`,'user');
    this.sendBulkAddRequest(selected);
  }

  async sendBulkAddRequest(products){
    this.showCustomLoading('cart','선택한 재료들을 장바구니에 담고 있습니다...','progress');
    try{
      const res = await fetch('/api/cart/bulk-add',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          ...(getCSRFToken()?{'X-CSRFToken':getCSRFToken()}:{}),
        },
        body: JSON.stringify({ user_id:this.userId, products }),
        credentials:'include'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '일괄 담기 실패');

      const successCount = data.added_count || products.length;
      this.addMessage(`${successCount}개의 재료가 장바구니에 담겼습니다!`,'bot');
      if (data.cart) this.updateCart(data.cart, true);

      const list = document.getElementById('recipesList');
      list.querySelectorAll('.ingredient-checkbox').forEach(cb=>cb.checked=false);
      const all = list.querySelector('#select-all-ingredients');
      if (all) all.checked=false;
    }catch(err){
      console.error('Bulk add error:', err);
      this.addMessage('선택한 재료를 담는 중 오류가 발생했습니다.','bot',true);
    }finally{
      this.hideCustomLoading();
    }
  }

//환불/교환/배송문의 UI

updateCS(cs) {
  if (!cs || !Array.isArray(cs.orders) || cs.orders.length === 0) return;

  // 배송문의 식별: 서버가 내려주는 플래그/카테고리로 체크
  const isDelivery = !!cs.always_show || cs.category === '배송' || cs.list_type === 'delivery';
  
  // 배송문의 상태를 클래스 속성에 저장
  this.isCurrentlyDeliveryInquiry = isDelivery;

  const key = cs.orders.map(o => String(o.order_code)).join(',');

  // 배송문의가 아니면 중복 방지 유지
  if (!isDelivery) {
    if (this.lastOrdersKey === key) return;
    this.lastOrdersKey = key;
  }
  // 배송문의면 캐시를 건드리지 않음 → 항상 표시

  const messages = document.getElementById('messages');
  const wrap = document.createElement('div');
  wrap.className = 'mb-4 message-animation';
  const hint = this.escapeHtml(cs.message);

  const itemsHtml = cs.orders.map(o => {
    const date = this.escapeHtml(o.order_date || '');
    const price = Number(o.total_price || 0).toLocaleString();
    const code = this.escapeHtml(String(o.order_code));
    const status = this.escapeHtml(o.order_status || '');
    return `
      <button class="order-select-btn px-3 py-2 rounded-lg border hover:bg-blue-50 w-full text-left"
              data-order="${code}">
        <div class="flex items-center justify-between">
          <div class="font-medium">주문 #${code}</div>
          <div class="text-sm text-gray-500">${date} · ${price}원</div>
        </div>
        <div class="text-xs text-gray-500 mt-1">상태: ${status}</div>
      </button>`;
  }).join('');

  wrap.innerHTML = `
    <div class="flex items-start">
      <div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
        <i class="fas fa-robot text-green-600 text-sm"></i>
      </div>
      <div class="message-bubble-bot">
        <div class="mb-2">${hint}</div>
        <div class="grid grid-cols-1 gap-2">${itemsHtml}</div>
      </div>
    </div>`;
  messages.appendChild(wrap);
  this.scrollToBottom();
}

  // 주문 선택 버튼 클릭
  handleOrderSelectClick(e) {
    const btn = e.target.closest('.order-select-btn');
    if (!btn) return;
    const orderCode = btn.dataset.order;
    if (!orderCode) return;
    this.fetchAndShowOrderDetails(orderCode);
  }

  // 주문 상세의 "상품 행" 클릭 → 업로드 시작(버튼도 제공)
  handleOrderItemClick(e){
    if (e.target.closest('.evidence-upload-btn')) return;
    const row = e.target.closest('tr.order-item-row');
    if (!row) return;
    const bubble = row.closest('.order-details-bubble');
    if (!bubble) return;

    // 배송문의일 때는 행 클릭을 무시
    if (this.isCurrentlyDeliveryInquiry) return;

    const product = row.dataset.product || '';
    const orderCode = bubble.dataset.orderCode || '';
    if (!product || !orderCode) return;

    this.ensureEvidenceInput();
    this.pendingEvidence = { orderCode, product };
    this.showCustomLoading('cs', `'${product}' 사진을 업로드해주세요`, 'dots');
    this.evidenceInput.click();
  }

  // "사진 업로드" 버튼 클릭 처리 (수량 전달)
  handleEvidenceUploadButtonClick(e){
    const btn = e.target.closest('.evidence-upload-btn');
    if (!btn) return;

    // 버튼이 속한 행에서 최대 수량 읽기
    const row = btn.closest('tr.order-item-row');
    const maxQty = row ? parseInt(row.dataset.qty || '1', 10) : 1;

    const orderCode = btn.dataset.order;
    const product = btn.dataset.product;
    if (!orderCode || !product) return;

    // 사용자에게 수량 입력 받기 (기본 1)
    let qty = 1;
    if (maxQty > 1) {
      const ans = prompt(`환불 요청 수량을 입력해주세요 (1 ~ ${maxQty})`, '1');
      const n = parseInt(ans || '1', 10);
      qty = isNaN(n) ? 1 : Math.min(Math.max(1, n), maxQty);
    }

    this.ensureEvidenceInput();
    this.pendingEvidence = { orderCode, product, quantity: qty };
    this.showCustomLoading('cs', `'${product}' 사진을 업로드해주세요`, 'dots');
    this.evidenceInput.click();
  }

  // 증빙 업로드 input 생성
  ensureEvidenceInput(){
    if (this.evidenceInput) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', (e) => this.handleEvidenceSelected(e));
    document.body.appendChild(input);
    this.evidenceInput = input;
  }

  // 파일 선택 후 업로드 → 판정 요청
  async handleEvidenceSelected(e){
    const file = e.target.files && e.target.files[0];
    e.target.value = '';  // 같은 파일 재업로드 허용
    this.hideCustomLoading();
    if (!file || !this.pendingEvidence) return;

    const previewUrl = URL.createObjectURL(file);
    this.addImageMessage(previewUrl, 'user');

    const { orderCode, product, quantity } = this.pendingEvidence;
    this.pendingEvidence = null;

    this.showCustomLoading('cs', '증빙 이미지를 분석 중입니다...', 'dots');
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('user_id', this.userId);
      form.append('order_code', orderCode);
      form.append('product', product);
      form.append('quantity', String(quantity || 1));   // ✅ 수량 전송

      const headers = {};
      const csrf = getCSRFToken(); if (csrf) headers['X-CSRFToken'] = csrf;

      const res = await fetch('/api/cs/evidence', {
        method: 'POST',
        body: form,
        headers,
        credentials: 'include'
      });
      const data = await res.json();
      this.renderEvidenceResultBubble(data, { orderCode, product });
    } catch (err){
      console.error(err);
      this.addMessage('이미지 업로드/분석 중 오류가 발생했어요.', 'bot', true);
    } finally {
      this.hideCustomLoading();
    }
  }

// 증빙 분석 결과 말풍선 
renderEvidenceResultBubble(data, ctx){
  const cs = (data && data.cs) || {};
  const ticket = cs.ticket || {};
  const analysis = ticket.image_analysis || {};

  const prod = this.escapeHtml(ticket.product || ctx.product || "");
  const tId  = this.escapeHtml(ticket.ticket_id || "");
  const agentMsg = this.escapeHtml(ticket.agent_message || cs.message || "");

  const reason = this.escapeHtml(analysis.human_reason || analysis.issue_summary || "");
  let issues = "";
  if (Array.isArray(analysis.quality_issues)) {
    issues = this.escapeHtml(analysis.quality_issues.join(", "));
  } else if (analysis.quality_issues) {
    issues = this.escapeHtml(String(analysis.quality_issues));
  }
  const conf = (analysis.confidence != null)
    ? `신뢰도 ${Math.round(Number(analysis.confidence)*100)}%`
    : "";

  let topLine = "";
  if (tId) {
    topLine = `
      <div class="text-sm">
        "<span class="font-medium">${prod}</span>" 상품
        <span class="font-semibold text-green-600">환불 접수 완료</span>
        <span class="text-xs text-gray-500 ml-2">티켓번호: <span class="font-mono">${tId}</span></span>
      </div>`;
  } else if (prod) {
    topLine = `<div class="text-sm">"${prod}"에 대한 접수 결과</div>`;
  }

  const agentBlock = agentMsg
    ? `<div class="text-sm leading-relaxed mt-1">${agentMsg}</div>`
    : "";

  const detailsBlock = `
    ${reason ? `<div class="text-xs mt-2"><span class="text-gray-500">사유</span> · ${reason}</div>` : ""}
    ${issues ? `<div class="text-xs mt-1"><span class="text-gray-500">감지된 이슈</span> · ${issues}${conf ? ` (${conf})` : ""}</div>` : ""}
  `;

  const html = `
    <div class="order-evidence-result rounded-lg border p-3">
      ${topLine}
      ${agentBlock}
      ${detailsBlock}
    </div>
  `;
  this.addMessage(html, 'bot');
  // ✅ 다음 '환불하고 싶어' 때 강제 재렌더를 위해 초기화
  this.lastCSOrderListKey = null;
  this.lastCSOrderListTs  = 0;
}

  updateCart(cart, saveState = true){
    if (saveState && cart) {
      if (cart.items) { cart.items.forEach(item=>{ item.qty=parseInt(item.qty,10); item.unit_price=parseFloat(item.unit_price); }); }
      this.cartState=JSON.parse(JSON.stringify(cart));
    }
    const currentCart=this.cartState;
    const section=document.getElementById('cartSection');
    const list=document.getElementById('cartItems');
    const countBadge=document.getElementById('cartCount');
    const subtotalEl=document.getElementById('subtotalAmount');
    const discountEl=document.getElementById('discountAmount');
    const totalEl=document.getElementById('totalAmount');
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
        <div class="flex-1 mr-2">
          <span class="font-medium">${this.escapeHtml(item.name)}</span>
          <div class="text-xs text-gray-500">${this.formatPrice(item.unit_price)}원</div>
        </div>
        <div class="quantity-controls flex items-center">
          <button class="quantity-btn minus-btn" data-product-name="${this.escapeHtml(item.name)}">-</button>
          <span class="quantity-display">${item.qty}</span>
          <button class="quantity-btn plus-btn" data-product-name="${this.escapeHtml(item.name)}">+</button>
        </div>
        <button class="remove-item ml-2" data-product-name="${this.escapeHtml(item.name)}">
          <i class="fas fa-times"></i>
        </button>`;
      list.appendChild(itemDiv);
    });

    subtotalEl.textContent=this.formatPrice(currentCart.subtotal)+'원';
    const discountAmount=(currentCart.discounts||[]).reduce((acc,d)=>acc+d.amount,0);
    discountEl.textContent=`- ${this.formatPrice(discountAmount)}원`;
    totalEl.textContent=this.formatPrice(currentCart.total)+'원';
    checkoutButton.classList.remove('hidden');
  }

  updateOrderInfo(order){
    const section=document.getElementById('orderSection');
    const info=document.getElementById('orderInfo');
    if (!order||!order.order_id){ section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    info.innerHTML=`
      <p><strong>주문번호:</strong> ${this.escapeHtml(order.order_id)}</p>
      <p><strong>총 금액:</strong> ${this.formatPrice(order.total_amount)}원</p>
      <p><strong>상태:</strong> <span class="font-bold text-blue-600">${order.status==='confirmed'?'주문완료':'처리중'}</span></p>`;
  }

  updateSessionInfo(){ const sessionInfo=document.getElementById('sessionInfo'); if (this.sessionId) sessionInfo.textContent=`세션: ${this.sessionId.slice(-8)}`; }

  clearChat(){
    if (confirm('채팅 기록을 모두 지우시겠습니까?')) {
      document.getElementById('messages').innerHTML='';
      this.sessionId='sess_'+Math.random().toString(36).substr(2,9);
      this.updateSessionInfo();
      document.getElementById('productsSection').classList.add('hidden');
      document.getElementById('recipesSection').classList.add('hidden');
    }
  }

  escapeHtml(text){ const div=document.createElement('div'); div.textContent=text||''; return div.innerHTML; }
  formatPrice(price){ if (price===null||price===undefined) return '0'; return new Intl.NumberFormat('ko-KR').format(price); }

  async showCartInChat(){
    this.addMessage('장바구니 보여주세요','user');
    if (!this.cartState||!this.cartState.items){ await this.ensureCartLoaded(); }
    if (!this.cartState||!this.cartState.items||this.cartState.items.length===0){ this.addMessage('현재 장바구니가 비어있습니다.','bot'); return; }
    let cartMessage='🛒 현재 장바구니 내용:\n\n';
    this.cartState.items.forEach((item,i)=>{
      cartMessage+=`${i+1}. ${item.name}\n`;
      cartMessage+=`   가격: ${this.formatPrice(item.unit_price)}원\n`;
      cartMessage+=`   수량: ${item.qty}개\n`;
      cartMessage+=`   소계: ${this.formatPrice(item.unit_price*item.qty)}원\n\n`;
    });
    cartMessage+=`💰 총 상품금액: ${this.formatPrice(this.cartState.subtotal)}원\n`;
    const discountAmount=(this.cartState.discounts||[]).reduce((acc,d)=>acc+d.amount,0);
    if (discountAmount>0) cartMessage+=`💸 할인금액: -${this.formatPrice(discountAmount)}원\n`;
    cartMessage+=`💳 최종 결제금액: ${this.formatPrice(this.cartState.total)}원`;
    this.addMessage(cartMessage,'bot');
  }

  async handleImageSelected(e){
    const file=e.target.files && e.target.files[0]; if (!file) return;
    const previewUrl=URL.createObjectURL(file); this.addImageMessage(previewUrl,'user');
    try{
      const form=new FormData();
      form.append('image',file);
      form.append('user_id',this.userId);
      form.append('session_id',this.sessionId);
      const headers={}; const csrf=getCSRFToken(); if (csrf) headers['X-CSRFToken']=csrf;
      const res=await fetch('/api/upload/image',{ method:'POST', body:form, headers, credentials:'include' });
      const data=await res.json();
      const imageUrl=data.url||data.image_url||'';
      if (imageUrl){ const hiddenMsg=`__IMAGE_UPLOADED__ ${imageUrl}`; await this.sendMessage(hiddenMsg,true); }
    }catch(err){ console.error(err); this.addMessage('이미지 업로드 중 오류가 발생했어요.','bot',true); }
    finally{ e.target.value=''; }
  }

  handleCheckout(){
    if (!this.cartState||!this.cartState.items||this.cartState.items.length===0){ alert('장바구니가 비어있습니다.'); return; }
    const message=`장바구니에 있는 상품들로 주문 진행하고 싶어요`;
    this.addMessage(message,'user'); this.sendMessage(message);
  }

  // 주문 상세 조회 호출
  async fetchAndShowOrderDetails(orderCode) {
    this.showCustomLoading('cs', '주문 내역을 불러오는 중입니다...', 'dots');
    try {
      const res = await fetch('/api/orders/details', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getCSRFToken() ? { 'X-CSRFToken': getCSRFToken() } : {})
        },
        body: JSON.stringify({
          order_code: String(orderCode),
          user_id: this.userId
        }),
        credentials: 'include'
      });

      const data = await res.json();

      if (!res.ok || !data || !Array.isArray(data.items) || data.items.length === 0) {
        this.addMessage('해당 주문의 상세 내역을 찾지 못했어요.', 'bot', true);
        return;
      }

      // 배송문의 상태를 data 객체에 추가하여 전달
      data.isDeliveryInquiry = this.isCurrentlyDeliveryInquiry;
      this.renderOrderDetailsBubble(data);
    } catch (err) {
      console.error('order details error:', err);
      this.addMessage('주문 내역을 불러오던 중 오류가 발생했어요.', 'bot', true);
    } finally {
      this.hideCustomLoading();
    }
  }

  // 주문 상세 말풍선: 배송문의면 "사진 업로드" 버튼 제거
  renderOrderDetailsBubble(data) {
    const code = this.escapeHtml(String(data.order_code || ''));
    const date = this.escapeHtml(data.order_date || '');
    const status = this.escapeHtml(data.order_status || '');
    
    // 배송문의 여부 판단 (서버 데이터 또는 클래스 속성에서 확인)
    const isDelivery = data.isDeliveryInquiry || data.allow_evidence === false || data.category === '배송' || data.list_type === 'delivery';

    const rows = (data.items || []).map((it, idx) => {
      const rawName = it.product || it.name || '';
      const name = this.escapeHtml(rawName);
      const qty = Number(it.quantity || it.qty || 0);
      const price = Number(it.price || it.unit_price || 0);
      const line = price * qty;
      
      // 배송문의가 아닌 경우에만 증빙 컬럼과 버튼 추가
      const evidenceCell = isDelivery ? '' : `
        <td class="py-1 text-center">
          <button class="evidence-upload-btn px-2 py-1 text-xs border rounded hover:bg-blue-50"
                  data-order="${code}" data-product="${name}">
            <i class="fas fa-camera mr-1"></i>사진 업로드
          </button>
        </td>`;
      
      return `
      <tr class="border-b order-item-row" data-product="${name}" data-qty="${qty}">
        <td class="py-1 pr-3 text-gray-800">${idx + 1}.</td>
        <td class="py-1 pr-3 text-gray-800">${name}</td>
        <td class="py-1 pr-3 text-right">${this.formatPrice(price)}원</td>
        <td class="py-1 pr-3 text-right">${qty}</td>
        <td class="py-1 text-right font-medium">${this.formatPrice(line)}원</td>
        ${evidenceCell}
      </tr>
    `;
    }).join('');

    const subtotal = Number(data.subtotal || data.total_price || 0);
    const total    = Number(data.total || subtotal);
    const discount = Math.max(0, Number(data.discount || 0));
    
    // 테이블 헤더에서도 배송문의면 증빙 컬럼 제거
    const evidenceHeader = isDelivery ? '' : '<th class="text-center">증빙</th>';
    const evidenceNotice = isDelivery ? '' : '<div class="mt-2 text-xs text-gray-500">* 환불/교환하려는 상품의 <b>사진 업로드</b> 버튼을 눌러 증빙 이미지를 올려주세요.</div>';

    const html = `
    <div class="order-details-bubble" data-order-code="${code}">
      <div class="mb-2 font-semibold text-gray-800">주문 #${code}</div>
      <div class="text-xs text-gray-500 mb-2">${date}${status ? ` · 상태: ${status}` : ''}</div>
      <div class="rounded-lg border overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="text-left py-2 pl-3">#</th>
              <th class="text-left">상품명</th>
              <th class="text-right">단가</th>
              <th class="text-right">수량</th>
              <th class="text-right">금액</th>
              ${evidenceHeader}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${evidenceNotice}
      <div class="mt-2 text-sm">
        <div class="flex justify-between"><span class="text-gray-600">상품 합계</span><span class="font-medium">${this.formatPrice(subtotal)}원</span></div>
        ${discount > 0 ? `<div class="flex justify-between"><span class="text-gray-600">할인</span><span class="font-medium">- ${this.formatPrice(discount)}원</span></div>` : ''}
        <div class="flex justify-between mt-1"><span class="font-semibold">총 결제금액</span><span class="font-bold text-blue-600">${this.formatPrice(total)}원</span></div>
      </div>
    </div>
  `;

    this.addMessage(html, 'bot');
  }
}

document.addEventListener('DOMContentLoaded', () => { new ChatBot(); });