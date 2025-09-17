"""
handoff_end.py — F역할: 핸드오프 & 세션 종료 (상담사 연결/오케스트레이션)

F역할의 책임:
- handoff(): 상담사/CRM 이관 기능
- end_session(): 세션 종료 및 최종 결과 정리
- 대화 요약 및 개인정보 필터링
- CRM 웹훅 연동
"""

import logging
import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from dataclasses import asdict
import numpy as np

# 상대 경로로 graph_interfaces 임포트
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from graph_interfaces import ChatState

logger = logging.getLogger("F_HANDOFF_END")

# ============================================================================
# F역할 전용 설정 및 유틸리티
# ============================================================================

class CRMAdapter:
    """CRM/상담 시스템 연동 어댑터"""
    
    def __init__(self, crm_type: str = "zendesk"):
        self.crm_type = crm_type
        self.base_url = self._get_crm_config(crm_type)
        
    def _get_crm_config(self, crm_type: str) -> str:
        """CRM 시스템별 설정"""
        configs = {
            "zendesk": "https://qook.zendesk.com/api/v2",
            "freshdesk": "https://qook.freshdesk.com/api/v2", 
            "mock": "http://localhost:8080/mock-crm"  # 개발용
        }
        return configs.get(crm_type, configs["mock"])
    
    def create_ticket(self, ticket_data: Dict[str, Any]) -> Dict[str, Any]:
        """상담 티켓 생성 (실제 구현에서는 HTTP 요청)"""
        # TODO: 실제 CRM API 호출 구현
        mock_ticket_id = f"CRM-{uuid.uuid4().hex[:8].upper()}"
        
        logger.info(f"CRM 티켓 생성: {mock_ticket_id}", extra={
            "crm_type": self.crm_type,
            "ticket_data": ticket_data
        })
        
        return {
            "crm_id": mock_ticket_id,
            "status": "created",
            "created_at": datetime.now().isoformat(),
            "priority": ticket_data.get("priority", "normal")
        }

class ConversationSummarizer:
    """대화 요약 및 개인정보 필터링"""
    
    @staticmethod
    def filter_sensitive_info(text: str) -> str:
        """개인정보 마스킹"""
        import re
        
        # 전화번호 마스킹 (010-1234-5678 → 010-****-5678)
        text = re.sub(r'010-\d{4}-(\d{4})', r'010-****-\1', text)
        
        # 이메일 마스킹 (test@email.com → t***@email.com)
        text = re.sub(r'(\w)[\w\.-]*@', r'\1***@', text)
        
        # 주소 마스킹 (상세주소 부분만)
        text = re.sub(r'(\S+동\s+\d+)[\s\S]*?(\d+호)', r'\1 ***동 \2', text)
        
        # 카드번호 마스킹 (1234-5678-9012-3456 → ****-****-****-3456)
        text = re.sub(r'\b(\d{4})-(\d{4})-(\d{4})-(\d{4})\b', r'****-****-****-\4', text)
        
        return text
    
    @staticmethod 
    def summarize_conversation(state: ChatState) -> Dict[str, Any]:
        """대화 내용 요약 생성"""
        # TODO: 실제 LLM 요약 구현
        summary = {
            "user_intent": "상담 요청",
            "issue_category": state.cs.get("ticket", {}).get("category", "일반문의"),
            "resolution_status": "상담사 이관",
            "key_points": [],
            "attachments": state.attachments,
            "conversation_length": state.turn_id or 1
        }
        
        return summary

# ============================================================================
# F역할 핵심 함수 구현
# ============================================================================

def _create_message():
    
    count = np.random.randint(0, 15)
    min = count*3

    return f"현재 고객님 앞에는 {count}명이 대기 중입니다. 예상 대기 시간은 약 {min}분입니다. 잠시만 기다려 주세요."


