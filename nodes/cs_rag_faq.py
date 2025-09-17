from typing import Dict, Any, List
from .cs_common import openai_client, pinecone_index, get_db_connection, logger
from mysql.connector import Error


def faq_policy_rag(state) -> Dict[str, Any]:
    logger.info("FAQ RAG 검색 시작", extra={"user_id": getattr(state, 'user_id', None), "query": getattr(state, 'query', '')})
    logger.info(f"OpenAI 클라이언트: {openai_client is not None}, Pinecone 인덱스: {pinecone_index is not None}")
    if not (openai_client and pinecone_index):
        logger.info("RAG 조건 실패 - DB 폴백으로 이동")
        return _faq_db_fallback(state)
    try:
        embedding_response = openai_client.embeddings.create(model="text-embedding-3-small", input=state.query)
        query_embedding = embedding_response.data[0].embedding
        results = pinecone_index.query(vector=query_embedding, top_k=5, include_metadata=True,
                                       filter={"type": {"$in": ["faq", "terms"]}})
        logger.info(f"Pinecone 검색 결과: {len(results.matches)}개 매치")
        if not results.matches:
            logger.info("검색 결과 없음 - DB 폴백으로 이동")
            return _faq_db_fallback(state)
        docs, citations = [], []
        threshold = 0.4  # 유사도 임계값
        for i, match in enumerate(results.matches):
            md = match.metadata or {}
            score = match.score

            # 임계값 이하 문서는 제외 (로그도 출력하지 않음)
            if score < threshold:
                continue

            logger.info(f"검색 결과 {i+1}: 점수={score:.3f}, 카테고리={md.get('category','')}")

            content = md.get("text", "")
            docs.append(content)
            citations.append(f"{md.get('type','unknown')}:{md.get('category','')}")
            logger.info(f"내용: {content[:200]}...")  # 내용 일부 로깅

        # 임계값을 넘는 문서가 없으면 DB 폴백
        if not docs:
            logger.info(f"임계값 {threshold} 이상인 문서가 없음 - DB 폴백으로 이동")
            return _faq_db_fallback(state)

        logger.info(f"최종적으로 {len(docs)}개 문서 사용")
        context_text = "\n\n".join(docs)
        rag_prompt = f"""
        다음은 고객 질문과 관련된 참고 문서입니다.

        질문: {state.query}

        참고 문서:
        {context_text}

        위 문서를 기반으로 고객에게 친절하고 정확한 답변을 200자 이내로 작성하세요.
        """
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": rag_prompt}],
            temperature=0.2,
            max_tokens=400,
        )
        answer_text = (response.choices[0].message.content or "").strip()
        confidence = 0.8
        return {"cs": {"answer": {"text": answer_text, "citations": citations[:3], "confidence": confidence}}}
    except Exception as e:
        logger.error(f"Pinecone RAG 실패: {e} → DB 폴백 실행")
        return _faq_db_fallback(state)


def _faq_db_fallback(state) -> Dict[str, Any]:
    try:
        faq_results = _search_faq(state.query)
        best_answer = _select_best_answer(faq_results, state.query)
        confidence = _calculate_confidence(best_answer, state.query)
        if confidence > 0.3:
            answer_text = best_answer["answer"]
            citations = [f"faq:{best_answer['category']}#{best_answer['id']}"]
        else:
            answer_text = "죄송하지만 정확한 답변을 찾지 못했습니다. 상담사가 도와드리겠습니다."
            citations = []
        return {
            "cs": {"answer": {"text": answer_text, "citations": citations, "confidence": confidence,
                              "searched_faqs": len(faq_results)}},
            "meta": {"rag_method": "db_fallback", "should_handoff": confidence < 0.3},
        }
    except Exception as e:
        logger.error(f"FAQ DB 폴백 실패: {e}")
        return {"cs": {"answer": {"text": "시스템 오류로 답변을 생성할 수 없습니다.",
                                   "citations": [], "confidence": 0.0, "error": str(e)}}}


def _search_faq(query: str) -> List[Dict[str, Any]]:
    query_lower = (query or "").lower()
    keywords = query_lower.split()
    conn = get_db_connection()
    if not conn:
        return []
    try:
        with conn.cursor(dictionary=True) as cursor:
            if not keywords:
                return []
            where_clauses = " OR ".join(["question LIKE %s" for _ in keywords])
            params = [f"%{keyword}%" for keyword in keywords]
            sql = f"SELECT faq_id as id, question, answer, faq_category as category FROM faq_tbl WHERE {where_clauses}"
            cursor.execute(sql, params)
            results = cursor.fetchall()
            for row in results:
                score = sum(1 for keyword in keywords if keyword in (row.get("question") or "").lower())
                row["score"] = score
            results.sort(key=lambda x: x["score"], reverse=True)
            return results
    except Error as e:
        logger.error(f"FAQ 검색 실패: {e}")
        return []
    finally:
        if conn and conn.is_connected():
            conn.close()


def _select_best_answer(faq_results: List[Dict[str, Any]], query: str) -> Dict[str, Any]:
    if not faq_results:
        return {"id": "no_result", "answer": "관련 정보를 찾을 수 없습니다.", "category": "none", "score": 0.0}
    return faq_results[0]


def _calculate_confidence(answer: Dict[str, Any], query: str) -> float:
    base_score = answer.get("score", 0.0)
    if base_score >= 2.0:
        return 0.9
    elif base_score >= 1.0:
        return 0.7
    elif base_score > 0.0:
        return 0.4
    else:
        return 0.1