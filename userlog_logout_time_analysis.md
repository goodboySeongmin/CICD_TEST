# userlog_tbl logout_time NULL 문제 원인 분석

### 수정 대상 파일:                       │  
     │ - static/js/navigation.js (브라우저   │  
     │ 종료 시 beacon 호출)                  │  
     │ - utils/db_audit.py (세션 타임아웃 및 │  
     │ 정리 로직)                            │  
     │ - auth_routes.py (로그인 시 이전 세션 │  
     │ 마감)     

     
## 🔍 현재 상황 개요

`userlog_tbl` 테이블에서 `logout_time` 컬럼이 전부 NULL 값으로 찍히는 문제가 발생하고 있습니다. 이는 사용자의 로그아웃 시점을 추적할 수 없어 사용자 세션 관리 및 분석에 문제를 야기합니다.

## 📋 데이터베이스 구조 분석

### userlog_tbl 테이블 구조
```sql
CREATE TABLE userlog_tbl (
    log_id VARCHAR(45) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    log_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    logout_time DATETIME,  -- 이 컬럼이 항상 NULL
    FOREIGN KEY (user_id) REFERENCES userinfo_tbl(user_id) ON DELETE CASCADE
);
```

- `log_time`: 로그인 시점 (자동으로 현재 시간 설정)
- `logout_time`: 로그아웃 시점 (수동으로 업데이트해야 하지만 NULL 상태)

## 🔧 현재 구현된 로직 분석

### 1. 로그인 시 로그 생성 로직

**파일**: `utils/db_audit.py`의 `ensure_userlog_for_session()` 함수
```python
def ensure_userlog_for_session(user_id: str, session_id: str) -> str:
    """log_id를 session_id(최대 45자)에 매핑하여 생성/유지"""
    log_id = session_id[:45]
    conn = _conn()
    if not conn:
        return log_id
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT IGNORE INTO userlog_tbl (log_id, user_id, log_time)
                VALUES (%s, %s, NOW())
                """,
                (log_id, user_id),
            )
        conn.commit()
```

**호출 위치**: 
- `app.py:247`: `db_audit.ensure_userlog_for_session(state.user_id, state.session_id)`
- `app.py:563`: 주석 처리된 상태

### 2. 로그아웃 시 logout_time 업데이트 로직

**파일**: `utils/db_audit.py`의 `finish_userlog_for_user()` 함수
```python
def finish_userlog_for_user(user_id: str) -> None:
    """사용자의 활성 세션에 대한 logout_time 업데이트"""
    conn = _conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            # 해당 사용자의 logout_time이 null인 가장 최근 log_id를 찾아서 업데이트
            cur.execute(
                """
                UPDATE userlog_tbl 
                SET logout_time = NOW() 
                WHERE user_id = %s 
                AND logout_time IS NULL 
                ORDER BY log_time DESC 
                LIMIT 1
                """,
                (user_id,)
            )
        conn.commit()
```

**호출 위치**:
- `auth_routes.py:366`: 명시적 로그아웃 시 (`/auth/logout` API)
- `auth_routes.py:394`: 브라우저 종료 시 (`/auth/logout-beacon` API)

### 3. 로그아웃 API 호출 상황

#### A. 명시적 로그아웃 (`/auth/logout`)
**파일**: `auth_routes.py:360-373`
```python
response.delete_cookie(key="access_token")
response.delete_cookie(key="user_id")
try:
    # hjs 수정: 세션 비활성화 + chat_sessions 완료 + userlog 로그아웃 시간 기록
    db_audit.deactivate_user_sessions(user_id)
    db_audit.complete_sessions_for_user(user_id)
    db_audit.finish_userlog_for_user(user_id)  # ← 여기서 logout_time 업데이트
except Exception as e:
    logger.warning(f"logout audit 실패: {e}")
```

#### B. 브라우저 종료 시 (`/auth/logout-beacon`)
**파일**: `auth_routes.py:390-397`
```python
if uid:
    # hjs 수정: 브라우저 종료/비콘에서도 세션/로그 마감
    db_audit.deactivate_user_sessions(uid)
    db_audit.complete_sessions_for_user(uid)
    db_audit.finish_userlog_for_user(uid)  # ← 여기서 logout_time 업데이트
```

## ⚠️ 문제 원인 분석

### 주요 원인 1: 브라우저 종료 시 beacon 호출 부재

**현재 상황**:
- `static/js/navigation.js`의 `beforeunload` 이벤트에서 단순히 CSS 효과만 처리
```javascript
window.addEventListener('beforeunload', function() {
    if (!isTransitioning) {
        document.body.classList.add('page-fade-out');
    }
});
```

