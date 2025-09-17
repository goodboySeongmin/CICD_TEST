// hjs 수정: 음성 입력/녹음 모듈 (ChatVoice)
(function(global){
  'use strict';
  const ChatVoice = {
    async toggleVoiceRecording(bot){
      const nowRecording = !bot.isRecording;
      bot.isRecording = nowRecording;
      const micBtn = document.getElementById('voiceInput');
      const cancelBtn = document.getElementById('voiceCancel');
      const submitBtn = document.querySelector('button[type="submit"]');
      const input = document.getElementById('messageInput');
      if (nowRecording){
        if (micBtn) { micBtn.classList.add('recording'); micBtn.title='녹음 중'; }
        if (cancelBtn) { cancelBtn.classList.remove('hidden'); cancelBtn.classList.add('show'); }
        if (submitBtn) submitBtn.style.display = 'none'; // 전송버튼 숨김
        if (input) input.setAttribute('disabled','disabled');
        bot.canceled = false;
        const Recog = getSpeechRecognitionCtor();
        if (Recog) { ChatVoice.startSpeechRecognition(bot, Recog); }
        else { await ChatVoice.startMediaRecorder(bot); }
      } else {
        if (bot.recognition) bot.recognition.stop();
        if (bot.mediaRecorder) bot.mediaRecorder.stop();
        if (micBtn) micBtn.classList.remove('recording');
        if (cancelBtn) { cancelBtn.classList.add('hidden'); cancelBtn.classList.remove('show'); }
        if (submitBtn) submitBtn.style.display = 'flex'; // 전송버튼 표시
        if (input) input.removeAttribute('disabled');
      }
    },
    cancelVoiceRecording(bot){
      if (!bot.isRecording) return;
      bot.canceled = true;
      ChatVoice.stopVoiceUI(bot);
      if (bot.recognition) {
        try { bot.recognition.abort(); } catch (_) {}
        try { bot.recognition.stop(); } catch (_) {}
        bot.recognition = null;
      }
      if (bot.mediaRecorder) {
        try { if (bot.mediaRecorder.state !== 'inactive') bot.mediaRecorder.stop(); } catch (_) {}
        bot.mediaRecorder = null;
      }
      if (bot.mediaStream) {
        try { bot.mediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}
        bot.mediaStream = null;
      }
      bot.audioChunks = [];
      bot.lastTranscript = '';
    },
    stopVoiceUI(bot){
      bot.isRecording = false;
      const micBtn = document.getElementById('voiceInput');
      const cancelBtn = document.getElementById('voiceCancel');
      const submitBtn = document.querySelector('button[type="submit"]');
      const input = document.getElementById('messageInput');
      if (micBtn) micBtn.classList.remove('recording');
      if (cancelBtn) { cancelBtn.classList.add('hidden'); cancelBtn.classList.remove('show'); }
      if (submitBtn) submitBtn.style.display = 'flex'; // 전송버튼 복원
      if (input) input.removeAttribute('disabled');
    },
    startSpeechRecognition(bot, Recog){
      try {
        bot.lastTranscript = '';
        const r = new Recog();
        bot.recognition = r;
        r.lang = 'ko-KR';
        r.continuous = true;
        r.interimResults = true;
        r.onresult = (event) => {
          let finalText = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            if (res.isFinal) finalText += res[0].transcript;
          }
          if (finalText) bot.lastTranscript += finalText;
        };
        r.onerror = (e) => {
          const isAbort = bot.canceled || (e && (e.error === 'aborted' || e.name === 'AbortError'));
          if (!isAbort) { console.error('SpeechRecognition error:', e); bot.addMessage('음성 인식 중 오류가 발생했어요.', 'bot', true); }
          bot.recognition = null;
          ChatVoice.stopVoiceUI(bot);
        };
        r.onend = () => {
          const text = (bot.lastTranscript || '').trim();
          ChatVoice.stopVoiceUI(bot);
          if (!bot.canceled && text) { bot.addMessage(text, 'user'); bot.sendMessage(text, false); }
          bot.recognition = null;
        };
        r.start();
      } catch (err) { console.error(err); bot.addMessage('브라우저 음성인식을 사용할 수 없어요.', 'bot', true); ChatVoice.stopVoiceUI(bot); }
    },
    async startMediaRecorder(bot){
      try {
        bot.audioChunks = [];
        bot.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(bot.mediaStream);
        bot.mediaRecorder = mr;
        mr.ondataavailable = (e) => e.data && bot.audioChunks.push(e.data);
        mr.onstop = async () => {
          ChatVoice.stopVoiceUI(bot);
          const finalize = () => {
            if (bot.mediaStream) { bot.mediaStream.getTracks().forEach(t => t.stop()); bot.mediaStream = null; }
            bot.mediaRecorder = null;
          };
          try {
            if (bot.canceled) { finalize(); return; }
            const blob = new Blob(bot.audioChunks, { type: 'audio/webm' });
            const form = new FormData();
            form.append('audio', blob, 'voice.webm');
            form.append('user_id', bot.userId);
            form.append('session_id', bot.sessionId);
            const headers = {}; const csrf = getCSRFToken(); if (csrf) headers['X-CSRFToken'] = csrf;
            const res = await fetch('/api/upload/audio', { method: 'POST', body: form, headers, credentials: 'include' });
            const data = await res.json();
            const text = (data && data.text || '').trim();
            if (text) { bot.addMessage(text, 'user'); bot.sendMessage(text, false); }
            else if (data && data.url) { const hiddenMsg = `__AUDIO_UPLOADED__ ${data.url}`; bot.sendMessage(hiddenMsg, true); bot.addMessage('음성 전사를 받을 수 없었어요.', 'bot'); }
          } catch (e) { console.error(e); bot.addMessage('오디오 업로드 중 오류가 발생했어요.', 'bot', true); }
          finally { finalize(); }
        };
        mr.start();
      } catch (err) { console.error(err); bot.addMessage('마이크 접근 권한이 없거나 사용할 수 없어요.', 'bot', true); ChatVoice.stopVoiceUI(bot); }
    },
  };
  global.ChatVoice = ChatVoice;
})(window);

