// 페이지 네비게이션 전환 JavaScript

// 전환 상태 추적
let isTransitioning = false;

// 페이지 전환 함수
function navigateToPage(targetUrl) {
    if (isTransitioning) return;
    
    isTransitioning = true;
    
    // 현재 페이지 정보
    const currentPage = getCurrentPageType();
    const targetPage = getPageTypeFromUrl(targetUrl);
    
    console.log(`페이지 전환 시작: ${currentPage} → ${targetPage}`);
    
    // 전환 오버레이 생성
    createTransitionOverlay(targetPage);
    
    // 현재 페이지 페이드아웃
    document.body.classList.add('page-fade-out');
    
    // 스르륵 넘어가는 애니메이션 실행
    setTimeout(() => {
        const overlay = document.querySelector('.slide-overlay');
        if (overlay) {
            overlay.classList.add('active');
        }
    }, 100);
    
    // 실제 페이지 이동
    setTimeout(() => {
        window.location.href = targetUrl;
    }, 800); // 애니메이션이 완료된 후 페이지 이동
}

// 현재 페이지 타입 판별
function getCurrentPageType() {
    const path = window.location.pathname;
    if (path === '/chat') return 'chatbot';
    if (path === '/mypage') return 'mypage';
    return 'unknown';
}

// URL에서 페이지 타입 추출
function getPageTypeFromUrl(url) {
    if (url.includes('/chat')) return 'chatbot';
    if (url.includes('/mypage')) return 'mypage';
    return 'unknown';
}

// 전환 오버레이 생성
function createTransitionOverlay(targetPage) {
    // 기존 오버레이 제거
    const existingOverlay = document.querySelector('.page-transition');
    if (existingOverlay) {
        existingOverlay.remove();
    }
    
    // 페이지별 아이콘 및 텍스트 설정
    const pageConfig = {
        chatbot: {
            icon: 'fas fa-robot',
            title: '챗봇으로 이동 중...',
            subtitle: '신선한 대화를 준비하고 있어요'
        },
        mypage: {
            icon: 'fas fa-user',
            title: '마이페이지로 이동 중...',
            subtitle: '개인 정보를 불러오고 있어요'
        }
    };
    
    const config = pageConfig[targetPage] || pageConfig.chatbot;
    
    // 오버레이 HTML 생성
    const overlay = document.createElement('div');
    overlay.className = 'page-transition';
    overlay.innerHTML = `
        <div class="slide-overlay">
            <div class="transition-content">
                <div class="transition-icon">
                    <i class="${config.icon}"></i>
                </div>
                <div class="transition-text">${config.title}</div>
                <div class="transition-subtitle">${config.subtitle}</div>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    console.log('네비게이션 시스템 초기화');
    
    // 네비게이션 버튼 활성화 상태 설정
    updateNavigationState();
    
    // 페이지 페이드인 효과
    setTimeout(() => {
        document.body.classList.add('page-fade-in');
    }, 100);
    
    // 네비게이션 버튼 이벤트 리스너 추가
    initializeNavigationListeners();
});

// 네비게이션 상태 업데이트
function updateNavigationState() {
    const currentPage = getCurrentPageType();
    const navButtons = document.querySelectorAll('.nav-btn');
    
    navButtons.forEach(btn => {
        btn.classList.remove('active');
        
        // 현재 페이지에 해당하는 버튼 활성화
        if ((currentPage === 'chatbot' && btn.id === 'navChatbot') ||
            (currentPage === 'mypage' && btn.id === 'navMypage')) {
            btn.classList.add('active');
        }
    });
}

// 네비게이션 리스너 초기화
function initializeNavigationListeners() {
    // 챗봇 버튼 클릭
    const chatbotBtn = document.getElementById('navChatbot');
    if (chatbotBtn) {
        chatbotBtn.addEventListener('click', () => {
            if (getCurrentPageType() !== 'chatbot') {
                navigateToPage('/chat');
            }
        });
    }
    
    // 마이페이지 버튼 클릭
    const mypageBtn = document.getElementById('navMypage');
    if (mypageBtn) {
        mypageBtn.addEventListener('click', () => {
            if (getCurrentPageType() !== 'mypage') {
                navigateToPage('/mypage');
            }
        });
    }
    
    // 키보드 단축키 지원
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey || e.metaKey) {
            switch(e.key) {
                case '1':
                    e.preventDefault();
                    if (getCurrentPageType() !== 'chatbot') {
                        navigateToPage('/chat');
                    }
                    break;
                case '2':
                    e.preventDefault();
                    if (getCurrentPageType() !== 'mypage') {
                        navigateToPage('/mypage');
                    }
                    break;
            }
        }
    });
}

// 전환 완료 후 정리
function cleanupTransition() {
    isTransitioning = false;
    const overlay = document.querySelector('.page-transition');
    if (overlay) {
        overlay.remove();
    }
    document.body.classList.remove('page-fade-out');
}

// 페이지 언로드 시 전환 효과 및 로그아웃 처리
window.addEventListener('beforeunload', function() {
    if (!isTransitioning) {
        document.body.classList.add('page-fade-out');
    }
    
    // 브라우저 종료/탭 닫기 시 로그아웃 beacon 호출
    try {
        // sendBeacon을 사용하여 비동기로 로그아웃 API 호출
        // 브라우저가 닫히더라도 요청이 전송됩니다
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/auth/logout-beacon', JSON.stringify({}));
        } else {
            // sendBeacon을 지원하지 않는 브라우저의 경우 폴백
            fetch('/auth/logout-beacon', {
                method: 'POST',
                keepalive: true,
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            }).catch(() => {
                // 브라우저 종료 시 에러가 발생할 수 있으므로 무시
            });
        }
    } catch (error) {
        // beforeunload 이벤트에서는 에러를 무시합니다
        console.warn('브라우저 종료 시 로그아웃 처리 중 오류:', error);
    }
});

// 페이지 unload 시에도 추가 처리 (일부 브라우저에서 beforeunload가 실행되지 않을 수 있음)
window.addEventListener('unload', function() {
    try {
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/auth/logout-beacon', JSON.stringify({}));
        }
    } catch (error) {
        // unload 이벤트에서는 에러를 무시합니다
    }
});

// 페이지 가시성 API로 전환 상태 관리
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
        cleanupTransition();
        updateNavigationState();
    }
});

// 전역 네비게이션 함수 (HTML onclick에서 사용)
window.navigateToPage = navigateToPage;

console.log('네비게이션 시스템 로드 완료');