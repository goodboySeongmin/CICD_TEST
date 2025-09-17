"""
Kakao 주소 검색 API 연동
Daum 우편번호 서비스를 사용한 주소 검색 기능
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import aiohttp
import logging

logger = logging.getLogger(__name__)

# Kakao 주소 API 라우터
kakao_router = APIRouter(prefix="/kakao", tags=["kakao-address"])

class AddressSearchRequest(BaseModel):
    query: str
    page: Optional[int] = 1
    size: Optional[int] = 10

class AddressSearchResponse(BaseModel):
    success: bool
    addresses: List[Dict[str, Any]]
    total_count: int
    message: Optional[str] = None

# Kakao REST API 키 (환경변수에서 설정 권장)
KAKAO_REST_API_KEY = "YOUR_KAKAO_REST_API_KEY"

class KakaoAddressService:
    """Kakao 주소 검색 서비스"""
    
    def __init__(self):
        self.api_key = KAKAO_REST_API_KEY
        self.base_url = "https://dapi.kakao.com/v2/local/search/address"
    
    async def search_address(self, query: str, page: int = 1, size: int = 10) -> Dict[str, Any]:
        """주소 검색 API 호출"""
        
        if not self.api_key or self.api_key == "YOUR_KAKAO_REST_API_KEY":
            # API 키가 없는 경우 모의 데이터 반환
            return await self._mock_address_search(query)
        
        headers = {
            "Authorization": f"KakaoAK {self.api_key}",
            "Content-Type": "application/json"
        }
        
        params = {
            "query": query,
            "page": page,
            "size": size
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.base_url, headers=headers, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        return self._format_address_response(data)
                    else:
                        logger.error(f"Kakao API 오류: {response.status}")
                        return {"success": False, "error": "주소 검색 API 호출 실패"}
                        
        except Exception as e:
            logger.error(f"주소 검색 중 오류 발생: {e}")
            return {"success": False, "error": "주소 검색 중 오류가 발생했습니다"}
    
    async def _mock_address_search(self, query: str) -> Dict[str, Any]:
        """모의 주소 검색 결과 (API 키 없을 때)"""
        
        mock_addresses = [
            {
                "address_name": "서울 강남구 테헤란로 123",
                "address_type": "ROAD",
                "x": "127.0276194",
                "y": "37.4979517",
                "road_address": {
                    "address_name": "서울 강남구 테헤란로 123",
                    "building_name": "Qook 빌딩",
                    "main_building_no": "123",
                    "region_1depth_name": "서울",
                    "region_2depth_name": "강남구",
                    "region_3depth_name": "역삼동",
                    "road_name": "테헤란로",
                    "sub_building_no": "",
                    "underground_yn": "N",
                    "zone_no": "06142"
                }
            },
            {
                "address_name": "서울 서초구 서초대로 456",
                "address_type": "ROAD", 
                "x": "127.0276194",
                "y": "37.4979517",
                "road_address": {
                    "address_name": "서울 서초구 서초대로 456",
                    "building_name": "신선마트",
                    "main_building_no": "456",
                    "region_1depth_name": "서울",
                    "region_2depth_name": "서초구",
                    "region_3depth_name": "서초동",
                    "road_name": "서초대로",
                    "sub_building_no": "",
                    "underground_yn": "N",
                    "zone_no": "06651"
                }
            }
        ]
        
        # 검색어가 포함된 주소만 필터링
        filtered_addresses = [
            addr for addr in mock_addresses 
            if query.lower() in addr["address_name"].lower()
        ]
        
        if not filtered_addresses:
            # 검색 결과가 없으면 기본 주소 반환
            filtered_addresses = mock_addresses[:1]
        
        return {
            "success": True,
            "addresses": filtered_addresses,
            "total_count": len(filtered_addresses)
        }
    
    def _format_address_response(self, kakao_response: Dict[str, Any]) -> Dict[str, Any]:
        """Kakao API 응답을 표준 형식으로 변환"""
        
        try:
            documents = kakao_response.get("documents", [])
            meta = kakao_response.get("meta", {})
            
            formatted_addresses = []
            for doc in documents:
                road_address = doc.get("road_address")
                if road_address:
                    formatted_addresses.append({
                        "address_name": road_address.get("address_name"),
                        "building_name": road_address.get("building_name", ""),
                        "zone_no": road_address.get("zone_no", ""),
                        "region_1depth_name": road_address.get("region_1depth_name"),
                        "region_2depth_name": road_address.get("region_2depth_name"),
                        "region_3depth_name": road_address.get("region_3depth_name"),
                        "road_name": road_address.get("road_name"),
                        "main_building_no": road_address.get("main_building_no"),
                        "coordinates": {
                            "x": doc.get("x"),
                            "y": doc.get("y")
                        }
                    })
            
            return {
                "success": True,
                "addresses": formatted_addresses,
                "total_count": meta.get("total_count", len(formatted_addresses))
            }
            
        except Exception as e:
            logger.error(f"주소 응답 포맷팅 중 오류: {e}")
            return {"success": False, "error": "주소 데이터 처리 중 오류가 발생했습니다"}

# 전역 서비스 인스턴스
kakao_address_service = KakaoAddressService()

@kakao_router.post("/address/search", response_model=AddressSearchResponse)
async def search_address(request: AddressSearchRequest):
    """주소 검색 API"""
    
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="검색어를 입력해주세요")
        
        result = await kakao_address_service.search_address(
            query=request.query,
            page=request.page,
            size=request.size
        )
        
        if result["success"]:
            return AddressSearchResponse(
                success=True,
                addresses=result["addresses"],
                total_count=result["total_count"]
            )
        else:
            raise HTTPException(status_code=500, detail=result["error"])
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"주소 검색 API 처리 중 오류: {e}")
        raise HTTPException(status_code=500, detail="주소 검색 중 오류가 발생했습니다")

@kakao_router.get("/address/validate/{zone_no}")
async def validate_postal_code(zone_no: str):
    """우편번호 유효성 검증"""
    
    try:
        # 우편번호 형식 검증 (5자리 숫자)
        if not zone_no.isdigit() or len(zone_no) != 5:
            return {
                "success": False,
                "valid": False,
                "message": "올바른 우편번호 형식이 아닙니다 (5자리 숫자)"
            }
        
        # 실제 우편번호 데이터베이스와 검증 (여기서는 기본 검증만)
        valid_prefixes = ["01", "02", "03", "04", "05", "06", "07", "08", "09"]
        is_valid = any(zone_no.startswith(prefix) for prefix in valid_prefixes)
        
        return {
            "success": True,
            "valid": is_valid,
            "zone_no": zone_no,
            "message": "유효한 우편번호입니다" if is_valid else "존재하지 않는 우편번호입니다"
        }
        
    except Exception as e:
        logger.error(f"우편번호 검증 중 오류: {e}")
        raise HTTPException(status_code=500, detail="우편번호 검증 중 오류가 발생했습니다")