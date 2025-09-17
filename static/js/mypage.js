// 마이페이지 JavaScript 기능

// 현재 활성화된 메뉴를 추적
let currentActiveMenu = 'orders';
let MYPAGE_USER_ID = null;

// DOM이 로드된 후 실행
// hjs 수정: 탭 통합 환경 가드 — mypage-view가 있을 때만 초기화
document.addEventListener('DOMContentLoaded', function() {
    console.log('마이페이지(탭) 초기화');
    initializeMenuEvents();
    resolveCurrentUser().then(uid => {
        MYPAGE_USER_ID = uid;
        try { updateWelcomeName(); } catch(_){}
        // 기본 탭은 외부에서 showContent 호출로 진입하도록 유지
    });
});

// 메뉴 이벤트 초기화
function initializeMenuEvents() {
    // 모든 메뉴 항목에 클릭 효과 추가
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            // 클릭 효과
            this.style.transform = 'translateX(8px) scale(0.98)';
            setTimeout(() => {
                this.style.transform = 'translateX(4px)';
            }, 150);
        });
    });
}

// 메뉴 클릭 시 콘텐츠 전환
function showContent(contentType) {
    console.log(`메뉴 전환: ${contentType}`);
    
    // 모든 콘텐츠 섹션 숨기기
    const allSections = document.querySelectorAll('.content-section');
    allSections.forEach(section => {
        section.classList.add('hidden');
        section.classList.remove('active');
    });
    
    // 선택된 콘텐츠 보이기
    const targetSection = document.getElementById(`content-${contentType}`);
    if (targetSection) {
        targetSection.classList.remove('hidden');
        targetSection.classList.add('active');
        
        // 부드러운 애니메이션 효과
        targetSection.style.opacity = '0';
        targetSection.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            targetSection.style.transition = 'all 0.3s ease';
            targetSection.style.opacity = '1';
            targetSection.style.transform = 'translateY(0)';
        }, 50);
    }
    
    // 섹션별 데이터 로드
    if (contentType === 'profile') loadUserProfile();
    if (contentType === 'orders') loadOrders();
    if (contentType === 'delivery') loadDeliveries();
    if (contentType === 'chat') loadChatHistory();
    if (contentType === 'recipes') { try { renderSavedRecipes(); } catch(_) {} }
    
    // 메뉴 활성화 상태 업데이트
    setActiveMenu(contentType);
    currentActiveMenu = contentType;
}

// 메뉴 활성화 상태 설정
function setActiveMenu(menuType) {
    // 모든 메뉴 아이템에서 활성화 상태 제거
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.classList.remove('bg-green-600', 'bg-opacity-30');
        item.style.backgroundColor = '';
    });
    
    // 선택된 메뉴 아이템 활성화
    const activeMenuItem = document.querySelector(`[data-menu="${menuType}"]`);
    if (activeMenuItem) {
        activeMenuItem.style.backgroundColor = 'rgba(34, 197, 94, 0.3)';
        activeMenuItem.classList.add('bg-green-600', 'bg-opacity-30');
    }
}

// 회원정보 수정 버튼 클릭
function editProfile() {
    console.log('회원정보 수정 버튼이 클릭되었습니다.');
    showContent('profile');
}

// 개인정보 수정 관련 함수들
function loadUserProfile() {
    console.log('사용자 개인정보 로드');
    
    // API 호출로 사용자 정보 가져오기
    fetch('/api/profile/get')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                populateProfileForm(data.user);
            } else {
                showNotification('사용자 정보를 불러올 수 없습니다.', 'error');
            }
        })
        .catch(error => {
            console.error('사용자 정보 로드 실패:', error);
            showNotification('사용자 정보 로드 중 오류가 발생했습니다.', 'error');
        });
}

