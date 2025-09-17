"""
test_basic.py — 기본 통합 테스트 스크립트

주요 기능들이 올바르게 동작하는지 확인하는 기본적인 테스트입니다.
"""

import asyncio
import logging
import sys
import os

# 프로젝트 루트를 Python 경로에 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from graph_interfaces import ChatState
from workflow import run_workflow
from nodes import (
    router_route, enhance_query, product_search_rag_text2sql,
    clarify, cart_manage, checkout, order_process,
    cs_intake, faq_policy_rag, handoff, end_session,
    recipe_search
)

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_basic_imports():
    """기본 임포트 테스트"""
    logger.info("=== 기본 임포트 테스트 ===")
    
    try:
        # 모든 노드 함수가 import되는지 확인
        functions = [
            router_route, enhance_query, product_search_rag_text2sql,
            clarify, cart_manage, checkout, order_process,
            cs_intake, faq_policy_rag, handoff, end_session,
            recipe_search
        ]
        
        for func in functions:
            assert callable(func), f"{func.__name__}이 호출 가능한 함수가 아닙니다"
        
        logger.info("✅ 모든 노드 함수 임포트 성공")
        return True
        
    except Exception as e:
        logger.error(f"❌ 임포트 테스트 실패: {e}")
        return False

def test_chat_state_creation():
    """ChatState 생성 테스트"""
    logger.info("=== ChatState 생성 테스트 ===")
    
    try:
        # 기본 ChatState 생성
        state = ChatState(
            user_id="test_user",
            session_id="test_session",
            turn_id=1,
            query="사과를 주문하고 싶어요"
        )
        
        assert state.user_id == "test_user"
        assert state.session_id == "test_session"
        assert state.turn_id == 1
        assert state.query == "사과를 주문하고 싶어요"
        assert isinstance(state.cart["items"], list)
        assert state.cart["total"] == 0.0
        
        logger.info("✅ ChatState 생성 성공")
        return True
        
    except Exception as e:
        logger.error(f"❌ ChatState 생성 테스트 실패: {e}")
        return False

def test_individual_nodes():
    """개별 노드 기능 테스트"""
    logger.info("=== 개별 노드 기능 테스트 ===")
    
    test_state = ChatState(
        user_id="test_user",
        session_id="test_session", 
        turn_id=1,
        query="유기농 사과를 주문하고 싶어요"
    )
    
    tests_passed = 0
    total_tests = 0
    
    # 1. 라우터 테스트
    try:
        total_tests += 1
        result = router_route(test_state)
        assert "route" in result
        assert "target" in result["route"]
        logger.info("✅ 라우터 노드 테스트 성공")
        tests_passed += 1
    except Exception as e:
        logger.error(f"❌ 라우터 노드 테스트 실패: {e}")
    
    # 2. 쿼리 보강 테스트
    try:
        total_tests += 1
        result = enhance_query(test_state)
        assert "rewrite" in result
        assert "slots" in result
        logger.info("✅ 쿼리 보강 노드 테스트 성공")
        tests_passed += 1
    except Exception as e:
        logger.error(f"❌ 쿼리 보강 노드 테스트 실패: {e}")
    
    # 3. 상품 검색 테스트
    try:
        total_tests += 1
        # 먼저 쿼리를 보강한 후
        enhanced = enhance_query(test_state)
        test_state.rewrite = enhanced["rewrite"]
        test_state.slots = enhanced["slots"]
        
        result = product_search_rag_text2sql(test_state)
        assert "search" in result
        assert "candidates" in result["search"]
        logger.info("✅ 상품 검색 노드 테스트 성공")
        tests_passed += 1
    except Exception as e:
        logger.error(f"❌ 상품 검색 노드 테스트 실패: {e}")
    
    # 4. 장바구니 테스트
    try:
        total_tests += 1
        # 검색 결과를 가진 상태에서
        search_result = product_search_rag_text2sql(test_state)
        test_state.search = search_result["search"]
        
        result = cart_manage(test_state)
        assert "cart" in result
        assert "items" in result["cart"]
        logger.info("✅ 장바구니 노드 테스트 성공")
        tests_passed += 1
    except Exception as e:
        logger.error(f"❌ 장바구니 노드 테스트 실패: {e}")
    
    # 5. CS 접수 테스트
    try:
        total_tests += 1
        cs_state = ChatState(query="배송이 늦어요", user_id="test_user")
        result = cs_intake(cs_state)
        assert "cs" in result
        assert "ticket" in result["cs"]
        logger.info("✅ CS 접수 노드 테스트 성공")
        tests_passed += 1
    except Exception as e:
        logger.error(f"❌ CS 접수 노드 테스트 실패: {e}")
    
    # 6. FAQ RAG 테스트
    try:
        total_tests += 1
        cs_state = ChatState(query="배송은 얼마나 걸리나요?", user_id="test_user")
        result = faq_policy_rag(cs_state)
        assert "cs" in result
        assert "answer" in result["cs"]
        logger.info("✅ FAQ RAG 노드 테스트 성공")
        tests_passed += 1
    except Exception as e:
        logger.error(f"❌ FAQ RAG 노드 테스트 실패: {e}")
    
    # 7. 핸드오프 테스트
    try:
        total_tests += 1
        handoff_state = ChatState(query="복잡한 문의입니다", user_id="test_user")
        handoff_state.cs = {"answer": {"confidence": 0.1}}
        result = handoff(handoff_state)
        assert "handoff" in result
        logger.info("✅ 핸드오프 노드 테스트 성공")
        tests_passed += 1
    except Exception as e:
        logger.error(f"❌ 핸드오프 노드 테스트 실패: {e}")
    
    # 8. 세션 종료 테스트
    try:
        total_tests += 1
        end_state = ChatState(query="감사합니다", user_id="test_user")
        result = end_session(end_state)
        assert "end" in result
        logger.info("✅ 세션 종료 노드 테스트 성공")
        tests_passed += 1
    except Exception as e:
        logger.error(f"❌ 세션 종료 노드 테스트 실패: {e}")
    
    logger.info(f"개별 노드 테스트 결과: {tests_passed}/{total_tests} 통과")
    return tests_passed == total_tests

