/**
 * 회원가입 페이지 JavaScript (단일 <form> 버전)
 * - 스텝 전환/검증/제출
 * - 비밀번호 강도/일치, 이메일 중복, 주소 검색, 전체동의
 */

class RegistrationManager {
  constructor() {
    this.currentStep = 1;
    this.totalSteps = 3;
    this.formData = {};

    this.initializeElements();
    this.bindEvents();
    this.updateStepDisplay();
  }

  /* -------------------- 초기화 -------------------- */
  initializeElements() {
    // 스텝 컨테이너(HTML의 .step-panel)
    this.stepPanels = document.querySelectorAll(".step-panel");

    // 인디케이터/프로그레스바(없어도 동작하도록 null-safe)
    this.stepIndicators = document.querySelectorAll(".step-indicator");
    this.progressBar = document.querySelector(".progress-fill");

    // 폼
    this.form = document.getElementById("registerForm");

    // 스텝 버튼들 (ID는 HTML과 1:1 매칭)
    this.next1Btn = document.getElementById("nextStep1");
    this.next2Btn = document.getElementById("nextStep2");
    this.prev2Btn = document.getElementById("prevStep2");
    this.prev3Btn = document.getElementById("prevStep3");
    this.submitBtn = document.getElementById("submitRegister");

    // 메시지 영역(없으면 조용히 패스)
    this.errorMessage = document.getElementById("errorMessage");
    this.errorText = document.getElementById("errorText");
    this.successMessage = document.getElementById("successMessage");
    this.successText = document.getElementById("successText");

    // 약관
    this.agreeAll = document.getElementById("agreeAll");
    this.agreeTerms = document.getElementById("agreeTerms");
    this.agreePrivacy = document.getElementById("agreePrivacy");
    this.agreeMarketing = document.getElementById("agreeMarketing");

    // 비밀번호/이메일 UI
    this.pwd = document.getElementById("password");
    this.pwd2 = document.getElementById("passwordConfirm");
    this.toggle1 = document.getElementById("togglePassword1");
    this.toggle2 = document.getElementById("togglePassword2");
    this.strengthBars = document.querySelectorAll(".password-strength-bar");
    this.strengthText = document.getElementById("passwordStrengthText");
    this.emailInput = document.getElementById("email");
    this.emailCheckBox = document.getElementById("emailCheck");
    this.emailCheckText = document.getElementById("emailCheckText");

    // 기타
    this.phoneInput = document.getElementById("phoneNum");
  }

  bindEvents() {
    // 스텝 이동
    this.next1Btn?.addEventListener("click", () => this.goNextFrom(1));
    this.next2Btn?.addEventListener("click", () => this.goNextFrom(2));
    this.prev2Btn?.addEventListener("click", () => this.showPanel(1));
    this.prev3Btn?.addEventListener("click", () => this.showPanel(2));

    // 폼 제출 가로채기 (마지막 스텝)
    this.form?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    // 주소 검색
    document
      .getElementById("searchAddress")
      ?.addEventListener("click", () => this.openAddressSearch());

    // 실시간 유효성/UI
    // 이메일 형식/중복 검사
    this.emailInput?.addEventListener("blur", () => this.checkEmailDuplicate());
    this.emailInput?.addEventListener("input", () => {
      const v = this.emailInput.value.trim();
      const basicValid = this.emailInput.checkValidity?.() ?? true;
      const regexValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      if (!v) {
        this._setEmailCheck(null);
      } else if (!basicValid || !regexValid) {
        this._setEmailCheck(false, "올바른 이메일 형식을 입력해주세요.");
      } else {
        // 형식이 유효하면 메시지 숨기고(깜빡임 방지), blur 시 서버 중복 검사 진행
        this._setEmailCheck(null);
      }
    });
    this.pwd?.addEventListener("input", () => this.updatePasswordStrength());
    this.pwd?.addEventListener("input", () => this.validatePasswordMatch());
    this.pwd2?.addEventListener("input", () => this.validatePasswordMatch());
    this.toggle1?.addEventListener("click", () => this.toggleVisibility(this.pwd));
    this.toggle2?.addEventListener("click", () => this.toggleVisibility(this.pwd2));
    this.phoneInput?.addEventListener("input", () => this.formatPhoneNumber());

    // 전체 동의
    this.agreeAll?.addEventListener("change", () => {
      const v = !!this.agreeAll.checked;
      if (this.agreeTerms) this.agreeTerms.checked = v;
      if (this.agreePrivacy) this.agreePrivacy.checked = v;
      if (this.agreeMarketing) this.agreeMarketing.checked = v;
    });
  }

