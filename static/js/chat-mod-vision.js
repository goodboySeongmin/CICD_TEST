/**
 * chat-mod-vision.js — 비전 AI 기능을 위한 JavaScript 모듈
 * 책임:
 * - 이미지 업로드 및 처리 기능
 * - 비전 레시피 검색 UI 상호작용
 * - 이미지 미리보기 및 관리
 */

// -----------------------------------------------------------------------------
// SECTION: 메시지 출력 핵심 함수
// -----------------------------------------------------------------------------

/**
 * 채팅창에 메시지를 동적으로 추가하는 통합 함수
 * @param {string} sender 'user' 또는 'bot'
 * @param {string|object} content 메시지 내용 (문자열 또는 이미지 객체 {src: '...'})
 */
function addMessage(sender, content) {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) {
        console.error("채팅 메시지 컨테이너를 찾을 수 없습니다.");
        return;
    }

    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'mb-4 message-animation';

    let messageHTML = '';

    if (sender === 'user') {
        // 사용자 메시지 (텍스트 또는 이미지)
        messageHTML = `
            <div class="flex items-end justify-end">
                ${typeof content === 'string'
                    ? `<div class="message-bubble-user mr-2">${content}</div>`
                    : `<div class="message-bubble-user mr-2 p-2"><img src="${content.src}" alt="업로드 이미지" class="max-w-xs rounded-lg"></div>`
                }
                <div class="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-user text-white text-sm"></i>
                </div>
            </div>`;
    } else { // 'bot'
        // 봇 메시지
        messageHTML = `
            <div class="flex items-start">
                <div class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
                    <i class="fas fa-robot text-green-600 text-sm"></i>
                </div>
                <div class="message-bubble-bot">${content}</div>
            </div>`;
    }

    messageWrapper.innerHTML = messageHTML;
    messagesContainer.appendChild(messageWrapper);

    // 스크롤을 맨 아래로 이동
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// -----------------------------------------------------------------------------
// SECTION: 비전 기능 핵심 로직
// -----------------------------------------------------------------------------

// 이미지 업로드 및 처리 관련 변수
let uploadedImageData = null;
let imagePreviewContainer = null;

/**
 * 이미지에서 레시피 검색 (수정된 버전)
 */
