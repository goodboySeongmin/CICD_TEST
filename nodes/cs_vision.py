import base64
import json
from typing import Dict, Any, List, Tuple, Optional
from .cs_common import openai_client, logger


def _normalize_name(s: str) -> str:
    import re
    if not s:
        return ""
    s = s.lower()
    s = re.sub(r"[\s\-_/,.()·]+", "", s)
    s = re.sub(r"[^0-9a-z가-힣]", "", s)
    return s


_BASIC_SYNONYMS = {
    "대파": ["파", "쪽파", "springonion", "scallion", "greenonion"],
    "사과": ["apple"],
    "바나나": ["banana"],
    "양파": ["onion"],
    "감자": ["potato"],
}


def _fallback_synonym_match(target: str, candidates: List[str]) -> bool:
    t = _normalize_name(target)
    syn = _BASIC_SYNONYMS.get(target, []) or _BASIC_SYNONYMS.get(t, [])
    keys = {_normalize_name("".join(s.split())) for s in syn}
    keys.add(t)
    for c in candidates:
        nc = _normalize_name(c)
        if not nc:
            continue
        if nc in keys:
            return True
    return False


def _llm_same_product_check(target_name: str, candidates: List[str], ocr_text: List[str]) -> Tuple[bool, float, str]:
    if not openai_client:
        ok = _fallback_synonym_match(target_name, candidates + ocr_text)
        return ok, 0.6 if ok else 0.0, "fallback-only"
    system = (
        "너는 전자상거래 CS 심사 보조원이다. "
        "입력된 '선택상품명'과 '이미지 추정 품목/텍스트'가 같은 상품인지 판정하라. "
        "한국어로 판단하며, 결과는 반드시 JSON만 반환한다. "
        "키: {same:boolean, confidence:number(0~1), reason:string(짧게 한국어)}"
    )
    user = {
        "선택상품명": target_name,
        "이미지_추정_품목": candidates,
        "이미지_OCR": ocr_text,
        "판정기준": [
            "상품군/품목이 동일하면 same=true (예: 대파 vs green onion/scallion)",
            "다르면 false (예: 대파 vs 사과)",
            "모호하면 신중히 낮은 confidence 부여",
        ],
    }
    resp = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ],
        temperature=0.1,
        max_tokens=200,
    )
    raw = (resp.choices[0].message.content or "").strip()
    try:
        obj = json.loads(raw)
        same = bool(obj.get("same"))
        conf = float(obj.get("confidence") or 0.0)
        reason = str(obj.get("reason") or "")
        return same, conf, reason
    except Exception:
        return False, 0.0, "parse-failed"


def check_product_match(target_product_name: str, analysis: Dict[str, Any]) -> Tuple[bool, float, str]:
    candidates = []
    p = (analysis or {}).get("primary_item") or ""
    if p:
        candidates.append(str(p))
    candidates += [str(x) for x in ((analysis or {}).get("detected_items") or [])]
    ocr = [str(x) for x in ((analysis or {}).get("ocr_text") or [])]
    if _fallback_synonym_match(target_product_name, candidates + ocr):
        return True, 0.8, "synonym-match"
    same, conf, reason = _llm_same_product_check(target_product_name, candidates, ocr)
    return same, conf, reason


def analyze_attachments(attachments: List[str]) -> Optional[Dict[str, Any]]:
    if not attachments or not openai_client:
        return None
    try:
        image_path = attachments[0]
        # hjs 수정: 업로드 확장자에 따른 MIME 설정(jpg 포함) 및 사전 검증
        import os
        ext = os.path.splitext(image_path)[1].lower().lstrip('.')
        mime_map = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
        }
        if ext not in mime_map:
            logger.error("Vision API 분석 실패: unsupported file type '%s'", ext)
            return {
                "error": "unsupported_type",
                "message": "해당 파일은 지원되지 않는 파일입니다. 지원되는 파일로 업로드를 진행해주세요.",
                "supported_types": ["png", "jpg", "jpeg", "gif", "webp"],
            }
        with open(image_path, "rb") as f:
            encoded_image = base64.b64encode(f.read()).decode("utf-8")
        system_prompt = (
            "당신은 식재료 환불/교환 심사용 이미지 분석 보조원입니다.\n"
            "아래의 '반드시 지킬 것'을 따라 **오직 하나의 JSON 객체**만 반환하세요.\n\n"
            "[반드시 지킬 것]\n"
            "1) 출력은 JSON 한 개만. 설명/문장/코드펜스 금지.\n"
            "2) 모든 텍스트 값은 한국어로 작성.\n"
            "3) 다음 키만 포함:\n"
            "   - primary_item: string      # 사진에서 보이는 주된 품목명(가능하면 한국어 일반명)\n"
            "   - detected_items: string[]  # 감지된 품목들(한국어)\n"
            "   - ocr_text: string[]        # 이미지에서 읽힌 짧은 문자들(한국어가 보이면 한국어로)\n"
            "   - quality_issues: string[]  # ['곰팡이','상처','변색','누수','없음'] 등\n"
            "   - is_defective: boolean     # 불량이면 true\n"
            "   - issue_summary: string     # 한국어 한두 문장 요약\n"
            "   - confidence: number        # 0~1\n"
        )
        user_text = (
            "사진 속 식재료의 불량 여부를 평가하세요. 곰팡이, 심한 멍(상처), 큰 변색, 누수 등 명백한 결함이 보이면 "
            "is_defective=true로 설정하세요. 품목명(primary_item)은 가능하면 한국어 일반명으로 적고, "
            "라벨/문구가 보이면 ocr_text에 짧게 담아주세요. 결과는 반드시 한국어 값을 갖는 단일 JSON으로만 출력하세요."
        )
        resp = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": [
                    {"type": "text", "text": user_text},
                    # hjs 수정: 실제 MIME으로 전달(jpg 포함)
                    {"type": "image_url", "image_url": {"url": f"data:{mime_map[ext]};base64,{encoded_image}"}},
                ]},
            ],
            temperature=0.1,
            max_tokens=500,
        )
        raw = (resp.choices[0].message.content or "").strip()
        return json.loads(raw)
    except Exception as e:
        logger.error("Vision API 분석 실패: %s", e)
        return {
            "primary_item": "",
            "detected_items": [],
            "ocr_text": [],
            "quality_issues": ["분석 실패"],
            "is_defective": False,
            "issue_summary": "이미지 분석 실패",
            "confidence": 0.0,
        }