def handoff(state: ChatState) -> Dict[str, Any]:
    """
    상담사 이관
    - 저신뢰/예외 케이스에서 인간 상담사/CRM으로 이관합니다.
    - 대화 요약/근거/사용자 메타를 함께 전달합니다.

    입력: state.cs.answer 신뢰도, 대화 이력
    출력: state.handoff = {ticket_id, crm_id, status}
    """
    logger.info("상담사 이관 프로세스 시작", extra={
        "user_id": state.user_id,
        "session_id": state.session_id
    })
    
    try:
        # 1. 이관 사유 분석
        handoff_reason = _analyze_handoff_reason(state)
        
        # 2. 대화 요약 및 개인정보 필터링
        summarizer = ConversationSummarizer()
        conversation_summary = summarizer.summarize_conversation(state)
        
        # 3. CRM 티켓 데이터 준비
        ticket_data = {
            "user_id": state.user_id,
            "session_id": state.session_id,
            "subject": f"챗봇 이관 - {handoff_reason}",
            "description": summarizer.filter_sensitive_info(
                f"챗봇 대화 이관\n\n"
                f"이관 사유: {handoff_reason}\n"
                f"사용자 의도: {conversation_summary['user_intent']}\n"
                f"문제 카테고리: {conversation_summary['issue_category']}\n"
                f"대화 턴 수: {conversation_summary['conversation_length']}\n"
                f"첨부파일: {len(state.attachments)}개"
            ),
            "priority": _determine_priority(state),
            "tags": ["chatbot_handoff", conversation_summary["issue_category"]],
            "metadata": {
                "original_query": summarizer.filter_sensitive_info(state.query),
                "cs_confidence": state.cs.get("answer", {}).get("confidence", 0),
                "conversation_summary": conversation_summary
            }
        }
        
        # 4. CRM 시스템에 티켓 생성
        crm_adapter = CRMAdapter()
        crm_result = crm_adapter.create_ticket(ticket_data)
        
        # 5. 핸드오프 상태 업데이트
        msg = _create_message()
        handoff_result = {
            "ticket_id": state.cs.get("ticket", {}).get("ticket_id", f"T-{uuid.uuid4().hex[:8]}"),
            "crm_id": crm_result["crm_id"],
            "status": "sent",
            "handoff_reason": handoff_reason,
            "created_at": datetime.now().isoformat(),
            "estimated_response_time": "3분 이내",
            "message": msg,
        }
        
        logger.info("상담사 이관 완료", extra={
            "crm_id": crm_result["crm_id"],
            "handoff_reason": handoff_reason
        })
        
        return {
            "handoff": handoff_result,
            "meta": {
                "last_action": "handoff_complete",
                "next_step": "wait_agent_response"
            }
        }
        
    except Exception as e:
        logger.error(f"상담사 이관 실패: {e}", extra={
            "user_id": state.user_id,
            "error": str(e)
        })
        
        # 실패 시 폴백
        return {
            "handoff": {
                "status": "failed",
                "error": "이관 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
                "fallback_message": "죄송합니다. 시스템 오류로 상담사 연결에 실패했습니다. "
                                  "고객센터(1588-0000)로 직접 연락해주시기 바랍니다."
            }
        }

def end_session(state: ChatState) -> Dict[str, Any]:
    """
    세션 종료
    - 주문/CS 결과에 따라 마무리 메시지, 영수증/링크/요약 등의 아티팩트를 제공합니다.

    입력: state.order 또는 state.cs
    출력: state.end = {reason, artifacts[]}
    """
    logger.info("세션 종료 프로세스 시작", extra={
        "user_id": state.user_id,
        "session_id": state.session_id
    })
    
    try:
        # 1. 종료 사유 및 결과 분석
        end_reason, artifacts = _analyze_session_outcome(state)
        
        # 2. 최종 메시지 생성
        final_message = _generate_final_message(state, end_reason)
        
        # 3. 세션 정리 및 로깅
        _cleanup_session_data(state)
        
        end_result = {
            "reason": end_reason,
            "artifacts": artifacts,
            "final_message": final_message,
            "session_summary": {
                "total_turns": state.turn_id or 1,
                "completion_status": "success" if end_reason != "error" else "failed",
                "user_satisfaction": "unknown",  # TODO: 피드백 수집 구현
                "ended_at": datetime.now().isoformat()
            }
        }
        
        logger.info("세션 종료 완료", extra={
            "end_reason": end_reason,
            "artifacts_count": len(artifacts)
        })
        
        return {
            "end": end_result,
            "meta": {
                "session_closed": True,
                "cleanup_complete": True
            }
        }
        
    except Exception as e:
        logger.error(f"세션 종료 실패: {e}", extra={
            "user_id": state.user_id,
            "error": str(e)
        })
        
        return {
            "end": {
                "reason": "error",
                "artifacts": [],
                "final_message": "세션을 정상적으로 종료하지 못했습니다. 이용에 불편을 드려 죄송합니다.",
                "error": str(e)
            }
        }