  /* -------------------- 스텝 전환/표시 -------------------- */
  showPanel(index) {
    this.currentStep = index;
    this.updateStepDisplay();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  updateStepDisplay() {
    // 패널 표시/숨김
    this.stepPanels?.forEach((p, i) => {
      p.classList.toggle("hidden", i !== this.currentStep - 1);
      p.classList.toggle("active", i === this.currentStep - 1);
    });

    // 인디케이터
    this.stepIndicators?.forEach((el, i) => {
      el.classList.toggle("completed", i + 1 < this.currentStep);
      el.classList.toggle("active", i + 1 === this.currentStep);
    });

    // 프로그레스 채우기
    if (this.progressBar) {
      const percent = ((this.currentStep - 1) / (this.totalSteps - 1)) * 100;
      this.progressBar.style.width = `${percent}%`;
    }

    // 버튼 표시 제어 (submit 버튼은 HTML에서 type="submit")
    this.prev2Btn && (this.prev2Btn.style.display = this.currentStep === 2 ? "inline-flex" : "none");
    this.prev3Btn && (this.prev3Btn.style.display = this.currentStep === 3 ? "inline-flex" : "none");
    this.next1Btn && (this.next1Btn.style.display = this.currentStep === 1 ? "inline-flex" : "none");
    this.next2Btn && (this.next2Btn.style.display = this.currentStep === 2 ? "inline-flex" : "none");
    this.submitBtn && (this.submitBtn.style.display = this.currentStep === 3 ? "inline-flex" : "none");
  }

  async goNextFrom(step) {
    if (this.currentStep !== step) return;
    if (await this.validateCurrentStep()) {
      this.saveFormData(); // 누적 저장
      this.showPanel(step + 1);
    }
  }

  /* -------------------- 검증 -------------------- */
  async validateCurrentStep() {
    const panel = document.getElementById(`step${this.currentStep}Panel`);
    if (!panel) {
      this.showError("현재 단계 패널을 찾을 수 없습니다.");
      return false;
    }

    // 현재 패널 내 required만 검사 (숨겨진 요소 무시)
    const reqs = panel.querySelectorAll("input[required], select[required], textarea[required]");
    for (const el of reqs) {
      if (el.disabled || el.readOnly) continue;
      if (!el.checkValidity()) {
        const label = this._getFieldLabel(el, panel);
        this.showError(`${label}을(를) 올바르게 입력해주세요.`);
        el.reportValidity?.();
        el.focus();
        return false;
      }
    }

    // 추가 규칙
    if (this.currentStep === 1) {
      if (!(await this.validateStep1())) return false;
    }
    if (this.currentStep === 2) {
      if (!this.validateStep2()) return false;
    }
    if (this.currentStep === 3) {
      if (!this.validateStep3()) return false;
    }

    this.hideMessages();
    return true;
  }

  // 필드 라벨 텍스트 가져오기(placeholder를 사용하지 않음)
  _getFieldLabel(el, scope) {
    const byFor = (el.id && (scope || document).querySelector(`label[for="${el.id}"]`)) || null;
    let text = byFor?.textContent || "";
    if (!text) {
      // 같은 컨테이너 내 첫 번째 label 우선
      const container = el.closest('div');
      text = container?.querySelector('label')?.textContent || "";
    }
    if (!text) text = el.getAttribute('aria-label') || "";
    if (!text) text = el.getAttribute('data-label') || el.getAttribute('title') || "";
    if (!text) text = el.name || "필드";
    return (text || "").replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  }

  async validateStep1() {
    const name = document.getElementById("name");
    const email = document.getElementById("email");
    const password = document.getElementById("password");
    const passwordConfirm = document.getElementById("passwordConfirm");

    if (!name || !email || !password || !passwordConfirm) {
      this.showError("필수 입력 필드를 찾을 수 없습니다.");
      return false;
    }

    if (!name.value.trim()) return this._fail(name, "이름을 입력해주세요.");
    if (!email.value.trim()) return this._fail(email, "이메일을 입력해주세요.");
    if (!password.value.trim()) return this._fail(password, "비밀번호를 입력해주세요.");
    if (!passwordConfirm.value.trim()) return this._fail(passwordConfirm, "비밀번호 확인을 입력해주세요.");

    // hjs 수정: 비밀번호 8자 미만 경고
    if ((password.value || '').length < 8) {
      return this._fail(password, "비밀번호는 8자이상 입력해야합니다.");
    }

    if (password.value !== passwordConfirm.value) {
      return this._fail(passwordConfirm, "비밀번호가 일치하지 않습니다.");
    }

    // 이메일 중복
    const ok = await this.checkEmailDuplicate();
    return ok;
  }

  validateStep2() {
    // 선택값이면 생략 가능. 입력했다면 범위 체크.
    const ageEl = document.getElementById("age");
    const hhEl = document.getElementById("houseHold");

    if (ageEl?.value) {
      const age = Number(ageEl.value);
      if (Number.isNaN(age) || age < 1 || age > 120) {
        return this._fail(ageEl, "올바른 나이를 입력해주세요. (1-120세)");
      }
    }

    if (hhEl?.value) {
      const n = Number(hhEl.value);
      if (Number.isNaN(n) || n < 1 || n > 20) {
        return this._fail(hhEl, "가구원 수를 올바르게 입력해주세요. (1-20명)");
      }
    }
    return true;
  }

  validateStep3() {
    const address = document.getElementById("address");
    const postNum = document.getElementById("postNum");
    const agreeTerms = document.getElementById("agreeTerms");
    const agreePrivacy = document.getElementById("agreePrivacy");

    if (!address || !postNum) {
      this.showError("필수 입력 필드를 찾을 수 없습니다.");
      return false;
    }
    if (!address.value || !postNum.value) {
      this.showError("주소를 검색하여 선택해주세요.");
      return false;
    }
    if (!agreeTerms?.checked) {
      this.showError("[필수] 이용약관에 동의해주세요.");
      return false;
    }
    if (!agreePrivacy?.checked) {
      this.showError("[필수] 개인정보 처리방침에 동의해주세요.");
      return false;
    }
    return true;
  }

  _fail(el, msg) {
    this.showError(msg);
    el?.focus();
    return false;
  }

  /* -------------------- 유틸/검사 -------------------- */
  async checkEmailDuplicate() {
    const email = this.emailInput?.value?.trim();
    if (!email) {
      this._setEmailCheck(null);
      return true; // 비어있으면 여기서는 막지 않음
    }

    // 1) 클라이언트 측 형식 검증 (type="email" + 추가 정규식)
    const basicValid = this.emailInput?.checkValidity?.() ?? true;
    const regexValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!basicValid || !regexValid) {
      this._setEmailCheck(false, "올바른 이메일 형식을 입력해주세요.");
      return false;
    }

    try {
      const snapshot = email; // 사용자가 값 변경 시 결과 적용 방지
      const resp = await fetch(`/auth/check-email?email=${encodeURIComponent(email)}`);
      const data = await resp.json();

      // 2) 서버가 형식 부적합을 반환한 경우에도 실패 처리
      if (data && data.valid === false) {
        this._setEmailCheck(false, "올바른 이메일 형식을 입력해주세요.");
        return false;
      }

      // 사용자가 검사 중 값을 바꿨다면 결과 무시
      if ((this.emailInput?.value?.trim() || "") !== snapshot) {
        return true;
      }

      if (data?.exists) {
        this._setEmailCheck(false, "이미 사용 중인 이메일입니다.");
        return false;
      }
      this._setEmailCheck(true, "사용 가능한 이메일입니다.");
      return true;
    } catch (e) {
      console.warn("이메일 중복 검사 오류:", e);
      // 네트워크 오류 시 UI만 초기화하고 진행 허용
      this._setEmailCheck(null);
      return true;
    }
  }