function populateProfileForm(userData) {
    console.log('프로필 폼에 데이터 채우기', userData);
    
    // 기본 정보
    const fields = {
        'profileUserId': userData.user_id,
        'profileName': userData.name,
        'profileEmail': userData.email,
        'profilePhone': userData.phone_num,
        'profileBirthDate': userData.birth_date,
        'profileAge': userData.age,
        'profileAddress': userData.address,
        'profilePostNum': userData.post_num,
        'profileHouseHold': userData.house_hold,
        'profileAllergy': userData.allergy,
        'profileUnfavorite': userData.unfavorite
    };
    
    // 폼 필드 채우기
    Object.keys(fields).forEach(fieldId => {
        const element = document.getElementById(fieldId);
        if (element && fields[fieldId] !== null && fields[fieldId] !== undefined) {
            element.value = fields[fieldId];
        }
    });
    
    // 멤버십 정보 (읽기 전용으로 표시)
    const membershipElement = document.getElementById('profileMembership');
    if (membershipElement && userData.membership) {
        const membershipDisplayNames = {
            'basic': 'Basic - 기본 회원',
            'premium': 'Premium - 프리미엄 회원 (월 9,900원)',
            'gold': 'Gold - 골드 회원 (월 19,900원)'
        };
        membershipElement.value = membershipDisplayNames[userData.membership] || userData.membership;
    }
    
    // 성별 라디오 버튼
    if (userData.gender) {
        const genderRadio = document.querySelector(`input[name="gender"][value="${userData.gender}"]`);
        if (genderRadio) {
            genderRadio.checked = true;
        }
    }
    
    // 비건 체크박스
    const veganCheckbox = document.getElementById('profileVegan');
    if (veganCheckbox) {
        veganCheckbox.checked = userData.vegan === 1;
    }
}

function saveProfile() {
    console.log('개인정보 저장 시작');
    
    // 폼 데이터 수집 (멤버십 제외)
    const formData = {
        name: document.getElementById('profileName').value,
        email: document.getElementById('profileEmail').value,
        phone_num: document.getElementById('profilePhone').value,
        birth_date: document.getElementById('profileBirthDate').value,
        address: document.getElementById('profileAddress').value,
        post_num: document.getElementById('profilePostNum').value,
        age: document.getElementById('profileAge').value,
        gender: document.querySelector('input[name="gender"]:checked')?.value,
        house_hold: document.getElementById('profileHouseHold').value,
        vegan: document.getElementById('profileVegan').checked ? 1 : 0,
        allergy: document.getElementById('profileAllergy').value,
        unfavorite: document.getElementById('profileUnfavorite').value
    };
    
    // 필수 필드 검증
    if (!formData.name || !formData.email) {
        showNotification('이름과 이메일은 필수 입력 항목입니다.', 'error');
        return;
    }
    
    // 이메일 형식 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
        showNotification('올바른 이메일 형식을 입력해주세요.', 'error');
        return;
    }
    
    // API 호출로 정보 저장
    fetch('/api/profile/update', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('개인정보가 성공적으로 저장되었습니다.', 'info');
            // 기존 메뉴로 돌아가기
            showContent('orders');
        } else {
            showNotification(data.message || '저장 중 오류가 발생했습니다.', 'error');
        }
    })
    .catch(error => {
        console.error('개인정보 저장 실패:', error);
        showNotification('저장 중 오류가 발생했습니다.', 'error');
    });
}

function cancelProfileEdit() {
    console.log('개인정보 수정 취소');
    showContent('orders');
}

// 사용자 정보 로드
function resolveCurrentUser(){
  return fetch('/auth/status', { credentials:'include' })
    .then(r=>r.json())
    .then(d=> d && d.user_id ? d.user_id : (JSON.parse(localStorage.getItem('user_info')||'{}').user_id || 'anonymous'))
    .catch(()=> 'anonymous');
}

function updateWelcomeName(){
  const el = document.querySelector('.welcome-name');
  const sidebarEl = document.querySelector('.sidebar-user-name');
  // 프로필 API에서 이름 가져오기
  fetch('/api/profile/get', { credentials:'include' })
    .then(r=>r.json())
    .then(d=>{
      if (d && d.success && d.user && d.user.name) {
        if (el) el.textContent = d.user.name;
        if (sidebarEl) sidebarEl.textContent = d.user.name;
      }
    });
}

// 사용자 이름 업데이트 (미래 사용)
function updateUserName(name) {
    const userNameElements = document.querySelectorAll('.user-name, .welcome-name');
    userNameElements.forEach(element => {
        element.textContent = `${name} 님`;
    });
}

