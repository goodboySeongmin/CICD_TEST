(function(){
  function setup(bot){
    bot.handleEvidenceUploadButtonClick = function(e){
      const btn = e.target.closest('.evidence-upload-btn');
      if (!btn) return;
      const row = btn.closest('tr.order-item-row');
      const maxQty = row ? parseInt(row.dataset.qty || '1', 10) : 1;
      const orderCode = btn.dataset.order;
      const product = btn.dataset.product;
      if (!orderCode || !product) return;
      let qty = 1;
      if (maxQty > 1) {
        const ans = prompt(`환불 요청 수량을 입력해주세요 (1 ~ ${maxQty})`, '1');
        const n = parseInt(ans || '1', 10);
        qty = isNaN(n) ? 1 : Math.min(Math.max(1, n), maxQty);
      }
      bot.ensureEvidenceInput();
      bot.pendingEvidence = { orderCode, product, quantity: qty };
      bot.showCustomLoading('cs', `'${product}' 사진을 업로드해주세요`, 'dots');
      bot.evidenceInput.click();
      setTimeout(() => bot._fileDialogClosedCheck(), 700);
    };

    bot.ensureEvidenceInput = function(){
      if (bot.evidenceInput) return;
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
      input.addEventListener('change', (e) => bot.handleEvidenceSelected(e));
      document.body.appendChild(input); bot.evidenceInput = input;
    };

    bot.handleEvidenceSelected = async function(e){
      const file = e.target.files && e.target.files[0];
      e.target.value=''; bot.hideCustomLoading();
      if (!file || !bot.pendingEvidence) return;
      // hjs 수정: 업로드 전 타입 검증 (png, jpg/jpeg, gif, webp)
      try{
        const okTypes = ['image/png','image/jpeg','image/gif','image/webp'];
        const name = (file.name||'').toLowerCase();
        const extOk = ['.png','.jpg','.jpeg','.gif','.webp'].some(x=>name.endsWith(x));
        if (!(okTypes.includes(file.type) || extOk)){
          const msg = '해당 파일은 지원되지 않는 파일입니다. 지원되는 파일로 업로드를 진행해주세요. png, jpg, jpeg, gif, webp';
          bot.addMessage(msg, 'bot', true);
          return;
        }
      }catch(_){ }
      const previewUrl = URL.createObjectURL(file);
      bot.addImageMessage(previewUrl, 'user');
      const { orderCode, product, quantity } = bot.pendingEvidence; bot.pendingEvidence = null;
      bot.showCustomLoading('cs','증빙 이미지를 분석 중입니다...','dots');
      try{
        const form = new FormData();
        form.append('image', file);
        form.append('user_id', bot.userId);
        form.append('order_code', orderCode);
        form.append('product', product);
        form.append('quantity', String(quantity||1));
        const headers={}; const csrf = getCSRFToken(); if (csrf) headers['X-CSRFToken']=csrf;
        const res = await fetch('/api/cs/evidence',{ method:'POST', body:form, headers, credentials:'include' });
        const data = await res.json();
        // hjs 수정: 서버에서 지원되지 않는 파일 메시지를 내려준 경우 사용자에게 안내만 표시
        if (data && data.cs && data.cs.message && !data.cs.ticket){
          bot.addMessage(String(data.cs.message), 'bot', true);
        } else {
          bot.renderEvidenceResultBubble(data, { orderCode, product });
        }
      }catch(err){ console.error(err); bot.addMessage('이미지 업로드/분석 중 오류가 발생했어요.','bot',true); }
      finally{ bot.hideCustomLoading(); }
    };

    bot._fileDialogClosedCheck = function(){
      try{
        const hasFile = !!(bot.evidenceInput && bot.evidenceInput.files && bot.evidenceInput.files.length>0);
        if (!hasFile) bot.hideCustomLoading();
      }catch(_){ bot.hideCustomLoading(); }
    };
  }

  window.CSEvidence = { setup };
})();