  _setEmailCheck(ok, msg = "") {
    if (!this.emailCheckBox || !this.emailCheckText) return;
    if (ok === null) {
      this.emailCheckBox.classList.add("hidden");
      return;
    }
    this.emailCheckBox.classList.remove("hidden");
    this.emailCheckText.textContent = msg;
    this.emailCheckText.className = ok ? "text-green-600" : "text-red-600";
  }

  validatePasswordMatch() {
    if (!this.pwd || !this.pwd2) return;
    const match = this.pwd.value && this.pwd.value === this.pwd2.value;
    this.pwd2.classList.toggle("border-green-500", match);
    this.pwd2.classList.toggle("border-red-500", !match && !!this.pwd2.value);
  }

  updatePasswordStrength() {
    if (!this.pwd || !this.strengthBars || !this.strengthText) return;

    const v = this.pwd.value || "";
    let score = 0;
    if (v.length >= 8) score++;
    if (/[a-z]/.test(v)) score++;
    if (/[A-Z]/.test(v)) score++;
    if (/\d/.test(v)) score++;
    if (/[^A-Za-z0-9]/.test(v)) score++;

    // 0~5 점수를 0~4개의 바에 매핑
    const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#16a34a"];
    const labels = ["매우 약함", "약함", "보통", "강함", "매우 강함"];
    const idx = Math.max(0, Math.min(score - 1, 4));
    const color = colors[idx];
    const text = score ? labels[idx] : "비밀번호 강도";

    this.strengthBars.forEach((bar, i) => {
      bar.style.backgroundColor = i < score ? color : "#e5e7eb";
    });
    this.strengthText.textContent = text;
    this.strengthText.style.color = score ? color : "";
  }

  toggleVisibility(input) {
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
  }

