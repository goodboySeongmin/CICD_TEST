import logging
from langgraph.graph import StateGraph, END
from graph_interfaces import ChatState

from nodes.router_clarify import router_route, clarify
from nodes.query_enhancement import enhance_query
from nodes.product_search import product_search_rag_text2sql
from nodes.recipe_search import recipe_search
from nodes.vision_recipe import vision_recipe
from nodes.cart_order import cart_manage, view_cart, remove_from_cart, checkout
from nodes.cs_impl import cs_intake, _classify_cs_type
from nodes.cs_rag_faq import faq_policy_rag
from nodes.handoff_end import handoff

logger = logging.getLogger(__name__)

def search_hub(state: ChatState) -> ChatState:
    """검색 관련 요청을 처리하는 허브 함수 - conditional_edges가 분기 처리"""
    target = state.route.get("target")
    logger.info(f"Search hub: Processing '{target}'")
    # 상태 설정만 하고 conditional_edges가 다음 노드를 결정
    return state

def cs_hub(state: ChatState) -> ChatState:
    """CS 관련 요청을 처리하는 허브 함수 - conditional_edges가 분기 처리"""
    target = state.route.get("target")
    logger.info(f"CS hub: Processing '{target}'")
    
    # handoff는 직접 처리
    if target == 'handoff':
        state.cs["classification"] = "handoff"
        return state

    # hjs 수정: 라우터가 cs 하위타입을 지정한 경우 그대로 신뢰하고 분류를 설정
    if target in ('cs_intake', 'faq_policy_rag'):
        state.cs["classification"] = 'faq_policy' if target == 'faq_policy_rag' else 'cs_intake'
        return state
    
    return state

# ===== 조건부 함수들 (StateGraph용) =====
def determine_search_target(state: ChatState) -> str:
    """search_hub에서 다음 노드를 결정하는 조건부 함수 (if문 없이 딕셔너리 매핑)"""
    target = state.route.get("target")
    logger.info(f"Search target decision: '{target}'")

    # 딕셔너리 매핑으로 분기 처리 (if문 없음)
    target_mapping = {
        'cart_add': 'enhance_query',    # cart_add는 먼저 enhance_query 실행
        'cart_remove': 'enhance_query', # cart_remove도 먼저 enhance_query 실행
        'product_search': 'enhance_query',
        'recipe_search': 'enhance_query',
        'vision_recipe': 'vision_recipe',  # vision_recipe는 바로 vision_recipe로
        'cart_view': 'enhance_query',
        'checkout': 'enhance_query',
    }

    next_node = target_mapping.get(target, 'enhance_query')  # 기본값은 enhance_query
    logger.info(f"determine_search_target: route='{target}' -> next='{next_node}'")
    return next_node

def determine_cs_target(state: ChatState) -> str:
    """cs_hub에서 다음 노드를 결정하는 조건부 함수 - LLM 분류 결과 기반"""
    target = state.route.get("target")
    classification = state.cs.get("classification", "cs_intake")
    
    logger.info(f"CS target decision: route='{target}', classification='{classification}'")
    
    # handoff는 바로 handoff로
    if target == 'handoff' or classification == 'handoff':
        logger.info(f"determine_cs_target: route='{target}', class='{classification}' -> next='handoff'")
        return 'handoff'
    
    # LLM 분류 결과에 따른 분기 (딕셔너리 매핑)
    classification_mapping = {
        'cs_intake': 'cs_intake',
        'faq_policy': 'faq_policy_rag'
    }
    
    next_node = classification_mapping.get(classification, 'cs_intake')
    logger.info(f"determine_cs_target: route='{target}', class='{classification}' -> next='{next_node}'")
    return next_node

def determine_after_enhance_query(state: ChatState) -> str:
    """enhance_query 후 다음 노드를 결정하는 조건부 함수"""
    target = state.route.get("target")
    logger.info(f"After enhance_query decision: '{target}'")
    
    # 딕셔너리 매핑으로 분기 처리 (if문 없음)
    target_mapping = {
        'cart_add': 'product_search',  # cart_add는 product_search 후 cart_manage
        'cart_remove': 'remove_from_cart',
        'product_search': 'product_search',
        'recipe_search': 'recipe_search',
        'cart_view': 'view_cart',
        'checkout': 'view_cart',       # checkout은 먼저 view_cart
    }
    
    next_node = target_mapping.get(target, 'product_search')
    logger.info(f"determine_after_enhance_query: route='{target}' -> next='{next_node}'")
    return next_node