// ===== 주문 내역 =====
async function loadOrders(){
  try{
    const uid = MYPAGE_USER_ID || (await resolveCurrentUser());
    const res = await fetch('/api/orders/history', {
      method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include',
      body: JSON.stringify({ user_id: uid, limit: 20 })
    });
    const data = await res.json();
    const orders = Array.isArray(data.orders) ? data.orders : [];
    const list = document.getElementById('ordersList');
    if (!list) return;
    if (orders.length === 0){ list.innerHTML = '<div class="text-gray-500">최근 주문 내역이 없습니다.</div>'; return; }

    // 렌더
    list.innerHTML = orders.map(o=>renderOrderCard(o)).join('');
  }catch(e){ console.error('loadOrders error:', e); }
}

function renderOrderCard(o){
  const code = escapeHtml(String(o.order_code));
  const date = escapeHtml(String(o.order_date||''));
  const status = String(o.order_status||'').toLowerCase();
  const total = formatKRW(o.total_price||0);
  const badge = status.includes('deliver')
    ? '<span class="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">배송완료</span>'
    : '<span class="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">처리중</span>';
  return `
    <div class="bg-gray-50 rounded-lg p-6 border border-gray-200">
      <div class="flex justify-between items-start mb-4">
        <div>
          <h3 class="font-semibold text-lg text-gray-800">주문번호: ${code}</h3>
          <p class="text-gray-600 text-sm">${date}</p>
        </div>
        ${badge}
      </div>
      <div class="border-t mt-4 pt-4 flex justify-between items-center">
        <span class="font-semibold text-lg">총 금액</span>
        <span class="font-bold text-lg text-green-600">${total}원</span>
      </div>
      <div class="mt-3 text-right">
        <button class="order-detail-btn px-3 py-1 text-sm border rounded hover:bg-gray-100" data-code="${code}">상세 보기</button>
      </div>
      <div class="order-detail-panel mt-3 hidden"></div>
    </div>`;
}

// ===== 배송 내역 =====
async function loadDeliveries(){
  try{
    const uid = MYPAGE_USER_ID || (await resolveCurrentUser());
    const res = await fetch('/api/orders/history', {
      method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include',
      body: JSON.stringify({ user_id: uid, limit: 20 })
    });
    const data = await res.json();
    const orders = (data.orders||[]).filter(o=> String(o.order_status||'').toLowerCase().includes('deliver') || String(o.order_status||'').toLowerCase()==='confirmed');
    const list = document.getElementById('deliveryList');
    if (!list) return;
    if (orders.length === 0){ list.innerHTML = '<div class="text-gray-500">표시할 배송 내역이 없습니다.</div>'; return; }
    list.innerHTML = orders.map(o=>renderDeliveryCard(o)).join('');
  }catch(e){ console.error('loadDeliveries error:', e); }
}

function renderDeliveryCard(o){
  const code = escapeHtml(String(o.order_code));
  const status = String(o.order_status||'');
  const badge = status.toLowerCase().includes('deliver')
    ? '<span class="bg-green-500 text-white px-3 py-1 rounded-full text-sm font-medium"><i class="fas fa-check mr-1"></i>배송완료</span>'
    : '<span class="bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-medium"><i class="fas fa-truck mr-1"></i>배송중</span>';
  const date = escapeHtml(String(o.order_date||''));
  return `
  <div class="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg p-6 border border-green-200">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-lg text-gray-800">${code}</h3>
      ${badge}
    </div>
    <p class="text-gray-600 text-sm">주문 일시: ${date}</p>
    <div class="bg-white rounded-lg p-4 mt-4">
      <p class="text-sm text-gray-700"><strong>배송업체:</strong> Qook 배송</p>
      <p class="text-sm text-gray-700"><strong>운송장번호:</strong> - </p>
      <p class="text-sm text-gray-700"><strong>예상 도착:</strong> - </p>
    </div>
  </div>`;
}

