from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field

@dataclass
class ChatState:
    user_id: str
    session_id: Optional[str] = None
    query: Optional[str] = None
    turn_id: int = 0
    attachments: List[str] = field(default_factory=list)
    image: Optional[str] = None  # base64 인코딩된 이미지 데이터
    vision_mode: bool = False    # 비전 모드 여부
    
    route: Dict[str, Any] = field(default_factory=dict)
    rewrite: Dict[str, Any] = field(default_factory=dict)
    slots: Dict[str, Any] = field(default_factory=dict)
    search: Dict[str, Any] = field(default_factory=dict)
    recipe: Dict[str, Any] = field(default_factory=dict)
    cart: Dict[str, Any] = field(default_factory=dict)
    checkout: Dict[str, Any] = field(default_factory=dict)
    order: Dict[str, Any] = field(default_factory=dict)
    cs: Dict[str, Any] = field(default_factory=dict)
    handoff: Dict[str, Any] = field(default_factory=dict)
    end: Dict[str, Any] = field(default_factory=dict)

    meta: Dict[str, Any] = field(default_factory=dict)
    
    def update(self, data: Dict[str, Any]):
        for key, value in data.items():
            if hasattr(self, key) and value:
                # 딕셔너리 필드는 업데이트, 다른 필드는 덮어쓰기
                if isinstance(getattr(self, key), dict):
                    getattr(self, key).update(value)
                else:
                    setattr(self, key, value)