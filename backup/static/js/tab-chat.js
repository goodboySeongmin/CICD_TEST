/**
 * Tab용 챗봇 클라이언트 JavaScript 
 * /chat의 기능을 /tab으로 포팅한 버전
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

/* ====== HTML 여부 탐지(텍스트/HTML 구분) ====== */
function isLikelyHtml(str = "") {
  return /<\/?[a-z][\s\S]*>/i.test(String(str).trim());
}

class TabChatBot {
  constructor() {
    this.sessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
    this.userId = resolveUserId();
    this.cartState = null;

    // 상품 관련 상태
    this.productCandidates = [];
    this.productPage = 0;
    this.PRODUCTS_PER_PAGE = 5;
    
    this.ingredientCandidates = [];
    this.ingredientPage = 0;
    this.INGREDIENTS_PER_PAGE = 5;

    // 정렬 상태
    this.productSortBy = 'popular';
    this.ingredientSortBy = 'popular';

    // 레시피 관련 상태
    this.recipeCandidates = [];
    this.favoriteRecipes = JSON.parse(localStorage.getItem('favoriteRecipes') || '[]');

    this.debounceTimer = null;
    this.pendingCartUpdate = {};

    // 음성 관련 상태
    this.isRecording = false;
    this.canceled = false;
    this.recognition = null;
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.audioChunks = [];
    this.lastTranscript = '';

    this.init();
  }

  init() {
    this.bindEvents();
    this.updateSessionInfo();
    this.initializeCart();
    this.loadFavoriteRecipes();
  }