// ===== 채팅 히스토리 =====
async function loadChatHistory(){
  try{
    const uid = MYPAGE_USER_ID || (await resolveCurrentUser());
    const res = await fetch('/api/orders/chat-history', {
      method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include',
      body: JSON.stringify({ user_id: uid, limit: 200 })
    });
    const data = await res.json();
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const wrap = document.getElementById('chatHistory');
    if (!wrap) return;
    if (messages.length===0){ wrap.innerHTML = '<div class="text-gray-500">최근 대화가 없습니다.</div>'; return; }
    // hjs 수정: 날짜/세션별 요약 타일 + 상세보기 토글
    const sessions = {};
    messages.forEach(m=>{ const sid = m.log_id || 'unknown'; (sessions[sid]||=([])).push(m); });
    const sids = Object.keys(sessions).sort((a,b)=>{
      const at = new Date((sessions[a][0]?.time)||0).getTime();
      const bt = new Date((sessions[b][0]?.time)||0).getTime();
      return bt - at;
    });
    let html = '';
    sids.forEach((sid, idx)=>{
      const list = sessions[sid].slice().sort((x,y)=> new Date(x.time).getTime() - new Date(y.time).getTime());
      const date = (list[0]?.time||'').slice(0,10);
      const firstUserMsg = (list.find(x=>x.role==='user')?.text || '').slice(0,30);
      const count = list.length;
      html += `
      <div class="bg-gray-50 rounded-lg p-4 border border-gray-200 mb-3">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm text-gray-500">${escapeHtml(date)} • 세션 ${idx+1}</div>
            <div class="text-gray-800 mt-1">${escapeHtml(firstUserMsg || '대화를 시작해보세요')}</div>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">${count} 메시지</span>
            <button class="chat-detail-toggle px-3 py-1 text-sm border rounded hover:bg-gray-100">상세보기</button>
          </div>
        </div>
        <div class="chat-detail-body hidden mt-3 space-y-2">
          ${list.map(m=>renderChatRow(m)).join('')}
        </div>
      </div>`;
    });
    wrap.innerHTML = html;
  }catch(e){ console.error('loadChatHistory error:', e); }
}

function renderChatRow(m){
  const isUser = m.role === 'user';
  const text = escapeHtml(m.text||'');
  const time = escapeHtml(m.time||'');
  if (isUser){
    return `
    <div class="flex items-start">
      <div class="bg-blue-100 p-2 rounded-full mr-3"><i class="fas fa-user text-blue-600"></i></div>
      <div>
        <p class="text-gray-800"><strong>나:</strong> ${text}</p>
        <p class="text-gray-500 text-sm">${time}</p>
      </div>
    </div>`;
  }
  return `
    <div class="flex items-start flex-row-reverse">
      <div class="bg-green-100 p-2 rounded-full ml-3"><i class="fas fa-robot text-green-600"></i></div>
      <div class="bg-green-50 rounded-lg p-3 shadow-sm flex-1">
        <p class="text-gray-800"><strong>Qook:</strong> ${text}</p>
        <p class="text-gray-500 text-sm mt-1 text-right">${time}</p>
      </div>
    </div>`;
}

function formatKRW(n){ const v = Math.round(Number(n)||0); return v.toLocaleString('ko-KR'); }
function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

// 이벤트 위임: 주문 상세 & 채팅 상세 토글
document.addEventListener('click', async (e)=>{
  const btn = e.target.closest('.order-detail-btn');
  if (btn){
    const code = btn.dataset.code; const panel = btn.closest('.bg-gray-50')?.querySelector('.order-detail-panel');
    if (!code || !panel) return;
    try{
      const uid = MYPAGE_USER_ID || (await resolveCurrentUser());
      const res = await fetch('/api/orders/details', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ user_id: uid, order_code: String(code) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail||'상세 조회 실패');
      panel.innerHTML = renderOrderDetails(data);
      panel.classList.toggle('hidden');
    }catch(err){ console.error('order details error:', err); }
  }
  const tgl = e.target.closest('.chat-detail-toggle');
  if (tgl){
    const body = tgl.closest('.bg-gray-50')?.querySelector('.chat-detail-body');
    if (body) body.classList.toggle('hidden');
  }
});