def determine_after_product_search(state: ChatState) -> str:
    """product_search 후 다음 노드를 결정하는 조건부 함수"""
    target = state.route.get("target")
    
    # cart_add인 경우에만 cart_manage로 분기
    cart_add_mapping = {
        'cart_add': 'cart_manage'
    }
    
    next_node = cart_add_mapping.get(target, 'END')
    logger.info(f"determine_after_product_search: route='{target}' -> next='{next_node}'")
    return next_node

def determine_after_view_cart(state: ChatState) -> str:
    """view_cart 후 다음 노드를 결정하는 조건부 함수"""
    target = state.route.get("target")
    has_items = bool(state.cart.get("items"))
    
    # checkout이고 장바구니에 아이템이 있는 경우만 checkout으로
    checkout_condition = target == 'checkout' and has_items
    
    next_node = 'checkout' if checkout_condition else 'END'
    logger.info(f"determine_after_view_cart: route='{target}', has_items={has_items} -> next='{next_node}'")
    return next_node

def determine_after_faq_policy_rag(state: ChatState) -> str:
    """faq_policy_rag 후 다음 노드를 결정하는 조건부 함수"""
    should_handoff = state.cs.get("answer", {}).get("should_handoff", False)
    next_node = 'handoff' if should_handoff else 'END'
    logger.info(f"determine_after_faq_policy_rag: should_handoff={should_handoff} -> next='{next_node}'")
    return next_node

def determine_after_vision_recipe(state: ChatState) -> str:
    """vision_recipe 후 다음 노드를 결정하는 조건부 함수"""
    target = state.route.get("target")
    logger.info(f"After vision_recipe decision: target='{target}'")

    # vision_recipe에서 recipe_search로 라우팅된 경우 recipe_search로 이동
    if target == 'recipe_search':
        return 'recipe_search'
    else:
        # 기본적으로 recipe_search로 이동
        return 'recipe_search'

# ===== 라우팅 결정 함수들 (StateGraph용) =====
def determine_route(state: ChatState) -> str:
    """라우터의 결과에 따라 다음 노드를 결정하는 함수"""
    target = state.route.get("target")
    logger.info(f"Routing decision: target = '{target}'")

    if target == 'clarify':
        return 'clarify'
    elif target in ['product_search', 'recipe_search', 'vision_recipe', 'cart_add', 'cart_remove', 'cart_view', 'checkout']:
        return 'search_hub'
    elif target in ['handoff', 'cs_intake', 'faq_policy_rag']:
        return 'cs_hub'
    else:
        # 알 수 없는 타겟의 경우 clarify로 보냄
        state.meta["final_message"] = "알 수 없는 요청입니다. 다시 시도해주세요."
        return 'clarify'

