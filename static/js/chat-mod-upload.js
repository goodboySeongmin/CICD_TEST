// hjs 수정: 이미지 업로드 모듈 (ChatUpload)
(function(global){
  'use strict';
  const ChatUpload = {
    async handleImageSelected(bot, e){
      const file=e.target.files && e.target.files[0]; if (!file) return;
      const previewUrl=URL.createObjectURL(file); bot.addImageMessage(previewUrl,'user');
      try{
        const form=new FormData();
        form.append('image',file);
        form.append('user_id',bot.userId);
        form.append('session_id',bot.sessionId);
        const headers={}; const csrf=getCSRFToken(); if (csrf) headers['X-CSRFToken']=csrf;
        const res=await fetch('/api/upload/image',{ method:'POST', body:form, headers, credentials:'include' });
        const data=await res.json();
        const imageUrl=data.url||data.image_url||'';
        if (imageUrl){ const hiddenMsg=`__IMAGE_UPLOADED__ ${imageUrl}`; await bot.sendMessage(hiddenMsg,true); }
      }catch(err){ console.error(err); bot.addMessage('이미지 업로드 중 오류가 발생했어요.','bot',true); }
      finally{ e.target.value=''; }
    }
  };
  global.ChatUpload = ChatUpload;
})(window);