function renderOrderDetails(d){
  const items = (d.items||[]).map((it, idx)=>{
    const name = escapeHtml(it.product||it.name||'');
    const qty = Number(it.quantity||it.qty||0);
    // hjs 수정: order_detail_tbl.price는 라인 합계(= 단가*수량)임 → 추가 곱셈 금지
    const lineTotal = Number(it.price||it.unit_price||0);
    const line = Number(lineTotal||0).toLocaleString('ko-KR');
    return `<div class=\"flex justify-between text-sm\"><div>${idx+1}. ${name} × ${qty}</div><div>${line}원</div></div>`;
  }).join('');
  const subtotal = Number(d.subtotal||0).toLocaleString('ko-KR');
  const discount = Number(d.discount_amount||0).toLocaleString('ko-KR');
  const shipping = Number(d.shipping_fee||0).toLocaleString('ko-KR');
  const total = Number(d.total_price||0).toLocaleString('ko-KR');
  return `
    <div class=\"rounded border p-3 bg-white\"> 
      <div class=\"space-y-1 mb-2\">${items||'<div class=\"text-gray-500 text-sm\">항목 없음</div>'}</div>
      <div class=\"border-t pt-2 text-sm\">
        <div class=\"flex justify-between\"><span>상품 합계</span><span>${subtotal}원</span></div>
        <div class=\"flex justify-between\"><span>할인</span><span class=\"text-red-600\">- ${discount}원</span></div>
        <div class=\"flex justify-between\"><span>배송비</span><span>${shipping}원</span></div>
        <div class=\"flex justify-between font-semibold\"><span>총 결제금액</span><span>${total}원</span></div>
      </div>
    </div>`;
}

// 저장한 레시피 렌더
function renderSavedRecipes(){
  const grid = document.querySelector('#content-recipes .grid');
  if (!grid) return;
  try{
    const uid = JSON.parse(localStorage.getItem('user_info')||'{}').user_id || 'guest';
    const local = JSON.parse(localStorage.getItem(`favorite_recipes_${uid}`)||'[]');
    fetch(`/api/recipes/favorites?user_id=${encodeURIComponent(uid)}`, { credentials:'include' })
      .then(r=>r.json()).then(async data=>{
        let serverItems = (data && data.items) ? data.items : [];
        if ((!serverItems || serverItems.length===0) && Array.isArray(local) && local.length>0){
          try{
            await fetch('/api/recipes/favorites/bulk-sync',{
              method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
              body: JSON.stringify({ user_id: uid, items: local.map(x=>({ user_id:uid, recipe_url:x.url, recipe_title:x.title, snippet:x.description||'' })) })
            });
            const r2 = await fetch(`/api/recipes/favorites?user_id=${encodeURIComponent(uid)}`, { credentials:'include' });
            const d2 = await r2.json();
            serverItems = d2.items||[];
          }catch(e){ console.error('bulk-sync error', e); }
        }
        if (!serverItems || serverItems.length===0){ grid.innerHTML = '<div class="text-gray-500">저장한 레시피가 없습니다.</div>'; return; }
        grid.innerHTML = serverItems.map(r=>{
          const title = escapeHtml(r.recipe_title||'레시피');
          const desc = escapeHtml(r.snippet||'');
          const url = r.recipe_url||'#';
          return `
          <div class=\"bg-white rounded-lg shadow-md overflow-hidden border border-gray-200\"> 
            <div class=\"h-48 bg-gradient-to-br from-green-100 to-blue-100 flex items-center justify-center\">
              <i class=\"fas fa-utensils text-6xl text-green-400\"></i>
            </div>
            <div class=\"p-6\">
              <h3 class=\"font-semibold text-xl text-gray-800 mb-2\">${title}</h3>
              <p class=\"text-gray-600 text-sm mb-4\">${desc}</p>
              <div class=\"mt-4 flex items-center justify-between\">
                <a class=\"inline-block bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 transition duration-200\" target=\"_blank\" href=\"${url}\">레시피 보기</a>
                <button class=\"saved-recipe-ingredients-btn border px-3 py-2 rounded hover:bg-gray-50\" data-title=\"${title}\" data-desc=\"${desc}\" data-url=\"${url}\">재료 추천받기</button>
              </div>
            </div>
          </div>`;
        }).join('');
        // hjs 수정: 즐겨찾기 삭제 버튼 주입
        try { addSavedRecipeRemoveButtons(); } catch(_){ }
      }).catch(()=>{
        if (!local || local.length===0){ grid.innerHTML = '<div class="text-gray-500">저장한 레시피가 없습니다.</div>'; return; }
        grid.innerHTML = local.map(r=>{
          const title = escapeHtml(r.title||'레시피');
          const desc = escapeHtml(r.description||'');
          const url = r.url||'#';
          return `
          <div class=\"bg-white rounded-lg shadow-md overflow-hidden border border-gray-200\"> 
            <div class=\"h-48 bg-gradient-to-br from-green-100 to-blue-100 flex items-center justify-center\">
              <i class=\"fas fa-utensils text-6xl text-green-400\"></i>
            </div>
            <div class=\"p-6\">
              <h3 class=\"font-semibold text-xl text-gray-800 mb-2\">${title}</h3>
              <p class=\"text-gray-600 text-sm mb-4\">${desc}</p>
              <div class=\"mt-4 flex items-center justify-between\">
                <a class=\"inline-block bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 transition duration-200\" target=\"_blank\" href=\"${url}\">레시피 보기</a>
                <button class=\"saved-recipe-ingredients-btn border px-3 py-2 rounded hover:bg-gray-50\" data-title=\"${title}\" data-desc=\"${desc}\" data-url=\"${url}\">재료 추천받기</button>
              </div>
            </div>
          </div>`;
        }).join('');
        // hjs 수정: 즐겨찾기 삭제 버튼 주입(로컬)
        try { addSavedRecipeRemoveButtons(); } catch(_){ }
      });
  }catch(e){ console.error('renderSavedRecipes error:', e); }
}

