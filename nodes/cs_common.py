"""
Common utilities and clients shared across CS modules.
"""
import os
import logging
from decimal import Decimal
from typing import Any
from dotenv import load_dotenv
from datetime import datetime

import mysql.connector
from mysql.connector import Error

load_dotenv()

logger = logging.getLogger("E_CS_COMMON")

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "user": os.getenv("DB_USER", "qook_user"),
    "password": os.getenv("DB_PASSWORD", "qook_pass"),
    "database": os.getenv("DB_NAME", "qook_chatbot"),
    "port": int(os.getenv("DB_PORT", "3306")),
}

CS_DEFECT_THRESHOLD = float(os.getenv("CS_DEFECT_THRESHOLD", "0.35"))
CS_AUTO_ACCEPT_DEBUG = os.getenv("CS_AUTO_ACCEPT_DEBUG", "false").lower() == "true"
CS_PRODUCT_MATCH_THRESHOLD = float(os.getenv("CS_PRODUCT_MATCH_THRESHOLD", "0.60"))

def get_db_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except Error as e:
        logger.error(f"DB 연결 실패: {e}")
        return None


# OpenAI client (optional)
try:
    import openai

    openai_api_key = os.getenv("OPENAI_API_KEY")
    openai_client = openai.OpenAI(api_key=openai_api_key) if openai_api_key else None
    if not openai_api_key:
        logger.warning("OpenAI API key not found. Using mock responses.")
except Exception:
    openai_client = None
    logger.warning("OpenAI package not available.")

# Pinecone client (optional)
try:
    from pinecone import Pinecone

    pinecone_api_key = os.getenv("PINECONE_API_KEY")
    pinecone_index_name = "qook"
    if pinecone_api_key:
        pinecone_client = Pinecone(api_key=pinecone_api_key)
        pinecone_index = pinecone_client.Index(pinecone_index_name)
    else:
        pinecone_client = None
        pinecone_index = None
        logger.warning("Pinecone API key not found. Using mock responses.")
except Exception:
    pinecone_client = None
    pinecone_index = None
    logger.warning("Pinecone package not available.")


def _to_float(val: Any) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    try:
        s = str(val).strip().replace(",", "")
        return float(s)
    except Exception:
        try:
            return float(Decimal(str(val)))
        except Exception:
            return 0.0


def _to_int(val: Any) -> int:
    if val is None:
        return 0
    if isinstance(val, int):
        return val
    try:
        s = str(val).strip().replace(",", "")
        return int(float(s))
    except Exception:
        try:
            return int(Decimal(str(val)))
        except Exception:
            return 0


def _fmt_dt(d):
    if isinstance(d, datetime):
        return d.strftime("%Y-%m-%d %H:%M")
    return str(d) if d is not None else ""


def _fmt_date(d):
    if isinstance(d, datetime):
        return d.strftime("%Y-%m-%d")
    return str(d) if d is not None else ""