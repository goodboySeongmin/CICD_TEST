from typing import Dict, Any, List, Tuple
from datetime import datetime
from mysql.connector import Error, errorcode

from graph_interfaces import ChatState
from .cs_common import (
    get_db_connection,
    logger,
    CS_DEFECT_THRESHOLD,
    CS_AUTO_ACCEPT_DEBUG,
    CS_PRODUCT_MATCH_THRESHOLD,
)
from .cs_vision import analyze_attachments, check_product_match


def _fetch_order_item_qtys(order_code: str) -> Dict[str, int]:
    conn = get_db_connection()
    if not conn:
        return {}
    try:
        with conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT product, COALESCE(quantity,0) AS quantity
                FROM order_detail_tbl
                WHERE order_code=%s
                """,
                (order_code,),
            )
            rows = cur.fetchall()
        return {(r["product"] or "").strip(): int(r["quantity"] or 0) for r in rows}
    except Error as e:
        logger.error(f"fetch order item qtys failed: {e}")
        return {}
    finally:
        try:
            if conn and conn.is_connected():
                conn.close()
        except Exception:
            pass


def _fetch_refunded_qtys(user_id: str, order_code: str) -> Dict[str, int]:
    conn = get_db_connection()
    if not conn:
        return {}
    try:
        with conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT product, COALESCE(SUM(request_qty),0) AS qty
                FROM refund_tbl
                WHERE user_id=%s
                  AND order_code=%s
                  AND status IN ('open','processing','approved','refunded')
                GROUP BY product
                """,
                (user_id, order_code),
            )
            rows = cur.fetchall()
        return {(r["product"] or "").strip(): int(r["qty"] or 0) for r in rows}
    except Error as e:
        logger.error(f"fetch refunded qtys failed: {e}")
        return {}
    finally:
        try:
            if conn and conn.is_connected():
                conn.close()
        except Exception:
            pass


def _remaining_refundable_qty(user_id: str, order_code: str, product: str) -> int:
    ordered_map = _fetch_order_item_qtys(order_code)
    refunded_map = _fetch_refunded_qtys(user_id, order_code)
    key = product.strip()
    ordered = int(ordered_map.get(key) or 0)
    refunded = int(refunded_map.get(key) or 0)
    return max(0, ordered - refunded)


def _persist_refund_with_check_atomic(
    user_id: str,
    order_code: str,
    product: str,
    ticket_id: str,
    analysis: Dict[str, Any],
    request_qty: int,
    status: str = "approved",
) -> Tuple[bool, str, int]:
    conn = get_db_connection()
    if not conn:
        return False, "DB 연결 실패", 0
    try:
        conn.start_transaction()
        with conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT COALESCE(quantity,0) AS quantity
                FROM order_detail_tbl
                WHERE order_code=%s AND product=%s
                FOR UPDATE
                """,
                (order_code, product),
            )
            row = cur.fetchone() or {"quantity": 0}
            ordered_qty = int(row.get("quantity") or 0)
            cur.execute(
                """
                SELECT COALESCE(SUM(request_qty),0) AS refunded
                FROM refund_tbl
                WHERE user_id=%s AND order_code=%s AND product=%s
                  AND status IN ('open','processing','approved','refunded')
                FOR UPDATE
                """,
                (user_id, order_code, product),
            )
            row2 = cur.fetchone() or {"refunded": 0}
            refunded_qty = int(row2.get("refunded") or 0)
            remain = max(0, ordered_qty - refunded_qty)
            if remain <= 0:
                conn.rollback()
                return False, f"해당 주문의 '{product}'은(는) 환불 가능한 수량이 없습니다.", 0
            final_qty = min(int(request_qty or 1), remain)
            if final_qty <= 0:
                conn.rollback()
                return False, "요청 수량이 올바르지 않습니다.", 0
            now = datetime.now()
            reason = (analysis or {}).get("issue_summary") or "품질 이상 확인"
            cur.execute(
                """
                INSERT INTO refund_tbl (
                    ticket_id, user_id, order_code, product, request_qty, reason, status, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (ticket_id, user_id, order_code, product, int(final_qty), reason, status, now, now),
            )
        conn.commit()
        return True, "OK", final_qty
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        if hasattr(e, "errno") and e.errno == 1644:
            return False, "요청 수량이 허용 한도를 초과했습니다.", 0
        if hasattr(e, "errno") and e.errno in (errorcode.ER_DUP_ENTRY,):
            return False, "이미 동일 상품 환불이 접수된 상태예요.", 0
        logger.warning(f"persist refund (atomic) failed: {getattr(e,'errno',None)} {e}")
        return False, "요청을 처리하는 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.", 0
    finally:
        try:
            if conn and conn.is_connected():
                conn.close()
        except Exception:
            pass


