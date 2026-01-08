from typing import Any, Dict, List
import re

EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

def validate_signup_payload(payload: Dict[str, Any]) -> Dict[str, str]:
    """Basic server-side validation to mirror the client guardrails."""
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    confirm_password = payload.get("confirmPassword") or ""

    if len(name) < 2:
        raise ValueError("Name must be at least 2 characters.")
    if not EMAIL_REGEX.match(email):
        raise ValueError("Enter a valid email address.")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if not confirm_password:
        raise ValueError("Password confirmation is required.")
    if password != confirm_password:
        raise ValueError("Passwords do not match.")

    return {"name": name, "email": email, "password": password}

def validate_login_payload(payload: Dict[str, Any]) -> Dict[str, str]:
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    if not EMAIL_REGEX.match(email):
        raise ValueError("Enter a valid email address.")
    if not password:
        raise ValueError("Password is required.")
    return {"email": email, "password": password}

def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        
        return float(value)
    except (TypeError, ValueError):
        return default

def summarize_anomaly_reason(row: Dict[str, Any], features: Dict[str, Any]) -> str:
    """Create a human-readable explanation for why a row was flagged."""
    vendor = (row.get("vendor") or "").strip() or "this vendor"
    department = (row.get("department") or "").strip() or "this department"

    amount = safe_float(row.get("amount"), safe_float(features.get("amount"), 0.0))
    vendor_avg = safe_float(features.get("vendor_avg_amount"))
    dept_avg = safe_float(features.get("dept_avg_amount"))
    vendor_ratio = safe_float(features.get("vendor_amount_ratio"))
    dept_ratio = safe_float(features.get("dept_amount_ratio"))
    vendor_freq = safe_float(features.get("vendor_txn_freq"))
    dept_freq = safe_float(features.get("dept_txn_freq"))
    global_z = safe_float(features.get("global_amount_zscore"))

    reasons: List[str] = []

    if vendor_ratio >= 5 and vendor_avg > 0:
        reasons.append(
            f"Amount {amount:,.2f} is {vendor_ratio:.1f}x higher than {vendor}'s usual spend (~{vendor_avg:,.2f})."
        )
    
    if dept_ratio >= 5 and dept_avg > 0:
        reasons.append(
            f"Amount {amount:,.2f} is {dept_ratio:.1f}x the average for {department} (~{dept_avg:,.2f})."
        )

    if global_z >= 3:
        reasons.append(
            f"Value is {global_z:.1f} standard deviation above the dataset average."
        )

    if vendor_freq <= 1:
        reasons.append(f"First transaction recorded for {vendor} in this file.")
    
    if dept_freq <= 1:
        reasons.append(
            f"{department} only appears once, so this entry has no comparable peers."
        )
    
    if not reasons:
        return "Model flagged this entry as unusual compared to prior transactions."
    
    # Combine up to two concise reasons
    return " ".join(reasons[:2])