// 저장한 레시피 → 챗봇으로 재료 추천 연결
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.saved-recipe-ingredients-btn');
  if (!btn) return;
  const title = btn.dataset.title || '';
  const desc = btn.dataset.desc || '';
  const url = btn.dataset.url || '';
  const msg = `선택된 레시피: "${title}"
레시피 설명: ${desc}
URL: ${url}

이 레시피에 필요한 재료들을 우리 쇼핑몰에서 구매 가능한 상품으로 추천해주세요.`;
  try{
    const uid = JSON.parse(localStorage.getItem('user_info')||'{}').user_id || 'guest';
    localStorage.setItem(`chat_pending_message_${uid}`, msg);
  }catch(_){ }
  if (typeof navigateToPage === 'function') navigateToPage('/chat'); else window.location.href = '/chat';
});

// hjs 수정: 저장 레시피 카드에 삭제 버튼을 동적으로 삽입
function addSavedRecipeRemoveButtons(){
  // hjs 수정: 삭제 버튼을 카드 하단 액션이 아닌, 제목/설명 우측(재료 추천받기 버튼 바로 위)로 이동
  const grid = document.querySelector('#content-recipes .grid');
  if (!grid) return;
  const cards = grid.querySelectorAll('.bg-white.rounded-lg.shadow-md');
  cards.forEach(card => {
    const cardBody = card.querySelector('.p-6');
    const actions = cardBody ? cardBody.querySelector('.mt-4.flex.items-center.justify-between') : null;
    if (!cardBody || !actions) return;

    // 기존 하단에 있던 삭제 버튼 제거(중복 방지)
    const oldInActions = actions.querySelector('.saved-recipe-remove-btn');
    if (oldInActions) oldInActions.remove();

    // 타이틀/설명 기준 정보 수집
    const titleEl = cardBody.querySelector('h3');
    const descEl = cardBody.querySelector('p.text-gray-600');
    const anchor = actions.querySelector('a[target="_blank"]');
    const url = anchor ? anchor.getAttribute('href') : '';
    const title = titleEl ? titleEl.textContent : '';

    // 삭제 버튼이 포함된 상단 툴바 생성 (액션 영역 바로 위, 우측 정렬)
    let toolbar = cardBody.querySelector('.saved-recipe-toolbar');
    if (!toolbar){
      toolbar = document.createElement('div');
      toolbar.className = 'saved-recipe-toolbar flex items-center justify-end mb-2';
      // 설명 요소 뒤, 액션 영역 앞에 삽입
      if (descEl && descEl.parentNode === cardBody){
        cardBody.insertBefore(toolbar, actions);
      } else {
        cardBody.insertBefore(toolbar, actions);
      }
    }

    // 버튼 생성 및 주입
    if (!toolbar.querySelector('.saved-recipe-remove-btn')){
      const btn = document.createElement('button');
      btn.className = 'saved-recipe-remove-btn border px-3 py-1 rounded hover:bg-gray-50 text-xs';
      btn.title = '즐겨찾기 삭제';
      btn.setAttribute('data-url', url);
      btn.setAttribute('data-title', title);
      btn.innerHTML = '<i class="fas fa-trash-alt"></i> 삭제';
      toolbar.appendChild(btn);
    }
  });
}

