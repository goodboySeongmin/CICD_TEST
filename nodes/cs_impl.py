from typing import Dict, Any, List, Optional
from datetime import datetime
import uuid, unicodedata

from graph_interfaces import ChatState
from .cs_common import get_db_connection, logger, _fmt_date, _fmt_dt
from .cs_orders import get_user_orders_today, get_order_details, get_user_orders_last_5_days


STATUS_BADGE = {
    "approved": "✅",
    "open": "🟢",
    "processing": "⏳",
    "refunded": "💸",
    "rejected": "❌",
    "canceled": "🚫",
}
STATUS_LABEL = {
    "approved": "접수 완료",
    "open": "접수",
    "processing": "처리중",
    "refunded": "환불 완료",
    "rejected": "반려",
    "canceled": "취소",
}


def _classify_cs_type(query: str, attachments: List[str]) -> str:
    q = (query or "").strip()
    if attachments:
        return "cs_intake"
    faq_keywords = [  # hjs 수정: 규정/faq 키워드 추가로 정책/약관 문의 포착 강화
        "이용약관",
        "개인정보",
        "정책",
        "약관",
        "규정",
        "faq",
        "서비스",
        "회원",
        "가입",
        "탈퇴",
        "이용방법",
        "사용법",
        "어떻게",
        "방법",
    ]
    return "faq_policy" if any(k in q for k in faq_keywords) else "cs_intake"


# def _classify_cs_category(query: str, attachments: List[str]) -> str:
#     q = (query or "").strip()
#     if any(k in q for k in ["환불", "교환", "반품"]):
#         return "환불"
#     if attachments:
#         return "상품문의"
#     query_lower = q.lower()
#     categories = {
#         "배송": ["배송", "도착", "언제", "늦어", "안와", "느려", "빨리"],
#         "환불": ["환불", "취소", "반품", "돌려", "돈", "계좌", "교환"],
#         "상품문의": ["상품", "품질", "상태", "신선", "상함", "이상"],
#         "주문변경": ["변경", "수정", "주소", "시간", "바꿔"],
#         "결제": ["결제", "카드", "계좌", "승인", "실패", "오류"],
#     }
#     for category, keywords in categories.items():
#         if any(keyword in query_lower for keyword in keywords):
#             return category
#     return "일반문의"

def _classify_cs_category(query: str, attachments: List[str]) -> str:
    # 0) 정규화
    q_raw = (query or "").strip()
    q = unicodedata.normalize("NFKC", q_raw).lower()

    # 1) 첨부만 있고 텍스트가 거의 없으면 상품문의로 빠르게 처리
    if not q and attachments:
        return "상품문의"

    # 2) 최우선 오버라이드 (취소/환불/교환 류는 가장 강한 의도)
    if any(k in q for k in ("환불", "반품", "교환", "취소", "철회", "환급", "반송")):
        return "환불"

    # 3) 점수표 초기화
    scores: Dict[str, int] = {
        "배송": 0,
        "환불": 0,
        "상품문의": 0,
        "주문변경": 0,
        "결제": 0,
    }

    # 4) 카테고리별 키워드
    keyword_map: Dict[str, List[str]] = {
        "배송": ["배송", "도착", "언제", "늦", "안 와", "안와", "느리", "빨리", "택배", "송장", "운송장", "추적", "배달", "분실", "파손"],
        "환불": ["환불", "취소", "반품", "교환", "철회", "환급", "반송", "환불해", "환불요청", "취소해"],
        "상품문의": ["상품", "품질", "상태", "신선", "상함", "불량", "하자", "유통기한", "교환요청", "사진"],
        "주문변경": ["변경", "수정", "주소", "배송지", "시간", "날짜", "지연요청", "빠르게", "늦게", "받는사람", "전화번호"],
        "결제": ["결제", "카드", "계좌", "승인", "취소요청", "환불금", "pg", "영수증", "세금계산서", "입금", "환불처리"],
    }

    # 5) 점수 계산
    for cat, kws in keyword_map.items():
        for kw in kws:
            if kw in q:
                scores[cat] += 1

    # 6) 첨부파일 힌트: 이미지가 있으면 상품문의 가중치 부여
    if attachments:
        img_ext = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif")
        if any(str(a).lower().endswith(img_ext) for a in attachments):
            scores["상품문의"] += 2

    # 7) 충돌 해소 규칙
    # 7-1) 배송 vs 주문변경: 주소/배송지/시간/날짜가 있으면 주문변경 쪽에 가중치
    if scores["배송"] and scores["주문변경"]:
        if any(k in q for k in ("주소", "배송지", "시간", "날짜")):
            scores["주문변경"] += 1

    # 7-2) '계좌/환불금' 등장 시 결제보다 환불 의도 강화
    if any(k in q for k in ("계좌", "환불금")):
        scores["환불"] += 1

    # 8) 최종 선택
    best_cat, best_score = max(scores.items(), key=lambda x: x[1])
    if best_score == 0:
        return "일반문의"
    return best_cat


