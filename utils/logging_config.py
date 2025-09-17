import logging
import sys
from typing import Optional
from config import config

def setup_logging(level: Optional[str] = None, format_string: Optional[str] = None) -> None:
    log_level = level or config.LOG_LEVEL
    log_format = format_string or config.LOG_FORMAT
    
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)
    
    # 루트 로거 설정
    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)
    
    # 기존 핸들러 제거
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
        
    # 새 핸들러 추가
    formatter = logging.Formatter(log_format)
    
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    root_logger.addHandler(stream_handler)
    
    # (선택) 파일 핸들러
    # try:
    #     file_handler = logging.FileHandler("./var/qook_chatbot.log", encoding="utf-8")
    #     file_handler.setFormatter(formatter)
    #     root_logger.addHandler(file_handler)
    # except FileNotFoundError:
    #     os.makedirs("./var", exist_ok=True)
    #     file_handler = logging.FileHandler("./var/qook_chatbot.log", encoding="utf-8")
    #     file_handler.setFormatter(formatter)
    #     root_logger.addHandler(file_handler)

    # 특정 라이브러리 로그 레벨 조정
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    
    logger = logging.getLogger(__name__)
    logger.info(f"로깅이 {log_level} 레벨로 설정되었습니다.")