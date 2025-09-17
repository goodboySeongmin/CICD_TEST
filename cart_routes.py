# GROCERY_CHATBOT/cart_routes.py
from fastapi import APIRouter, Request, Cookie
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import secrets

# cart_order의 DB 연동 함수 재사용
from nodes.cart_order import view_cart, update_cart_item
from graph_interfaces import ChatState  # ChatState(user_id=...) 형태로 사용

router = APIRouter(prefix="/api/cart", tags=["cart"])

def _resolve_user_id(request: Request,
                     body_user_id: Optional[str],
                     cookie_user_id: Optional[str]) -> str:
    """
    user_id 우선순위:
    1) 바디/쿼리의 user_id
    2) user_id 쿠키
    3) 없으면 guest 생성
    """
    uid = body_user_id or cookie_user_id or request.cookies.get("user_id")
    if not uid:
        uid = "guest_" + secrets.token_hex(4)
    return uid

# ----- 스키마 -----
class UpdatePayload(BaseModel):
    user_id: Optional[str] = None
    product_name: str
    quantity: int

class SelectedPayload(BaseModel):
    user_id: Optional[str] = None
    products: List[str]

# ----- 라우트 -----
@router.get("/get")
async def cart_get(request: Request,
                   user_id: Optional[str] = None,
                   user_id_cookie: Optional[str] = Cookie(None, alias="user_id")):
    uid = _resolve_user_id(request, user_id, user_id_cookie)
    state = ChatState(user_id=uid)
    result = view_cart(state)         # {"cart": {...}} 또는 {"meta": {...}}
    return result if "cart" in result else {"cart": {"items": [], "subtotal": 0, "discounts": [], "total": 0}}

@router.post("/get")
async def cart_get_post(payload: Dict[str, Any],
                        request: Request,
                        user_id_cookie: Optional[str] = Cookie(None, alias="user_id")):
    uid = _resolve_user_id(request, payload.get("user_id"), user_id_cookie)
    state = ChatState(user_id=uid)
    result = view_cart(state)
    return result if "cart" in result else {"cart": {"items": [], "subtotal": 0, "discounts": [], "total": 0}}

@router.post("/update")
async def cart_update(payload: UpdatePayload,
                      request: Request,
                      user_id_cookie: Optional[str] = Cookie(None, alias="user_id")):
    uid = _resolve_user_id(request, payload.user_id, user_id_cookie)
    # DB 업데이트 후 최신 장바구니 리턴
    result = update_cart_item(uid, payload.product_name, payload.quantity)
    # update_cart_item은 {"cart": {...}} 또는 {"error": "..."} 형태
    if "error" in result:
        return {"error": result["error"], "cart": {"items": [], "subtotal": 0, "discounts": [], "total": 0}}
    return result

@router.post("/checkout-selected")
async def checkout_selected(payload: SelectedPayload,
                            request: Request,
                            user_id_cookie: Optional[str] = Cookie(None, alias="user_id")):
    """선택한 상품들만 결제 처리"""
    uid = _resolve_user_id(request, payload.user_id, user_id_cookie)
    from nodes.cart_order import checkout
    state = ChatState(user_id=uid, checkout={"selected_names": payload.products})
    result = checkout(state)
    return result

@router.post("/remove-selected")
async def remove_selected(payload: SelectedPayload,
                          request: Request,
                          user_id_cookie: Optional[str] = Cookie(None, alias="user_id")):
    """선택한 상품들만 장바구니에서 제거"""
    uid = _resolve_user_id(request, payload.user_id, user_id_cookie)
    from nodes.cart_order import remove_from_cart
    state = ChatState(user_id=uid, checkout={"selected_names": payload.products})
    result = remove_from_cart(state)
    return result
