// 고정 네비게이션 바 및 페이지 전환 시스템

// 현재 활성 페이지
let currentPage = 'chatbot';

// 페이지 전환 함수
function switchToPage(targetPage) {
    if (currentPage === targetPage) return;
    
    console.log(`페이지 전환: ${currentPage} → ${targetPage}`);
    
    const slider = document.getElementById('pageSlider');
    const navButtons = document.querySelectorAll('.nav-tab');
    
    if (!slider) return;
    
    // 슬라이더 위치 변경
    if (targetPage === 'chatbot') {
        slider.className = 'page-slider show-chatbot slide-transition';
    } else if (targetPage === 'mypage') {
        slider.className = 'page-slider show-mypage slide-transition';
    }
    
    // 네비게이션 버튼 상태 업데이트
    navButtons.forEach(btn => {
        btn.classList.remove('active');
        if ((targetPage === 'chatbot' && btn.id === 'navChatbot') ||
            (targetPage === 'mypage' && btn.id === 'navMypage')) {
            btn.classList.add('active');
        }
    });
    
    // 현재 페이지 업데이트
    currentPage = targetPage;
    
    // 페이지별 추가 초기화
    if (targetPage === 'chatbot') {
        initializeChatbotPage();
    } else if (targetPage === 'mypage') {
        initializeMypagePage();
    }
}

// 챗봇 페이지 초기화
function initializeChatbotPage() {
    console.log('챗봇 페이지 초기화');
    
    // 챗봇 관련 초기화 로직
    const chatContainer = document.querySelector('#chatbotPage .page-content-wrapper');
    if (chatContainer) {
        // 챗봇 페이지가 활성화될 때의 추가 로직
        // 예: 포커스 설정, 상태 복원 등
    }
}

// 마이페이지 초기화
function initializeMypagePage() {
    console.log('마이페이지 초기화');
    
    // 마이페이지 관련 초기화 로직
    const mypageContainer = document.querySelector('#mypagePage .page-content-wrapper');
    if (mypageContainer) {
        // 마이페이지가 활성화될 때의 추가 로직
        // 예: 데이터 로드, 메뉴 상태 복원 등
    }
}

// 키보드 네비게이션
function initializeKeyboardNavigation() {
    document.addEventListener('keydown', function(e) {
        // Alt + 숫자 키로 빠른 전환
        if (e.altKey) {
            switch(e.key) {
                case '1':
                    e.preventDefault();
                    switchToPage('chatbot');
                    break;
                case '2':
                    e.preventDefault();
                    switchToPage('mypage');
                    break;
            }
        }
        
        // 좌우 화살표로 페이지 전환 (Ctrl + 화살표)
        if (e.ctrlKey) {
            switch(e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    if (currentPage === 'mypage') {
                        switchToPage('chatbot');
                    }
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (currentPage === 'chatbot') {
                        switchToPage('mypage');
                    }
                    break;
            }
        }
    });
}


// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    console.log('고정 네비게이션 시스템 초기화');
    
    // 초기 페이지 상태 설정
    const urlPath = window.location.pathname;
    if (urlPath.includes('/mypage')) {
        currentPage = 'mypage';
        switchToPage('mypage');
    } else {
        currentPage = 'chatbot';
        switchToPage('chatbot');
    }
    
    // 키보드 네비게이션 초기화
    initializeKeyboardNavigation();
    
    // 브라우저 뒤로가기/앞으로가기 처리
    window.addEventListener('popstate', function(e) {
        const urlPath = window.location.pathname;
        if (urlPath.includes('/mypage')) {
            switchToPage('mypage');
        } else if (urlPath.includes('/chat')) {
            switchToPage('chatbot');
        }
    });
});

// 페이지 히스토리 관리
function updateBrowserHistory(page) {
    const url = page === 'chatbot' ? '/chat' : '/mypage';
    const title = page === 'chatbot' ? 'Qook 챗봇' : 'Qook 마이페이지';
    
    // 현재 URL과 다를 때만 히스토리 업데이트
    if (window.location.pathname !== url) {
        window.history.pushState({ page }, title, url);
    }
}

// 성능 최적화를 위한 디바운스
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 리사이즈 이벤트 처리 (디바운스 적용)
const handleResize = debounce(() => {
    // 리사이즈 시 레이아웃 재조정
    const slider = document.getElementById('pageSlider');
    if (slider) {
        // 강제로 리플로우 트리거하여 레이아웃 수정
        slider.style.display = 'none';
        slider.offsetHeight; // 리플로우 강제 실행
        slider.style.display = 'flex';
    }
}, 250);

window.addEventListener('resize', handleResize);

// 전역 함수로 내보내기
window.switchToPage = switchToPage;

// 디버깅용
window.getCurrentPage = () => currentPage;

console.log('고정 네비게이션 시스템 로드 완료');