def _generate_ticket_id() -> str:
    import uuid
    timestamp = datetime.now().strftime("%Y%m%d")
    random_suffix = str(uuid.uuid4())[:6]
    return f"CS-{timestamp}-{random_suffix.upper()}"


def handle_partial_refund_with_image(
    state: ChatState,
    order_code: str,
    product: str,
    request_qty: int = 1,
) -> Dict[str, Any]:
    remain = _remaining_refundable_qty(state.user_id, order_code, product)
    if remain <= 0:
        return {"cs": {"message": f"해당 주문의 '{product}'은(는) 이미 접수된 건을 제외하면 환불 가능한 수량이 없습니다."}, "meta": {"next_step": "done"}}
    capped = False
    if request_qty > remain:
        request_qty = remain
        capped = True
    image_analysis = None
    if state.attachments:
        image_analysis = analyze_attachments(state.attachments)
        # hjs 수정: 지원되지 않는 파일 유형 안내
        if image_analysis and isinstance(image_analysis, dict) and image_analysis.get("error") == "unsupported_type":
            supported = image_analysis.get("supported_types") or ["png","jpg","jpeg","gif","webp"]
            return {
                "cs": {
                    "message": (
                        "해당 파일은 지원되지 않는 파일입니다. 지원되는 파일로 업로드를 진행해주세요. "
                        + ", ".join(supported)
                    )
                },
                "meta": {"next_step": "done"}
            }
    same, same_conf, _ = check_product_match(product, image_analysis or {})
    if not same or same_conf < CS_PRODUCT_MATCH_THRESHOLD:
        return {
            "cs": {
                "message": (
                    f"업로드하신 사진이 선택하신 '{product}'와(과) 다른 품목으로 보여 자동 접수하지 않았어요.\n"
                    "불편을 드려 죄송합니다. 해당 상품 사진으로 다시 올려주시거나, 상담사 연결을 원하시면 알려주세요."
                ),
                "analysis": image_analysis or {},
                "match": {"same": same, "confidence": same_conf},
            },
            "meta": {"next_step": "handoff"},
        }
    is_def = bool(image_analysis and image_analysis.get("is_defective"))
    conf = float((image_analysis or {}).get("confidence") or 0.0)
    accepted = CS_AUTO_ACCEPT_DEBUG or (is_def and conf >= CS_DEFECT_THRESHOLD)
    if accepted:
        remain2 = _remaining_refundable_qty(state.user_id, order_code, product)
        if remain2 <= 0:
            return {"cs": {"message": f"방금 전 요청으로 '{product}'의 환불 가능 수량이 소진되어 더 이상 접수할 수 없습니다."}, "meta": {"next_step": "done"}}
        if request_qty > remain2:
            request_qty = remain2
            capped = True
        ticket_id = _generate_ticket_id()
        ok, msg, saved_qty = _persist_refund_with_check_atomic(
            user_id=state.user_id,
            order_code=order_code,
            product=product,
            ticket_id=ticket_id,
            analysis=image_analysis or {},
            request_qty=request_qty,
            status="approved",
        )
        if not ok:
            return {"cs": {"message": msg}, "meta": {"next_step": "done"}}
        reason_text = (image_analysis or {}).get("issue_summary") or "품질 이상으로 확인되었습니다."
        cap_note = (" (요청 수량이 남은 수량을 초과하여 잔여 수량만 접수되었습니다.)" if capped else "")
        polite_message = (
            f"요청 주신 '{product}' {saved_qty}개에 대해 환불 접수를 처리해 드렸어요.\n"
            f"사유: {reason_text}\n"
            f"티켓번호: {ticket_id}{cap_note}\n"
            "불편을 드려 정말 죄송합니다. 빠르게 처리하겠습니다."
        )
        ticket_info = {
            "ticket_id": ticket_id,
            "summary": reason_text,
            "priority": "high",
            "created_at": datetime.now().isoformat(),
            "status": "open",
            "order_code": order_code,
            "product": product,
            "request_qty": saved_qty,
            "image_analysis": image_analysis or {"note": "auto-accept"},
        }
        return {"cs": {"ticket": ticket_info, "message": polite_message}, "meta": {"next_step": "done"}}
    return {
        "cs": {
            "message": "이미지를 확인했으나 자동 환불 기준에 부합하지 않아 접수되지 않았어요.\n불편을 드려 죄송합니다. 상담사가 추가로 도와드릴게요.",
            "analysis": image_analysis or {},
        },
        "meta": {"next_step": "handoff"},
    }