async function searchRecipeFromImage() {
    if (!uploadedImageData) {
        alert('먼저 이미지를 업로드해주세요.');
        return;
    }

    try {
        // 1. 사용자 이미지 메시지 출력
        addMessage('user', { src: uploadedImageData });

        // 2. 사용자 텍스트 메시지("...레시피를 찾아줘") 출력
        const searchMessage = '이 이미지에 해당하는 음식의 레시피를 찾아줘';
        addMessage('user', searchMessage);

        // 3. 로딩 상태 표시
        const loadingMessage = addLoadingMessage('이미지를 분석하고 레시피를 검색 중입니다...');

        // 4. 서버로 데이터 전송
        const response = await fetch(uploadedImageData);
        const blob = await response.blob();
        const formData = new FormData();
        formData.append('image', blob, 'uploaded_image.jpg');
        formData.append('message', searchMessage);

        // 사용자 ID, 세션 ID 추가
        let userId = 'anonymous';
        const botInstance = window.chatbot || window._chatbot;
        if (botInstance && botInstance.userId) {
            userId = botInstance.userId;
        } else {
            try {
                const userInfo = localStorage.getItem('user_info');
                if (userInfo) userId = JSON.parse(userInfo).user_id || 'anonymous';
            } catch (e) {}
        }
        formData.append('user_id', userId);
        const sessionId = localStorage.getItem(`chat_session_${userId}`) || '';
        formData.append('session_id', sessionId);


        // 5. 비전 API 호출
        const apiResponse = await fetch('/api/chat/vision', {
            method: 'POST',
            body: formData
        });

        if (!apiResponse.ok) {
            throw new Error(`HTTP error! status: ${apiResponse.status}`);
        }
        const result = await apiResponse.json(); // response_payload가 여기 담겨있음

        // 6. 로딩 메시지 제거
        removeLoadingMessage(loadingMessage);

        // 7. [수정] 최종 봇 응답 메시지를 search_query를 사용하여 동적으로 생성
        let responseText;
        const recipeResults = result.recipe?.results || [];
        const recipeCount = recipeResults.length;
        const searchQuery = result.recipe?.search_query; // 예: "'알리오 올리오'"

        if (recipeCount > 0 && searchQuery) {
            // 작은따옴표(')를 제거하여 "알리오 올리오"로 만듭니다.
            const cleanQuery = searchQuery.replace(/'/g, '');
            responseText = `${cleanQuery} 레시피를 ${recipeCount}개 찾았습니다.`;
        } else {
            // 레시피가 없거나 search_query가 없는 경우, 서버의 기본 응답을 사용합니다.
            responseText = result.response || '관련 레시피를 찾지 못했습니다.';
        }
        addMessage('bot', responseText);

        // 8. (부가 기능) 레시피 목록이 있다면 사이드바 업데이트
        if (window.ChatRecipes && result.recipe) {
            ChatRecipes.updateRecipesList(botInstance, result.recipe);
        }

    } catch (error) {
        console.error('Vision API 호출 실패:', error);
        removeLoadingMessage();
        addMessage('bot', '이미지 분석 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
        // 처리가 끝나면 업로드된 이미지 데이터 초기화
        removeImagePreview();
    }
}

// -----------------------------------------------------------------------------
// SECTION: UI 초기화 및 이벤트 핸들러
// -----------------------------------------------------------------------------

/**
 * 비전 기능 초기화
 */
function initializeVisionFeatures() {
    console.log('Vision features initializing...');
    createImagePreviewContainer();
    setupQuickButton();
    setupDragAndDrop();
    console.log('Vision features initialized successfully');
}

/**
 * 퀵 버튼 설정
 */
function setupQuickButton() {
    const quickButton = document.querySelector('#vision-quick-btn');
    if (quickButton) {
        quickButton.replaceWith(quickButton.cloneNode(true));
        const newButton = document.querySelector('#vision-quick-btn');
        newButton.onclick = function(e) {
            e.preventDefault();
            triggerImageUpload();
            return false;
        };
    } else {
        setTimeout(setupQuickButton, 1000);
    }
}

/**
 * 이미지 미리보기 컨테이너 생성 (실제 미리보기는 사용하지 않음)
 */
function createImagePreviewContainer() {
    if (document.querySelector('#image-preview-container')) return;
    imagePreviewContainer = document.createElement('div');
    imagePreviewContainer.id = 'image-preview-container';
    imagePreviewContainer.style.display = 'none';
    const chatForm = document.querySelector('#chatForm');
    if (chatForm) chatForm.parentElement.insertBefore(imagePreviewContainer, chatForm);
}

/**
 * 이미지 업로드 파일창 트리거
 */
function triggerImageUpload() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', (e) => {
        handleImageUpload(e);
        document.body.removeChild(fileInput);
    });
    document.body.appendChild(fileInput);
    fileInput.click();
}
/**
 * 이미지 업로드 처리
 */
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert('이미지 파일만 업로드 가능합니다.');
        return;
    }
    if (file.size > 10 * 1024 * 1024) { // 10MB
        alert('이미지 파일 크기는 10MB 이하여야 합니다.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        uploadedImageData = e.target.result;
        searchRecipeFromImage(); // 읽기가 완료되면 바로 검색 시작
    };
    reader.onerror = () => alert('이미지를 읽는 중 오류가 발생했습니다.');
    reader.readAsDataURL(file);
}

/**
 * 이미지 미리보기 제거 및 데이터 초기화
 */
function removeImagePreview() {
    uploadedImageData = null;
    if (imagePreviewContainer) {
        imagePreviewContainer.style.display = 'none';
        imagePreviewContainer.innerHTML = '';
    }
}

/**
 * 드래그 앤 드롭 기능 설정
 */
function setupDragAndDrop() {
    const dropZone = document.body;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });
    dropZone.addEventListener('drop', e => {
        const file = e.dataTransfer.files[0];
        if (file) {
            handleImageUpload({ target: { files: [file] } });
        }
    }, false);
}

// -----------------------------------------------------------------------------
// SECTION: 레거시 및 헬퍼 함수
// -----------------------------------------------------------------------------

/** 로딩 메시지 추가 */
function addLoadingMessage(message) {
    if (window.chatbot && typeof window.chatbot.showCustomLoading === 'function') {
        window.chatbot.showCustomLoading(message);
        return { id: 'custom-loading' };
    }
    return null;
}

/** 로딩 메시지 제거 */
function removeLoadingMessage(loadingElement) {
    if (window.chatbot && typeof window.chatbot.hideCustomLoading === 'function') {
        window.chatbot.hideCustomLoading();
    }
}

// -----------------------------------------------------------------------------
// SECTION: 초기화 실행
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function() {
    setTimeout(initializeVisionFeatures, 1000); // DOM 렌더링 후 안정적으로 실행
});

// 전역 함수 노출
window.triggerImageUpload = triggerImageUpload;