**문제점**:
- 브라우저 종료/탭 닫기 시 `/auth/logout-beacon` API 호출하는 코드가 없음
- 대부분의 사용자는 로그아웃 버튼을 누르지 않고 브라우저를 그냥 닫음
- 이로 인해 `finish_userlog_for_user()` 함수가 호출되지 않아 `logout_time`이 NULL로 남음

**확인된 beacon 코드**:
- `templates/chat.html:666`: `/auth/logout-beacon` 호출 코드 존재
- `templates/landing.html:347`: `/auth/logout-beacon` 호출 코드 존재
- 하지만 `navigation.js`에는 브라우저 종료 시 beacon 호출 코드가 없음

### 주요 원인 2: 세션 타임아웃 처리 시 userlog 미반영

**현재 상황**:
- `utils/db_audit.py`의 `timeout_inactive_sessions()` 함수는 `chat_sessions` 테이블만 처리
```python
def timeout_inactive_sessions(minutes: int = 10) -> None:
    conn = _conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE chat_sessions
                SET status='timeout', updated_at=NOW()
                WHERE status='active' AND updated_at < (NOW() - INTERVAL %s MINUTE)
                """,
                (minutes,)
            )
        conn.commit()
```

**문제점**:
- 세션 타임아웃 발생 시 `userlog_tbl`의 `logout_time`은 업데이트되지 않음
- 장시간 비활성 상태에서 세션이 만료되어도 로그아웃 시점이 기록되지 않음

### 주요 원인 3: 다중 세션 관리 문제

**현재 상황**:
- `ensure_userlog_for_session()` 함수는 새 세션만 생성
- 기존 활성 세션들의 `logout_time` 처리 로직 없음

**문제점**:
- 한 사용자가 여러 브라우저/탭에서 로그인 시 이전 세션의 `logout_time`이 업데이트되지 않음
- 새 로그인 발생 시 이전 활성 세션들이 자동으로 마감되지 않음

### 주요 원인 4: 에러 처리 및 복구 메커니즘 부족

**현재 상황**:
- `finish_userlog_for_user()` 함수에서 오류 시 단순 warning만 출력
```python
except Error as e:
    logger.warning(f"finish_userlog_for_user 실패: {e}")
```

**문제점**:
- DB 연결 실패, 네트워크 오류 등으로 `logout_time` 업데이트 실패 시 복구 방법 없음
- 실패한 업데이트에 대한 재시도 메커니즘 없음
- 오래된 NULL 레코드들을 정리하는 배치 작업 없음

### 주요 원인 5: 프론트엔드-백엔드 연동 문제

**현재 상황**:
- 일부 페이지(`chat.html`, `landing.html`)에만 logout-beacon 코드 존재
- 모든 페이지에서 일관된 브라우저 종료 처리 부재

**문제점**:
- 페이지별로 다른 로그아웃 처리 방식
- `navigation.js`는 모든 페이지에서 로드되지만 beacon 호출 코드 없음

## 📊 영향도 분석

### 1. 데이터 정확성 문제
- 사용자 세션 지속 시간을 정확히 측정할 수 없음
- 사용자 활동 패턴 분석 불가능

### 2. 시스템 성능 문제
- 끝나지 않은 세션들이 계속 누적
- 정확한 동시 접속자 수 파악 불가

### 3. 비즈니스 분석 문제
- 사용자 체류 시간 분석 불가
- 페이지별 이탈률 계산 불가

## 🔄 현재 구현된 관련 함수들

### db_audit.py 내 관련 함수들
1. `ensure_userlog_for_session()` - 로그인 시 userlog 생성
2. `finish_userlog_for_user()` - 로그아웃 시 logout_time 업데이트
3. `timeout_inactive_sessions()` - 세션 타임아웃 처리 (userlog 미반영)
4. `complete_sessions_for_user()` - 사용자 세션 일괄 완료
5. `deactivate_user_sessions()` - 사용자 세션 비활성화

### 호출 관계도
```
로그인 → ensure_userlog_for_session() → userlog_tbl INSERT (logout_time=NULL)

명시적 로그아웃 → /auth/logout → finish_userlog_for_user() → logout_time 업데이트

브라우저 종료 → (beacon 호출 부재) → /auth/logout-beacon 미호출 → logout_time NULL 유지
```

이 분석을 통해 `logout_time`이 NULL로 남는 주요 원인이 브라우저 종료 시 beacon API 호출 부재임을 확인할 수 있습니다.