  formatPhoneNumber() {
    const el = this.phoneInput;
    if (!el) return;
    let v = (el.value || "").replace(/[^\d]/g, "");
    if (v.length >= 11) {
      v = v.replace(/(\d{3})(\d{4})(\d{4}).*/, "$1-$2-$3");
    } else if (v.length >= 7) {
      v = v.replace(/(\d{3})(\d{3,4})(\d{0,4}).*/, "$1-$2-$3");
    } else if (v.length >= 3) {
      v = v.replace(/(\d{3})(\d{0,4}).*/, "$1-$2");
    }
    el.value = v;
  }

  /* -------------------- 데이터/제출 -------------------- */
  saveFormData() {
    if (!this.form) return;
    const fd = new FormData(this.form);
    // 기본 필드
    for (const [k, v] of fd.entries()) this.formData[k] = v;
    // 체크박스 (체크 여부)
    this.form
      .querySelectorAll('input[type="checkbox"]')
      .forEach((c) => (this.formData[c.name] = !!c.checked));
  }

  async handleSubmit() {
    // 마지막 스텝 검증
    const ok = await this.validateCurrentStep();
    if (!ok) return;

    this.saveFormData();
    await this.submitRegistration();
  }

  getCSRFToken() {
    // Django CSRF 토큰 쿠키에서 가져오기
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async submitRegistration() {
    this.setLoading(true);
    this.hideMessages();

    try {
      const csrf = this.getCSRFToken();
      const resp = await fetch("/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRFToken": csrf } : {}),
        },
        body: JSON.stringify(this.formData),
        credentials: "same-origin",
      });

      const data = await resp.json().catch(() => ({}));

      if (resp.ok && (data.success ?? true)) {
        this.showSuccess("회원가입이 완료되었습니다! 멤버십 선택 페이지로 이동합니다...");
        if (data.access_token) {
            localStorage.setItem("access_token", data.access_token);
            if (data.user) localStorage.setItem("user_info", JSON.stringify(data.user));
        }
        const nextUrl = window.POST_REGISTER_REDIRECT || "/membership";
        setTimeout(() => (window.location.href = nextUrl), 1200);
        } else {
        this.showError(data.detail || data.message || "회원가입에 실패했습니다.");
        }
    } catch (e) {
      console.error("Registration error:", e);
      this.showError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      this.setLoading(false);
    }
  }

  /* -------------------- 주소 검색 -------------------- */
  openAddressSearch() {
    // daum.Postcode가 전역에 로드되어 있어야 함
    new daum.Postcode({
      oncomplete: (data) => {
        const fullAddress = data.roadAddress || data.jibunAddress || "";
        document.getElementById("postNum")?.setAttribute("value", data.zonecode || "");
        const addrEl = document.getElementById("address");
        if (addrEl) {
          addrEl.removeAttribute("readonly");
          addrEl.value = fullAddress;
          addrEl.setAttribute("readonly", "readonly");
        }
        document.getElementById("detailAddress")?.focus();
      },
    }).open();
  }

  /* -------------------- 로딩/메시지 -------------------- */
  setLoading(loading) {
    [this.next1Btn, this.next2Btn, this.prev2Btn, this.prev3Btn, this.submitBtn].forEach((b) => {
      if (!b) return;
      b.disabled = loading;
      b.classList.toggle("opacity-50", loading);
      b.classList.toggle("cursor-not-allowed", loading);
    });

    if (this.submitBtn) {
      const btnText = this.submitBtn.querySelector("#registerButtonText");
      const spinner = document.getElementById("registerSpinner");
      if (loading) {
        if (btnText) btnText.textContent = "가입 중...";
        spinner?.classList.remove("hidden");
      } else {
        if (btnText) btnText.textContent = "회원가입 완료";
        spinner?.classList.add("hidden");
      }
    }
  }

  showError(message) {
    if (this.errorText && this.errorMessage) {
      this.errorText.textContent = message;
      this.errorMessage.classList.remove("hidden");
      this.successMessage?.classList.add("hidden");
      this.errorMessage.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      // 메시지 영역이 없으면 alert로 폴백
      console.warn("[Register] ", message);
    }
  }

  showSuccess(message) {
    if (this.successText && this.successMessage) {
      this.successText.textContent = message;
      this.successMessage.classList.remove("hidden");
      this.errorMessage?.classList.add("hidden");
      this.successMessage.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      console.info("[Register] ", message);
    }
  }

  hideMessages() {
    this.errorMessage?.classList.add("hidden");
    this.successMessage?.classList.add("hidden");
  }
}

/* -------------------- 부팅 -------------------- */
document.addEventListener("DOMContentLoaded", () => {
  window.registrationManager = new RegistrationManager();

  // 진행 중 이탈 방지(선택)
  window.addEventListener("beforeunload", (e) => {
    const m = window.registrationManager;
    if (m && m.currentStep > 1 && m.currentStep < 3) {
      e.preventDefault();
      e.returnValue = "회원가입을 진행 중입니다. 페이지를 떠나시겠습니까?";
    }
  });
});
