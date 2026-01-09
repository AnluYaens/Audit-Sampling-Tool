import pytest
from backend import create_app, db
from backend.models import User
from backend.utils import validate_signup_payload, validate_login_payload, summarize_anomaly_reason

@pytest.fixture
def client():
    app = create_app()
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-key"
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    
    with app.app_context():
        db.create_all()
        yield app.test_client()
        db.session.remove()
        db.drop_all()

# --- Auth & Security Tests ---

def test_validation_limits(client):
    """Test payload size and transaction count limits."""
    # Authenticate first
    email = "limit_test@example.com"
    password = "password123"
    
    # Create user
    client.post("/api/auth/signup", json={
        "name": "Limit Tester",
        "email": email,
        "password": password,
        "confirmPassword": password
    })
    
    # Login
    client.post("/api/auth/login", json={"email": email, "password": password})

    # Test Transaction Limit: Create a fake payload with 10001 items
    large_payload = [{"amount": 100} for _ in range(10001)]
    res = client.post("/api/anomaly/score", json={"transactions": large_payload})
    assert res.status_code == 400
    assert "limit exceeded" in res.get_json()["error"]

    # Test Valid Count
    valid_payload = [{"amount": 100} for _ in range(10)]
    res_valid = client.post("/api/anomaly/score", json={"transactions": valid_payload})
    if res_valid.status_code == 400:
        # Just in case our limit logic changes, ensure 'limit exceeded' isn't the reason
        assert "limit exceeded" not in res_valid.get_json().get("error", "")

def test_auth_flow(client):
    """Test signup, login, access, and logout."""
    # 1. Signup
    email = "security_test@example.com"
    password = "securepassword123"
    
    client.post("/api/auth/signup", json={
        "name": "Test User",
        "email": email,
        "password": password,
        "confirmPassword": password
    })

    # 2. Login
    login_res = client.post("/api/auth/login", json={
        "email": email,
        "password": password
    })
    assert login_res.status_code == 200

    # 3. Access Protected Endpoint
    score_res = client.post("/api/anomaly/score", json={"transactions": []})
    assert score_res.status_code != 401

    # 4. Logout
    logout_res = client.post("/api/auth/logout")
    assert logout_res.status_code == 200

    # 5. Access Again (Should be 401)
    score_res_again = client.post("/api/anomaly/score", json={"transactions": []})
    assert score_res_again.status_code == 401

# --- Utility Function Tests ---

def test_validate_signup_valid():
    """Test valid signup payload."""
    payload = {
        "name": "Valid User",
        "email": "test@example.com",
        "password": "password123",
        "confirmPassword": "password123"
    }
    result = validate_signup_payload(payload)
    assert result["email"] == "test@example.com"

def test_validate_signup_mismatch_password():
    """Test validation fails when passwords do not match."""
    payload = {
        "name": "User",
        "email": "test@example.com",
        "password": "password123",
        "confirmPassword": "mismatch"
    }
    with pytest.raises(ValueError, match="Passwords do not match"):
        validate_signup_payload(payload)

def test_validate_login_valid():
    """Test valid login payload."""
    payload = {"email": "test@example.com", "password": "password123"}
    result = validate_login_payload(payload)
    assert result["email"] == "test@example.com"

def test_summarize_anomaly_reason():
    """Test anomaly reason summarization logic."""
    row = {"vendor": "Vendor A", "amount": 5000}
    features = {
        "amount": 5000,
        "vendor_avg_amount": 500,
        "vendor_amount_ratio": 10.0,  # 10x higher
        "global_amount_zscore": 1.0
    }
    reason = summarize_anomaly_reason(row, features)
    assert "10.0x higher than Vendor A's usual spend" in reason
