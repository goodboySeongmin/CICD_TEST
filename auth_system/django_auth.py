"""
Django 연동 인증 시스템
FastAPI와 Django User 모델을 연결하여 회원가입/로그인 처리
"""

import hashlib
import uuid
from datetime import datetime
from typing import Optional, Dict, Any
import mysql.connector
from mysql.connector import Error
import logging

logger = logging.getLogger(__name__)

# DB 연결 설정 (기존과 동일)
DB_CONFIG = {
    'host': '127.0.0.1',
    'user': 'qook_user',
    'password': 'qook_pass',
    'database': 'qook_chatbot',
    'port': 3306
}

class DjangoAuthManager:
    """Django 스타일 인증 관리자"""
    
    def __init__(self):
        self.salt = "qook_chatbot_salt"
    
    def hash_password(self, password: str) -> str:
        """Django 스타일 비밀번호 해싱"""
        return hashlib.pbkdf2_hmac('sha256', 
                                 password.encode('utf-8'), 
                                 self.salt.encode('utf-8'), 
                                 100000).hex()
    
    def verify_password(self, password: str, hashed: str) -> bool:
        """비밀번호 검증"""
        return self.hash_password(password) == hashed
    
    def check_email_exists(self, email: str) -> bool:
        """이메일 중복 확인"""
        conn = self.get_db_connection()
        if not conn:
            return False
        
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT user_id FROM userinfo_tbl WHERE email = %s", (email,))
                return cursor.fetchone() is not None
        except Exception as e:
            logger.error(f"이메일 중복 확인 오류: {e}")
            return False
        finally:
            conn.close()
    
    def create_user(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        """새 사용자 생성"""
        conn = self.get_db_connection()
        if not conn:
            return {"success": False, "error": "DB 연결 실패"}
        
        try:
            with conn.cursor() as cursor:
                # 이메일 중복 확인
                cursor.execute("SELECT user_id FROM userinfo_tbl WHERE email = %s", (user_data['email'],))
                if cursor.fetchone():
                    return {"success": False, "error": "이미 가입된 이메일입니다"}
                
                # 사용자 ID 생성
                user_id = f"user_{uuid.uuid4().hex[:8]}"
                # userinfo_tbl에 기본 정보 저장
                cursor.execute("""
                    INSERT INTO userinfo_tbl (user_id, name, birth_date, email, phone_num, address, post_num)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    user_id,
                    user_data['name'],
                    user_data.get('birth_date'),
                    user_data['email'],
                    user_data.get('phone_num'),
                    user_data.get('address', ''),
                    user_data.get('post_num', '')
                ))
                
                # user_detail_tbl에 상세 정보 저장
                cursor.execute("""
                    INSERT INTO user_detail_tbl (user_id, gender, age, allergy, vegan, house_hold, unfavorite, membership)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    user_id,
                    user_data.get('gender'),
                    user_data.get('age'),
                    user_data.get('allergy'),
                    user_data.get('vegan', 0),
                    user_data.get('house_hold', 1),
                    user_data.get('unfavorite'),
                    user_data.get('membership', 'basic')
                ))
                
                # Django 스타일 auth_user 테이블에도 저장 (호환성)
                password_hash = self.hash_password(user_data['password'])
                cursor.execute("""
                    INSERT INTO auth_user (id, username, email, password, first_name, last_name, is_active, is_staff, is_superuser, date_joined, last_login)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    user_id,
                    user_data['email'],
                    user_data['email'],
                    password_hash,
                    user_data['name'],
                    '',
                    1,  # is_active
                    0,  # is_staff
                    0,  # is_superuser
                    datetime.now(),
                    None
                ))
                
                conn.commit()
                
                return {
                    "success": True,
                    "user_id": user_id,
                    "message": "회원가입이 완료되었습니다"
                }
                
        except Error as e:
            conn.rollback()
            logger.error(f"회원가입 실패: {e}")
            return {"success": False, "error": "회원가입 처리 중 오류가 발생했습니다"}
        
        finally:
            if conn and conn.is_connected():
                conn.close()
    
    def authenticate_user(self, email: str, password: str) -> Dict[str, Any]:
        """사용자 로그인 인증"""
        conn = self.get_db_connection()
        if not conn:
            return {"success": False, "error": "DB 연결 실패"}
        
        try:
            with conn.cursor(dictionary=True) as cursor:
                # 사용자 정보 조회
                cursor.execute("""
                    SELECT u.user_id, u.name, u.email, a.password, ud.membership
                    FROM userinfo_tbl u
                    JOIN auth_user a ON u.user_id = a.id
                    LEFT JOIN user_detail_tbl ud ON u.user_id = ud.user_id
                    WHERE u.email = %s
                """, (email,))
                
                user = cursor.fetchone()
                if not user:
                    return {"success": False, "error": "등록되지 않은 이메일입니다"}
                
                # 비밀번호 확인
                if not self.verify_password(password, user['password']):
                    return {"success": False, "error": "비밀번호가 일치하지 않습니다"}
                
                # 로그인 시간 업데이트
                cursor.execute("UPDATE auth_user SET last_login = %s WHERE id = %s", 
                             (datetime.now(), user['user_id']))
                conn.commit()
                
                return {
                    "success": True,
                    "user": {
                        "user_id": user['user_id'],
                        "name": user['name'],
                        "email": user['email'],
                        "membership": user['membership']
                    }
                }
                
        except Error as e:
            logger.error(f"로그인 실패: {e}")
            return {"success": False, "error": "로그인 처리 중 오류가 발생했습니다"}
        
        finally:
            if conn and conn.is_connected():
                conn.close()
    
    def get_user_profile(self, user_id: str) -> Dict[str, Any]:
        """사용자 프로필 조회"""
        conn = self.get_db_connection()
        if not conn:
            return {"success": False, "error": "DB 연결 실패"}
        
        try:
            with conn.cursor(dictionary=True) as cursor:
                cursor.execute("""
                    SELECT u.*, ud.gender, ud.age, ud.allergy, ud.vegan, ud.house_hold, ud.unfavorite, ud.membership
                    FROM userinfo_tbl u
                    LEFT JOIN user_detail_tbl ud ON u.user_id = ud.user_id
                    WHERE u.user_id = %s
                """, (user_id,))
                
                user = cursor.fetchone()
                if not user:
                    return {"success": False, "error": "사용자를 찾을 수 없습니다"}
                
                return {"success": True, "user": dict(user)}
                
        except Error as e:
            logger.error(f"프로필 조회 실패: {e}")
            return {"success": False, "error": "프로필 조회 중 오류가 발생했습니다"}
        
        finally:
            if conn and conn.is_connected():
                conn.close()
    
    def get_db_connection(self):
        """데이터베이스 연결"""
        try:
            return mysql.connector.connect(**DB_CONFIG)
        except Error as e:
            logger.error(f"DB 연결 실패: {e}")
            return None

# 전역 인증 관리자 인스턴스
auth_manager = DjangoAuthManager()