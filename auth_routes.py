"""
FastAPI 인증 라우트
회원가입, 로그인, 로그아웃, 프로필 관리 API
"""

from fastapi import APIRouter, HTTPException, Depends, Response, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
import re
from typing import Optional, List, Dict, Any
import jwt
from datetime import datetime, timedelta
from uuid import uuid4
import logging
import os
import mysql.connector
from mysql.connector import Error

from auth_system.django_auth import auth_manager
from utils import db_audit

logger = logging.getLogger(__name__)

# JWT 설정
SECRET_KEY = "qook_chatbot_secret_key_2024"
ALGORITHM = "HS256"
# 인스턴스 재시작 시 토큰 무효화를 위해 런타임 솔트 적용
_RUNTIME_SALT = os.environ.get("QOOK_INSTANCE_SALT") or uuid4().hex

def _runtime_secret() -> str:
    return f"{SECRET_KEY}:{_RUNTIME_SALT}"
ACCESS_TOKEN_EXPIRE_HOURS = 24

# 보안 스키마
security = HTTPBearer()

# 라우터 생성
auth_router = APIRouter(prefix="/auth", tags=["authentication"])

# Pydantic 모델들
class UserRegistration(BaseModel):
    name: str
    email: EmailStr
    password: str
    phone_num: Optional[str] = None
    birth_date: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[int] = None
    address: Optional[str] = None
    post_num: Optional[str] = None
    allergy: Optional[str] = None
    vegan: Optional[bool] = False
    house_hold: Optional[int] = 1
    unfavorite: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class AddressUpdate(BaseModel):
    address: str
    post_num: str

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    phone_num: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[int] = None
    allergy: Optional[str] = None
    vegan: Optional[bool] = None
    house_hold: Optional[int] = None
    unfavorite: Optional[str] = None

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """JWT 액세스 토큰 생성"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, _runtime_secret(), algorithm=ALGORITHM)
    return encoded_jwt

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """JWT 토큰 검증"""
    try:
        payload = jwt.decode(credentials.credentials, _runtime_secret(), algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    
    return user_id

def _is_valid_email_format(email: str) -> bool:
    pattern = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    return bool(pattern.match(email or ""))

def _db_conn():
    try:
        return mysql.connector.connect(
            host=os.getenv("DB_HOST", "127.0.0.1"),
            user=os.getenv("DB_USER", "qook_user"),
            password=os.getenv("DB_PASSWORD", "qook_pass"),
            database=os.getenv("DB_NAME", "qook_chatbot"),
            port=int(os.getenv("DB_PORT", "3306")),
        )
    except Error:
        return None

def _safe_session_id(token: str) -> str:
    try:
        # 간단한 세션ID 파생(길이 제한)
        return (token or "sess_" + datetime.utcnow().strftime("%s"))[:128]
    except Exception:
        return "sess_fallback"


@auth_router.get("/check-email")
async def check_email(email: str):
    """이메일 중복/형식 확인 API (프론트 실시간 검사용)"""
    try:
        # 형식 검증: 잘못된 형식이면 exists=False로 응답
        if not _is_valid_email_format(email):
            return {"exists": False, "valid": False}

        exists = auth_manager.check_email_exists(email)
        return {"exists": bool(exists), "valid": True}
    except Exception as e:
        logger.error(f"이메일 확인 중 오류: {e}")
        # 네트워크/서버 오류 시 중립 응답
        return {"exists": False, "valid": True}


@auth_router.get("/memberships")
async def list_memberships() -> Dict[str, Any]:
    """멤버십 옵션 목록 반환"""
    conn = _db_conn()
    if not conn:
        raise HTTPException(status_code=500, detail="DB 연결 실패")
    try:
        with conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT membership_name, description, benefits, monthly_fee, discount_rate, free_shipping_threshold
                FROM membership_tbl
                ORDER BY monthly_fee ASC
                """
            )
            rows = cur.fetchall() or []
            options: List[Dict[str, Any]] = []
            for r in rows:
                features = []
                try:
                    import json
                    features = (json.loads(r.get("benefits") or "{}") or {}).get("features", [])
                except Exception:
                    features = []
                options.append({
                    "membership_name": r.get("membership_name"),
                    "description": r.get("description"),
                    "monthly_fee": r.get("monthly_fee"),
                    "discount_rate": float(r.get("discount_rate") or 0.0),
                    "free_shipping_threshold": int(r.get("free_shipping_threshold") or 30000),
                    "features": features,
                })
            return {"options": options}
    except Error as e:
        raise HTTPException(status_code=500, detail=f"멤버십 조회 실패: {e}")
    finally:
        if conn and conn.is_connected():
            conn.close()


class MembershipSelect(BaseModel):
    membership: str