# ============================================================================
# F역할 내부 헬퍼 함수들
# ============================================================================

def _analyze_handoff_reason(state: ChatState) -> str:
    """이관 사유 분석"""
    cs_confidence = state.cs.get("answer", {}).get("confidence", 0)
    
    if cs_confidence < 0.3:
        return "낮은 응답 신뢰도"
    elif state.cs.get("ticket", {}).get("category") in ["환불", "분쟁", "법적문의"]:
        return "복잡한 정책 문의"
    elif len(state.attachments) > 0:
        return "이미지/증빙 검토 필요"
    else:
        return "일반 상담 요청"

def _determine_priority(state: ChatState) -> str:
    """티켓 우선순위 결정"""
    category = state.cs.get("ticket", {}).get("category", "")
    
    if category in ["환불", "분쟁", "배송사고"]:
        return "high"
    elif category in ["상품문의", "주문변경"]:
        return "normal" 
    else:
        return "low"

def _analyze_session_outcome(state: ChatState) -> tuple[str, List[str]]:
    """세션 결과 분석 및 아티팩트 생성"""
    artifacts = []
    
    # 주문 완료된 경우
    if state.order.get("status") == "confirmed":
        order_id = state.order.get("order_id")
        artifacts.extend([
            f"주문 확인서: /orders/{order_id}/receipt",
            f"배송 추적: /orders/{order_id}/tracking",
            "주문 요약 PDF"
        ])
        return "order_complete", artifacts
    
    # 상담사 이관된 경우  
    elif state.handoff.get("status") == "sent":
        crm_id = state.handoff.get("crm_id")
        artifacts.extend([
            f"상담 티켓: {crm_id}",
            "이관 내용 요약"
        ])
        return "handoff_complete", artifacts
    
    # CS 해결된 경우
    elif state.cs.get("answer", {}).get("confidence", 0) > 0.7:
        artifacts.extend([
            "FAQ 참조 링크",
            "관련 정책 문서"
        ])
        return "cs_resolved", artifacts
    
    # 사용자가 중도 이탈한 경우
    else:
        return "user_exit", []

def _generate_final_message(state: ChatState, end_reason: str) -> str:
    """종료 사유별 최종 메시지 생성"""
    messages = {
        "order_complete": "주문이 성공적으로 완료되었습니다! 맛있는 식사 되세요 🥬✨",
        "handoff_complete": "상담사가 곧 연락드릴 예정입니다. 조금만 기다려 주세요!",
        "cs_resolved": "문의가 해결되었기를 바랍니다. 추가 궁금한 점이 있으시면 언제든 문의해주세요!",
        "user_exit": "이용해 주셔서 감사합니다. 언제든 다시 방문해주세요!",
        "error": "시스템 오류가 발생했습니다. 불편을 드려 죄송합니다."
    }
    
    base_message = messages.get(end_reason, messages["user_exit"])
    
    # 개인화된 메시지 추가
    if state.user_id:
        base_message += f"\n\nQook 신선식품을 이용해 주셔서 감사합니다!"
    
    return base_message

def _cleanup_session_data(state: ChatState) -> None:
    """세션 데이터 정리 (개인정보 등)"""
    # TODO: 필요시 임시 데이터 정리 로직 구현
    logger.info("세션 데이터 정리 완료", extra={
        "session_id": state.session_id
    })