def cs_intake(state: ChatState) -> Dict[str, Any]:
    logger.info(
        "CS 접수 프로세스 시작",
        extra={"user_id": state.user_id, "query": state.query, "attachments": len(state.attachments)},
    )
    try:
        q = (state.query or "").strip()
        history_keywords = [
            "환불내역",
            "환불 내역",
            "환불이력",
            "환불 이력",
            "환불조회",
            "환불 조회",
            "환불현황",
            "환불 현황",
            "환불상태",
            "환불 상태",
            "환불확인",
            "환불 확인",
        ]
        if any(k in q for k in history_keywords):
            return handle_refund_history_request(state)
        
        r = (state.query or "").strip()
        order_keywords = [
            "주문 내역",
            "주문내역",
            "주문",
            "주문 내역 확인",
            "주문내역확인",
            "주문 내역 현황"
        ]

        if any(r_ in r for r_ in order_keywords):
            return handle_order_list_inquiry(state)

        category = _classify_cs_category(state.query, state.attachments)
        if any(k in q for k in ["환불", "교환", "반품"]):
            category = "환불"

        if category == "환불":
            return handle_refund_request(state)

        if category == "주문변경":
            return {"cs": {"message": "주문 변경 요청은 상담사가 도와드리겠습니다."}, "meta": {"next_step": "handoff"}}

        ticket_id = _generate_ticket_id()
        ticket_info = {
            "ticket_id": ticket_id,
            "category": category,
            "summary": _generate_inquiry_summary(state.query, None),
            "priority": _determine_priority(category),
            "created_at": datetime.now().isoformat(),
            "status": "open",
        }
        return {
            "cs": {"ticket": ticket_info},
            "meta": {"cs_message": f"문의가 접수되었습니다. 티켓번호: {ticket_id}", "next_step": "done"},
        }
    except Exception as e:
        logger.error(f"CS 접수 실패: {e}")
        return {
            "cs": {
                "ticket": {
                    "ticket_id": "ERROR-" + str(uuid.uuid4())[:8],
                    "category": "일반문의",
                    "summary": "문의 접수 중 오류 발생",
                    "error": str(e),
                }
            },
            "meta": {"next_step": "done"},
        }


def handle_refund_request(state: ChatState) -> Dict[str, Any]:
    orders = get_user_orders_today(state.user_id)
    if not orders:
        return {"cs": {"message": "오늘 배송(완료)된 주문이 없어요. 상담사가 도와드릴게요."}, "meta": {"next_step": "handoff"}}
    ui_orders = []
    for o in orders:
        refundable_lines = _list_refundable_line_items(state.user_id, o["order_code"])
        if not refundable_lines:
            continue
        ui_orders.append({
            "order_code": o["order_code"],
            "order_date": (o["order_date"].strftime("%Y-%m-%d") if isinstance(o["order_date"], datetime) else str(o["order_date"])),
            "order_status": o.get("order_status") or "",
            "total_price": o.get("total_price"),
            "refundable_lines": refundable_lines,
        })
    if not ui_orders:
        return {"cs": {"message": "오늘 주문 중 이미 처리된 품목을 제외하면 환불 가능한 항목이 없습니다."}, "meta": {"next_step": "done"}}
    return {"cs": {"message": "환불하실 오늘자 주문을 선택해주세요.", "orders": ui_orders}, "meta": {"next_step": "await_order_selection"}}

def handle_order_list_inquiry(state: ChatState) -> Dict[str, Any]:

    delivers = get_user_orders_last_5_days(state.user_id)

    if not delivers:
        return {"cs": {"message": "최근 5일 내 주문내역이 없어요."}, "meta": {"next_step": "handoff"}}

    ui_delivers = []
    for o in delivers:
        ui_delivers.append({
            "order_code": o["order_code"],
            "order_date": _fmt_dt(o.get("order_date")),
            "order_status": o.get("order_status", ""),
            "total_price": o.get("total_price"),
            # 선택: 있으면 노출 (없으면 프론트에서 무시)
            "carrier": o.get("carrier") or "",
            "tracking_no": o.get("tracking_no") or o.get("tracking_number") or "",
            "expected_delivery": _fmt_date(o.get("expected_delivery")) if o.get("expected_delivery") else "",
        })

    # 프론트가 refund와 동일한 형태의 리스트 렌더링을 사용한다면 "orders" 키로 내려주는 게 가장 무난
    return {
        "cs": {
            "message": "확인하실 주문내역을 선택해주세요.",
            "orders": ui_delivers,
            "category": "배송",
            "list_type": "delivery",
            "allow_evidence": False,           # ✅ 이 한 줄로 프론트에서 증빙 감춤
        },
        "meta": {"next_step": "await_order_selection"}
    }