@auth_router.post("/membership/select")
async def select_membership(payload: MembershipSelect, user_id: str = Depends(verify_token)):
    """현재 사용자 멤버십 선택/변경"""
    conn = _db_conn()
    if not conn:
        raise HTTPException(status_code=500, detail="DB 연결 실패")
    try:
        with conn.cursor() as cur:
            # 유효성: membership_tbl에 존재하는지 확인
            cur.execute("SELECT 1 FROM membership_tbl WHERE membership_name=%s", (payload.membership,))
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="존재하지 않는 멤버십입니다.")
            
            # 사용자가 userinfo_tbl에 존재하는지 확인
            cur.execute("SELECT 1 FROM userinfo_tbl WHERE user_id=%s", (user_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="유효하지 않은 사용자입니다.")
            
            # 현재 사용자의 멤버십 확인
            cur.execute("SELECT membership FROM user_detail_tbl WHERE user_id=%s", (user_id,))
            current_membership = cur.fetchone()
            
            # 이미 같은 멤버십이 적용된 경우
            if current_membership and current_membership[0] == payload.membership:
                return {"success": True, "membership": payload.membership, "message": "현재 적용 중인 멤버십입니다."}
            
            # user_detail_tbl 업데이트 또는 삽입 (UPSERT 방식)
            if current_membership:
                # 기존 레코드가 있으면 업데이트
                cur.execute(
                    "UPDATE user_detail_tbl SET membership=%s WHERE user_id=%s",
                    (payload.membership, user_id)
                )
            else:
                # 기존 레코드가 없으면 새로 삽입 (기본값들과 함께)
                cur.execute(
                    "INSERT INTO user_detail_tbl (user_id, membership, house_hold, vegan) VALUES (%s, %s, 1, 0)",
                    (user_id, payload.membership)
                )
            conn.commit()
        return {"success": True, "membership": payload.membership}
    except HTTPException:
        raise
    except Error as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"멤버십 적용 실패: {e}")
    finally:
        if conn and conn.is_connected():
            conn.close()


@auth_router.post("/register")
async def register(user_data: UserRegistration, response: Response):
    """회원가입"""
    try:
        # 필드 정규화: 프론트 이름/키 차이를 서버 스키마에 맞춤
        payload = user_data.dict()
        # phone -> phone_num
        if not payload.get("phone_num") and payload.get("phone"):
            payload["phone_num"] = payload.get("phone")
        # household -> house_hold (정수 변환 안전)
        if not payload.get("house_hold") and payload.get("household") is not None:
            try:
                payload["house_hold"] = int(payload.get("household"))
            except Exception:
                payload["house_hold"] = 1

        # birth_date: 빈 문자열이면 None 처리 (DATE 컬럼 오류 방지)
        if payload.get("birth_date") in ("", None):
            payload["birth_date"] = None

        # age: 문자열로 올 수 있으니 정수화
        if payload.get("age") not in (None, ""):
            try:
                payload["age"] = int(payload.get("age"))
            except Exception:
                payload["age"] = None

        # gender: 허용 값만 유지
        if payload.get("gender") not in ("M", "F", None, ""):
            payload["gender"] = None

        # vegan: bool -> 0/1 정규화
        if isinstance(payload.get("vegan"), bool):
            payload["vegan"] = 1 if payload["vegan"] else 0

        # 간단한 비밀번호 정책(서버 가드): 8자 이상
        if not payload.get("password") or len(payload.get("password")) < 8:
            raise HTTPException(status_code=400, detail="비밀번호는 8자 이상이어야 합니다.")

        try:
            result = auth_manager.create_user(payload)
        except Exception as e:
            logger.error(f"회원가입 내부 오류(데이터 검증/DB): {e}")
            raise HTTPException(status_code=400, detail="요청 데이터가 올바르지 않거나 처리 중 오류가 발생했습니다.")
        
        if result["success"]:
            # 회원가입 성공 시 자동 로그인
            access_token = create_access_token(data={"sub": result["user_id"]})
            # 로그인과 동일하게 세션 쿠키 설정
            response.set_cookie(
                key="access_token",
                value=f"Bearer {access_token}",
                samesite="lax"
            )
            response.set_cookie(
                key="user_id",
                value=result["user_id"],
                samesite="lax"
            )
            
            return {
                "success": True,
                "message": result["message"],
                "user_id": result["user_id"],
                "access_token": access_token,
                "token_type": "bearer"
            }
        else:
            raise HTTPException(status_code=400, detail=result["error"])
            
    except HTTPException as he:
        # 상위로 그대로 전달하여 4xx가 5xx로 변환되지 않도록 함
        raise he
    except Exception as e:
        logger.error(f"회원가입 처리 중 오류: {e}")
        raise HTTPException(status_code=500, detail="회원가입 처리 중 오류가 발생했습니다")