  bindEvents() {
    const chatForm = document.getElementById('chatForm');
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const clearChat = document.getElementById('clearChat');
    
    if (chatForm) {
      chatForm.addEventListener('submit', (e) => { e.preventDefault(); this.sendMessage(); });
    }

    if (messageInput) {
      messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { 
          e.preventDefault(); 
          this.sendMessage(); 
        }
      });
    }

    if (clearChat) {
      clearChat.addEventListener('click', () => this.clearChat());
    }

    // 퀵 액션 버튼 이벤트
    document.addEventListener('click', (e) => {
      if (e.target.closest('.quick-action')) {
        const btn = e.target.closest('.quick-action');
        const message = btn.getAttribute('data-message');
        if (message) {
          document.getElementById('messageInput').value = message;
          this.sendMessage();
        }
      }
    });

    // 음성 입력 버튼
    const voiceInput = document.getElementById('voiceInput');
    const voiceCancel = document.getElementById('voiceCancel');
    
    if (voiceInput) {
      voiceInput.addEventListener('click', () => this.toggleVoiceRecording());
    }
    
    if (voiceCancel) {
      voiceCancel.addEventListener('click', () => this.cancelVoiceRecording());
    }

    // 상담사 연결 버튼
    const consultantButton = document.getElementById('consultantButton');
    const imageInput = document.getElementById('imageInput');
    
    if (consultantButton) {
      consultantButton.addEventListener('click', () => this.handleConsultantConnect());
    }
    
    // 이미지 업로드는 숨겨진 input으로만 처리
    if (imageInput) {
      imageInput.addEventListener('change', (e) => this.handleImageUpload(e));
    }
  }

  updateSessionInfo() {
    const sessionInfo = document.getElementById('sessionInfo');
    if (sessionInfo) {
      sessionInfo.textContent = `세션: ${this.sessionId.slice(-4)}`;
    }
  }

  // 채팅 초기화
  clearChat() {
    const messages = document.getElementById('messages');
    if (messages) {
      messages.innerHTML = '';
    }
    this.sessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
    this.updateSessionInfo();
  }

  // 메시지 전송
  async sendMessage(imageFile = null) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;

    const message = messageInput.value.trim();
    if (!message && !imageFile) return;

    // 사용자 메시지 표시
    if (message) {
      this.addMessage('user', message);
    }
    
    if (imageFile) {
      this.addMessage('user', `[이미지 업로드: ${imageFile.name}]`);
    }

    messageInput.value = '';
    this.showLoading(true);

    try {
      const formData = new FormData();
      formData.append('message', message);
      formData.append('session_id', this.sessionId);
      formData.append('user_id', this.userId);
      
      if (imageFile) {
        formData.append('image', imageFile);
      }

      const response = await fetch('/chat_stream', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      this.handleResponse(data);

    } catch (error) {
      console.error('메시지 전송 오류:', error);
      this.addMessage('assistant', '죄송합니다. 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      this.showLoading(false);
    }
  }

  // 응답 처리
  handleResponse(data) {
    if (data.response) {
      this.addMessage('assistant', data.response);
    }

    // 상품 정보가 있으면 사이드바에 표시
    if (data.products && data.products.length > 0) {
      this.updateProductsList(data.products);
      // 상품 탭으로 자동 전환
      if (window.switchRightSidebar) {
        window.switchRightSidebar('products');
      }
    }

    // 레시피 정보가 있으면 사이드바에 표시
    if (data.recipes && data.recipes.length > 0) {
      this.updateRecipesList(data.recipes);
      // 레시피 탭으로 자동 전환
      if (window.switchLeftSidebar) {
        window.switchLeftSidebar('recipes');
      }
    }

    // 장바구니 상태 업데이트
    if (data.cart_state) {
      this.updateCartState(data.cart_state);
    }
  }

  // 메시지 추가
  addMessage(role, content) {
    const messages = document.getElementById('messages');
    if (!messages) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-animation mb-6';
    
    const isUser = role === 'user';
    const messageClass = isUser ? 'user-message' : 'assistant-message';
    
    messageDiv.innerHTML = `
      <div class="flex items-start ${isUser ? 'justify-end' : ''}">
        ${!isUser ? `
          <div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
            <i class="fas fa-robot text-green-600 text-sm"></i>
          </div>
        ` : ''}
        <div class="${isUser ? 'bg-blue-500 text-white' : 'bg-green-50'} rounded-2xl ${isUser ? 'rounded-br-sm' : 'rounded-tl-sm'} px-4 py-3 max-w-md ${messageClass}">
          <div class="text-${isUser ? 'white' : 'gray-800'}">
            ${isLikelyHtml(content) ? content : this.escapeHtml(content).replace(/\n/g, '<br>')}
          </div>
        </div>
        ${isUser ? `
          <div class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center ml-3 flex-shrink-0">
            <i class="fas fa-user text-blue-600 text-sm"></i>
          </div>
        ` : ''}
      </div>
    `;
    
    messages.appendChild(messageDiv);
    this.scrollToBottom();
  }

  // HTML 이스케이프
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 로딩 표시
  showLoading(show) {
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
      if (show) {
        loadingIndicator.classList.remove('hidden');
        this.scrollToBottom();
      } else {
        loadingIndicator.classList.add('hidden');
      }
    }
  }

  // 스크롤을 아래로
  scrollToBottom() {
    const chatContainer = document.getElementById('chatContainer');
    if (chatContainer) {
      setTimeout(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }, 100);
    }
  }

  // 상품 목록 업데이트
  updateProductsList(products) {
    const productsList = document.getElementById('productsList');
    if (!productsList) return;

    productsList.innerHTML = '';
    
    products.forEach((product, index) => {
      const productDiv = document.createElement('div');
      productDiv.className = 'product-card p-3 border rounded-lg';
      
      productDiv.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <h4 class="font-medium text-sm text-gray-800 flex-1">${product.name || '상품명'}</h4>
          <span class="text-green-600 font-semibold text-sm ml-2">${this.formatPrice(product.price || 0)}</span>
        </div>
        <p class="text-gray-600 text-xs mb-2">${product.description || '상품 설명'}</p>
        <div class="flex justify-between items-center">
          <span class="text-xs text-gray-500">${product.unit || '단위'}</span>
          <button class="add-to-cart-btn text-xs px-3 py-1" onclick="tabChatBot.addToCart('${product.sku}', '${product.name}', ${product.price})">
            장바구니
          </button>
        </div>
      `;
      
      productsList.appendChild(productDiv);
    });

    // 빈 메시지 제거
    const emptyMessage = productsList.querySelector('.text-gray-500');
    if (emptyMessage) {
      emptyMessage.remove();
    }
  }

  // 레시피 목록 업데이트
  updateRecipesList(recipes) {
    const recipesList = document.getElementById('recipesList');
    if (!recipesList) return;

    this.recipeCandidates = recipes;
    recipesList.innerHTML = '';
    
    recipes.forEach((recipe, index) => {
      const recipeDiv = document.createElement('div');
      recipeDiv.className = 'recipe-card';
      
      const isFavorited = this.favoriteRecipes.some(fav => fav.title === recipe.title);
      
      recipeDiv.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <h4 class="font-medium text-sm text-gray-800 flex-1">${recipe.title || '레시피명'}</h4>
          <button class="favorite-btn text-sm ${isFavorited ? 'favorited' : ''}" onclick="tabChatBot.toggleFavorite(${index})">
            <i class="fas fa-heart"></i>
          </button>
        </div>
        <p class="text-gray-600 text-xs mb-2">${recipe.description || '레시피 설명'}</p>
        <div class="flex justify-between items-center">
          <span class="text-xs text-gray-500">${recipe.cookingTime || '조리시간: 미정'}</span>
          <button class="text-blue-600 hover:text-blue-800 text-xs font-medium" onclick="tabChatBot.selectRecipe(${index})">
            재료 보기
          </button>
        </div>
      `;
      
      recipesList.appendChild(recipeDiv);
    });

    // 빈 메시지 제거
    const emptyMessage = recipesList.querySelector('.text-gray-500');
    if (emptyMessage) {
      emptyMessage.remove();
    }
  }

  // 가격 포맷팅
  formatPrice(price) {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency: 'KRW'
    }).format(price);
  }

  // 장바구니에 추가
  async addToCart(sku, name, price) {
    console.log('장바구니에 추가:', sku, name, price);
    
    try {
      const response = await fetch('/cart/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: this.userId,
          sku: sku,
          name: name,
          price: price,
          quantity: 1
        })
      });

      if (response.ok) {
        const data = await response.json();
        this.updateCartState(data.cart_state);
        
        // 사용자에게 피드백
        this.addMessage('assistant', `${name}이(가) 장바구니에 추가되었습니다.`);
      } else {
        throw new Error('장바구니 추가 실패');
      }
    } catch (error) {
      console.error('장바구니 추가 오류:', error);
      this.addMessage('assistant', '장바구니 추가 중 오류가 발생했습니다.');
    }
  }

  // 장바구니 상태 업데이트
  updateCartState(cartState) {
    this.cartState = cartState;
    
    // 장바구니 아이템 표시
    const cartItems = document.getElementById('cartItems');
    const cartCount = document.getElementById('cartCount');
    const subtotalAmount = document.getElementById('subtotalAmount');
    const totalAmount = document.getElementById('totalAmount');
    const checkoutButton = document.getElementById('checkoutButton');

    if (!cartState || !cartState.items || cartState.items.length === 0) {
      if (cartItems) {
        cartItems.innerHTML = '<div class="text-gray-500 text-sm text-center py-4">장바구니가 비어있습니다.</div>';
      }
      if (cartCount) cartCount.textContent = '0';
      if (subtotalAmount) subtotalAmount.textContent = '0원';
      if (totalAmount) totalAmount.textContent = '0원';
      if (checkoutButton) checkoutButton.classList.add('hidden');
      
      // 헤더 카운트 업데이트
      if (window.updateCartDisplay) {
        window.updateCartDisplay();
      }
      return;
    }

    // 장바구니 아이템 표시
    if (cartItems) {
      cartItems.innerHTML = '';
      cartState.items.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'bg-gray-50 rounded-lg p-3 text-sm';
        
        itemDiv.innerHTML = `
          <div class="flex justify-between items-start mb-1">
            <span class="font-medium text-gray-800 flex-1">${item.name}</span>
            <button class="text-red-500 hover:text-red-700 ml-2" onclick="tabChatBot.removeFromCart('${item.sku}')">
              <i class="fas fa-times text-xs"></i>
            </button>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-gray-600">${item.quantity}개</span>
            <span class="text-green-600 font-semibold">${this.formatPrice(item.price * item.quantity)}</span>
          </div>
        `;
        
        cartItems.appendChild(itemDiv);
      });
    }

    // 총계 업데이트
    const itemCount = cartState.items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cartState.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const total = subtotal; // 할인 로직이 있다면 여기서 계산

    if (cartCount) cartCount.textContent = itemCount.toString();
    if (subtotalAmount) subtotalAmount.textContent = this.formatPrice(subtotal);
    if (totalAmount) totalAmount.textContent = this.formatPrice(total);
    
    if (checkoutButton) {
      if (itemCount > 0) {
        checkoutButton.classList.remove('hidden');
      } else {
        checkoutButton.classList.add('hidden');
      }
    }

    // 헤더 카운트 업데이트
    if (window.updateCartDisplay) {
      window.updateCartDisplay();
    }
  }

  // 장바구니에서 제거
  async removeFromCart(sku) {
    try {
      const response = await fetch('/cart/remove', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: this.userId,
          sku: sku
        })
      });

      if (response.ok) {
        const data = await response.json();
        this.updateCartState(data.cart_state);
        this.addMessage('assistant', '상품이 장바구니에서 제거되었습니다.');
      } else {
        throw new Error('장바구니 제거 실패');
      }
    } catch (error) {
      console.error('장바구니 제거 오류:', error);
      this.addMessage('assistant', '장바구니 제거 중 오류가 발생했습니다.');
    }
  }

  // 즐겨찾기 토글
  toggleFavorite(recipeIndex) {
    const recipe = this.recipeCandidates[recipeIndex];
    if (!recipe) return;

    const existingIndex = this.favoriteRecipes.findIndex(fav => fav.title === recipe.title);
    
    if (existingIndex >= 0) {
      // 즐겨찾기에서 제거
      this.favoriteRecipes.splice(existingIndex, 1);
    } else {
      // 즐겨찾기에 추가
      this.favoriteRecipes.push({
        title: recipe.title,
        description: recipe.description,
        cookingTime: recipe.cookingTime,
        url: recipe.url,
        ingredients: recipe.ingredients || [],
        addedAt: new Date().toISOString()
      });
    }

    // 로컬 스토리지에 저장
    localStorage.setItem('favoriteRecipes', JSON.stringify(this.favoriteRecipes));
    
    // UI 업데이트
    this.updateRecipesList(this.recipeCandidates);
    this.loadFavoriteRecipes();
    
    const action = existingIndex >= 0 ? '제거' : '추가';
    this.addMessage('assistant', `"${recipe.title}"이(가) 즐겨찾기에서 ${action}되었습니다.`);
  }

  // 즐겨찾기 목록 로드
  loadFavoriteRecipes() {
    const favoritesList = document.getElementById('favoritesList');
    if (!favoritesList) return;

    if (this.favoriteRecipes.length === 0) {
      favoritesList.innerHTML = '<div class="text-gray-500 text-sm text-center py-4">즐겨찾기한 레시피가 없습니다.</div>';
      return;
    }

    favoritesList.innerHTML = '';
    
    this.favoriteRecipes.forEach((recipe, index) => {
      const recipeDiv = document.createElement('div');
      recipeDiv.className = 'recipe-card favorited';
      
      recipeDiv.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <h4 class="font-medium text-sm text-gray-800 flex-1">${recipe.title}</h4>
          <button class="favorite-btn favorited text-sm" onclick="tabChatBot.removeFavorite(${index})">
            <i class="fas fa-heart"></i>
          </button>
        </div>
        <p class="text-gray-600 text-xs mb-2">${recipe.description || '레시피 설명'}</p>
        <div class="flex justify-between items-center">
          <span class="text-xs text-gray-500">${recipe.cookingTime || '조리시간: 미정'}</span>
          <button class="text-blue-600 hover:text-blue-800 text-xs font-medium" onclick="tabChatBot.selectFavoriteRecipe(${index})">
            재료 보기
          </button>
        </div>
      `;
      
      favoritesList.appendChild(recipeDiv);
    });
  }

  // 즐겨찾기에서 제거
  removeFavorite(favoriteIndex) {
    const recipe = this.favoriteRecipes[favoriteIndex];
    if (!recipe) return;

    this.favoriteRecipes.splice(favoriteIndex, 1);
    localStorage.setItem('favoriteRecipes', JSON.stringify(this.favoriteRecipes));
    
    this.loadFavoriteRecipes();
    this.addMessage('assistant', `"${recipe.title}"이(가) 즐겨찾기에서 제거되었습니다.`);
  }

  // 레시피 선택 (재료 보기)
  selectRecipe(recipeIndex) {
    const recipe = this.recipeCandidates[recipeIndex];
    if (!recipe) return;

    const message = `"${recipe.title}" 레시피의 재료를 알려주세요.`;
    document.getElementById('messageInput').value = message;
    this.sendMessage();
  }

  // 즐겨찾기 레시피 선택
  selectFavoriteRecipe(favoriteIndex) {
    const recipe = this.favoriteRecipes[favoriteIndex];
    if (!recipe) return;

    const message = `"${recipe.title}" 레시피의 재료를 알려주세요.`;
    document.getElementById('messageInput').value = message;
    this.sendMessage();
  }

  // 장바구니 초기화
  initializeCart() {
    // 페이지 로드 시 장바구니 상태를 가져옴
    this.loadCartState();
  }

  // 장바구니 상태 로드
  async loadCartState() {
    try {
      const response = await fetch(`/cart/state?user_id=${this.userId}`);
      if (response.ok) {
        const data = await response.json();
        this.updateCartState(data.cart_state);
      }
    } catch (error) {
      console.error('장바구니 상태 로드 오류:', error);
    }
  }

  // 음성 녹음 토글
  toggleVoiceRecording() {
    if (this.isRecording) {
      this.stopVoiceRecording();
    } else {
      this.startVoiceRecording();
    }
  }

  // 음성 녹음 시작
  startVoiceRecording() {
    console.log('음성 녹음 시작');
    // 음성 녹음 로직 구현
    // 기존 chat.js의 음성 녹음 기능을 포팅
  }

  // 음성 녹음 중지
  stopVoiceRecording() {
    console.log('음성 녹음 중지');
    // 음성 녹음 중지 로직 구현
  }

  // 음성 녹음 취소
  cancelVoiceRecording() {
    console.log('음성 녹음 취소');
    // 음성 녹음 취소 로직 구현
  }

  // 상담사 연결 처리
  handleConsultantConnect() {
    console.log('상담사 연결 요청');
    this.addMessage('assistant', '상담사 연결을 요청했습니다. 잠시만 기다려주세요. 🎧');
    
    // 상담사 연결 메시지를 자동으로 보냄
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
      messageInput.value = '상담사와 연결해주세요';
      this.sendMessage();
    }
  }

  // 이미지 업로드 처리
  handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    console.log('이미지 업로드:', file.name);
    this.sendMessage(file);
  }
}

// 전역 변수로 인스턴스 생성
let tabChatBot = null;

// 페이지 로드 시에는 초기화하지 않고 탭 전환 시에만 초기화
document.addEventListener('DOMContentLoaded', function() {
  console.log('Tab-chat.js 로드 완료');
});

// 탭 전환 시 초기화를 위한 함수
function initializeTabChatBot() {
  console.log('TabChatBot 초기화 시작');
  if (!tabChatBot) {
    tabChatBot = new TabChatBot();
    // 전역 변수 업데이트
    window.tabChatBot = tabChatBot;
    console.log('TabChatBot 인스턴스 생성 완료');
  } else {
    console.log('TabChatBot 이미 초기화됨');
  }
}

// 전역으로 내보내기
window.TabChatBot = TabChatBot;
window.tabChatBot = tabChatBot;
window.initializeTabChatBot = initializeTabChatBot;

console.log('Tab 챗봇 시스템 로드 완료');