"""
Minimal Flask backend that persists users in SQLite.

The client-side login/sign-up forms submit to the `/api/auth/*` endpoints
exposed here. Passwords are hashed with Werkzeug helpers so no plain text
credentials are stored on disk.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd
from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager,
    UserMixin,
    login_required,
    login_user,
    logout_user,
    current_user,
)
from joblib import load
from werkzeug.security import check_password_hash, generate_password_hash
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_compress import Compress
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from ml import FEATURE_COLUMNS, REQUIRED_RAW_COLUMNS, prepare_features

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATABASE_PATH = DATA_DIR / "auth.db"
MODELS_DIR = BASE_DIR / "models"
MODEL_PATH = MODELS_DIR / "isolation_forest.joblib"
MODEL_META_PATH = MODELS_DIR / "isolation_forest.json"
EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

app = Flask(__name__, static_folder=".", static_url_path="")
app.secret_key = os.getenv('SECRET_KEY', 'change-this-to-a-secure-random-key-in-production')
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{DATABASE_PATH}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16MB limit


db = SQLAlchemy(app)

# Enable response compression
Compress(app)

# Configure rate limiting
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

from itsdangerous import URLSafeTimedSerializer

# Initialize Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)

# Serializer for generating auth tokens
serializer = URLSafeTimedSerializer(app.secret_key)

MODEL_PIPELINE = None
MODEL_METADATA: Dict[str, Any] = {}


class User(UserMixin, db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    created_at = db.Column(db.String(50), nullable=False, default=datetime.utcnow().isoformat)


@login_manager.user_loader
def load_user(user_id: str):
    return db.session.get(User, int(user_id))

@login_manager.request_loader
def load_user_from_request(request):
    """Support token-based auth for clients that can't use cookies (e.g. file://)."""
    auth_header = request.headers.get("Authorization")
    if auth_header:
        try:
            token = auth_header.replace("Bearer ", "", 1)
            user_id = serializer.loads(token, max_age=86400) # Valid for 24 hours
            return db.session.get(User, int(user_id))
        except Exception:
            return None
    return None


