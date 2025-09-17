from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, EmailStr
from typing import Optional
import mysql.connector
from datetime import datetime
import logging

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 라우터 생성
router = APIRouter(prefix="/api/profile", tags=["profile"])

# 데이터베이스 연결 함수
def get_db_connection():
    try:
        connection = mysql.connector.connect(
            host='localhost',
            database='qook_chatbot',
            user='qook_user',
            password='qook_pass',
            charset='utf8mb4',
            collation='utf8mb4_unicode_ci'
        )
        return connection
    except mysql.connector.Error as e:
        logger.error(f"데이터베이스 연결 실패: {e}")
        raise HTTPException(status_code=500, detail="데이터베이스 연결에 실패했습니다.")

# Pydantic 모델 정의
class UserProfileUpdate(BaseModel):
    name: str
    email: EmailStr
    phone_num: Optional[str] = None
    birth_date: Optional[str] = None
    address: Optional[str] = None
    post_num: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    house_hold: Optional[int] = None
    vegan: Optional[int] = 0
    allergy: Optional[str] = None
    unfavorite: Optional[str] = None

class UserProfileResponse(BaseModel):
    success: bool
    user: Optional[dict] = None
    message: Optional[str] = None

# 현재 사용자 ID 가져오기: 쿠키 기반(JWT > user_id 순)
def get_current_user_id(request: Request) -> str:
    """쿠키의 access_token(JWT)을 검증하여 사용자 ID를 추출합니다.
    유효한 토큰이 없으면 'anonymous'를 반환합니다.
    """
    try:
        token = request.cookies.get("access_token")
        if token and token.startswith("Bearer "):
            import jwt
            from auth_routes import ALGORITHM as _ALG
            from auth_routes import _runtime_secret as _sec
            payload = jwt.decode(token[7:], _sec(), algorithms=[_ALG])
            uid = payload.get("sub")
            if uid:
                return uid
    except Exception:
        pass
    return "anonymous"

@router.get("/get")
async def get_user_profile(request: Request):
    """사용자 개인정보 조회"""
    user_id = get_current_user_id(request)
    
    connection = None
    cursor = None
    
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        
        # 사용자 정보 조회 (JOIN을 사용해 한 번에 가져오기)
        query = """
        SELECT 
            u.user_id, u.name, u.birth_date, u.email, u.phone_num, u.address, u.post_num,
            ud.gender, ud.age, ud.allergy, ud.vegan, ud.house_hold, ud.unfavorite, ud.membership
        FROM userinfo_tbl u
        LEFT JOIN user_detail_tbl ud ON u.user_id = ud.user_id
        WHERE u.user_id = %s
        """
        
        cursor.execute(query, (user_id,))
        user_data = cursor.fetchone()
        
        if not user_data:
            return UserProfileResponse(
                success=False,
                message="사용자 정보를 찾을 수 없습니다."
            )
        
        # 날짜 형식 변환
        if user_data.get('birth_date'):
            user_data['birth_date'] = str(user_data['birth_date'])
        
        return UserProfileResponse(
            success=True,
            user=user_data
        )
        
    except mysql.connector.Error as e:
        logger.error(f"데이터베이스 오류: {e}")
        raise HTTPException(status_code=500, detail="데이터베이스 오류가 발생했습니다.")
    except Exception as e:
        logger.error(f"예상치 못한 오류: {e}")
        raise HTTPException(status_code=500, detail="서버 오류가 발생했습니다.")
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()

@router.post("/update")
async def update_user_profile(profile_data: UserProfileUpdate, request: Request):
    """사용자 개인정보 수정"""
    user_id = get_current_user_id(request)
    
    connection = None
    cursor = None
    
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        
        # 트랜잭션 시작
        connection.start_transaction()
        
        # userinfo_tbl 업데이트
        userinfo_query = """
        UPDATE userinfo_tbl 
        SET name = %s, email = %s, phone_num = %s, birth_date = %s, address = %s, post_num = %s
        WHERE user_id = %s
        """
        
        userinfo_values = (
            profile_data.name,
            profile_data.email,
            profile_data.phone_num,
            profile_data.birth_date if profile_data.birth_date else None,
            profile_data.address,
            profile_data.post_num,
            user_id
        )
        
        cursor.execute(userinfo_query, userinfo_values)
        
        # user_detail_tbl 확인 및 업데이트/삽입
        check_detail_query = "SELECT user_id FROM user_detail_tbl WHERE user_id = %s"
        cursor.execute(check_detail_query, (user_id,))
        detail_exists = cursor.fetchone()
        
        if detail_exists:
            # 기존 레코드 업데이트 (멤버십 제외)
            detail_update_query = """
            UPDATE user_detail_tbl 
            SET gender = %s, age = %s, allergy = %s, vegan = %s, 
                house_hold = %s, unfavorite = %s
            WHERE user_id = %s
            """
            
            detail_values = (
                profile_data.gender,
                profile_data.age,
                profile_data.allergy,
                profile_data.vegan,
                profile_data.house_hold,
                profile_data.unfavorite,
                user_id
            )
            
            cursor.execute(detail_update_query, detail_values)
        else:
            # 새 레코드 삽입 (멤버십 제외, 기본값 사용)
            detail_insert_query = """
            INSERT INTO user_detail_tbl 
            (user_id, gender, age, allergy, vegan, house_hold, unfavorite, membership)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'basic')
            """
            
            detail_values = (
                user_id,
                profile_data.gender,
                profile_data.age,
                profile_data.allergy,
                profile_data.vegan,
                profile_data.house_hold,
                profile_data.unfavorite
            )
            
            cursor.execute(detail_insert_query, detail_values)
        
        # 트랜잭션 커밋
        connection.commit()
        
        return UserProfileResponse(
            success=True,
            message="개인정보가 성공적으로 저장되었습니다."
        )
        
    except mysql.connector.Error as e:
        if connection:
            connection.rollback()
        logger.error(f"데이터베이스 오류: {e}")
        raise HTTPException(status_code=500, detail="데이터베이스 오류가 발생했습니다.")
    except Exception as e:
        if connection:
            connection.rollback()
        logger.error(f"예상치 못한 오류: {e}")
        raise HTTPException(status_code=500, detail="서버 오류가 발생했습니다.")
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()

@router.get("/membership-options")
async def get_membership_options():
    """멤버십 옵션 목록 조회"""
    connection = None
    cursor = None
    
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        
        query = """
        SELECT membership_name, description, monthly_fee, discount_rate
        FROM membership_tbl
        ORDER BY monthly_fee ASC
        """
        
        cursor.execute(query)
        memberships = cursor.fetchall()
        
        return {
            "success": True,
            "memberships": memberships
        }
        
    except mysql.connector.Error as e:
        logger.error(f"데이터베이스 오류: {e}")
        raise HTTPException(status_code=500, detail="멤버십 정보를 불러올 수 없습니다.")
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()
