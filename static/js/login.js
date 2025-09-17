// 로그인 폼 처리
class LoginHandler {
  constructor() {
    this.form = document.getElementById('loginForm');
    this.emailInput = document.getElementById('email');
    this.passwordInput = document.getElementById('password');
    this.loginButton = document.getElementById('loginButton');
    this.loginButtonText = document.getElementById('loginButtonText');
    this.loginSpinner = document.getElementById('loginSpinner');
    this.errorMessage = document.getElementById('errorMessage');
    this.errorText = document.getElementById('errorText');
    this.successMessage = document.getElementById('successMessage');
    this.successText = document.getElementById('successText');
    this.togglePasswordButton = document.getElementById('togglePassword');

    this.bindEvents();
  }

  bindEvents() {
    this.form.addEventListener('submit', (e) => this.handleLogin(e));
    this.togglePasswordButton.addEventListener('click', () => this.togglePassword());
  }

  async handleLogin(event) {
    event.preventDefault();

    const email = this.emailInput.value.trim();
    const password = this.passwordInput.value;

    if (!email || !password) {
      this.showError('이메일과 비밀번호를 모두 입력해주세요.');
      return;
    }

    this.setLoading(true);
    this.hideMessages();

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        this.showSuccess('로그인 성공! 메인 페이지로 이동합니다...');
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('user_info', JSON.stringify(data.user));
        // hjs 수정: 새 로그인 시 이전 채팅 세션/메시지 초기화
        try {
          const uid = (data.user && (data.user.user_id || data.user.id || data.user.uid)) || '';
          if (uid) {
            localStorage.removeItem(`chat_messages_${uid}`);
            localStorage.removeItem(`chat_session_${uid}`);
            localStorage.removeItem(`chat_pending_message_${uid}`);
          }
        } catch (_) {}
        setTimeout(() => { window.location.href = '/chat'; }, 1500);
      } else {
        this.showError(data.detail || data.message || '로그인에 실패했습니다.');
      }
    } catch (error) {
      console.error('Login error:', error);
      this.showError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      this.setLoading(false);
    }
  }

  togglePassword() {
    const type = this.passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    this.passwordInput.setAttribute('type', type);
    const icon = this.togglePasswordButton.querySelector('i');
    icon.className = type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
  }

  setLoading(loading) {
    this.loginButton.disabled = loading;
    if (loading) {
      this.loginButtonText.textContent = '로그인 중...';
      this.loginSpinner.classList.remove('hidden');
    } else {
      this.loginButtonText.textContent = '로그인';
      this.loginSpinner.classList.add('hidden');
    }
  }

  showError(message) {
    this.errorText.textContent = message;
    this.errorMessage.classList.remove('hidden');
    this.successMessage.classList.add('hidden');
  }

  showSuccess(message) {
    this.successText.textContent = message;
    this.successMessage.classList.remove('hidden');
    this.errorMessage.classList.add('hidden');
  }

  hideMessages() {
    this.errorMessage.classList.add('hidden');
    this.successMessage.classList.add('hidden');
  }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  new LoginHandler();
});