# ===== StateGraph 생성 =====
def create_workflow_graph():
    """LangGraph StateGraph를 사용한 워크플로우 생성"""
    
    # StateGraph 생성
    workflow = StateGraph(ChatState)
    
    # 노드 추가 - 허브와 개별 기능 노드들
    workflow.add_node("router", router_route)
    workflow.add_node("clarify", clarify)
    workflow.add_node("search_hub", search_hub)  # 상태 설정용으로 변경 예정
    workflow.add_node("cs_hub", cs_hub)          # 상태 설정용으로 변경 예정
    
    # 개별 기능 노드들 추가
    workflow.add_node("enhance_query", enhance_query)
    workflow.add_node("product_search", product_search_rag_text2sql)
    workflow.add_node("recipe_search", recipe_search)
    workflow.add_node("vision_recipe", vision_recipe)
    workflow.add_node("cart_manage", cart_manage)
    workflow.add_node("view_cart", view_cart)
    workflow.add_node("remove_from_cart", remove_from_cart)
    workflow.add_node("checkout", checkout)
    workflow.add_node("cs_intake", cs_intake)
    workflow.add_node("faq_policy_rag", faq_policy_rag)
    workflow.add_node("handoff", handoff)
    
    # 엣지 연결
    # 시작점 설정
    workflow.set_entry_point("router")
    
    # 라우터에서 조건부 분기
    workflow.add_conditional_edges(
        "router",
        determine_route,  # 라우팅 결정 함수
        {
            "clarify": "clarify",
            "search_hub": "search_hub", 
            "cs_hub": "cs_hub"
        }
    )
    
    # search_hub에서 개별 기능으로 conditional_edges 분기
    workflow.add_conditional_edges(
        "search_hub",
        determine_search_target,
        {
            "enhance_query": "enhance_query",
            "vision_recipe": "vision_recipe"
        }
    )
    
    # cs_hub에서 개별 기능으로 conditional_edges 분기 (LLM 분류 기반)
    workflow.add_conditional_edges(
        "cs_hub",
        determine_cs_target,
        {
            "cs_intake": "cs_intake",
            "faq_policy_rag": "faq_policy_rag",
            "handoff": "handoff"
        }
    )
    
    # enhance_query 후 분기
    workflow.add_conditional_edges(
        "enhance_query",
        determine_after_enhance_query,
        {
            "product_search": "product_search",
            "recipe_search": "recipe_search", 
            "view_cart": "view_cart",
            "remove_from_cart": "remove_from_cart",
            "checkout": "checkout",               
        }
    )
    
    # product_search 후 분기 (cart_add인 경우만)
    workflow.add_conditional_edges(
        "product_search",
        determine_after_product_search,
        {
            "cart_manage": "cart_manage",
            "END": END
        }
    )
    
    # view_cart 후 분기 (checkout인 경우만)
    workflow.add_conditional_edges(
        "view_cart", 
        determine_after_view_cart,
        {
            "checkout": "checkout",
            "END": END
        }
    )
    
    # faq_policy_rag 후 분기 (handoff 여부 결정)
    workflow.add_conditional_edges(
        "faq_policy_rag",
        determine_after_faq_policy_rag,
        {
            "handoff": "handoff",
            "END": END
        }
    )

    # vision_recipe 후 분기 (recipe_search로 이동)
    workflow.add_conditional_edges(
        "vision_recipe",
        determine_after_vision_recipe,
        {
            "recipe_search": "recipe_search"
        }
    )

    # 종료 노드들
    workflow.add_edge("clarify", END)
    workflow.add_edge("recipe_search", END)
    workflow.add_edge("cart_manage", END)
    workflow.add_edge("remove_from_cart", END)
    workflow.add_edge("checkout", END)
    workflow.add_edge("cs_intake", END)
    workflow.add_edge("handoff", END)
    
    # 컴파일하여 실행 가능한 그래프 생성
    return workflow.compile()

# 글로벌 workflow 인스턴스 생성
_workflow_graph = None

def get_workflow_graph():
    """워크플로우 그래프 싱글톤 인스턴스 반환"""
    global _workflow_graph
    if _workflow_graph is None:
        _workflow_graph = create_workflow_graph()
        logger.info("StateGraph workflow created successfully")
    return _workflow_graph

def run_workflow(state: ChatState) -> ChatState:
    """StateGraph 기반 워크플로우 실행 (기존 인터페이스 유지)"""
    try:
        workflow_graph = get_workflow_graph()
        result = workflow_graph.invoke(state)
        logger.info("StateGraph workflow execution completed")
        return result
    except Exception as e:
        logger.error(f"StateGraph workflow execution failed: {e}")
        # 폴백: 기존 방식으로 처리
        return run_workflow_fallback(state)

def run_workflow_fallback(state: ChatState) -> ChatState:
    """기존 if문 방식 워크플로우 (폴백용)"""
    # 1. LLM 기반 라우팅
    state.update(router_route(state))
    target = state.route.get("target")
    logger.info(f"Fallback workflow: Routing complete. Target is '{target}'.")
    
    # 2. 라우팅 결과에 따라 적절한 허브로 분기
    if target == 'clarify':
        state.update(clarify(state))
        return state
    
    # Search 관련 의도들을 search_hub로 전달
    elif target in ['product_search', 'recipe_search', 'cart_add', 'cart_remove', 'cart_view', 'checkout']:
        logger.info(f"Fallback routing to search_hub for target: {target}")
        print("search_hub:", search_hub(state))
        return search_hub(state)
        
    # CS 관련 의도들을 cs_hub로 전달  
    elif target in ['cs_intake', 'faq_policy_rag', 'handoff']:
        logger.info(f"Fallback routing to cs_hub for target: {target}")
        return cs_hub(state)
        
    else: 
        state.meta["final_message"] = "알 수 없는 요청입니다. 다시 시도해주세요."

    logger.info("Fallback workflow finished.")
    return state
