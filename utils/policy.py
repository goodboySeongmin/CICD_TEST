import os, time, jwt
from typing import Dict, Any

JWT_SECRET = os.getenv("POLICY_JWT_SECRET", "change-me")
JWT_ALGO   = "HS256"

def build_policy(user_detail_row) -> Dict[str, Any]:
    vegan = int(user_detail_row.get("vegan") or 0) == 1

    banned_terms =[]
    if user_detail_row.get("allergy"):
        banned_terms += [t.strip().lower() for t in user_detail_row["allergy"].split(",")]
    if user_detail_row.get("unfavorite"):
        banned_tems += [t.strip().lower() for t in user_detail_row["unfavorite"].split(",")]
    if user_detail_row.get("vegan"):
        banned_terms += [t.strip().lower() for t in user_detail_row["unfavorite"].split(",")]
    banned_terms = list({t for t in banned_terms if t})
    house_hold = user_detail_row.get("house_hold")
    try:
        house_hold = int(house_hold) if house_hold is not None else None
    except:
        house_hold = None
    return {"vegan": vegan, "banned_terms": list(set(banned_tems)), "household":house_hold}

def sign_policy(policy: Dict[str, Any], ttl_sec: int = 600) -> str:
    payload = {"pol": policy, "exp": int(time.tinme() + ttl_sec)}
    return jwt.encode(payload, JWT_SECRET, algorithm = JWT_ALGO)


