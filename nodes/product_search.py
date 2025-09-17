import logging
import os
import re
import json
from typing import Dict, List, Any, Optional
from mysql.connector import Error
from mysql.connector.pooling import MySQLConnectionPool
import sys
from graph_interfaces import ChatState
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logger = logging.getLogger('chatbot.product_search')

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("scikit-learn not available. Using simple text matching.")

try:
    import openai
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if openai_api_key:
        openai_client = openai.OpenAI(api_key=openai_api_key)
    else:
        openai_client = None
        logger.warning("OpenAI API key not found. Text2SQL will be limited.")
except ImportError:
    openai_client = None
    logger.warning("OpenAI package not available.")

# --- DB 연결 설정 (환경 변수에서 로드) ---
DB_CONFIG = {
    'host': os.getenv('DB_HOST', '127.0.0.1'),
    'user': os.getenv('DB_USER', 'qook_user'),
    'password': os.getenv('DB_PASS', 'qook_pass'),
    'database': os.getenv('DB_NAME', 'qook_chatbot'),
    'port': int(os.getenv('DB_PORT', 3306))
}

# --- DB 커넥션 풀 생성 ---
try:
    db_connection_pool = MySQLConnectionPool(pool_name="qook_pool",
                                            pool_size=5,
                                             **DB_CONFIG)
    logger.info("DB 커넥션 풀 생성 성공")
except Error as e:
    db_connection_pool = None
    logger.error(f"DB 커넥션 풀 생성 실패: {e}")

def get_db_connection():
    """데이터베이스 커넥션 풀에서 커넥션을 가져옵니다."""
    if db_connection_pool:
        try:
            return db_connection_pool.get_connection()
        except Error as e:
            logger.error(f"DB 커넥션 풀에서 연결 가져오기 실패: {e}")
            return None
    logger.error("DB 커넥션 풀이 초기화되지 않았습니다.")
    return None

def _format_product_from_db(p: Dict[str, Any]) -> Dict[str, Any]:
    """DB에서 가져온 상품 딕셔너리를 표준 포맷으로 정제합니다."""
    p['price'] = float(p.get('price', 0.0) or 0.0)
    p['stock'] = int(p.get('stock', 0) or 0)
    p['organic'] = p.get('organic') == 'Y'
    p['cart_add_count'] = p.get('cart_add_count', 0) or 0

    cat_map = {1: '과일', 2: '채소', 3: '곡물/견과류', 4: '육류/수산', 5: '유제품',
                6: '냉동식품', 7: '조미료/소스', 8: '음료', 9: '베이커리', 10: '기타'}
    p['category_text'] = cat_map.get(p.get('category_id'), '기타')
    
    p['search_text'] = f"{p.get('name', '')} {p.get('item', '')} {p.get('origin', '')} {p['category_text']} {'유기농' if p['organic'] else ''}"
    return p

