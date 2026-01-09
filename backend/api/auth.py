from flask import Blueprint, request, jsonify
from flask_login import login_user, logout_user, login_required
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
from itsdangerous import URLSafeTimedSerializer
from flask import current_app

from backend.models import db, User
from backend import limiter
from backend.utils import validate_signup_payload, validate_login_payload

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/api/auth/signup', methods=['POST'])
@limiter.limit("5 per hour")
def signup():
    payload = request.get_json(silent=True) or {}
    
    try:
        data = validate_signup_payload(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    # Check if user already exists
    if User.query.filter_by(email=data["email"]).first():
        return jsonify({"error": "Email already exists"}), 409

    # Create new User
    new_user = User(
        name=data["name"],
        email=data["email"],
        password_hash=generate_password_hash(data["password"]),
        created_at=datetime.utcnow().isoformat()
    )
    db.session.add(new_user)
    db.session.commit()

    return jsonify({"message": "Account created successfully."}), 201

@auth_bp.route('/api/auth/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    payload = request.get_json(silent=True) or {}
    try:
        data = validate_login_payload(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    user = User.query.filter_by(email=data["email"]).first()

    if not user or not check_password_hash(user.password_hash, data["password"]):
        return jsonify({"error": "Invalid email or password"}), 401

    # Log user in (session-based)
    login_user(user)

    # Generate token for cookie-less clients
    s = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
    token = s.dumps(user.id)

    return jsonify({
        "message": "Signed in successfully.",
        "token": token,
        "user": {
            "id": user.id,
            "name": user.name,
            "createdAt": user.created_at
        }
    })

@auth_bp.route('/api/auth/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return jsonify({"message": "Logged out successfully."})