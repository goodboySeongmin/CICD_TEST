"""
vision_recipe.py — 비전 AI 기반 레시피 검색 모듈
책임:
- 이미지를 분석하여 만들어진 음식인지 판단
- 음식 이름을 추출하여 레시피 검색용 데이터 생성
- query_enhancement와 동일한 형식으로 데이터 구조화
"""
import logging
import os
import base64
import json
from typing import Dict, Any, Optional
import sys

# 프로젝트 루트 경로 추가
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from graph_interfaces import ChatState

logger = logging.getLogger("VISION_RECIPE")

# OpenAI 클라이언트 설정
try:
    import openai
    openai_api_key = os.getenv("OPENAI_API_KEY")
    openai_client = openai.OpenAI(api_key=openai_api_key) if openai_api_key else None
    if not openai_client:
        logger.warning("OpenAI API key not found. Vision features will be disabled.")
except ImportError:
    openai_client = None
    logger.warning("OpenAI package not available. Vision features will be disabled.")

def vision_recipe(state: ChatState) -> Dict[str, Any]:
    """
    이미지를 분석하여 음식을 인식하고 레시피 검색용 데이터를 생성합니다.
    """
    logger.info("비전 레시피 검색 프로세스 시작")

    if not openai_client:
        return {
            "route": {"target": "clarify", "confidence": 0.1},
            "response": "죄송합니다. 이미지 분석 기능을 사용할 수 없습니다."
        }

    try:
        # 이미지 데이터 확인 (단순화된 로직)
        image_data = _extract_image_from_state(state)
        if not image_data:
            return {
                "route": {"target": "clarify", "confidence": 0.1},
                "response": "이미지를 찾을 수 없습니다. 이미지를 다시 업로드해 주세요."
            }

        # 이미지 분석으로 음식 인식
        food_analysis = _analyze_food_image(image_data)
        if not food_analysis or not food_analysis.get("is_food"):
            return {
                "route": {"target": "clarify", "confidence": 0.3},
                "response": "음식 이미지가 아니거나 인식이 어렵습니다. 요리가 완료된 음식 사진을 업로드해 주세요."
            }

        food_name = food_analysis.get("food_name", "")
        if not food_name:
            return {
                "route": {"target": "clarify", "confidence": 0.3},
                "response": "음식을 정확히 인식할 수 없습니다. 더 명확한 사진을 업로드해 주세요."
            }

        logger.info(f"음식 인식 완료: {food_name}")

        # query_enhancement와 동일한 형식으로 데이터 생성 및 라우팅
        enhanced_data = _create_recipe_query_data(food_name, food_analysis)
        enhanced_data["route"] = {"target": "recipe_search", "confidence": 0.9}
        enhanced_data["food_analysis"] = food_analysis # API 응답에서 사용할 수 있도록 전달

        return enhanced_data

    except Exception as e:
        logger.error(f"비전 레시피 검색 중 오류 발생: {e}", exc_info=True)
        return {
            "route": {"target": "clarify", "confidence": 0.1},
            "response": "이미지 분석 중 오류가 발생했습니다. 다시 시도해 주세요."
        }

def _extract_image_from_state(state: ChatState) -> Optional[str]:
    """
    ChatState에서 이미지 데이터를 추출합니다.
    vision 워크플로우는 state.image에 base64 데이터가 담겨 올 것을 기대합니다.
    """
    if hasattr(state, 'image') and state.image and 'base64,' in state.image:
        logger.info("state.image에서 base64 이미지 데이터 발견")
        # "data:image/jpeg;base64," 부분을 제외한 순수 base64 데이터만 반환
        return state.image.split(',')[1]
    
    logger.warning("state.image에서 유효한 base64 이미지 데이터를 찾을 수 없음")
    return None

def _analyze_food_image(base64_image_data: str) -> Optional[Dict[str, Any]]:
    """
    OpenAI Vision API를 사용하여 이미지에서 음식을 분석합니다.
    """
    system_prompt = """당신은 음식 이미지 분석 전문가입니다.
이미지를 분석하여 다음 정보를 JSON 형식으로 제공해주세요:

1. is_food: 이미지가 요리된 음식인지 판단 (true/false)
2. food_name: 음식의 정확한 한국어 이름 (예: "김치찌개", "불고기", "파스타")
3. confidence: 분석 신뢰도 (0.0-1.0)
4. description: 음식에 대한 간단한 설명
5. ingredients: 보이는 주요 재료들 (배열)

규칙:
- 요리된 음식(완성된 요리)만 is_food: true로 판단
- 생재료, 식재료, 과일, 채소만 있는 경우는 is_food: false
- 음식 이름은 가장 일반적인 한국어 명칭 사용
- 확신이 없으면 confidence를 낮게 설정

JSON 형식 예시:
{
  "is_food": true,
  "food_name": "김치찌개",
  "confidence": 0.9,
  "description": "김치와 돼지고기가 들어간 한국 전통 찌개",
  "ingredients": ["김치", "돼지고기", "두부", "대파"]
}"""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "이 이미지에서 음식을 분석해주세요."},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image_data}"
                            }
                        }
                    ]
                }
            ],
            response_format={"type": "json_object"},
            max_tokens=500
        )
        result = json.loads(response.choices[0].message.content)
        logger.info(f"이미지 분석 결과: {result}")
        return result
    except Exception as e:
        logger.error(f"OpenAI 이미지 분석 API 호출 실패: {e}")
        return None

def _create_recipe_query_data(food_name: str, food_analysis: Dict[str, Any]) -> Dict[str, Any]:
    """
    음식 이름을 기반으로 query_enhancement와 동일한 형식의 데이터를 생성합니다.
    """
    keywords = list(set([food_name] + food_analysis.get("ingredients", [])))
    
    return {
        "rewrite": {
            "text": f"{food_name} 레시피 검색",
            "keywords": keywords,
            "confidence": food_analysis.get("confidence", 0.8),
            "changes": ["이미지에서 음식 이름 추출", "레시피 검색용 쿼리 생성"]
        },
        "slots": {
            "dish_name": food_name,
            "ingredients": food_analysis.get("ingredients", [])[:5] # 최대 5개
        }
    }