class ProductSearchEngine:
    """통합 상품 검색 엔진"""
    def __init__(self):
        self.product_data = []
        self.tfidf_vectorizer = None
        self.tfidf_matrix = None
        self.db_schema = self._get_db_schema()
        # self._load_data_from_db()
    
    def _get_db_schema(self) -> str:
        return """
        CREATE TABLE product_tbl (
            product VARCHAR(45) PRIMARY KEY,
            item VARCHAR(45) NOT NULL,
            organic VARCHAR(45),
            unit_price VARCHAR(45) NOT NULL,
            origin VARCHAR(45),
            cart_add_count INT DEFAULT 0,
            FOREIGN KEY (item) REFERENCES category_tbl(item)
        );
        CREATE TABLE stock_tbl (
            product VARCHAR(45) PRIMARY KEY,
            stock VARCHAR(45) NOT NULL,
            FOREIGN KEY (product) REFERENCES product_tbl(product) ON DELETE CASCADE
        );
        CREATE TABLE category_tbl (
            item VARCHAR(45) PRIMARY KEY,
            category_id INT,
            FOREIGN KEY (category_id) REFERENCES category_definition_tbl(category_id)
        );
        CREATE TABLE category_definition_tbl (
            category_id INT PRIMARY KEY,
            category_name VARCHAR(45) NOT NULL
        );
        """
    
    def _load_data_from_db(self):
        """DB에서 상품 데이터를 로드하고 RAG 검색을 위한 인덱스를 구축합니다."""
        conn = get_db_connection()
        if not conn:
            logger.error("DB 연결 실패로 상품 데이터를 로드할 수 없습니다.")
            return
        try:
            with conn.cursor(dictionary=True) as cursor:
                sql = """
                    SELECT 
                        p.product as name,
                        p.unit_price as price,
                        p.origin,
                        p.organic,
                        p.item,
                        s.stock,
                        c.category_id
                    FROM product_tbl p
                    LEFT JOIN stock_tbl s ON p.product = s.product
                    LEFT JOIN category_tbl c ON p.item = c.item
                """
                cursor.execute(sql)
                products = cursor.fetchall()
                self.product_data = [_format_product_from_db(p) for p in products]
                logger.info(f"데이터베이스에서 {len(self.product_data)}개의 상품 정보를 로드했습니다.")
            
            if SKLEARN_AVAILABLE and self.product_data:
                texts = [product['search_text'] for product in self.product_data]
                self.tfidf_vectorizer = TfidfVectorizer(max_features=1000, ngram_range=(1, 2))
                self.tfidf_matrix = self.tfidf_vectorizer.fit_transform(texts)
                logger.info("TF-IDF 인덱스를 성공적으로 빌드했습니다.")

        except Error as e:
            logger.error(f"DB에서 상품 데이터 로드 실패: {e}")
        finally:
            if conn and conn.is_connected():
                conn.close()

    def search_products(self, state: ChatState) -> Dict[str, Any]:
        """
        Text2SQL 또는 RAG를 사용하여 상품을 검색하고, LLM으로 결과를 필터링합니다.
        """
        # state에서 쿼리와 슬롯을 가져옵니다. 재작성된 텍스트를 우선 사용합니다.
        query = state.rewrite.get('text', state.query)
        slots = state.slots or {}

        # hjs 수정: LLM 기반 의미 확장으로 쿼리 보강(하드코딩 매핑 제거)
        query, slots = self._llm_expand_query(query, slots)

        # 1차 검색 수행
        result = None
        if openai_client:
            sql_query = self._generate_sql(query, slots)
            if sql_query:
                sql_result = self._execute_sql(sql_query)
                if sql_result:
                    logger.info("Text2SQL 검색 성공")
                    result = {"success": True, "candidates": sql_result, "method": "text2sql", "sql_query": sql_query}

        if not result:
            logger.info("Text2SQL 실패 또는 미사용, RAG 검색으로 전환")
            rag_result = self._try_rag_search(query, slots)
            if rag_result:
                logger.info("RAG 검색 성공")
                result = {"success": True, "candidates": rag_result, "method": "rag"}

        # 2차 LLM 필터링 수행
        if result and result["success"] and result.get("candidates"):
            logger.info(f"LLM 필터링 전 후보 개수: {len(result['candidates'])}")
            # 이를 통해 필터링 함수가 'rewrite'와 'keywords' 정보에 접근할 수 있습니다.
            filtered_candidates = _filter_products_with_llm(result["candidates"], state, openai_client)
            logger.info(f"LLM 필터링 후 후보 개수: {len(filtered_candidates)}")
            # 필터링된 결과로 업데이트
            result["candidates"] = filtered_candidates
            result["filtered"] = True
            return result

        logger.warning("Text2SQL 및 RAG 검색 모두 실패")
        # return {"success": False, "candidates": [], "method": "failed", "error": "검색 결과가 없습니다."}
        return {"success": False, "candidates": [], "method": "failed", "error": "오늘은 해당 상품이 준비되지 않았어요. 다른 상품을 이용해주세요."}
    
    def _generate_sql(self, query: str, slots: Dict[str, Any]) -> Optional[str]:
        if not openai_client:
            logger.warning("OpenAI client 없음, SQL 생성 불가")
            return None
        
        logger.info(f"SQL 생성 시작 - Query: '{query}', Slots: {slots}")
        try:
            system_prompt = self._build_system_prompt(query,slots)
            user_prompt = self._build_user_prompt(query, slots)
            response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.1,
                max_tokens=500
            )
            
            sql_response = response.choices[0].message.content.strip()
            logger.debug(f"LLM SQL 응답: {sql_response}")
            sql_query = self._extract_sql_from_response(sql_response)
            logger.info(f"LLM 응답에서 추출된 SQL: {sql_query}")
            if sql_query and self._validate_sql(sql_query):
                logger.info(f"SQL 생성 성공: {sql_query}")
                return sql_query
            else:
                logger.warning("SQL 검증 실패 또는 빈 쿼리")
                return None
                
        except Exception as e:
            logger.error(f"SQL 생성 중 오류 발생: {e}")
            return None
    
    def _build_system_prompt(self, query: str, slots: Dict[str, Any]) -> str:
        return f"""당신은 신선식품 쇼핑몰의 SQL 전문가입니다. 
사용자의 자연어 쿼리와 slots을 바탕으로 정확한 MySQL SQL로 변환하세요.
## 기본 원칙
- `slots` 딕셔너리에 있는 각 키-값 쌍을 `AND` 조건으로 결합하여 `WHERE` 절을 구성합니다.
- `slots`가 비어있으면 `WHERE` 절을 추가하지 않습니다.
- `product_tbl`은 `p`, `stock_tbl`은 `s`, `category_tbl`은 `c`라는 별칭(alias)을 사용합니다.
- `slots` 안의 키값 중 product, category, item, price_cap, origin, organic이 있으면 전부 where 절에 반영되어야 합니다.

---
## 슬롯별 변환 규칙
-`product` 슬롯:
  - **설명**: 상품명을 지정합니다. (예: "사과", "교자")
  - **SQL 변환**: `product_tbl`의 `product` 컬럼을 `LIKE` 검색합니다. 사용자가 "사과"를 검색하면 "유기농 사과"도 찾을 수 있어야 하므로, 완전 일치(`=`)가 아닌 `LIKE '%키워드%'`를 사용합니다.
  - **예시**: `slots: {{"product": "사과"}}` → `... WHERE p.product LIKE '%사과%'`

- `category` 슬롯:
  - **설명**: 상품의 대분류를 지정합니다. (예: "과일", "채소")
  - **SQL 변환**: `category_tbl`과 `JOIN`이 필요합니다. 제공된 **# 카테고리 매핑**을 사용하여 슬롯의 문자열 값을 숫자 `category_id`로 변환해야 합니다.
  - **예시**: `slots: {{"category": "과일"}}` → `... WHERE c.category_id = 1`

- `item` 슬롯:
  - **설명**: 상품의 구체적인 품목을 지정합니다. (예: "사과", "당근")
  - **SQL 변환**: `product_tbl`의 `item` 컬럼을 `LIKE` 검색합니다. 사용자가 "사과"를 검색하면 "유기농 사과"도 찾을 수 있어야 하므로, 완전 일치(`=`)가 아닌 `LIKE '%키워드%'`를 사용합니다.
  - **예시**: `slots: {{"item": "사과"}}` → `... WHERE p.item LIKE '%사과%'`

- `price_cap` 슬롯:
  - **설명**: 사용자가 원하는 최대 가격을 나타냅니다. 이 값 이하의 상품을 찾아야 합니다.
  - **SQL 변환**: `product_tbl`의 `unit_price` 컬럼을 `CAST`를 사용하여 숫자형(`UNSIGNED`)으로 변환한 후, `<=` 연산자로 비교합니다.
  - **예시**: `slots: {{"price_cap": 10000}}` → `... WHERE CAST(p.unit_price AS UNSIGNED) <= 10000`

- `origin` 슬롯:
  - **설명**: 상품의 원산지를 지정합니다.
  - **SQL 변환**: `product_tbl`의 `origin` 컬럼과 정확히 일치(`=`)하는 항목을 찾습니다.
  - **예시**: `slots: {{"origin": "국내산"}}` → `... WHERE p.origin = '국내산'`

- `organic` 슬롯:
  - **설명**: 유기농 상품 여부를 나타냅니다.
  - **SQL 변환**: 슬롯 값이 `true`일 경우에만, `product_tbl`의 `organic` 컬럼이 'Y'인 조건을 추가합니다. 슬롯이 없거나 `false`이면 이 조건은 추가하지 않습니다.
  - **예시**: `slots: {{"organic": true}}` → `... WHERE p.organic = 'Y'`

# 데이터베이스 스키마:
{self.db_schema}
# 사용자 쿼리:
{query}
# 추출된 슬롯:
{slots}

# 카테고리 매핑:
1: 과일, 2: 채소, 3: 곡물/견과류, 4: 육류/수산, 5: 유제품, 6: 냉동식품, 7: 조미료/소스, 8: 음료, 9: 베이커리, 10: 기타

# Few-shot 예시들:

## 기본 검색 예시

예시 1:
사용자 쿼리: "사과 찾아줘"
사고 과정: '사과'라는 상품을 찾는 요청 -> product_tbl에서 상품명(product) 또는 품목(item)에 '사과'가 포함된 항목 검색 -> 가격, 원산지, 재고 정보 함께 조회
SELECT p.product, p.unit_price, p.origin, s.stock FROM product_tbl p LEFT JOIN stock_tbl s ON p.product = s.product WHERE p.product LIKE '%사과%' OR p.item LIKE '%사과%';

예시 2:
사용자 쿼리: "3000원 이하 과일 추천해줘"
사고 과정: 가격 조건(3000원 이하) + 카테고리(과일=1) -> product_tbl과 category_tbl 조인 -> p.item과 c.item을 연결 -> 가격 조건 적용
SELECT DISTINCT p.product, p.unit_price, p.origin, s.stock FROM product_tbl p LEFT JOIN stock_tbl s ON p.product = s.product LEFT JOIN category_tbl c ON p.item = c.item WHERE CAST(p.unit_price AS UNSIGNED) <= 3000 AND c.category_id = 1;

예시 3:
사용자 쿼리: "유기농 채소 있어?"
사고 과정: 유기농(organic='Y') + 채소(category_id=2) -> product_tbl의 organic 필드와 category_tbl 조인
SELECT p.product, p.unit_price, p.origin, s.stock FROM product_tbl p LEFT JOIN stock_tbl s ON p.product = s.product LEFT JOIN category_tbl c ON p.item = c.item WHERE p.organic = 'Y' AND c.category_id = 2;

예시 4:
사용자 쿼리: "재고 많은 상품 보여줘"
사고 과정: 재고량 기준 정렬 -> stock_tbl의 stock 컬럼으로 내림차순 정렬
SELECT p.product, p.unit_price, p.origin, s.stock FROM product_tbl p LEFT JOIN stock_tbl s ON p.product = s.product ORDER BY CAST(s.stock AS UNSIGNED) DESC LIMIT 10;

## 고급 및 개인화 검색 예시

예시 5 (인기 상품):
사용자 쿼리: "요즘 제일 잘 나가는 상품이 뭐야?"
사고 과정: 인기 상품은 장바구니 추가 횟수(cart_add_count)가 높은 상품 -> product_tbl의 cart_add_count를 기준으로 내림차순 정렬
SELECT p.product, p.unit_price, p.origin, s.stock FROM product_tbl p LEFT JOIN stock_tbl s ON p.product = s.product ORDER BY p.cart_add_count DESC LIMIT 5;

예시 6 (다중 조건 결합 - AND):
사용자 쿼리: "만원 이하로 살 수 있는 국산 유기농 과일 보여줘"
사고 과정: 여러 조건 결합 -> 가격(<=10000), 원산지('국내산'), 유기농('Y'), 카테고리(과일=1) -> 모든 조건을 AND로 연결
SELECT p.product, p.unit_price, p.origin, s.stock FROM product_tbl p LEFT JOIN stock_tbl s ON p.product = s.product LEFT JOIN category_tbl c ON p.item = c.item WHERE CAST(p.unit_price AS UNSIGNED) <= 10000 AND p.origin = '국내산' AND p.organic = 'Y' AND c.category_id = 1;

예시 7 (개인화 - 알러지):
사용자 쿼리: "user001입니다. 견과류 알러지가 있는데, 먹을만한 거 추천해주세요."
사고 과정: 사용자 정보(user_id='user001')와 알러지 정보('견과류') 확인 -> user_detail_tbl JOIN -> 알러지 정보를 바탕으로 상품명과 품목에서 해당 키워드를 제외 (`NOT LIKE`)
SELECT p.product, p.unit_price, p.origin FROM product_tbl p LEFT JOIN stock_tbl s ON p.product = s.product WHERE s.stock > 0 AND p.product NOT LIKE '%견과류%' AND p.item NOT LIKE '%아몬드%' AND p.item NOT LIKE '%호두%' AND p.item NOT LIKE '%땅콩%' ORDER BY p.cart_add_count DESC LIMIT 5;

예시 8 (개인화 - 비건):
사용자 쿼리: "비건을 위한 상품을 찾고 있어요."
사고 과정: 비건 사용자는 육류/수산(4), 유제품(5) 카테고리를 피해야 함 -> 카테고리 ID를 `NOT IN`으로 제외
SELECT p.product, p.unit_price, p.origin, s.stock FROM product_tbl p LEFT JOIN stock_tbl s ON p.product = s.product LEFT JOIN category_tbl c ON p.item = c.item WHERE c.category_id NOT IN (4, 5) ORDER BY p.cart_add_count DESC LIMIT 10;

예시 9 (유의어/확장 검색):
사용자 쿼리: "해산물 좀 찾아줘"
사고 과정: 사용자가 '해산물'을 찾고 있다. '해산물'은 '수산' 품목을 포함하는 개념이며, '육류/수산' 카테고리(ID=4)에 속한다. 따라서 category_id = 4인 상품들을 검색한다.
SELECT p.product, p.unit_price, p.origin, s.stock FROM product_tbl p LEFT JOIN stock_tbl s ON p.product = s.product LEFT JOIN category_tbl c ON p.item = c.item WHERE c.category_id = 4 ORDER BY p.cart_add_count DESC LIMIT 10;

예시 10 (의도 기반 검색):
사용자 쿼리: "아침에 간단하게 먹을만한 거 있어?"
사고 과정: 사용자가 '아침 식사'를 찾고 있다. 아침에는 보통 '빵'이나 '요거트', '우유' 등을 먹는다. 이는 '베이커리' 카테고리(ID=9)와 '유제품' 카테고리(ID=5)에 해당한다. 두 카테고리의 인기 상품을 추천한다.
SELECT p.product, p.unit_price, p.origin, s.stock FROM product_tbl p LEFT JOIN stock_tbl s ON p.product = s.product LEFT JOIN category_tbl c ON p.item = c.item WHERE c.category_id IN (5, 9) ORDER BY p.cart_add_count DESC LIMIT 10;

예시 11 (쿼리와 슬롯 OR 결합):
사용자 쿼리: "조선간장"
추출된 정보: - 카테고리: 조미료
사고 과정: 사용자는 '조선간장'을 직접 검색하고 있지만, '조미료' 카테고리 정보도 함께 제공되었습니다. 이는 '조선간장'을 포함하여 다른 조미료 상품들도 함께 보고 싶다는 의도일 수 있습니다. 따라서 상품명/품목에 '조선간장'이 포함되거나, 또는 카테고리가 '조미료'(ID=7)인 경우를 모두 검색합니다.
SELECT p.product, p.unit_price, p.origin, s.stock FROM product_tbl p LEFT JOIN stock_tbl s ON p.product = s.product LEFT JOIN category_tbl c ON p.item = c.item WHERE (p.product LIKE '%조선간장%' OR p.item LIKE '%조선간장%') OR c.category_id = 7;

# 중요 규칙:
1. 항상 `LEFT JOIN`을 사용하여 모든 관련 테이블을 연결하세요.
2. `LIKE` 검색 시 `'%키워드%'` 패턴을 사용하세요.
3. 가격/재고 비교 시 `CAST(컬럼 AS UNSIGNED)` 사용하세요.
4. 카테고리 검색 시 `category_id` 컬럼을 사용하고 숫자 매핑을 정확히 사용하세요.
5. `category_tbl` 조인 시 `p.item = c.item` 조건을 사용하세요.
6. 유기농 검색 시 `product_tbl`의 `organic = 'Y'` 조건을 사용하세요.
7. 응답 형식: `SQL: [쿼리문]` 으로만 답하세요.
8. 인기 상품 문의는 `product_tbl`의 `cart_add_count`를 기준으로 `DESC` 정렬하세요.
9. 개인화 질문(알러지, 비건 등)이 오면 `user_detail_tbl`을 참조하여 `NOT LIKE` 또는 `NOT IN`으로 조건을 제외하세요.
10. 여러 조건이 동시에 주어지면 product나 item은 OR, 나머지 조건은 AND로 결합하세요.
11. 사용자 정보는 `userinfo_tbl`, `user_detail_tbl`에 있으며, `user_id`로 JOIN 가능합니다.
12. 사용자의 키워드가 명확한 상품이나 카테고리와 일치하지 않을 경우, **단어의 의미를 추론하여 가장 관련성 높은 카테고리를 검색**하세요. (예: '해산물' -> '수산' -> `category_id=4`, '아침식사' -> '베이커리', '유제품' -> `category_id IN (5, 9)`)
"""
    def _build_user_prompt(self, query: str, slots: Dict[str, Any]) -> str:
        prompt_parts = [f"사용자 쿼리: \"{query}\""]
        if slots:
            prompt_parts.append("추출된 정보:")
            if slots.get('category'): prompt_parts.append(f"- 카테고리: {slots['category']}")
            if slots.get('price_cap'): prompt_parts.append(f"- 최대 가격: {slots['price_cap']}원")
            if slots.get('organic'): prompt_parts.append("- 유기농 선호")
            if slots.get('origin'): prompt_parts.append(f"- 원산지: {slots['origin']}")
            if slots.get('item'): prompt_parts.append(f"- 품목: {slots['item']}")
        prompt_parts.append("\n위 정보를 바탕으로 SQL을 생성해주세요.")
        prompt_parts.append("사고 과정을 먼저 설명한 후, SQL을 제공하세요.")
        return "\n".join(prompt_parts)
    
    def _extract_sql_from_response(self, response: str) -> Optional[str]:
        """
        LLM 응답에서 SQL 쿼리를 추출합니다.
        코드 블록이 없는 경우 SQL: 라벨 다음의 SELECT 문을 추출합니다.
        """
        match = re.search(r'```sql\s*\n?(.*?)\n?\s*```', response, re.IGNORECASE | re.DOTALL)
        if match: 
            sql = match.group(1).strip().rstrip(';')
            return ' '.join(sql.split())

        match = re.search(r'```\s*\n?(.*?)\n?\s*```', response, re.IGNORECASE | re.DOTALL)
        if match: 
            sql = match.group(1).strip().rstrip(';')
            if sql.upper().strip().startswith('SELECT'):
                return ' '.join(sql.split())

        match = re.search(r'SQL:\s*(SELECT.*?)(?=\n[A-Z가-힣]|\Z)', response, re.IGNORECASE | re.DOTALL)
        if match: 
            sql = match.group(1).strip().rstrip(';')
            if sql.upper().startswith('SQL:'):
                sql = re.sub(r'^SQL:\s*', '', sql, flags=re.IGNORECASE)
            return ' '.join(sql.split())

        match = re.search(r'(SELECT\s+.*?)(?=\n[A-Z가-힣]|\Z)', response, re.IGNORECASE | re.DOTALL)
        if match: 
            sql = match.group(1).strip().rstrip(';')
            return ' '.join(sql.split())
        return None
    
    def _validate_sql(self, sql: str) -> bool:
        # hjs 수정: 별칭 사용(p.)까지 허용하도록 검증 강화
        sanitized_sql = re.sub(r'\s+', ' ', sql).strip()
        sql_upper = sanitized_sql.upper()

        # 1) SELECT로 시작하는지만 허용
        if not sql_upper.startswith('SELECT'):
            return False

        # 2) 위험 키워드 차단
        dangerous_keywords = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE']
        if any(keyword in sql_upper for keyword in dangerous_keywords):
            logger.warning("위험한 SQL 키워드 감지")
            return False

        # 3) 대상 테이블 포함 여부 검사: 테이블명(product_tbl) 또는 별칭 접근(p.) 허용
        #    - LLM이 별칭만 사용하는 정상 쿼리를 허용하기 위함
        has_table_name = 'PRODUCT_TBL' in sql_upper
        has_alias_usage = re.search(r'\bP\.', sql_upper) is not None
        if not (has_table_name or has_alias_usage):
            logger.warning("product_tbl 테이블명 또는 별칭 'p.' 사용이 SQL에 포함되지 않음")
            return False

        return True

    def _execute_sql(self, sql: str) -> List[Dict[str, Any]]:
        conn = get_db_connection()
        if not conn: return []
        try:
            with conn.cursor(dictionary=True) as cursor:
                cursor.execute(sql)
                results = cursor.fetchall()
                formatted_results = []
                for row in results:
                    formatted_results.append({
                        'sku': row.get('product'), 'name': row.get('product'),
                        'price': float(row.get('unit_price', 0.0) or 0.0), 
                        'stock': int(row.get('stock', 0) or 0),
                        'origin': row.get('origin'), 'score': 0.9
                    })
                return formatted_results
        except Error as e:
            logger.error(f"SQL 실행 실패: {e}, SQL: {sql}")
            return []
        finally:
            if conn and conn.is_connected(): conn.close()

    def _try_rag_search(self, query: str, slots: Dict[str, Any]) -> List[Dict[str, Any]]:
        enhanced_query = self._enhance_query(query, slots)
        if SKLEARN_AVAILABLE and self.tfidf_vectorizer and self.tfidf_matrix is not None:
            candidates = self._tfidf_search(enhanced_query)
        else:
            candidates = self._simple_keyword_search(enhanced_query)
        filtered_candidates = [c for c in candidates if self._passes_slot_filters(c, slots)]
        return self._format_candidates(filtered_candidates[:20])
    
    def _enhance_query(self, query: str, slots: Dict[str, Any]) -> str:
        # hjs 수정: 간단한 정규화/확장 적용 후 질의 보강
        query, slots = self._expand_terms(query, slots)
        parts = [query]
        if slots.get('category'): parts.append(slots['category'])
        if slots.get('organic'): parts.append("유기농")
        if slots.get('item'): parts.append(slots['item'])
        if slots.get('product'): parts.append(slots['product'])
        return ' '.join([str(p) for p in parts if p])

    # hjs 수정: LLM으로 재료/카테고리 의미 확장(하드코딩 없는 방식)
    def _llm_expand_query(self, query: str, slots: Dict[str, Any]) -> (str, Dict[str, Any]):
        # hjs 수정: OpenAI 미사용 시 즉시 휴리스틱 확장으로 대체
        if not openai_client or not query:
            return self._expand_terms(query, slots)
        try:
            # hjs 수정: 의미 확장 예시 강화(달걀/계란, 간마늘/다진 마늘, 사과 품종, 소/돼지/닭 부위)
            system_prompt = (
                "당신은 식재료 용어 정규화 전문가입니다. 입력 질의의 핵심 재료를 대표명으로 정규화하고, 같은 부류의 대표 하위 품목 예시를 0~5개 내로 제안합니다. "
                "출력은 JSON만 반환하세요. 키: canonical_item(대표명), expansions(관련/하위 품목 리스트). 예시: "
                "'다진 마늘/간마늘'→ canonical_item='마늘'; '계란/달걀'→ canonical_item='달걀'; "
                "'홍사과/청사과/홍로'→ canonical_item='사과'; '돼지고기'→ expansions=['목살','삼겹살','앞다리살','뒷다리살','항정살']; "
                "'소고기'→ ['등심','안심','양지','우둔','목심','차돌박이']; '닭고기'→ ['닭가슴살','닭다리','닭봉','닭날개']"
            )
            user_prompt = json.dumps({
                "query": query,
                "slots": slots or {},
                "schema_notes": "product_tbl(product,item,origin,organic,unit_price), category_tbl(item->category_id)"
            }, ensure_ascii=False)
            resp = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.0,
                response_format={"type": "json_object"}
            )
            data = json.loads(resp.choices[0].message.content)
            canonical = (data.get("canonical_item") or data.get("canonical") or "").strip()
            expansions = data.get("expansions") or []
            # 질의 보강
            new_q = query
            extra_terms = []
            if canonical:
                extra_terms.append(canonical)
            if isinstance(expansions, list):
                extra_terms.extend([str(x) for x in expansions if x])
            if extra_terms:
                new_q = f"{query} {' '.join(extra_terms)}".strip()
            # 슬롯 보정(있을 때만)
            new_slots = dict(slots or {})
            if canonical and new_slots.get('item'):
                new_slots['item'] = canonical
            return new_q, new_slots
        except Exception as e:
            logger.debug(f"LLM 의미 확장 실패: {e}")
            return query, slots

    # hjs 수정: LLM 부재/실패 시 최소한의 휴리스틱 확장(다진 마늘→마늘, 돼지고기→부위 확장)
    def _expand_terms(self, query: str, slots: Dict[str, Any]) -> (str, Dict[str, Any]):
        try:
            q = (query or '')
            s = dict(slots or {})
            lower_q = q.lower()
            # 다진 마늘 → 마늘
            if '다진 마늘' in q or '다진마늘' in q or 'minced garlic' in lower_q:
                q += ' 마늘'
                if s.get('item') and ('마늘' not in s.get('item')):
                    s['item'] = '마늘'
            # 돼지고기 → 대표 부위 확장
            if '돼지고기' in q or 'pork' in lower_q:
                q += ' 목살 삼겹살 앞다리살 뒷다리살 항정살'
            # 닭고기 → 대표 부위 확장
            if '닭고기' in q or 'chicken' in lower_q:
                q += ' 닭가슴살 닭다리 닭봉 닭날개'
            # 소고기 → 대표 부위 확장
            if '소고기' in q or 'beef' in lower_q:
                q += ' 등심 안심 양지 우둔 목심 차돌박이'
            # 대파 → 파 계열 보강
            if '대파' in q:
                q += ' 파 쪽파'
                if s.get('item'): s['item'] = '파'
            # 진간장 → 간장 계열 보강
            if '진간장' in q:
                q += ' 간장 양조간장'
                if s.get('item'): s['item'] = '간장'
            # 김치 → 대표 김치 보강
            if '김치' in q and '김치찌개' not in q:
                q += ' 배추김치 포기김치'
            # 두부 → 유형 보강
            if '두부' in q:
                q += ' 부침두부 찌개두부 연두부'
            # hjs 수정: 계란 ↔ 달걀 정규화
            if '계란' in q and '달걀' not in q:
                q += ' 달걀'
                if s.get('item'): s['item'] = '달걀'
            if 'egg' in lower_q and '달걀' not in q:
                q += ' 달걀'
            # 고춧가루 → 유사 표기 보강
            if '고춧가루' in q:
                q += ' 고추가루 고추 분말'
            # 양파 → 변형 보강
            if '다진 양파' in q or '다진양파' in q:
                q += ' 양파'
            return q, s
        except Exception:
            return query, slots
    
    def _tfidf_search(self, query: str) -> List[Dict[str, Any]]:
        query_vector = self.tfidf_vectorizer.transform([query])
        similarities = cosine_similarity(query_vector, self.tfidf_matrix).flatten()
        top_indices = similarities.argsort()[-20:][::-1]
        results = []
        for idx in top_indices:
            if similarities[idx] > 0:
                product = self.product_data[idx].copy()
                product['similarity_score'] = float(similarities[idx])
                results.append(product)
        return results
    
    def _simple_keyword_search(self, query: str) -> List[Dict[str, Any]]:
        keywords = query.lower().split()
        results = []
        for product in self.product_data:
            score = sum(2.0 if keyword in product.get('name', '').lower() else 1.0 for keyword in keywords if keyword in product.get('search_text', '').lower())
            if score > 0:
                product_copy = product.copy()
                product_copy['similarity_score'] = score
                results.append(product_copy)
        results.sort(key=lambda x: x['similarity_score'], reverse=True)
        return results[:20]
    
    def _passes_slot_filters(self, product: Dict[str, Any], slots: Dict[str, Any]) -> bool:
        if slots.get('price_cap') and product.get('price', 0.0) > float(slots['price_cap']): return False
        if product.get('stock', 0) <= 0: return False
        if slots.get('organic') and not product.get('organic', False): return False
        if slots.get('category') and slots['category'] != product.get('category_text', ''): return False
        if slots.get('origin') and slots['origin'] != product.get('origin', ''): return False
        if slots.get('item') and slots['item'] not in product.get('name', '') and slots['item'] not in product.get('item', ''): return False
        return True
    
    def _format_candidates(self, candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [{
            'sku': c.get('name', ''), 'name': c.get('name', ''),
            'price': c.get('price', 0.0), 'stock': c.get('stock', 0),
            'score': c.get('similarity_score', 0.5), 'origin': c.get('origin', ''),
            'category': c.get('category_text', '')
        } for c in candidates]

_search_engine = None

def get_search_engine() -> ProductSearchEngine:
    global _search_engine
    if _search_engine is None: _search_engine = ProductSearchEngine()
    return _search_engine

def product_search_rag_text2sql(state: ChatState) -> Dict[str, Any]:
    logger.info("=== Product Search Node Started ===")
    try:
        search_engine = get_search_engine()
        
        result = search_engine.search_products(state)
        
        if result["success"] and result.get("candidates"):
            search_result = {
                "candidates": result.get("candidates", []),
                "method": result.get("method"),
                "total_results": len(result.get("candidates", []))
            }
            if result.get("sql_query"): 
                search_result["sql"] = result["sql_query"]
            if result.get("filtered"):
                search_result["filtered"] = True
            return {"search": search_result}
        else:
            return {"search": {"candidates": [], "method": "failed", "error": result.get("error"), "total_results": 0}}
            
    except Exception as e:
        logger.error(f"Product search failed with error: {e}", exc_info=True)
        return {"search": {"candidates": [], "method": "error", "error": str(e), "total_results": 0}}
    except Exception as e:
        logger.error(f"Product search failed with error: {e}", exc_info=True)
        return {"search": {"candidates": [], "method": "error", "error": str(e), "total_results": 0}}
    
def _filter_products_with_llm(
    products: List[Dict[str, Any]],
    state:ChatState,
    llm_client: Optional[openai.OpenAI]
) -> List[Dict[str, Any]]:
    """
    LLM을 사용하여 사용자의 쿼리와 1차 검색된 상품 목록의 연관성을 판단하고,
    관련 없는 상품들을 정밀하게 필터링합니다.
    """
    # LLM 클라이언트가 없거나, 필터링할 상품이 1개 이하면 필터링을 건너뜁니다.
    if not llm_client or not products or len(products) <= 1:
        return products
    candidate_info_full = [
        {
            "name": p.get("name"),
            "price": p.get("price"),
            "origin": p.get("origin"),
            "organic": p.get("organic"), 
            "category": p.get("category_text")
        }
        # get() 메서드의 두 번째 인자로 기본값을 제공하여 키가 없는 경우에도 오류가 발생하지 않도록 합니다.
        for p in products
    ]

    # state에서 재작성된 keywords를 가져옵니다. 없으면 빈 리스트를 사용합니다.
    keywords = state.rewrite.get("keywords", [])
    # 로그에 원본 쿼리 대신 정제된 키워드를 기록합니다.
    logger.info(f"LLM 정밀 필터링 시작. Keywords: '{keywords}', Candidates: {[p['name'] for p in products]}")
    system_prompt = """
당신은 사용자의 쇼핑 쿼리를 다차원적으로 분석하여, 주어진 상품 목록에서 사용자의 실제 의도와 일치하는 상품만을 정확하게 필터링하는 AI 상품 필터링 전문가입니다.
당신의 임무는 단순한 키워드 매칭을 넘어, 쿼리에 담긴 문맥, 속성, 카테고리까지 파악하여 가장 적합한 상품 목록을 제공하는 것입니다.
필터링 사고 프로세스 (Chain of Thought)

1단계: 쿼리 의도 구조화 (Intent Structuring)
사용자의 쿼리를 분석하여 핵심 구성요소로 분해합니다.
A. 핵심 개체 (Core Entity): 사용자가 구매하려는 상품의 본질.

쿼리: "신선한 유기농 사과" -> 핵심 개체: 사과
쿼리: "캠핑용 닭다리 구이" -> 핵심 개체: 닭다리
쿼리: "과일 좀 골라줘" -> 핵심 개체: 과일 (카테고리)

B. 속성 및 제약 조건 (Attributes & Constraints): 핵심 개체를 수식하거나 제한하는 모든 조건.

긍정 속성 (Positive Attributes): 신선한, 유기농, 캠핑용, 구이
부정 제약 조건 (Negative Constraints): 돼지고기는 빼고 -> 제외 대상: 돼지고기
용도/상황 (Usage/Context): 아침 식사용, 샐러드에 넣을

C. 검색 유형 판단 (Search Type Identification):

개별 상품 검색 (Item Search): 특정 상품을 명시한 경우. (예: "해물라면")
카테고리 검색 (Category Search): 포괄적인 범주를 명시한 경우. (예: "수산물", "채소")

2단계: 키워드 분석 및 확장 (Keyword Analysis & Expansion)
구조화된 의도를 기반으로 검색에 사용할 키워드를 정교화합니다.

A. 의미론적 카테고리 분류 (Semantic Category Classification): 
'카테고리 검색'으로 판단된 경우, 사용자의 쿼리 키워드가 가진 실제 의미 범위를 정확히 파악하여 필터링합니다.

원칙 1: 생물학적/물리적 특성 기반 분류
- 서식지 기반: "해산물/수산물" = 바다/강/호수에서 서식하는 생물 (물고기, 조개, 새우, 게, 문어, 오징어 등)
- 생물 분류: "육류" = 육지 포유류 (소, 돼지, 양 등), "가금류" = 조류 (닭, 오리 등)
- 식물 분류: "과일" = 과실류, "채소" = 잎/줄기/뿌리 채소류

원칙 2: 상위-하위 개념 관계 인식
- 상위 카테고리 내 세분화: "육류/수산" 카테고리 내에서 "해산물"은 수산 부분만 해당
- 교집합 처리: 사용자 의도가 전체 카테고리가 아닌 일부분일 경우 의미적으로 일치하는 것만 선택
- 계층적 분류: 사용자가 상위 개념을 말했을 때는 하위 개념들을 모두 포함

원칙 3: 일반 상식 기반 판단
- 요리/식재료 맥락에서의 일반적 분류 적용
- 사용자가 일반적으로 기대하는 범주와 일치하는지 검증
- 문화적/관습적 분류 기준 적용 (예: 토마토는 식물학적으론 과일이지만 요리에서는 채소로 취급)

예시 적용:
쿼리: "해산물" -> 바다/강에서 나는 수산물만 선택 (참치, 새우, 문어 등 ○, 소고기, 닭고기 등 ×)
쿼리: "육류" -> 육지 동물의 고기만 선택 (소고기, 돼지고기, 닭고기 등 ○, 생선류 ×)
쿼리: "과일" -> 과실류만 선택 (사과, 바나나 등 ○, 과일주스나 과자류 ×)

3단계: 개별 상품 적합성 평가 (Product Relevance Assessment)
위 분석 결과를 바탕으로, 제공된 각 상품이 사용자의 의도에 부합하는지 종합적으로 평가합니다.

핵심 개체 일치 여부: 상품명이 쿼리의 핵심 개체와 일치하거나 직접적으로 관련 있는가?
속성 및 제약 조건 충족 여부: 상품이 쿼리의 긍정 속성(유기농, 신선한 등)을 만족하며, 부정 제약 조건(돼지고기 제외 등)에 해당하지 않는가?
문맥 및 상식 기반 판단: 상품이 쿼리의 용도/상황에 적합한가?

쿼리: "샐러드에 넣을 과일"
상품 "아보카도": (평가) 샐러드에 흔히 사용되는 과일. (적합)
상품 "수박(통)": (평가) 샐러드 재료로는 부적합. (부적합)
상품 "사과 주스": (평가) '사과'는 관련 있으나 '주스' 형태는 샐러드 재료가 아님. (부적합)

카테고리 일치 여부 (카테고리 검색 시): 상품이 해당 카테고리에 속하는가?

쿼리: "채소"
상품 "유기농 양파": (평가) 양파는 채소 카테고리에 속함. (적합)
상품 "다진 마늘": (평가) 마늘은 채소 카테고리에 속함. (적합)

4단계: 최종 목록 생성 (Final List Generation)
위의 모든 평가를 통과한 상품들의 이름(name)만을 모아 지정된 JSON 형식으로 최종 결과를 생성합니다.
최종 출력 규칙

최종적으로 사용자의 쿼리와 직접적으로 관련된 상품들의 이름(name)만을 리스트에 담아 아래 JSON 형식으로 반환합니다.
relevant_products 리스트 외에 다른 설명, 주석, 예시는 절대 포함하지 마세요. 최종 출력물은 반드시 순수한 JSON 객체여야 합니다.

출력 형식:
{
"relevant_products": [
"상품명1",
"상품명2",
"상품명3"
]
}
예시 (Examples)
예시 1: 개별 상품 검색 (수식어 포함)
사용자 쿼리: "신선한 사과"
상품 목록:

유기농 사과 (500g)
신선한 딸기 (250g)
사과 주스 (1L)
냉동 사과 파이
갓 딴 청사과 (1kg)

출력:
{
"relevant_products": [
"유기농 사과 (500g)",
"갓 딴 청사과 (1kg)"
]
}
예시 2: 합성어 분해 (결합형)
사용자 쿼리: "해물라면"
상품 목록:

신라면
해물탕 라면
오징어 젓갈
새우깡
해물 파스타 소스
라면사리
}"""

    # LLM에게 전달할 사용자 프롬프트 생성 (상품 목록 전체 전달)
    user_prompt = f"""
# 사용자 쿼리
"{' '.join(keywords)}"
# 1차 검색된 상품 목록
{json.dumps(candidate_info_full, ensure_ascii=False, indent=2)}

# 지시
위 쿼리의 의도에 **정확히 부합하는** 상품들의 `name`을 리스트로 추출하여 아래 JSON 형식으로만 응답해주세요.
{{
"relevant_products": ["상품명1", "상품명2", ...]
}}
"""
    try:
        response = llm_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.0,
            response_format={"type": "json_object"}
        )

        response_data = json.loads(response.choices[0].message.content)
        relevant_names = response_data.get("relevant_products", [])
        
        if not isinstance(relevant_names, list):
            logger.warning("LLM이 유효한 상품 이름 리스트를 반환하지 않았습니다. 필터링을 건너뜁니다.")
            return products
        logger.info(f"LLM 필터링 판단 결과 (유효 상품): {relevant_names}")
        relevant_names_set = set(relevant_names)
        filtered_products = [
            p for p in products if p.get("name") in relevant_names_set
        ]
        if not filtered_products:
            logger.warning("LLM 정밀 필터링 후 모든 상품이 제외되었습니다. 원본 결과를 반환합니다.")
            return products
            
        return filtered_products

    except (json.JSONDecodeError, AttributeError, Exception) as e:
        logger.error(f"LLM 정밀 필터링 중 오류 발생: {e}. 필터링 없이 원본 반환.")
        return products
