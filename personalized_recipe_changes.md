# 개인맞춤화 레시피 추천 시스템 구현 변경사항

## 개요
사용자의 `allergy`, `vegan`, `unfavorite` 정보를 기반으로 개인맞춤화된 레시피 검색 및 추천 기능을 구현했습니다.

## 새로 추가된 파일

### 1. policy.py
**경로**: `C:\Users\koko5\Downloads\grocery_chatbot_v4_2025_09_15\policy.py`

**주요 기능**:
- 사용자 개인정보 조회 (`get_user_preferences`)
- 개인맞춤화 검색 키워드 생성 (`create_personalized_search_keywords`)
- 레시피 재료 필터링 (`filter_recipe_ingredients`)
- 레시피 내용 기반 제외 판단 (`should_exclude_recipe_content`)
- 개인맞춤화 추천 키워드 생성 (`get_personalized_recipe_suggestions`)

**핵심 코드**:
```python
def get_user_preferences(user_id: str) -> Dict[str, Any]:
    """사용자의 allergy, vegan, unfavorite 정보 조회"""
    # user_detail_tbl에서 개인정보 조회
    
def filter_recipe_ingredients(ingredients: List[str], user_preferences: Dict[str, Any]) -> List[str]:
    """개인 선호도에 따라 재료 필터링"""
    # 비건, 알러지, 싫어하는 음식 기반 필터링
    
def should_exclude_recipe_content(title: str, content: str, user_preferences: Dict[str, Any]) -> bool:
    """레시피 제목과 내용으로 개인 선호도 필터링 판단"""
```

## 수정된 파일

### 2. nodes/recipe_search.py
**경로**: `C:\Users\koko5\Downloads\grocery_chatbot_v4_2025_09_15\nodes\recipe_search.py`

**주요 변경사항**:

#### 2.1 Import 추가
```python
# 개인맞춤화 정책 임포트
from policy import (
    get_user_preferences, 
    create_personalized_search_keywords, 
    filter_recipe_ingredients,
    should_exclude_recipe_content
)
```

#### 2.2 `_handle_general_recipe_search` 함수 수정
- 사용자 선호도 조회 기능 추가
- 개인맞춤화된 검색 쿼리 생성
- 개인맞춤화 메시지 표시

```python
def _handle_general_recipe_search(original_query: str, rewrite_query: str, state: ChatState = None) -> Dict[str, Any]:
    # 개인맞춤화: 사용자 선호도 조회
    user_preferences = {}
    if state and state.user_id:
        user_preferences = get_user_preferences(state.user_id)
    
    # 개인맞춤화된 검색 쿼리 생성
    if user_preferences:
        personalized_query, exclusion_keywords = create_personalized_search_keywords(base_query, user_preferences)
        recipe_query = personalized_query
    
    # Tavily로 개인맞춤화된 검색 실행
    recipe_results = _search_with_tavily(recipe_query, user_preferences)
```

#### 2.3 `_handle_selected_recipe` 함수 수정
- 개인 선호도 기반 재료 필터링
- 개인맞춤화된 상품 추천
- 개인맞춤화 메시지 포맷팅

```python
def _handle_selected_recipe(query: str, state: ChatState = None) -> Dict[str, Any]:
    # 개인맞춤화: 사용자 선호도 조회
    user_preferences = {}
    if state and state.user_id:
        user_preferences = get_user_preferences(state.user_id)
    
    # 개인맞춤화: 사용자 선호도에 맞지 않는 재료 필터링
    if user_preferences:
        filtered_ingredients = filter_recipe_ingredients(extracted_ingredients, user_preferences)
        extracted_ingredients = filtered_ingredients
        structured_content["ingredients"] = extracted_ingredients
    
    # 개인맞춤화된 상품 추천
    matched_products = _get_product_details_from_db(all_search_terms, user_preferences)
```

#### 2.4 `_search_with_tavily` 함수 수정
- 개인 선호도 기반 검색 제외 키워드 추가
- 검색 결과에서 개인 선호도 필터링