// hjs 수정: 즐겨찾기 삭제 처리
document.addEventListener('click', async (e)=>{
  const btn = e.target.closest('.saved-recipe-remove-btn');
  if (!btn) return;
  const url = btn.dataset.url || '';
  const title = btn.dataset.title || '';
  try{
    const uid = MYPAGE_USER_ID || (await resolveCurrentUser());
    await fetch('/api/recipes/favorites', {
      method:'DELETE', headers:{ 'Content-Type':'application/json' }, credentials:'include',
      body: JSON.stringify({ user_id: uid, recipe_url: url })
    });

    // hjs 수정: 로컬스토리지에서도 삭제 (chat.js와 동일한 방식)
    const favoritesKey = `favorite_recipes_${uid}`;
    try {
      const localFavorites = JSON.parse(localStorage.getItem(favoritesKey) || '[]');
      const updatedFavorites = localFavorites.filter(item =>
        item.url !== url && item.title !== title
      );
      localStorage.setItem(favoritesKey, JSON.stringify(updatedFavorites));
    } catch(localErr) {
      console.error('로컬스토리지 업데이트 실패:', localErr);
    }

    const card = btn.closest('.bg-white.rounded-lg');
    if (card) card.remove();

    // hjs 수정: 챗봇 즐겨찾기 목록 실시간 동기화
    try {
      if (window.chatBot && typeof window.chatBot.renderFavorites === 'function') {
        window.chatBot.renderFavorites();
      }
    } catch(syncErr) {
      console.log('챗봇 동기화 실패:', syncErr);
    }

    showNotification(`"${title}"을(를) 즐겨찾기에서 제거했습니다.`, 'info');
  }catch(err){ console.error('remove favorite on mypage error', err); showNotification('삭제 중 오류가 발생했습니다.', 'error'); }
});

// 알림 표시 함수
function showNotification(message, type = 'info') {
    // 기존 알림이 있으면 제거
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // 새 알림 생성
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'info' ? '#10b981' : '#ef4444'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1000;
        animation: slideIn 0.3s ease;
        max-width: 300px;
        font-weight: 500;
    `;
    
    // 애니메이션 스타일 추가
    if (!document.querySelector('#notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // 3초 후 자동 제거
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}

// 페이지 전환 효과 (부드러운 로딩)
function smoothPageTransition(url) {
    document.body.style.opacity = '0.5';
    setTimeout(() => {
        window.location.href = url;
    }, 150);
}

// 키보드 네비게이션 지원
document.addEventListener('keydown', function(event) {
    // ESC 키로 알림 닫기
    if (event.key === 'Escape') {
        const notification = document.querySelector('.notification');
        if (notification) {
            notification.remove();
        }
    }
});

// 마우스 오버 효과를 위한 추가 이벤트
document.addEventListener('DOMContentLoaded', function() {
    const menuItems = document.querySelectorAll('.menu-item');
    
    menuItems.forEach(item => {
        // 마우스 진입시
        item.addEventListener('mouseenter', function() {
            this.style.transform = 'translateX(8px)';
        });
        
        // 마우스 떠날 때
        item.addEventListener('mouseleave', function() {
            this.style.transform = 'translateX(0)';
        });
    });
});

console.log('마이페이지 JavaScript가 로드되었습니다.');