def init_storage() -> None:
    """Ensure folders exist and bootstrap the SQLite schema."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with app.app_context():
        db.create_all()


def load_anomaly_model() -> None:
    """Load the Isolation Forest pipeline and metadata if present."""
    global MODEL_PIPELINE, MODEL_METADATA
    MODEL_PIPELINE = None
    MODEL_METADATA = {}
    if not MODEL_PATH.exists():
        app.logger.info("Isolation Forest model missing at %s", MODEL_PATH)
        return
    try:
        MODEL_PIPELINE = load(MODEL_PATH)
    except Exception as exc:  # pragma: no cover - defensive log
        app.logger.exception("Failed to load anomaly model.", exc_info=exc)
        MODEL_PIPELINE = None
        return
    if MODEL_META_PATH.exists():
        try:
            MODEL_METADATA = json.loads(MODEL_META_PATH.read_text())
        except json.JSONDecodeError:
            app.logger.warning(
                "Anomaly metadata file is invalid JSON: %s", MODEL_META_PATH
            )
            MODEL_METADATA = {}


def get_anomaly_threshold() -> float:
    """Return the configured threshold or a safe default."""
    threshold = MODEL_METADATA.get("threshold")
    if threshold is not None:
        return float(threshold)
    if MODEL_PIPELINE is not None and hasattr(MODEL_PIPELINE, "offset_"):
        return float(getattr(MODEL_PIPELINE, "offset_", 0.0))
    return 0.0


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


@app.after_request
def add_cors_headers(response):
    """Allow local static pages (file://) to call the API."""
    # Since we are using Token Auth (Bearer), we don't need credentials (cookies).
    # This allows us to use wildcard '*' which is much more robust for file:// access.
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response


@app.route("/api/health", methods=["GET"])
def healthcheck():
    return jsonify({"status": "ok"})


@app.route("/api/auth/signup", methods=["POST"])
@limiter.limit("5 per hour")
def signup():
    payload = request.get_json(silent=True) or {}
    try:
        data = validate_signup_payload(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        new_user = User(
            name=data["name"],
            email=data["email"],
            password_hash=generate_password_hash(data["password"]),
            created_at=datetime.utcnow().isoformat(timespec="seconds"),
        )
        db.session.add(new_user)
        db.session.commit()
    except Exception:  # SQLAlchemy raises IntegrityError but generic catch is safer for now
        return jsonify({"error": "An account with that email already exists."}), 409

    return jsonify({"message": "Account created successfully."}), 201


@app.route("/api/auth/login", methods=["POST"])
@limiter.limit("10 per minute")
def login():
    payload = request.get_json(silent=True) or {}
    try:
        data = validate_login_payload(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    user = User.query.filter_by(email=data["email"]).first()

    if not user or not check_password_hash(user.password_hash, data["password"]):
        return jsonify({"error": "Invalid email or password."}), 401

    # Create user object and log in
    login_user(user)

    # Generate token for stateless clients
    token = serializer.dumps(user.id)

    return jsonify(
        {
            "message": "Signed in successfully.",
            "token": token,
            "user": {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "createdAt": user.created_at,
            },
        }
    )


@app.route("/api/auth/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    return jsonify({"message": "Logged out successfully."})


def _safe_float(value: Any, default: float = 0.0) -> float:
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
    amount = _safe_float(row.get("amount"), _safe_float(features.get("amount"), 0.0))
    vendor_avg = _safe_float(features.get("vendor_avg_amount"))
    dept_avg = _safe_float(features.get("dept_avg_amount"))
    vendor_ratio = _safe_float(features.get("vendor_amount_ratio"))
    dept_ratio = _safe_float(features.get("dept_amount_ratio"))
    vendor_freq = _safe_float(features.get("vendor_txn_freq"))
    dept_freq = _safe_float(features.get("dept_txn_freq"))
    global_z = _safe_float(features.get("global_amount_zscore"))

    reasons: List[str] = []
    if vendor_ratio >= 5 and vendor_avg > 0:
        reasons.append(
            f"Amount {amount:,.2f} is {vendor_ratio:.1f}× higher than {vendor}'s usual spend (~{vendor_avg:,.2f})."
        )
    if dept_ratio >= 5 and dept_avg > 0:
        reasons.append(
            f"Amount {amount:,.2f} is {dept_ratio:.1f}× the average for {department} (~{dept_avg:,.2f})."
        )
    if global_z >= 3:
        reasons.append(
            f"Value is {global_z:.1f} standard deviations above the dataset average."
        )
    if vendor_freq <= 1:
        reasons.append(f"First transaction recorded for {vendor} in this file.")
    if dept_freq <= 1:
        reasons.append(
            f"{department} only appears once, so this entry has no comparable peers."
        )

    if not reasons:
        return "Model flagged this entry as unusual compared to prior transactions."
    # Combine up to two concise reasons.
    return " ".join(reasons[:2])


@app.route("/api/anomaly/meta", methods=["GET"])
@login_required
def anomaly_meta():
    """Expose model availability so the UI can conditionally enable features."""
    available = MODEL_PIPELINE is not None
    payload = {
        "available": available,
        "requiredFields": REQUIRED_RAW_COLUMNS,
        "threshold": MODEL_METADATA.get("threshold"),
        "trainedAt": MODEL_METADATA.get("trained_at"),
    }
    if not available:
        payload["message"] = "Isolation Forest model not trained yet."
    return jsonify(payload)


@app.route("/api/anomaly/score", methods=["POST"])
@login_required
def anomaly_score():
    """Score client-provided transactions with the Isolation Forest model."""
    if MODEL_PIPELINE is None:
        return (
            jsonify(
                {"error": "Anomaly model unavailable. Train it before scoring data."}
            ),
            503,
        )

    payload = request.get_json(silent=True) or {}
    rows = payload.get("transactions")
    if not isinstance(rows, list) or not rows:
        return jsonify({"error": "Provide a non-empty 'transactions' array."}), 400
    
    if len(rows) > 10000:
        return jsonify({"error": "Batch size limit exceeded. Maximum 10,000 transactions per request."}), 400

    if not all(isinstance(row, dict) for row in rows):
        return jsonify({"error": "Each transaction must be an object."}), 400

    frame = pd.DataFrame(rows)
    missing = [field for field in REQUIRED_RAW_COLUMNS if field not in frame.columns]
    if missing:
        return (
            jsonify({"error": f"Missing required fields: {', '.join(missing)}"}),
            400,
        )

    features = prepare_features(frame)
    try:
        scores = MODEL_PIPELINE.decision_function(features[FEATURE_COLUMNS])
    except Exception:  # pragma: no cover - defensive log
        app.logger.exception("Isolation Forest scoring failed.")
        return jsonify({"error": "Anomaly scoring failed. Check server logs."}), 500

    threshold = get_anomaly_threshold()
    feature_records = features.to_dict(orient="records")
    results = []
    for idx, score in enumerate(scores):
        is_anomaly = score < threshold
        reason = ""
        if is_anomaly and idx < len(feature_records):
            reason = summarize_anomaly_reason(rows[idx], feature_records[idx])
        results.append(
            {
                "index": idx,
                "score": float(score),
                "isAnomaly": bool(is_anomaly),
                "reason": reason,
            }
        )
    return jsonify(
        {
            "results": results,
            "threshold": threshold,
            "requiredFields": REQUIRED_RAW_COLUMNS,
        }
    )


init_storage()
load_anomaly_model()


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "File too large. Maximum size is 16MB."}), 413


# Serve static HTML files
@app.route("/")
def serve_index():
    return app.send_static_file("index.html")

@app.route("/<path:path>")
def serve_static(path):
    """Serve static files (HTML, CSS, JS, etc.)"""
    try:
        return app.send_static_file(path)
    except:
        # If file not found, redirect to index
        return app.send_static_file("index.html")


if __name__ == "__main__":
    app.run(debug=True)