```python
def _search_with_tavily(query: str, user_preferences: Dict[str, Any] = None) -> List[Dict[str, Any]]:
    # 사용자 선호도 기반 제외 키워드 추가
    if user_preferences:
        if user_preferences.get("vegan", False):
            meat_exclusions = ["-고기", "-돼지고기", "-소고기", "-닭고기", "-생선", "-육류"]
            exclusion_terms.extend(meat_exclusions)
        
        # 알러지 관련 제외
        if user_preferences.get("allergy"):
            allergy_items = user_preferences["allergy"].split(",")
            for item in allergy_items:
                exclusion_terms.append(f"-{item.strip()}")
    
    # 개인맞춤화 필터링 - 제목과 내용 기반
    if user_preferences and should_exclude_recipe_content(
        res.get("title", ""), res.get("content", ""), user_preferences
    ):
        continue  # 개인 선호도에 맞지 않는 레시피 제외
```

#### 2.5 `_get_product_details_from_db` 함수 수정
- DB 쿼리에서 개인 선호도 기반 상품 제외
- 비건, 알러지, 싫어하는 음식 기반 필터링

```python
def _get_product_details_from_db(ingredient_names: List[str], user_preferences: Dict[str, Any] = None) -> List[Dict[str, Any]]:
    # 개인맞춤화: 사용자 선호도에 따른 제외 조건 생성
    exclusion_conditions = []
    
    if user_preferences:
        # 비건 사용자의 경우 동물성 제품 제외
        if user_preferences.get("vegan", False):
            vegan_exclusions = ["고기", "돼지", "소고기", "닭", "생선", ...]
            for exclusion in vegan_exclusions:
                exclusion_conditions.append(f"p.product NOT LIKE '%{exclusion}%'")
        
        # 알러지 제외
        if user_preferences.get("allergy"):
            allergy_items = [item.strip() for item in user_preferences["allergy"].split(",")]
            for allergy in allergy_items:
                exclusion_conditions.append(f"p.product NOT LIKE '%{allergy}%'")
```

#### 2.6 `_format_recipe_content` 함수 수정
- 개인맞춤화 알림 메시지 추가
- 비건, 알러지, 선호도 정보 표시

```python
def _format_recipe_content(structured_content: Dict[str, Any], user_preferences: Dict[str, Any] = None) -> str:
    # 개인맞춤화 메시지 추가
    personalized_note = ""
    if user_preferences:
        if user_preferences.get("vegan"):
            personalized_note += "**🌱 비건 레시피로 개인맞춤화되었습니다.**\n"
        if user_preferences.get("allergy"):
            personalized_note += f"**⚠️ 알러지({user_preferences['allergy']}) 정보가 반영되었습니다.**\n"
        if user_preferences.get("unfavorite"):
            personalized_note += f"**❌ 선호하지 않는 음식({user_preferences['unfavorite']})이 제외되었습니다.**\n"
```

## 구현된 기능

### 1. 사용자 개인정보 기반 레시피 검색
- `user_detail_tbl`에서 `allergy`, `vegan`, `unfavorite` 정보 조회
- 검색 시 개인 선호도 자동 반영

### 2. 개인맞춤화된 Tavily 검색
- 비건 사용자: 육류 관련 검색 결과 제외
- 알러지 정보: 해당 알러지 유발 요소 제외
- 싫어하는 음식: 관련 레시피 제외

### 3. 재료 추천 필터링
- 레시피에서 추출된 재료 중 개인 선호도에 맞지 않는 재료 제거
- DB 상품 검색 시 개인 선호도 기반 상품 제외

### 4. 사용자 피드백
- 개인맞춤화된 결과임을 명시하는 메시지 표시
- 어떤 조건이 적용되었는지 사용자에게 알림

## 사용 방법

1. 사용자가 회원가입/프로필 설정에서 개인 선호도 정보 입력
2. 레시피 검색 시 자동으로 개인 선호도 반영
3. "저녁메뉴" 버튼 클릭 시 개인맞춤화된 레시피 추천
4. 선택된 레시피의 재료 추천 시에도 개인 선호도 반영

## 기존 코드 보존
- 기존 레시피 검색 로직은 모두 유지
- 개인정보가 없는 사용자도 기존과 동일하게 작동
- 기존 함수의 기본 동작은 변경되지 않음

## 데이터베이스 연동
- `user_detail_tbl` 테이블 활용
- `allergy`, `vegan`, `unfavorite` 컬럼 정보 활용
- 추가적인 DB 스키마 변경 없음