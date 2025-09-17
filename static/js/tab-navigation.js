// 탭 네비게이션 시스템

// 현재 활성 탭
let currentTab = 'chatbot';

// 탭 전환 함수
function switchTab(targetTab) {
    if (currentTab === targetTab) return;
    
    console.log(`탭 전환: ${currentTab} → ${targetTab}`);
    
    // 현재 활성 콘텐츠 숨기기
    const currentContent = document.getElementById(`${currentTab}-content`);
    if (currentContent) {
        currentContent.classList.remove('active');
    }
    
    // 타겟 콘텐츠 보이기
    setTimeout(() => {
        const targetContent = document.getElementById(`${targetTab}-content`);
        if (targetContent) {
            targetContent.classList.add('active');
        }
    }, 150);
    
    // 탭 버튼 상태 업데이트
    const allTabs = document.querySelectorAll('.tab-btn');
    allTabs.forEach(tab => {
        tab.classList.remove('active');
    });
    
    const activeTab = document.querySelector(`[data-tab="${targetTab}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
    }
    
    // 현재 탭 업데이트
    currentTab = targetTab;
    
    // 탭별 초기화
    initializeTabContent(targetTab);
}

// 탭별 콘텐츠 초기화
function initializeTabContent(tab) {
    console.log(`${tab} 탭 초기화`);
    
    switch(tab) {
        case 'chatbot':
            // 약간의 지연 후 초기화 (DOM이 완전히 준비될 때까지)
            setTimeout(() => {
                initializeChatbotTab();
            }, 100);
            break;
        case 'mypage':
            initializeMypageTab();
            break;
    }
}

// 챗봇 탭 초기화
function initializeChatbotTab() {
    console.log('챗봇 탭 초기화 시작');
    
    // DOM 요소 확인
    const chatbotContent = document.getElementById('chatbot-content');
    if (!chatbotContent || !chatbotContent.classList.contains('active')) {
        console.log('챗봇 탭이 활성화되지 않음, 초기화 건너뜀');
        return;
    }
    
    // 사이드바 초기화
    initializeSidebars();
    
    // 약간의 지연 후 챗봇 시스템 초기화
    setTimeout(() => {
        if (window.initializeTabChatBot) {
            console.log('TabChatBot 초기화 호출');
            window.initializeTabChatBot();
        } else {
            console.warn('initializeTabChatBot 함수를 찾을 수 없습니다');
        }
    }, 200);
    
    console.log('챗봇 탭 초기화 완료');
}

// 마이페이지 탭 초기화
function initializeMypageTab() {
    console.log('마이페이지 탭 초기화');
    // 마이페이지 관련 초기화 로직
    // 기존 mypage.js의 초기화 함수들을 호출할 수 있음
}

// 키보드 네비게이션
function initializeKeyboardNavigation() {
    document.addEventListener('keydown', function(e) {
        // Alt + 숫자 키로 빠른 전환
        if (e.altKey) {
            switch(e.key) {
                case '1':
                    e.preventDefault();
                    switchTab('chatbot');
                    break;
                case '2':
                    e.preventDefault();
                    switchTab('mypage');
                    break;
            }
        }
        
        // Ctrl + Tab으로 탭 전환
        if (e.ctrlKey && e.key === 'Tab') {
            e.preventDefault();
            const nextTab = currentTab === 'chatbot' ? 'mypage' : 'chatbot';
            switchTab(nextTab);
        }
    });
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    console.log('탭 네비게이션 시스템 초기화');
    
    // 초기 탭 설정
    const initialContent = document.getElementById('chatbot-content');
    if (initialContent) {
        initialContent.classList.add('active');
    }
    
    // 키보드 네비게이션 초기화
    initializeKeyboardNavigation();
    
    // 탭 버튼 클릭 이벤트 등록
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tab = this.getAttribute('data-tab');
            if (tab) {
                switchTab(tab);
            }
        });
    });
    
    // 초기 챗봇 탭이 활성화되어 있다면 초기화
    setTimeout(() => {
        const chatbotContent = document.getElementById('chatbot-content');
        if (chatbotContent && chatbotContent.classList.contains('active')) {
            console.log('페이지 로드 시 챗봇 탭 초기화');
            initializeChatbotTab();
        }
    }, 500);
});

// 사이드바 시스템
function initializeSidebars() {
    console.log('사이드바 시스템 초기화');
    
    // 좌측 사이드바 버튼 이벤트
    const leftRecipesBtn = document.getElementById('leftSidebarRecipes');
    const leftFavoritesBtn = document.getElementById('leftSidebarFavorites');
    
    console.log('좌측 사이드바 버튼 찾기:', leftRecipesBtn, leftFavoritesBtn);
    
    if (leftRecipesBtn && leftFavoritesBtn) {
        // 기존 이벤트 리스너 제거 후 다시 추가
        leftRecipesBtn.removeEventListener('click', handleLeftRecipesClick);
        leftFavoritesBtn.removeEventListener('click', handleLeftFavoritesClick);
        
        leftRecipesBtn.addEventListener('click', handleLeftRecipesClick);
        leftFavoritesBtn.addEventListener('click', handleLeftFavoritesClick);
        
        console.log('좌측 사이드바 이벤트 리스너 등록 완료');
    } else {
        console.error('좌측 사이드바 버튼을 찾을 수 없습니다');
    }
    
    // 우측 사이드바 버튼 이벤트
    const rightProductsBtn = document.getElementById('rightSidebarProducts');
    const rightCartBtn = document.getElementById('rightSidebarCart');
    
    console.log('우측 사이드바 버튼 찾기:', rightProductsBtn, rightCartBtn);
    
    if (rightProductsBtn && rightCartBtn) {
        // 기존 이벤트 리스너 제거 후 다시 추가
        rightProductsBtn.removeEventListener('click', handleRightProductsClick);
        rightCartBtn.removeEventListener('click', handleRightCartClick);
        
        rightProductsBtn.addEventListener('click', handleRightProductsClick);
        rightCartBtn.addEventListener('click', handleRightCartClick);
        
        console.log('우측 사이드바 이벤트 리스너 등록 완료');
    } else {
        console.error('우측 사이드바 버튼을 찾을 수 없습니다');
    }
}

// 이벤트 핸들러 함수들
function handleLeftRecipesClick() {
    console.log('레시피 버튼 클릭됨');
    switchLeftSidebar('recipes');
}

function handleLeftFavoritesClick() {
    console.log('즐겨찾기 버튼 클릭됨');
    switchLeftSidebar('favorites');
}

function handleRightProductsClick() {
    console.log('상품 버튼 클릭됨');
    switchRightSidebar('products');
}

function handleRightCartClick() {
    console.log('장바구니 버튼 클릭됨');
    switchRightSidebar('cart');
}

// 좌측 사이드바 전환
function switchLeftSidebar(section) {
    console.log(`좌측 사이드바 전환: ${section}`);
    
    // 버튼 상태 업데이트
    const recipesBtn = document.getElementById('leftSidebarRecipes');
    const favoritesBtn = document.getElementById('leftSidebarFavorites');
    
    if (!recipesBtn || !favoritesBtn) {
        console.error('좌측 사이드바 버튼을 찾을 수 없습니다');
        return;
    }
    
    // 모든 버튼의 활성 상태 제거
    recipesBtn.classList.remove('active', 'bg-green-600', 'text-white');
    recipesBtn.classList.add('bg-gray-200', 'text-gray-800');
    
    favoritesBtn.classList.remove('active', 'bg-green-600', 'text-white');
    favoritesBtn.classList.add('bg-gray-200', 'text-gray-800');
    
    // 선택된 버튼 활성화
    if (section === 'recipes') {
        recipesBtn.classList.add('active', 'bg-green-600', 'text-white');
        recipesBtn.classList.remove('bg-gray-200', 'text-gray-800');
    } else {
        favoritesBtn.classList.add('active', 'bg-green-600', 'text-white');
        favoritesBtn.classList.remove('bg-gray-200', 'text-gray-800');
    }
    
    // 콘텐츠 전환
    const recipesContent = document.getElementById('leftSidebarRecipesContent');
    const favoritesContent = document.getElementById('leftSidebarFavoritesContent');
    
    if (!recipesContent || !favoritesContent) {
        console.error('좌측 사이드바 콘텐츠를 찾을 수 없습니다');
        return;
    }
    
    // 모든 콘텐츠 숨기기
    recipesContent.classList.remove('active');
    recipesContent.classList.add('hidden');
    
    favoritesContent.classList.remove('active');
    favoritesContent.classList.add('hidden');
    
    // 선택된 콘텐츠 보이기
    if (section === 'recipes') {
        recipesContent.classList.add('active');
        recipesContent.classList.remove('hidden');
    } else {
        favoritesContent.classList.add('active');
        favoritesContent.classList.remove('hidden');
    }
    
    console.log(`좌측 사이드바 전환 완료: ${section}`);
}

// 우측 사이드바 전환
function switchRightSidebar(section) {
    console.log(`우측 사이드바 전환: ${section}`);
    
    // 버튼 상태 업데이트
    const productsBtn = document.getElementById('rightSidebarProducts');
    const cartBtn = document.getElementById('rightSidebarCart');
    
    if (!productsBtn || !cartBtn) {
        console.error('우측 사이드바 버튼을 찾을 수 없습니다');
        return;
    }
    
    // 모든 버튼의 활성 상태 제거
    productsBtn.classList.remove('active', 'bg-green-600', 'text-white');
    productsBtn.classList.add('bg-gray-200', 'text-gray-800');
    
    cartBtn.classList.remove('active', 'bg-green-600', 'text-white');
    cartBtn.classList.add('bg-gray-200', 'text-gray-800');
    
    // 선택된 버튼 활성화
    if (section === 'products') {
        productsBtn.classList.add('active', 'bg-green-600', 'text-white');
        productsBtn.classList.remove('bg-gray-200', 'text-gray-800');
    } else {
        cartBtn.classList.add('active', 'bg-green-600', 'text-white');
        cartBtn.classList.remove('bg-gray-200', 'text-gray-800');
    }
    
    // 콘텐츠 전환
    const productsContent = document.getElementById('rightSidebarProductsContent');
    const cartContent = document.getElementById('rightSidebarCartContent');
    
    if (!productsContent || !cartContent) {
        console.error('우측 사이드바 콘텐츠를 찾을 수 없습니다');
        return;
    }
    
    // 모든 콘텐츠 숨기기
    productsContent.classList.remove('active');
    productsContent.classList.add('hidden');
    
    cartContent.classList.remove('active');
    cartContent.classList.add('hidden');
    
    // 선택된 콘텐츠 보이기
    if (section === 'products') {
        productsContent.classList.add('active');
        productsContent.classList.remove('hidden');
    } else {
        cartContent.classList.add('active');
        cartContent.classList.remove('hidden');
        
        // 장바구니 섹션으로 전환할 때 장바구니 업데이트
        updateCartDisplay();
    }
    
    console.log(`우측 사이드바 전환 완료: ${section}`);
}

// 장바구니 표시 업데이트
function updateCartDisplay() {
    console.log('장바구니 표시 업데이트');
    
    try {
        // 장바구니 카운트 헤더 업데이트
        const cartCountHeader = document.getElementById('cartCountHeader');
        const cartCount = document.getElementById('cartCount');
        
        console.log('장바구니 요소 찾기:', { cartCountHeader, cartCount });
        
        if (cartCountHeader && cartCount) {
            const count = cartCount.textContent || '0';
            cartCountHeader.textContent = count;
            
            console.log('장바구니 카운트 업데이트:', count);
            
            if (parseInt(count) > 0) {
                cartCountHeader.classList.remove('hidden');
            } else {
                cartCountHeader.classList.add('hidden');
            }
        } else {
            console.warn('장바구니 카운트 요소를 찾을 수 없습니다');
        }
        
        // TabChatBot이 있다면 장바구니 상태 로드
        if (window.tabChatBot && typeof window.tabChatBot.loadCartState === 'function') {
            console.log('TabChatBot 장바구니 상태 로드');
            window.tabChatBot.loadCartState();
        }
        
    } catch (error) {
        console.error('장바구니 표시 업데이트 오류:', error);
    }
}

// 강제로 사이드바 이벤트 리스너 재등록 (디버깅용)
function forceSidebarReinitialization() {
    console.log('사이드바 강제 재초기화');
    setTimeout(() => {
        initializeSidebars();
    }, 100);
}

// 전역 함수로 내보내기
window.switchTab = switchTab;
window.switchLeftSidebar = switchLeftSidebar;
window.switchRightSidebar = switchRightSidebar;
window.updateCartDisplay = updateCartDisplay;
window.initializeSidebars = initializeSidebars;
window.forceSidebarReinitialization = forceSidebarReinitialization;

// 디버깅용
window.getCurrentTab = () => currentTab;

console.log('탭 네비게이션 시스템 로드 완료');