def _format_kr_status(s: str) -> str:
    m = {"open": "접수", "processing": "처리중", "refunded": "환불완료", "rejected": "반려", "canceled": "취소", None: "상태미상", "": "상태미상"}
    return m.get((s or "").lower(), s or "상태미상")


def _kr_dt(dt) -> str:
    try:
        if isinstance(dt, datetime):
            return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        pass
    return str(dt)[:16]


def handle_refund_history_request(state: ChatState) -> Dict[str, Any]:
    conn = get_db_connection()
    if not conn:
        return {"cs": {"message": "내역을 불러오지 못했어요. 잠시 후 다시 시도해주세요."}, "meta": {"next_step": "done"}}
    try:
        with conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT ticket_id, order_code, product, request_qty, status, reason,
                       created_at, updated_at
                FROM refund_tbl
                WHERE user_id = %s
                ORDER BY created_at DESC
                LIMIT 20
                """,
                (state.user_id,),
            )
            rows = cur.fetchall() or []
        if not rows:
            return {"cs": {"message": "환불 접수 내역이 아직 없습니다."}, "meta": {"next_step": "done"}}
        refunds = []
        for r in rows:
            refunds.append({
                "ticket_id": r.get("ticket_id") or "",
                "order_code": str(r.get("order_code") or ""),
                "product": r.get("product") or "",
                "request_qty": int(r.get("request_qty") or 0),
                "status": r.get("status") or "",
                "reason": r.get("reason") or "",
                "created_at": _kr_dt(r.get("created_at")),
                "updated_at": _kr_dt(r.get("updated_at")),
            })
        from collections import OrderedDict
        grouped: "OrderedDict[str, list[dict]]" = OrderedDict()
        for r in refunds:
            grouped.setdefault(r["order_code"], []).append(r)
        lines = ["최근 환불 내역을 보여드릴게요."]
        for order_code, items in grouped.items():
            head_time = items[0]["created_at"]
            lines.append(f"\n주문 {order_code} · {head_time}")
            for it in items:
                badge = STATUS_BADGE.get(it["status"], "•")
                label = STATUS_LABEL.get(it["status"], it["status"])
                ticket = it["ticket_id"]
                lines.append(f"  {badge} {it['product']} × {it['request_qty']}  · 티켓 {ticket} · {label}")
        msg = "\n".join(lines).rstrip()
        return {"cs": {"message": msg, "refunds": refunds}, "meta": {"next_step": "done"}}
    finally:
        try:
            if conn and conn.is_connected():
                conn.close()
        except Exception:
            pass


def _generate_inquiry_summary(query: str, image_analysis: Optional[Dict[str, Any]]) -> str:
    summary = (query or "")[:100]
    if image_analysis:
        items = ", ".join(image_analysis.get("detected_items", []))
        if items:
            summary += f" (첨부된 이미지: {items})"
    return summary


def _generate_ticket_id() -> str:
    timestamp = datetime.now().strftime("%Y%m%d")
    random_suffix = str(uuid.uuid4())[:6]
    return f"CS-{timestamp}-{random_suffix.upper()}"


def _determine_priority(category: str) -> str:
    return "high" if category in ["환불", "배송사고", "상품불량"] else "normal"


def _list_refundable_line_items(user_id: str, order_code: str) -> List[Dict[str, Any]]:
    details = get_order_details(order_code, user_id=user_id)
    if not details or not details.get("items"):
        return []
    refunded = _refunded_qty_map(user_id, order_code)
    refundable: List[Dict[str, Any]] = []
    for it in details["items"]:
        name = (it.get("product") or "").strip()
        ordered_qty = int(it.get("quantity") or 0)
        already = int(refunded.get(name, 0))
        remain = max(0, ordered_qty - already)
        if remain > 0:
            refundable.append({
                "product": name,
                "unit_price": float(it.get("price") or 0.0),
                "ordered_qty": ordered_qty,
                "refunded_qty": already,
                "refundable_qty": remain,
            })
    return refundable


def _refunded_qty_map(user_id: str, order_code: str) -> Dict[str, int]:
    conn = get_db_connection()
    if not conn:
        return {}
    try:
        with conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT product, COALESCE(SUM(request_qty),0) AS qty
                FROM refund_tbl
                WHERE user_id=%s AND order_code=%s
                GROUP BY product
                """,
                (user_id, order_code),
            )
            rows = cur.fetchall()
        return {(r["product"] or "").strip(): int(r["qty"] or 0) for r in rows}
    except Exception:
        return {}