@auth_router.post("/login")
async def login(user_login: UserLogin, response: Response, request: Request):
    """로그인"""
    try:
        result = auth_manager.authenticate_user(user_login.email, user_login.password)

        if result["success"]:
            user = result["user"]
            access_token = create_access_token(data={"sub": user["user_id"]})
            # 세션/로그 기록 (비침투)
            try:
                ua = request.headers.get('user-agent', '')
                ip = request.client.host if request and request.client else ''
                exp = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
                db_audit.insert_user_session(user["user_id"], _safe_session_id(access_token), exp, ua, ip)
            except Exception as e:
                logger.warning(f"login audit 실패: {e}")
            
            # 세션 쿠키로 토큰/유저 설정(브라우저 종료 시 만료)
            response.set_cookie(
                key="access_token",
                value=f"Bearer {access_token}",
                samesite="lax"
            )
            response.set_cookie(
                key="user_id",
                value=user["user_id"],
                samesite="lax"
            )
            
            return {
                "success": True,
                "message": "로그인 성공",
                "user": user,
                "access_token": access_token,
                "token_type": "bearer"
            }
        else:
            raise HTTPException(status_code=401, detail=result["error"])
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"로그인 처리 중 오류: {e}")
        raise HTTPException(status_code=500, detail="로그인 처리 중 오류가 발생했습니다")

@auth_router.post("/logout")
async def logout(response: Response, user_id: str = Depends(verify_token)):
    """로그아웃"""
    try:
        # 모든 쿠키 제거
        response.delete_cookie(key="access_token")
        response.delete_cookie(key="user_id")
        try:
            # hjs 수정: 세션 비활성화 + chat_sessions 완료 + userlog 로그아웃 시간 기록
            db_audit.deactivate_user_sessions(user_id)
            db_audit.complete_sessions_for_user(user_id)
            db_audit.finish_userlog_for_user(user_id)
        except Exception as e:
            logger.warning(f"logout audit 실패: {e}")
        
        return {
            "success": True,
            "message": "로그아웃 되었습니다"
        }
        
    except Exception as e:
        logger.error(f"로그아웃 처리 중 오류: {e}")
        raise HTTPException(status_code=500, detail="로그아웃 처리 중 오류가 발생했습니다")

@auth_router.post("/logout-beacon")
async def logout_beacon(request: Request, response: Response):
    """쿠키 기반 로그아웃(비권한). 브라우저 종료 시 비콘/페치로 호출 가능.
    Authorization 헤더 없이도 쿠키만으로 세션 종료 처리.
    """
    try:
        uid = request.cookies.get("user_id")
        # 쿠키 삭제
        response.delete_cookie(key="access_token")
        response.delete_cookie(key="user_id")
        try:
            if uid:
                # hjs 수정: 브라우저 종료/비콘에서도 세션/로그 마감
                db_audit.deactivate_user_sessions(uid)
                db_audit.complete_sessions_for_user(uid)
                db_audit.finish_userlog_for_user(uid)
        except Exception as e:
            logger.warning(f"logout-beacon audit 실패: {e}")
        return {"success": True}
    except Exception as e:
        logger.error(f"logout-beacon 오류: {e}")
        # 비콘 시나리오에선 실패하더라도 200으로 넘기는 편이 UX에 유리
        return {"success": False}

@auth_router.get("/profile")
async def get_profile(user_id: str = Depends(verify_token)):
    """사용자 프로필 조회"""
    try:
        result = auth_manager.get_user_profile(user_id)
        
        if result["success"]:
            return {
                "success": True,
                "user": result["user"]
            }
        else:
            raise HTTPException(status_code=404, detail=result["error"])
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"프로필 조회 중 오류: {e}")
        raise HTTPException(status_code=500, detail="프로필 조회 중 오류가 발생했습니다")

@auth_router.put("/profile")
async def update_profile(profile_data: ProfileUpdate, user_id: str = Depends(verify_token)):
    """사용자 프로필 업데이트"""
    try:
        # 프로필 업데이트 로직 구현
        # auth_manager에 update_user_profile 메소드 추가 필요
        
        return {
            "success": True,
            "message": "프로필이 업데이트되었습니다"
        }
        
    except Exception as e:
        logger.error(f"프로필 업데이트 중 오류: {e}")
        raise HTTPException(status_code=500, detail="프로필 업데이트 중 오류가 발생했습니다")

@auth_router.put("/address")
async def update_address(address_data: AddressUpdate, user_id: str = Depends(verify_token)):
    """주소 정보 업데이트 (Kakao 주소 API 연동)"""
    try:
        # 주소 업데이트 로직
        # auth_manager에 update_address 메소드 추가 필요
        
        return {
            "success": True,
            "message": "주소가 업데이트되었습니다",
            "address": address_data.address,
            "post_num": address_data.post_num
        }
        
    except Exception as e:
        logger.error(f"주소 업데이트 중 오류: {e}")
        raise HTTPException(status_code=500, detail="주소 업데이트 중 오류가 발생했습니다")

@auth_router.get("/verify-token")
async def verify_current_token(user_id: str = Depends(verify_token)):
    """현재 토큰 유효성 검증"""
    return {
        "success": True,
        "user_id": user_id,
        "message": "유효한 토큰입니다"
    }
