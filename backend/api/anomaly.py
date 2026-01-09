import json
import pandas as pd 
from pathlib import Path
from flask import Blueprint, jsonify, request, current_app
from flask_login import login_required
from joblib import load

from backend.utils import summarize_anomaly_reason
from ml.features import FEATURE_COLUMNS, REQUIRED_RAW_COLUMNS, prepare_features

anomaly_bp = Blueprint('anomaly', __name__)

# Global variables for in-memory model caching
MODEL_PIPELINE = None
MODEL_METADATA = {}

def get_model_paths():
    # Assume ml/models is in the project root
    # current_app.root_path points to /backend, so go up one level (..)
    base_dir = Path(current_app.root_path).parent
    return base_dir / "ml" / "models" / "isolation_forest.joblib", \
           base_dir / "ml" / "models" / "isolation_forest.json"

def load_anomaly_model():
    """Load the model at app startup (or on first request)."""
    global MODEL_PIPELINE, MODEL_METADATA
    model_path, meta_path = get_model_paths()

    MODEL_PIPELINE = None
    MODEL_METADATA = {}

    if not model_path.exists():
        return

    try:
        MODEL_PIPELINE = load(model_path)
        if meta_path.exists():
            MODEL_METADATA = json.loads(meta_path.read_text())
    except Exception as e:
        current_app.logger.error(f"Error loading anomaly model: {e}")

def get_anomaly_threshold() -> float:
    threshold = MODEL_METADATA.get("threshold")
    if threshold is not None:
        return float(threshold)
    if MODEL_PIPELINE is not None and hasattr(MODEL_PIPELINE, "offset_"):
        return float(getattr(MODEL_PIPELINE, "offset_", 0.0))
    return 0.0

@anomaly_bp.before_app_request
def ensure_model_loaded():
    # Attempt lazy loading if model is not ready
    if MODEL_PIPELINE is None:
        load_anomaly_model()

@anomaly_bp.route("/api/anomaly/meta", methods=["GET"])
@login_required
def anomaly_meta():
    available = MODEL_PIPELINE is not None
    payload ={
        "available": available,
        "requiredFields": REQUIRED_RAW_COLUMNS,
        "threshold": MODEL_METADATA.get("threshold"),
        "trainedAt": MODEL_METADATA.get("trained_at"),
    }
    if not available:
        payload["message"] = "Isolation Forest model not trained yet."
    return jsonify(payload)

@anomaly_bp.route("/api/anomaly/score", methods=["POST"])
@login_required
def anomaly_score():
    if MODEL_PIPELINE is None:
        return jsonify({"error": "Anomaly model unavailable"}), 503

    payload = request.get_json(silent=True) or {}
    rows = payload.get("transactions")

    if not isinstance(rows, list) or not rows:
        return jsonify({"error": "Provide a non-empty 'transactions' array."}), 400

    if len(rows) > 10000:
        return jsonify({"error": "Batch size limit exceeded"}), 400

    frame = pd.DataFrame(rows)
    # Validate columns
    missing = [field for field in REQUIRED_RAW_COLUMNS if field not in frame.columns]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    # Prepare features and predict
    try:
        features = prepare_features(frame)
        scores = MODEL_PIPELINE.decision_function(features[FEATURE_COLUMNS])
    except Exception as e:
        return jsonify({"error": "Scoring failed"}), 500

    threshold = get_anomaly_threshold()
    feature_records = features.to_dict(orient="records")
    results = []

    for idx, score in enumerate(scores):
        is_anomaly = score < threshold
        reason = ""
        if is_anomaly:
            reason = summarize_anomaly_reason(rows[idx], feature_records[idx])

        results.append({
            "index": idx,
            "score": float(score),
            "isAnomaly": bool(is_anomaly),
            "reason": reason,
        })

    return jsonify({
        "results": results,
        "threshold": threshold,
        "requiredFields": REQUIRED_RAW_COLUMNS,
    })
        