async def test_workflow_execution():
    """워크플로우 실행 테스트"""
    logger.info("=== 워크플로우 실행 테스트 ===")
    
    try:
        # 기본 상품 검색 워크플로우 테스트
        test_state = ChatState(
            user_id="test_user",
            session_id="test_session",
            turn_id=1,
            query="사과를 찾아주세요"
        )
        
        logger.info("워크플로우 실행 중...")
        result = await run_workflow(test_state)
        
        assert isinstance(result, dict)
        logger.info("✅ 워크플로우 실행 성공")
        
        # 결과 출력
        if result.get("search"):
            candidates = result["search"].get("candidates", [])
            logger.info(f"검색 결과: {len(candidates)}개 상품")
        
        if result.get("route"):
            target = result["route"].get("target")
            confidence = result["route"].get("confidence")
            logger.info(f"라우팅 결과: {target} (신뢰도: {confidence})")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ 워크플로우 실행 테스트 실패: {e}")
        return False

async def run_all_tests():
    """모든 테스트 실행"""
    logger.info("🚀 Qook 챗봇 기본 테스트 시작")
    
    test_results = []
    
    # 각 테스트 실행
    test_results.append(test_basic_imports())
    test_results.append(test_chat_state_creation())
    test_results.append(test_individual_nodes())
    test_results.append(await test_workflow_execution())
    
    # 결과 정리
    passed = sum(test_results)
    total = len(test_results)
    
    logger.info(f"🏁 테스트 완료: {passed}/{total} 통과")
    
    if passed == total:
        logger.info("🎉 모든 테스트가 성공적으로 통과했습니다!")
        return True
    else:
        logger.warning("⚠️  일부 테스트가 실패했습니다.")
        return False

if __name__ == "__main__":
    # 테스트 실행
    success = asyncio.run(run_all_tests())
    
    if success:
        print("\n✅ 모든 기본 테스트 통과 - 챗봇을 시작할 수 있습니다!")
        print("실행 방법: python app.py")
        sys.exit(0)
    else:
        print("\n❌ 일부 테스트 실패 - 문제를 해결한 후 다시 시도하세요.")
        sys.exit(1)