from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import mysql.connector
from mysql.connector import Error
import os

# hjs 수정: 레시피 즐겨찾기 라우터
router = APIRouter(prefix="/api/recipes", tags=["recipes"])  # hjs 수정


def get_db_connection():
    try:
        return mysql.connector.connect(
            host=os.getenv("DB_HOST", "127.0.0.1"),
            user=os.getenv("DB_USER", "qook_user"),
            password=os.getenv("DB_PASSWORD", os.getenv("DB_PASS", "qook_pass")),
            database=os.getenv("DB_NAME", "qook_chatbot"),
            port=int(os.getenv("DB_PORT", "3306")),
        )
    except Error:
        return None


class FavoriteAddRequest(BaseModel):
    user_id: str
    recipe_url: str
    recipe_title: Optional[str] = None
    snippet: Optional[str] = None
    source: Optional[str] = "tavily"
    image_url: Optional[str] = None
    site_name: Optional[str] = None
    tags: Optional[dict] = None


class FavoriteDeleteRequest(BaseModel):
    user_id: str
    recipe_url: str


class FavoriteBulkSyncRequest(BaseModel):
    user_id: str
    items: List[FavoriteAddRequest]


@router.get("/favorites")
async def list_favorites(user_id: str) -> Dict[str, Any]:
    """지정 사용자 즐겨찾기 레시피 목록 반환"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="DB 연결 실패")
    try:
        with conn.cursor(dictionary=True) as cur:
            sql = (
                "SELECT recipe_url, recipe_title, snippet, source, image_url, site_name, tags, favorited_at "
                "FROM recipe_favorite_tbl WHERE user_id=%s ORDER BY favorited_at DESC"
            )
            cur.execute(sql, (user_id,))
            rows = cur.fetchall() or []
            return {"success": True, "items": rows, "total": len(rows)}
    except Error as e:
        raise HTTPException(status_code=500, detail=f"즐겨찾기 조회 실패: {e}")
    finally:
        try:
            if conn and conn.is_connected():
                conn.close()
        except Exception:
            pass


@router.post("/favorites")
async def add_favorite(req: FavoriteAddRequest) -> Dict[str, Any]:
    """즐겨찾기 추가(중복 시 already_exists 안내)"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="DB 연결 실패")
    try:
        with conn.cursor() as cur:
            # 중복 확인
            sel = "SELECT 1 FROM recipe_favorite_tbl WHERE user_id=%s AND url_hash=SHA2(%s,256) LIMIT 1"
            cur.execute(sel, (req.user_id, req.recipe_url))
            if cur.fetchone():
                return {"success": True, "code": "already_exists", "message": "이미 저장된 레시피입니다"}

            sql = (
                "INSERT INTO recipe_favorite_tbl (user_id, recipe_url, source, recipe_title, image_url, site_name, snippet, tags, fetched_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())"
            )
            cur.execute(sql, (
                req.user_id, req.recipe_url, req.source or "tavily",
                req.recipe_title, req.image_url, req.site_name, req.snippet,
                (None if req.tags is None else str(req.tags))
            ))
            conn.commit()
            return {"success": True}
    except Error as e:
        raise HTTPException(status_code=500, detail=f"즐겨찾기 추가 실패: {e}")
    finally:
        try:
            if conn and conn.is_connected():
                conn.close()
        except Exception:
            pass


@router.delete("/favorites")
async def delete_favorite(req: FavoriteDeleteRequest) -> Dict[str, Any]:
    """즐겨찾기 삭제(없으면 already_removed 안내)"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="DB 연결 실패")
    try:
        with conn.cursor() as cur:
            sel = "SELECT 1 FROM recipe_favorite_tbl WHERE user_id=%s AND url_hash=SHA2(%s,256) LIMIT 1"
            cur.execute(sel, (req.user_id, req.recipe_url))
            if not cur.fetchone():
                return {"success": True, "code": "already_removed", "message": "이미 제거된 레시피 입니다"}

            cur.execute("DELETE FROM recipe_favorite_tbl WHERE user_id=%s AND url_hash=SHA2(%s,256)", (req.user_id, req.recipe_url))
            conn.commit()
            return {"success": True}
    except Error as e:
        raise HTTPException(status_code=500, detail=f"즐겨찾기 삭제 실패: {e}")
    finally:
        try:
            if conn and conn.is_connected():
                conn.close()
        except Exception:
            pass


@router.post("/favorites/bulk-sync")
async def bulk_sync_favorites(req: FavoriteBulkSyncRequest) -> Dict[str, Any]:
    """서버가 비어 있고 로컬에만 있을 때 일괄 업로드"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="DB 연결 실패")
    try:
        with conn.cursor() as cur:
            inserted = 0
            skipped = 0
            for it in (req.items or []):
                try:
                    # 이미 있으면 skip
                    cur.execute(
                        "SELECT 1 FROM recipe_favorite_tbl WHERE user_id=%s AND url_hash=SHA2(%s,256) LIMIT 1",
                        (req.user_id, it.recipe_url)
                    )
                    if cur.fetchone():
                        skipped += 1
                        continue
                    cur.execute(
                        "INSERT INTO recipe_favorite_tbl (user_id, recipe_url, source, recipe_title, image_url, site_name, snippet, tags, fetched_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NOW())",
                        (
                            req.user_id, it.recipe_url, it.source or "tavily", it.recipe_title, it.image_url,
                            it.site_name, it.snippet, (None if it.tags is None else str(it.tags))
                        )
                    )
                    inserted += 1
                except Error:
                    skipped += 1
            conn.commit()
            return {"success": True, "inserted": inserted, "skipped": skipped}
    except Error as e:
        raise HTTPException(status_code=500, detail=f"즐겨찾기 동기화 실패: {e}")
    finally:
        try:
            if conn and conn.is_connected():
                conn.close()
        except Exception:
            pass

